"""
Attendee payments: UPI proof upload + Razorpay Standard Checkout.
"""

import logging
import os
import secrets
from typing import Optional

import razorpay
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.event_management import EventManagement
from Models.payment_proof import PaymentProof
from Models.user import User
from Services.file_storage import store_bytes
from Services.rate_limit import limit_payment
from Utils.categories import is_allowed_image_bytes, is_allowed_image_filename
from Utils.datetimes import utc_now
from Utils.text_sanitize import sanitize_text

logger = logging.getLogger(__name__)

router = APIRouter()
# Mounted at /api so POST /api/create-order and /api/verify-payment match the Standard Checkout guide.
razorpay_router = APIRouter()


def _auto_issue_and_deliver(db: Session, row: PaymentProof) -> dict:
    """
    Mint unique QR tickets and deliver via email / WhatsApp / website.
    Payment is already recorded — never fail the payment response if delivery hiccups.
    """
    try:
        from APIs.admin import _deliver_ticket, _issue_tickets_from_payment

        booking = _issue_tickets_from_payment(db, row)
        delivery = _deliver_ticket(booking, row.attendee_phone or "", db=db)
        primary = (booking.tickets or [None])[0]
        token = getattr(primary, "qr_token", None) or delivery.get("qr_token")
        return {
            "booking_id": str(booking.booking_id),
            "qr_token": token,
            "ticket_url": delivery.get("ticket_url"),
            "qr_image_url": delivery.get("qr_image_url"),
            "email_sent": bool(delivery.get("email_sent")),
            "whatsapp_sent": bool(delivery.get("whatsapp_sent")),
            "status": "qr_ready",
            "delivery": delivery,
        }
    except Exception:
        logger.exception("Auto QR issue/delivery failed for payment_proof id=%s", getattr(row, "id", None))
        try:
            db.rollback()
        except Exception:
            pass
        return {
            "booking_id": None,
            "qr_token": None,
            "ticket_url": None,
            "qr_image_url": None,
            "email_sent": False,
            "whatsapp_sent": False,
            "status": getattr(row, "status", None) or "payment_submitted",
            "delivery": None,
        }


def _razorpay_credentials() -> tuple[str, str]:
    key_id = (os.getenv("RAZORPAY_KEY_ID") or "").strip()
    key_secret = (os.getenv("RAZORPAY_KEY_SECRET") or "").strip()
    if not key_id or not key_secret:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET on the server.",
        )
    return key_id, key_secret


def _razorpay_client() -> tuple[razorpay.Client, str]:
    key_id, key_secret = _razorpay_credentials()
    return razorpay.Client(auth=(key_id, key_secret)), key_id


class CreateOrderRequest(BaseModel):
    amount: int = Field(..., description="Amount in paise (minimum 100)")
    currency: str = Field(default="INR", max_length=8)
    receipt: Optional[str] = Field(default=None, max_length=40)
    event_id: Optional[str] = Field(default=None, max_length=255)
    ticket_type: Optional[str] = Field(default=None, max_length=100)
    quantity: Optional[int] = Field(default=1, ge=1, le=20)


class VerifyPaymentRequest(BaseModel):
    razorpay_order_id: str = Field(..., min_length=1, max_length=120)
    razorpay_payment_id: str = Field(..., min_length=1, max_length=120)
    razorpay_signature: str = Field(..., min_length=1, max_length=255)
    event_id: Optional[str] = Field(default=None, max_length=255)
    ticket_type: Optional[str] = Field(default=None, max_length=100)
    quantity: Optional[int] = Field(default=1, ge=1, le=20)
    amount: Optional[float] = Field(default=None, description="Amount in rupees for recording")
    attendee_name: Optional[str] = Field(default=None, max_length=120)
    attendee_phone: Optional[str] = Field(default=None, max_length=40)


def _clamp_purchase_quantity(db: Session, event_id: str, requested) -> int:
    try:
        qty = int(requested or 1)
    except (TypeError, ValueError):
        qty = 1
    qty = max(1, qty)
    host = None
    if event_id:
        try:
            host = db.query(EventManagement).filter(EventManagement.event_id == event_id).first()
        except Exception:
            # Non-UUID / invalid event ids must not abort payment recording after a valid signature.
            db.rollback()
            host = None
    meta = {}
    if host and isinstance(getattr(host, "policies_json", None), dict):
        meta = host.policies_json.get("_ticket_purchase") or {}
    mode = str(meta.get("mode") or "single").strip().lower()
    if mode != "multiple":
        return 1
    try:
        limit = int(meta.get("per_person_limit") or 2)
    except (TypeError, ValueError):
        limit = 2
    limit = max(2, min(limit, 20))
    return min(qty, limit)


@router.post("/proof", status_code=status.HTTP_201_CREATED)
async def submit_payment_proof(
    request: Request,
    event_id: str = Form(...),
    ticket_type: str = Form("General Admission"),
    amount: float = Form(0),
    quantity: int = Form(1),
    attendee_name: str = Form(...),
    attendee_email: str = Form(...),
    attendee_phone: str = Form(...),
    bank_name: str = Form(""),
    transaction_id: str = Form(...),
    screenshot: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    limit_payment(request)
    name = sanitize_text(attendee_name, max_length=120)
    email = sanitize_text(attendee_email or current_user.email or "", max_length=255).lower()
    phone = sanitize_text(attendee_phone, max_length=40)
    bank = sanitize_text(bank_name, max_length=120)
    txn = sanitize_text(transaction_id, max_length=80)
    if not name or not email or not phone or not txn:
        raise HTTPException(status_code=400, detail="Please fill name, email, phone number, and transaction ID.")

    data = await screenshot.read()
    if not data:
        raise HTTPException(status_code=400, detail="Please upload a payment screenshot.")
    filename = os.path.basename(screenshot.filename or "payment-screenshot.png")
    if not is_allowed_image_filename(filename):
        raise HTTPException(status_code=400, detail="Screenshot must be a JPG, PNG, or WEBP image.")
    content_type = (screenshot.content_type or "").lower()
    if not is_allowed_image_bytes(data, content_type):
        raise HTTPException(status_code=400, detail="Screenshot is not a valid image file.")

    stored = store_bytes(
        db,
        data=data,
        filename=screenshot.filename or "payment-screenshot.png",
        content_type=content_type or "image/png",
        kind="payment_proof",
        purpose="payment_screenshot",
        owner_customer_id=current_user.customer_id,
        owner_email=email,
    )

    existing = (
        db.query(PaymentProof)
        .filter(
            PaymentProof.event_id == str(event_id),
            func.lower(PaymentProof.attendee_email) == email,
        )
        .order_by(PaymentProof.created_at.desc())
        .first()
    )
    if existing and (existing.status or "") != "qr_ready":
        existing.attendee_name = name
        existing.attendee_phone = phone
        existing.bank_name = bank
        existing.transaction_id = txn
        existing.ticket_type = (ticket_type or "").strip() or existing.ticket_type
        existing.amount = float(amount or 0)
        existing.quantity = _clamp_purchase_quantity(db, str(event_id), quantity)
        existing.screenshot_file_id = stored.id
        existing.customer_id = current_user.customer_id
        existing.status = "payment_submitted"
        existing.created_at = utc_now()
        db.commit()
        db.refresh(existing)
        try:
            db.execute(text("UPDATE payment_proofs SET booking_id = NULL WHERE id = :id"), {"id": existing.id})
            db.commit()
        except Exception:
            db.rollback()
        row = existing
    else:
        row = PaymentProof(
            customer_id=current_user.customer_id,
            event_id=str(event_id),
            ticket_type=(ticket_type or "").strip() or "General Admission",
            amount=float(amount or 0),
            quantity=_clamp_purchase_quantity(db, str(event_id), quantity),
            attendee_name=name,
            attendee_email=email,
            attendee_phone=phone,
            bank_name=bank,
            transaction_id=txn,
            screenshot_file_id=stored.id,
            status="payment_submitted",
            created_at=utc_now(),
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    ticket = _auto_issue_and_deliver(db, row)
    message = (
        "Payment received. Your QR ticket is ready — check email, WhatsApp, and Your Orders."
        if ticket.get("qr_token")
        else "Payment received. Your ticket is being prepared; contact support if it does not appear shortly."
    )
    return {
        "message": message,
        "payment_id": row.id,
        "status": ticket.get("status") or row.status,
        **ticket,
    }


def _record_razorpay_payment(
    db: Session,
    current_user: User,
    *,
    event_id: Optional[str],
    ticket_type: Optional[str],
    quantity: Optional[int],
    amount_rupees: Optional[float],
    payment_id: str,
    attendee_name: Optional[str],
    attendee_phone: Optional[str],
) -> PaymentProof:
    email = sanitize_text(current_user.email or "", max_length=255).lower()
    if not email:
        raise HTTPException(status_code=400, detail="Your account has no email address.")
    name = sanitize_text(
        attendee_name or getattr(current_user, "full_name", None) or getattr(current_user, "username", None) or email,
        max_length=120,
    )
    phone = sanitize_text(
        attendee_phone or getattr(current_user, "phone", None) or getattr(current_user, "mobile", None) or "N/A",
        max_length=40,
    ) or "N/A"
    event_key = sanitize_text(event_id or "", max_length=255) or None
    ticket = sanitize_text(ticket_type or "General Admission", max_length=100) or "General Admission"
    qty = _clamp_purchase_quantity(db, event_key or "", quantity) if event_key else max(1, int(quantity or 1))
    amount_val = float(amount_rupees or 0)

    existing = None
    if event_key:
        existing = (
            db.query(PaymentProof)
            .filter(
                PaymentProof.event_id == event_key,
                func.lower(PaymentProof.attendee_email) == email,
            )
            .order_by(PaymentProof.created_at.desc())
            .first()
        )
    if existing and (existing.status or "") != "qr_ready":
        existing.attendee_name = name
        existing.attendee_phone = phone
        existing.bank_name = "Razorpay"
        existing.transaction_id = payment_id
        existing.ticket_type = ticket
        existing.amount = amount_val
        existing.quantity = qty
        existing.customer_id = current_user.customer_id
        existing.status = "payment_submitted"
        existing.created_at = utc_now()
        db.commit()
        db.refresh(existing)
        try:
            db.execute(text("UPDATE payment_proofs SET booking_id = NULL WHERE id = :id"), {"id": existing.id})
            db.commit()
        except Exception:
            db.rollback()
        return existing

    row = PaymentProof(
        customer_id=current_user.customer_id,
        event_id=event_key,
        ticket_type=ticket,
        amount=amount_val,
        quantity=qty,
        attendee_name=name,
        attendee_email=email,
        attendee_phone=phone,
        bank_name="Razorpay",
        transaction_id=payment_id,
        screenshot_file_id=None,
        status="payment_submitted",
        created_at=utc_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


async def create_razorpay_order(
    payload: CreateOrderRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a Razorpay order. Amount must be in paise (min 100)."""
    limit_payment(request)
    amount_paise = int(payload.amount or 0)
    if amount_paise < 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Amount must be at least 100 paise (₹1).",
        )
    currency = (payload.currency or "INR").strip().upper() or "INR"
    receipt = sanitize_text(payload.receipt or "", max_length=40)
    if not receipt:
        receipt = f"jod_{secrets.token_hex(6)}"

    client, key_id = _razorpay_client()
    try:
        order = client.order.create(
            {
                "amount": amount_paise,
                "currency": currency,
                "receipt": receipt,
                "payment_capture": 1,
                "notes": {
                    "event_id": sanitize_text(payload.event_id or "", max_length=255),
                    "ticket_type": sanitize_text(payload.ticket_type or "", max_length=100),
                    "quantity": str(payload.quantity or 1),
                    "customer_id": getattr(current_user, "customer_id", None) or "",
                },
            }
        )
    except razorpay.errors.BadRequestError as exc:
        logger.warning("Razorpay create order bad request: %s", exc)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    except Exception as exc:
        message = str(exc).lower()
        if "authentication" in message or "auth" in message or "401" in message:
            logger.error("Razorpay authentication failed while creating order")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Razorpay authentication failed. Check RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.",
            ) from exc
        logger.exception("Razorpay create order failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not create Razorpay order. Please try again.",
        ) from exc

    return {
        "order_id": order.get("id"),
        "amount": order.get("amount"),
        "currency": order.get("currency") or currency,
        "key_id": key_id,
        "receipt": order.get("receipt") or receipt,
    }


async def verify_razorpay_payment(
    payload: VerifyPaymentRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verify Razorpay checkout signature (HMAC-SHA256 of order_id|payment_id)."""
    limit_payment(request)
    order_id = (payload.razorpay_order_id or "").strip()
    payment_id = (payload.razorpay_payment_id or "").strip()
    signature = (payload.razorpay_signature or "").strip()
    if not order_id or not payment_id or not signature:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing razorpay_order_id, razorpay_payment_id, or razorpay_signature.",
        )

    client, _key_id = _razorpay_client()
    try:
        client.utility.verify_payment_signature(
            {
                "razorpay_order_id": order_id,
                "razorpay_payment_id": payment_id,
                "razorpay_signature": signature,
            }
        )
    except razorpay.errors.SignatureVerificationError as exc:
        logger.warning("Razorpay signature mismatch for order %s", order_id)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payment signature verification failed. Payment was not marked as paid.",
        ) from exc
    except Exception as exc:
        message = str(exc).lower()
        if "signature" in message:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Payment signature verification failed. Payment was not marked as paid.",
            ) from exc
        logger.exception("Razorpay verify failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Could not verify payment. Please contact support with your payment ID.",
        ) from exc

    amount_rupees = payload.amount
    if amount_rupees is None:
        amount_rupees = 0.0

    row = _record_razorpay_payment(
        db,
        current_user,
        event_id=payload.event_id,
        ticket_type=payload.ticket_type,
        quantity=payload.quantity,
        amount_rupees=amount_rupees,
        payment_id=payment_id,
        attendee_name=payload.attendee_name,
        attendee_phone=payload.attendee_phone,
    )

    ticket = _auto_issue_and_deliver(db, row)
    message = (
        "Payment verified. Your QR ticket is ready — check email, WhatsApp, and Your Orders."
        if ticket.get("qr_token")
        else "Payment verified. Your ticket is being prepared; contact support if it does not appear shortly."
    )
    return {
        "success": True,
        "message": message,
        "payment_id": row.id,
        "status": ticket.get("status") or row.status,
        "razorpay_payment_id": payment_id,
        "razorpay_order_id": order_id,
        **ticket,
    }


# Same handlers under /api/payments/* and /api/* for the Standard Checkout guide paths.
router.add_api_route("/create-order", create_razorpay_order, methods=["POST"], status_code=200)
router.add_api_route("/verify-payment", verify_razorpay_payment, methods=["POST"], status_code=200)
razorpay_router.add_api_route("/create-order", create_razorpay_order, methods=["POST"], status_code=200)
razorpay_router.add_api_route("/verify-payment", verify_razorpay_payment, methods=["POST"], status_code=200)
