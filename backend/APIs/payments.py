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
from sqlalchemy import func, or_, text
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.event_management import EventManagement
from Models.form_submissions import FormSubmission
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


def _auto_issue_and_deliver(db: Session, row: PaymentProof, submission_id: Optional[int] = None) -> dict:
    """
    Mint unique QR tickets and deliver via email / WhatsApp / website.
    Payment is already recorded — never fail the payment response if delivery hiccups.
    """
    try:
        from APIs.admin import _deliver_ticket, _issue_tickets_from_payment

        booking = _issue_tickets_from_payment(db, row, submission_id=submission_id)
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


class ClaimFreeTicketRequest(BaseModel):
    event_id: str = Field(..., min_length=1, max_length=255)
    ticket_type: Optional[str] = Field(default="General Admission", max_length=100)
    quantity: Optional[int] = Field(default=1, ge=1, le=20)
    attendee_name: Optional[str] = Field(default=None, max_length=120)
    attendee_phone: Optional[str] = Field(default=None, max_length=40)


def _ticket_label(item: dict) -> str:
    return str(
        item.get("name")
        or item.get("ticket_name")
        or item.get("title")
        or item.get("type")
        or item.get("ticket_type")
        or ""
    ).strip()


def _ticket_unit_price(item: dict) -> Optional[float]:
    for key in ("price", "amount", "ticket_price", "unit_price"):
        if key not in item or item.get(key) is None:
            continue
        try:
            return float(item.get(key) or 0)
        except (TypeError, ValueError):
            return None
    return None


def _resolve_ticket_unit_price(db: Session, event_id: str, ticket_type: str) -> float:
    """Server-side unit price for a ticket tier. Prefer host tickets_json, then catalog."""
    from Models.event import Event
    from APIs.events import _host_tickets_for_event, _parse_json_field

    wanted = (ticket_type or "").strip().lower()
    tiers: list = []
    host_tiers = _host_tickets_for_event(db, event_id)
    if isinstance(host_tiers, list):
        tiers.extend([t for t in host_tiers if isinstance(t, dict)])

    event = None
    try:
        event = db.query(Event).filter(Event.id == event_id).first()
    except Exception:
        db.rollback()
        event = None
    if event is None:
        try:
            from sqlalchemy import cast, String
            event = db.query(Event).filter(cast(Event.id, String) == str(event_id)).first()
        except Exception:
            db.rollback()
            event = None

    if event is not None:
        catalog = _parse_json_field(getattr(event, "ticket_types", None))
        if isinstance(catalog, list):
            for item in catalog:
                if isinstance(item, dict):
                    tiers.append(item)

    exact_prices = []
    fuzzy_prices = []
    for item in tiers:
        label = _ticket_label(item).lower()
        if not label:
            continue
        price = _ticket_unit_price(item)
        if price is None:
            continue
        if wanted and label == wanted:
            exact_prices.append(price)
        elif wanted and (wanted in label or label in wanted):
            fuzzy_prices.append(price)

    if exact_prices:
        return float(min(exact_prices))
    if fuzzy_prices:
        return float(min(fuzzy_prices))

    # Named tiers exist but none matched — do not fall back (avoids free-claim of paid tiers).
    named_tiers = [t for t in tiers if _ticket_label(t)]
    if named_tiers and wanted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Ticket type '{ticket_type}' was not found for this event.",
        )

    if event is not None and getattr(event, "price", None) is not None:
        try:
            return float(event.price or 0)
        except (TypeError, ValueError):
            return 0.0
    return 0.0


def _compact_id(value) -> str:
    return str(value or "").replace("-", "").strip().lower()


def _form_answers(submission) -> dict:
    raw = getattr(submission, "answers_json", None) if submission is not None else None
    if isinstance(raw, str):
        try:
            import json
            raw = json.loads(raw)
        except Exception:
            raw = {}
    return raw if isinstance(raw, dict) else {}


def _latest_host_form_submission(
    db: Session,
    event_id: str,
    user: User,
    ticket_type: Optional[str] = None,
    *,
    unpaid_only: bool = True,
) -> Optional[FormSubmission]:
    """Latest host registration form for this account + event (prefer unpaid)."""
    from APIs.bookings import _stored_event_matches

    login_email = sanitize_text(getattr(user, "email", None) or "", max_length=255).lower()
    customer_id = str(getattr(user, "customer_id", None) or "").strip()
    owner_filters = []
    if login_email:
        owner_filters.append(func.lower(FormSubmission.user_email) == login_email)
    if customer_id:
        owner_filters.append(FormSubmission.customer_id == customer_id)
    if not owner_filters:
        return None
    try:
        rows = (
            db.query(FormSubmission)
            .filter(or_(*owner_filters))
            .order_by(FormSubmission.submission_time.desc())
            .all()
        )
    except Exception:
        db.rollback()
        return None

    matches = []
    for row in rows:
        try:
            if not _stored_event_matches(db, row.event_id, event_id):
                continue
        except Exception:
            db.rollback()
            if _compact_id(row.event_id) != _compact_id(event_id):
                continue
        status_val = (row.status or "").strip().lower()
        if status_val in ("cancelled", "canceled", "refunded"):
            continue
        if unpaid_only:
            if status_val == "paid":
                continue
            try:
                from Utils.form_submission_query import form_submission_booking_id
                if form_submission_booking_id(db, getattr(row, "id", None)):
                    continue
            except Exception:
                db.rollback()
        matches.append(row)
    if not matches:
        return None

    want = (ticket_type or "").strip().lower()
    if want:
        typed = []
        for row in matches:
            answers = _form_answers(row)
            label = str(
                row.ticket_type
                or answers.get("_ticket_type")
                or answers.get("ticket_type")
                or answers.get("Ticket Type")
                or answers.get("Ticket")
                or ""
            ).strip().lower()
            if label == want or (label and (want in label or label in want)):
                typed.append(row)
        if typed:
            return typed[0]
    return matches[0]


def _attendee_from_host_form(
    db: Session,
    current_user: User,
    *,
    event_id: str,
    ticket_type: Optional[str],
    payload_name: Optional[str] = None,
    payload_phone: Optional[str] = None,
) -> tuple[str, str, str, str, Optional[FormSubmission]]:
    """
    Prefer host-form name/email/phone for ticket PDF + delivery.
    Falls back to profile only when the form field is missing.
    Returns (name, delivery_email, phone, login_email, submission).
    """
    from APIs.admin import NAME_KEYS, PHONE_KEYS, _answer_value
    from APIs.forms import _pick_answer

    login_email = sanitize_text(current_user.email or "", max_length=255).lower()
    if not login_email:
        raise HTTPException(status_code=400, detail="Your account has no email address.")

    submission = _latest_host_form_submission(
        db, event_id, current_user, ticket_type, unpaid_only=True
    )
    if submission is None:
        submission = _latest_host_form_submission(
            db, event_id, current_user, ticket_type, unpaid_only=False
        )

    answers = _form_answers(submission)
    form_name = _answer_value(answers, NAME_KEYS) or _pick_answer(
        answers, "full name", "attendee name", "your name", "participant name", "guest name"
    )
    if not form_name:
        maybe = _pick_answer(answers, "name")
        if maybe and not any(tok in maybe.lower() for tok in ("pass", "ticket", "general admission")):
            form_name = maybe
    form_email = _answer_value(
        answers,
        (
            "email",
            "email_address",
            "email address",
            "e_mail",
            "e mail",
            "attendee_email",
            "attendee email",
            "your email",
            "mail",
            "mail id",
            "mailid",
        ),
    ) or _pick_answer(answers, "email", "e-mail", "mail id", "mailid")
    form_phone = _answer_value(answers, PHONE_KEYS) or _pick_answer(
        answers, "phone", "mobile", "whatsapp", "contact number"
    )

    name = sanitize_text(
        form_name
        or payload_name
        or getattr(current_user, "full_name", None)
        or getattr(current_user, "username", None)
        or login_email,
        max_length=120,
    )
    delivery_email = sanitize_text(form_email or login_email, max_length=255).lower() or login_email
    phone = sanitize_text(
        form_phone
        or payload_phone
        or getattr(current_user, "phone", None)
        or getattr(current_user, "mobile", None)
        or "N/A",
        max_length=40,
    ) or "N/A"
    return name, delivery_email, phone, login_email, submission


def _find_open_payment_proof(
    db: Session,
    event_key: str,
    current_user: User,
    login_email: str,
) -> Optional[PaymentProof]:
    """Latest unfinished payment proof for this buyer + event (not qr_ready).

    Match by buyer customer_id only. Do not match attendee_email to login email —
    guest tickets store the host-form email on the proof.
    """
    customer_id = str(getattr(current_user, "customer_id", None) or "").strip()
    if not customer_id:
        return None
    rows = (
        db.query(PaymentProof)
        .filter(PaymentProof.event_id == event_key)
        .order_by(PaymentProof.created_at.desc())
        .all()
    )
    for row in rows:
        if (row.status or "").strip().lower() == "qr_ready":
            continue
        if str(row.customer_id or "") == customer_id:
            return row
    return None


def _record_free_payment(
    db: Session,
    current_user: User,
    *,
    event_id: str,
    ticket_type: Optional[str],
    quantity: Optional[int],
    attendee_name: Optional[str],
    attendee_phone: Optional[str],
) -> PaymentProof:
    """One free claim / host form => one PaymentProof (keyed to that form when present)."""
    event_key = sanitize_text(event_id or "", max_length=255)
    if not event_key:
        raise HTTPException(status_code=400, detail="Missing event for free ticket claim.")
    ticket = sanitize_text(ticket_type or "General Admission", max_length=100) or "General Admission"
    name, delivery_email, phone, _login_email, submission = _attendee_from_host_form(
        db,
        current_user,
        event_id=event_key,
        ticket_type=ticket,
        payload_name=attendee_name,
        payload_phone=attendee_phone,
    )
    if submission is not None and getattr(submission, "id", None) is not None:
        from APIs.admin import _ensure_payment_proof_for_submission
        return _ensure_payment_proof_for_submission(db, submission)

    qty = _clamp_purchase_quantity(db, event_key, quantity)
    free_txn = f"FREE-{secrets.token_hex(8).upper()}"
    row = PaymentProof(
        customer_id=current_user.customer_id,
        event_id=event_key,
        ticket_type=ticket,
        amount=0.0,
        quantity=qty,
        attendee_name=name,
        attendee_email=delivery_email,
        attendee_phone=phone,
        bank_name="Free",
        transaction_id=free_txn,
        screenshot_file_id=None,
        status="payment_submitted",
        created_at=utc_now(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


async def claim_free_ticket(
    payload: ClaimFreeTicketRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Issue and deliver a free ticket without Razorpay. Paid tickets must use checkout."""
    limit_payment(request)
    event_id = sanitize_text(payload.event_id or "", max_length=255)
    if not event_id:
        raise HTTPException(status_code=400, detail="Missing event_id.")
    ticket_type = sanitize_text(payload.ticket_type or "General Admission", max_length=100) or "General Admission"
    qty = _clamp_purchase_quantity(db, event_id, payload.quantity)

    unit_price = _resolve_ticket_unit_price(db, event_id, ticket_type)
    total = round(float(unit_price or 0) * qty, 2)
    if total > 0.009:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This ticket is not free. Please complete payment via Razorpay.",
        )

    pending_form = _latest_host_form_submission(
        db, event_id, current_user, ticket_type=None, unpaid_only=True
    )
    if pending_form is None:
        # Re-deliver only the latest form's own payment row (not any older guest).
        latest_form = _latest_host_form_submission(
            db, event_id, current_user, ticket_type=None, unpaid_only=False
        )
        if latest_form is not None and getattr(latest_form, "id", None) is not None:
            from APIs.admin import _ensure_payment_proof_for_submission, _payment_by_form_submission_id
            existing_ready = _payment_by_form_submission_id(db, latest_form.id)
            if existing_ready is None:
                existing_ready = _ensure_payment_proof_for_submission(db, latest_form)
            if existing_ready is not None and (existing_ready.status or "").strip().lower() == "qr_ready":
                ticket = _auto_issue_and_deliver(db, existing_ready, submission_id=latest_form.id)
                return {
                    "success": True,
                    "message": (
                        "Your free ticket is already ready — check email, WhatsApp, and Your Orders."
                        if ticket.get("qr_token")
                        else "Your free ticket is being prepared; contact support if it does not appear shortly."
                    ),
                    "payment_id": existing_ready.id,
                    "status": ticket.get("status") or existing_ready.status,
                    "free": True,
                    **ticket,
                }

    row = _record_free_payment(
        db,
        current_user,
        event_id=event_id,
        ticket_type=ticket_type,
        quantity=qty,
        attendee_name=payload.attendee_name,
        attendee_phone=payload.attendee_phone,
    )
    submission_id = getattr(pending_form, "id", None) if pending_form is not None else None
    if submission_id is None and row is not None:
        # FREE-FORM-{id} txn encodes the submission id.
        txn = (row.transaction_id or "")
        if txn.startswith("FREE-FORM-") or txn.startswith("FORM-"):
            try:
                submission_id = int(txn.rsplit("-", 1)[-1])
            except (TypeError, ValueError):
                submission_id = None
    ticket = _auto_issue_and_deliver(db, row, submission_id=submission_id)
    message = (
        "Free ticket confirmed. Your QR ticket is ready — check email, WhatsApp, and Your Orders."
        if ticket.get("qr_token")
        else "Free ticket recorded. Your ticket is being prepared; contact support if it does not appear shortly."
    )
    return {
        "success": True,
        "message": message,
        "payment_id": row.id,
        "status": ticket.get("status") or row.status,
        "free": True,
        **ticket,
    }


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
    event_key = sanitize_text(event_id or "", max_length=255) or None
    ticket = sanitize_text(ticket_type or "General Admission", max_length=100) or "General Admission"
    if event_key:
        name, delivery_email, phone, login_email, _submission = _attendee_from_host_form(
            db,
            current_user,
            event_id=event_key,
            ticket_type=ticket,
            payload_name=attendee_name,
            payload_phone=attendee_phone,
        )
    else:
        login_email = sanitize_text(current_user.email or "", max_length=255).lower()
        if not login_email:
            raise HTTPException(status_code=400, detail="Your account has no email address.")
        name = sanitize_text(
            attendee_name
            or getattr(current_user, "full_name", None)
            or getattr(current_user, "username", None)
            or login_email,
            max_length=120,
        )
        delivery_email = login_email
        phone = sanitize_text(
            attendee_phone
            or getattr(current_user, "phone", None)
            or getattr(current_user, "mobile", None)
            or "N/A",
            max_length=40,
        ) or "N/A"

    qty = _clamp_purchase_quantity(db, event_key or "", quantity) if event_key else max(1, int(quantity or 1))
    amount_val = float(amount_rupees or 0)

    # Idempotent: same Razorpay payment_id must not create a second row.
    if payment_id:
        dup = (
            db.query(PaymentProof)
            .filter(PaymentProof.transaction_id == payment_id)
            .order_by(PaymentProof.created_at.desc())
            .first()
        )
        if dup is not None:
            if (dup.status or "").strip().lower() != "qr_ready":
                dup.attendee_name = name
                dup.attendee_email = delivery_email
                dup.attendee_phone = phone
                dup.bank_name = "Razorpay"
                dup.ticket_type = ticket
                dup.amount = amount_val
                dup.quantity = qty
                dup.customer_id = current_user.customer_id
                dup.status = "payment_submitted"
                db.commit()
                db.refresh(dup)
            return dup

    # Always insert a new proof per successful Razorpay payment (multi-guest buys).
    row = PaymentProof(
        customer_id=current_user.customer_id,
        event_id=event_key,
        ticket_type=ticket,
        amount=amount_val,
        quantity=qty,
        attendee_name=name,
        attendee_email=delivery_email,
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
router.add_api_route("/claim-free-ticket", claim_free_ticket, methods=["POST"], status_code=200)
razorpay_router.add_api_route("/create-order", create_razorpay_order, methods=["POST"], status_code=200)
razorpay_router.add_api_route("/verify-payment", verify_razorpay_payment, methods=["POST"], status_code=200)
razorpay_router.add_api_route("/claim-free-ticket", claim_free_ticket, methods=["POST"], status_code=200)
