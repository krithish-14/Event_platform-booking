"""
Attendee payment-proof upload after scanning the UPI QR on the bill page.
"""

from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.payment_proof import PaymentProof
from Models.user import User
from Services.file_storage import public_url, store_bytes

router = APIRouter()

ALLOWED_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/heic",
    "image/heif",
}


@router.post("/proof", status_code=status.HTTP_201_CREATED)
async def submit_payment_proof(
    event_id: str = Form(...),
    ticket_type: str = Form("General Admission"),
    amount: float = Form(0),
    quantity: int = Form(1),
    attendee_name: str = Form(...),
    attendee_email: str = Form(...),
    attendee_phone: str = Form(...),
    bank_name: str = Form(...),
    transaction_id: str = Form(...),
    screenshot: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    name = (attendee_name or "").strip()
    email = (attendee_email or current_user.email or "").strip().lower()
    phone = (attendee_phone or "").strip()
    bank = (bank_name or "").strip()
    txn = (transaction_id or "").strip()
    if not name or not email or not phone or not bank or not txn:
        raise HTTPException(status_code=400, detail="Please fill name, email, number, bank name, and transaction ID.")

    data = await screenshot.read()
    if not data:
        raise HTTPException(status_code=400, detail="Please upload a payment screenshot.")
    content_type = (screenshot.content_type or "").lower()
    if content_type and content_type not in ALLOWED_TYPES and not content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Screenshot must be an image file.")

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
        db.commit()
        db.refresh(existing)
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
        )
        db.add(row)
        db.commit()
        db.refresh(row)

    return {
        "message": "Payment details submitted. Admin will generate your QR ticket after verification.",
        "payment_id": row.id,
        "status": row.status,
        "screenshot_url": public_url(stored),
    }
