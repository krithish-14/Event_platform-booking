"""
Attendee payment-proof upload after scanning the UPI QR on the bill page.
"""

import os

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.payment_proof import PaymentProof
from Models.user import User
from Services.file_storage import store_bytes
from Services.rate_limit import limit_payment
from Utils.categories import is_allowed_image_bytes, is_allowed_image_filename
from Utils.datetimes import utc_now
from Utils.text_sanitize import sanitize_text

router = APIRouter()


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
        existing.quantity = max(1, int(quantity or 1))
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
            quantity=max(1, int(quantity or 1)),
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

    return {
        "message": "Your registration process is completed, your ticket will be available within 24 hr, after verified by support team.",
        "payment_id": row.id,
        "status": row.status,
    }
