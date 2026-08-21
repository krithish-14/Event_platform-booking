"""
Admin portal APIs — list form submissions and generate QR tickets.
"""

import os
import random
import secrets
from typing import Any, Dict, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload

from Authentication.dependencies import get_current_admin
from Services.rate_limit import limit_admin
from Services.runtime_env import public_app_url
from Models.base import get_db
from Models.booking import Booking
from Models.event import Event
from Models.form_submissions import FormSubmission
from Models.payment_proof import PaymentProof
from Models.ticket import Ticket, unique_qr_token
from Models.user import User
from Services.auth_service import get_password_hash
from Services.email import send_email
from Services.whatsapp import send_whatsapp

from APIs.bookings import (
    _active_booking_for_event,
    _event_id_matches,
    _mark_form_submission_paid,
    _same_event_id,
    _serialize_booking,
    _ticket_from_answers,
)

router = APIRouter(dependencies=[Depends(limit_admin)])

NAME_KEYS = (
    "full_name", "fullname", "name", "attendee_name", "attendee",
    "full name", "your name", "participant name", "first_name",
)
PHONE_KEYS = (
    "phone", "mobile", "whatsapp", "phone_number", "mobile_number",
    "whatsapp_number", "contact", "phone number", "mobile number",
    "whatsapp number",
)


def _public_app_url() -> str:
    return public_app_url() or "http://127.0.0.1:5500"


def qr_image_url(token: str) -> str:
    return f"https://api.qrserver.com/v1/create-qr-code/?size=280x280&margin=8&data={quote(token or '')}"


def public_ticket_url(token: str) -> str:
    return f"{_public_app_url()}/ticket-details.html?token={quote(token or '', safe='')}"


def _norm_key(key: Any) -> str:
    return str(key or "").strip().lower().replace("-", "_")


def _answer_value(answers: Any, keys) -> str:
    if not isinstance(answers, dict):
        return ""
    wanted = {_norm_key(k) for k in keys}
    for key, value in answers.items():
        if str(key).startswith("_"):
            continue
        if _norm_key(key) in wanted:
            text = str(value or "").strip()
            if text:
                return text
    return ""


def _pretty_answers(answers: Any) -> Dict[str, Any]:
    if not isinstance(answers, dict):
        return {}
    out = {}
    for key, value in answers.items():
        if str(key).startswith("_"):
            continue
        out[str(key)] = value
    return out


def _lookup_event(db: Session, event_id) -> Optional[Event]:
    if not event_id:
        return None
    for cand in _event_id_matches(event_id):
        try:
            row = db.query(Event).filter(Event.id == cand).first()
        except Exception:
            row = None
        if row:
            return row
    return None


def _unique_customer_id(db: Session) -> str:
    while True:
        cid = f"CUST-{random.randint(100000, 999999)}"
        if not db.query(User).filter(User.customer_id == cid).first():
            return cid


def _unique_username(db: Session, email: str) -> str:
    base = (email.split("@")[0] or "attendee").replace(".", "_")[:40]
    candidate = base
    n = 0
    while db.query(User).filter(func.lower(User.username) == candidate.lower()).first():
        n += 1
        candidate = f"{base}_{n}"
    return candidate


def _ensure_attendee_user(db: Session, email: str, name: str, customer_id: Optional[str]) -> User:
    user = None
    if customer_id:
        user = db.query(User).filter(User.customer_id == str(customer_id)).first()
    if not user and email:
        user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
    if user:
        if name and not (user.full_name or "").strip():
            user.full_name = name
            db.commit()
            db.refresh(user)
        return user

    user = User(
        customer_id=_unique_customer_id(db),
        email=email,
        username=_unique_username(db, email),
        full_name=name or email.split("@")[0],
        hashed_password=get_password_hash(secrets.token_urlsafe(18)),
        is_active=True,
        is_admin=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def _reload_booking(db: Session, booking_id) -> Optional[Booking]:
    if not booking_id:
        return None
    return (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(Booking.booking_id == booking_id)
        .first()
    )


def _mint_unique_tickets(db: Session, booking: Booking, qty: int, ticket_type: str) -> list:
    existing = db.query(Ticket).filter(Ticket.booking_id == booking.booking_id).all()
    needed = max(1, int(qty or 1)) - len(existing)
    used = [t.qr_token for t in existing]
    created = []
    for _ in range(max(0, needed)):
        token = unique_qr_token(db, extra_used=used)
        used.append(token)
        ticket = Ticket(
            booking_id=booking.booking_id,
            event_id=booking.event_id,
            customer_id=booking.customer_id,
            ticket_type=ticket_type or booking.ticket_type or "Standard Access",
            qr_token=token,
            ticket_status="VALID",
        )
        db.add(ticket)
        created.append(ticket)
    if created:
        db.commit()
    return db.query(Ticket).filter(Ticket.booking_id == booking.booking_id).order_by(Ticket.created_at.asc()).all()


def _matching_payment(db: Session, email: str, event_id) -> Optional[PaymentProof]:
    email_clean = (email or "").strip().lower()
    if not email_clean:
        return None
    rows = (
        db.query(PaymentProof)
        .filter(func.lower(PaymentProof.attendee_email) == email_clean)
        .order_by(PaymentProof.created_at.desc())
        .all()
    )
    for row in rows:
        if event_id and row.event_id and not _same_event_id(row.event_id, event_id):
            continue
        return row
    return None


def _serialize_submission(db: Session, row: FormSubmission) -> dict:
    answers = row.answers_json if isinstance(row.answers_json, dict) else {}
    ticket_type, price = _ticket_from_answers(answers)
    if not ticket_type:
        ticket_type = row.ticket_type or "General Admission"
    if price is None:
        price = row.ticket_price
    event = _lookup_event(db, row.event_id)
    name = _answer_value(answers, NAME_KEYS) or (row.customer.full_name if row.customer else None) or ""
    phone = _answer_value(answers, PHONE_KEYS) or (getattr(row.booking, "receiver_phone", None) if row.booking else None) or ""
    tickets = []
    booking = None
    if row.booking_id:
        booking = (
            db.query(Booking)
            .options(joinedload(Booking.tickets), joinedload(Booking.event))
            .filter(Booking.booking_id == row.booking_id)
            .first()
        )
    if booking:
        tickets = [
            {
                "ticket_id": str(t.ticket_id),
                "qr_token": t.qr_token,
                "ticket_status": t.ticket_status,
                "qr_image_url": qr_image_url(t.qr_token),
                "ticket_url": public_ticket_url(t.qr_token),
            }
            for t in (booking.tickets or [])
        ]
    primary = tickets[0] if tickets else None
    status_val = (row.status or "payment_pending").lower()
    has_qr = bool(primary)
    return {
        "kind": "form",
        "id": row.id,
        "submission_id": row.id,
        "event_id": str(row.event_id or ""),
        "event_title": getattr(event, "title", None) or "Event",
        "event_venue": getattr(event, "venue", None) or getattr(event, "location", None),
        "user_email": row.user_email,
        "attendee_name": name or row.user_email,
        "attendee_phone": phone,
        "ticket_type": ticket_type,
        "ticket_price": float(price) if price is not None else float(getattr(event, "price", 0) or 0),
        "status": "qr_ready" if has_qr else status_val,
        "submitted_at": row.submission_time.isoformat() if row.submission_time else None,
        "answers": _pretty_answers(answers),
        "booking_id": str(booking.booking_id) if booking else (str(row.booking_id) if row.booking_id else None),
        "has_qr": has_qr,
        "qr_token": primary["qr_token"] if primary else None,
        "qr_image_url": primary["qr_image_url"] if primary else None,
        "ticket_url": primary["ticket_url"] if primary else None,
        "tickets": tickets,
    }


def _issue_tickets(db: Session, row: FormSubmission) -> Booking:
    email = (row.user_email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="This form has no attendee email.")
    event = _lookup_event(db, row.event_id)
    if not event:
        raise HTTPException(status_code=400, detail="This registration is not linked to a published event.")

    proof = _matching_payment(db, email, event.id)
    if not proof:
        raise HTTPException(
            status_code=400,
            detail="This attendee has not submitted a payment form yet. Open Payment forms, verify the UPI details, then click Generate QR.",
        )
    return _issue_tickets_from_payment(db, proof)


def _screenshot_url(file_id) -> Optional[str]:
    if not file_id:
        return None
    return f"/api/media/private/{file_id}"


def _serialize_payment_proof(db: Session, row: PaymentProof) -> dict:
    event = _lookup_event(db, row.event_id)
    tickets = []
    booking = None
    if row.booking_id:
        booking = (
            db.query(Booking)
            .options(joinedload(Booking.tickets), joinedload(Booking.event))
            .filter(Booking.booking_id == row.booking_id)
            .first()
        )
    if booking:
        tickets = [
            {
                "ticket_id": str(t.ticket_id),
                "qr_token": t.qr_token,
                "ticket_status": t.ticket_status,
                "qr_image_url": qr_image_url(t.qr_token),
                "ticket_url": public_ticket_url(t.qr_token),
            }
            for t in (booking.tickets or [])
        ]
    primary = tickets[0] if tickets else None
    has_qr = bool(primary)
    shot = _screenshot_url(row.screenshot_file_id)
    answers = {
        "Name": row.attendee_name,
        "Email": row.attendee_email,
        "Number": row.attendee_phone,
        "Bank name": row.bank_name,
        "Transaction ID": row.transaction_id,
    }
    if shot:
        answers["Screenshot"] = shot
    return {
        "kind": "payment",
        "id": row.id,
        "submission_id": row.id,
        "event_id": str(row.event_id or ""),
        "event_title": getattr(event, "title", None) or "Event",
        "event_venue": getattr(event, "venue", None) or getattr(event, "location", None),
        "user_email": row.attendee_email,
        "attendee_name": row.attendee_name,
        "attendee_phone": row.attendee_phone,
        "ticket_type": row.ticket_type or "General Admission",
        "ticket_price": float(row.amount or 0),
        "status": "qr_ready" if has_qr else (row.status or "payment_submitted"),
        "submitted_at": row.created_at.isoformat() if row.created_at else None,
        "answers": answers,
        "screenshot_url": shot,
        "bank_name": row.bank_name,
        "transaction_id": row.transaction_id,
        "booking_id": str(booking.booking_id) if booking else (str(row.booking_id) if row.booking_id else None),
        "has_qr": has_qr,
        "qr_token": primary["qr_token"] if primary else None,
        "qr_image_url": primary["qr_image_url"] if primary else None,
        "ticket_url": primary["ticket_url"] if primary else None,
        "tickets": tickets,
    }


def _issue_tickets_from_payment(db: Session, row: PaymentProof) -> Booking:
    email = (row.attendee_email or "").strip().lower()
    if not email:
        raise HTTPException(status_code=400, detail="This payment form has no attendee email.")
    event = _lookup_event(db, row.event_id)
    if not event:
        raise HTTPException(status_code=400, detail="This payment is not linked to a published event.")
    name = (row.attendee_name or "").strip() or email.split("@")[0]
    phone = (row.attendee_phone or "").strip()
    ticket_type = row.ticket_type or "General Admission"
    price = float(row.amount if row.amount is not None else (event.price or 0))
    qty = max(1, int(row.quantity or 1))
    user = _ensure_attendee_user(db, email, name, row.customer_id)

    booking = _reload_booking(db, row.booking_id)
    if not booking:
        booking = _active_booking_for_event(db, user, event.id)

    if not booking:
        booking = Booking(
            customer_id=user.customer_id,
            event_id=event.id,
            ticket_type=ticket_type or "Standard Access",
            quantity=qty,
            total_price=price,
            status="CONFIRMED",
            payment_id=row.transaction_id or f"PAY-ADMIN-{secrets.token_hex(4).upper()}",
            payment_mode="UPI",
            gst_amount=round(price * 0.18, 2),
            receiver_name=name,
            receiver_email=email,
            receiver_phone=phone or None,
        )
        db.add(booking)
        db.commit()
        db.refresh(booking)
    else:
        if phone and not (booking.receiver_phone or "").strip():
            booking.receiver_phone = phone
        if name and not (booking.receiver_name or "").strip():
            booking.receiver_name = name
        if email and not (booking.receiver_email or "").strip():
            booking.receiver_email = email
        if qty > int(booking.quantity or 1):
            booking.quantity = qty
        db.commit()

    _mint_unique_tickets(db, booking, qty, booking.ticket_type or ticket_type)
    row.booking_id = booking.booking_id
    row.status = "qr_ready"
    db.commit()
    try:
        _mark_form_submission_paid(db, event.id, user, booking_id=booking.booking_id)
    except Exception:
        pass
    issued = _reload_booking(db, booking.booking_id)
    if not issued or not (issued.tickets or []):
        raise HTTPException(status_code=500, detail="Could not create a unique QR ticket.")
    return issued


def _deliver_ticket(booking: Booking, phone: str) -> dict:
    tickets = [t for t in (booking.tickets or []) if (t.qr_token or "").strip()]
    if not tickets:
        raise HTTPException(status_code=500, detail="No unique QR ticket was issued for this attendee.")
    ticket = tickets[0]
    token = ticket.qr_token
    event_title = booking.event.title if booking.event else "your event"
    ticket_link = public_ticket_url(token)
    image = qr_image_url(token)
    attendee = booking.receiver_name or "there"
    email_addr = booking.receiver_email or ""
    extra_links = ""
    extra_text = ""
    if len(tickets) > 1:
        extra_text = "\n".join(
            f"Ticket {idx}: {public_ticket_url(t.qr_token)} (token {t.qr_token})"
            for idx, t in enumerate(tickets, start=1)
        )
        extra_links = "<ol>" + "".join(
            f'<li><a href="{public_ticket_url(t.qr_token)}">{t.qr_token}</a></li>'
            for t in tickets
        ) + "</ol>"

    text_body = (
        f"Hi {attendee},\n\n"
        f"Your JOD Events ticket for {event_title} is ready.\n"
        f"Ticket type: {booking.ticket_type or 'General Admission'}\n"
        f"Open your e-ticket: {ticket_link}\n"
        f"{extra_text + chr(10) if extra_text else ''}"
        f"Show the QR code at the gate. Token: {token}\n"
        "This QR is unique to you. Do not share it."
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#201d19;">
      <h2 style="color:#FF7508;">Your ticket is ready</h2>
      <p>Hi {attendee},</p>
      <p>Your unique QR ticket for <strong>{event_title}</strong> ({booking.ticket_type or "General Admission"}) is ready. This code belongs only to you.</p>
      <p style="text-align:center;margin:24px 0;">
        <img src="{image}" alt="Ticket QR" width="220" height="220" style="border:8px solid #fff8f0;border-radius:12px;" />
      </p>
      <p style="text-align:center;">
        <a href="{ticket_link}" style="background:#FF7508;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">View ticket on website</a>
      </p>
      {extra_links}
      <p style="font-size:13px;color:#64748b;">Gate token: {token}</p>
    </div>
    """
    email_sent = send_email(
        email_addr,
        f"Your QR ticket — {event_title}",
        text_body,
        html_body,
    ) if email_addr else False

    wa_text = (
        f"Hi {attendee}, your JOD Events ticket for {event_title} is ready.\n"
        f"This QR is unique to you.\n"
        f"View on website: {ticket_link}\n"
        f"QR: {image}"
    )
    if extra_text:
        wa_text = f"{wa_text}\n{extra_text}"
    wa_sent, wa_channel, wa_link = send_whatsapp(phone, wa_text, image_url=image)

    return {
        "website": True,
        "ticket_url": ticket_link,
        "qr_image_url": image,
        "qr_token": token,
        "ticket_count": len(tickets),
        "email_sent": bool(email_sent),
        "email_to": email_addr,
        "whatsapp_sent": bool(wa_sent),
        "whatsapp_channel": wa_channel,
        "whatsapp_url": wa_link,
        "whatsapp_to": phone or None,
    }


class GenerateQrRequest(BaseModel):
    resend: bool = False


@router.get("/me")
def admin_me(current_admin: User = Depends(get_current_admin)):
    return {
        "email": current_admin.email,
        "full_name": current_admin.full_name,
        "is_admin": True,
        "customer_id": current_admin.customer_id,
    }


@router.get("/submissions")
def list_form_submissions(
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    pay_rows = db.query(PaymentProof).order_by(PaymentProof.created_at.desc()).all()
    form_rows = (
        db.query(FormSubmission)
        .options(joinedload(FormSubmission.customer), joinedload(FormSubmission.booking))
        .order_by(FormSubmission.submission_time.desc())
        .all()
    )
    items = [_serialize_payment_proof(db, row) for row in pay_rows]
    items.extend(_serialize_submission(db, row) for row in form_rows)
    needle = (q or "").strip().lower()
    if needle:
        items = [
            item for item in items
            if needle in str(item.get("attendee_name") or "").lower()
            or needle in str(item.get("user_email") or "").lower()
            or needle in str(item.get("attendee_phone") or "").lower()
            or needle in str(item.get("event_title") or "").lower()
            or needle in str(item.get("bank_name") or "").lower()
            or needle in str(item.get("transaction_id") or "").lower()
        ]
    pay_items = [item for item in items if item.get("kind") == "payment"]
    ready = sum(1 for item in pay_items if item.get("has_qr"))
    return {
        "total": len(pay_items),
        "pending_qr": max(0, len(pay_items) - ready),
        "qr_ready": ready,
        "submissions": items,
    }


@router.post("/submissions/{submission_id}/generate-qr")
def generate_submission_qr(
    submission_id: int,
    payload: Optional[GenerateQrRequest] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    row = (
        db.query(FormSubmission)
        .options(joinedload(FormSubmission.customer), joinedload(FormSubmission.booking))
        .filter(FormSubmission.id == submission_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Form submission not found.")

    booking = _issue_tickets(db, row)
    if not booking:
        raise HTTPException(status_code=500, detail="Could not create the QR ticket.")

    db.refresh(row)
    phone = booking.receiver_phone or _answer_value(row.answers_json, PHONE_KEYS)
    delivery = _deliver_ticket(booking, phone)
    item = _serialize_submission(db, row)
    item["delivery"] = delivery
    item["booking"] = _serialize_booking(booking, db=db)
    return item


@router.post("/payments/{payment_id}/generate-qr")
def generate_payment_qr(
    payment_id: int,
    payload: Optional[GenerateQrRequest] = None,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    row = db.query(PaymentProof).filter(PaymentProof.id == payment_id).first()
    if not row:
        raise HTTPException(status_code=404, detail="Payment form not found.")
    booking = _issue_tickets_from_payment(db, row)
    if not booking:
        raise HTTPException(status_code=500, detail="Could not create the QR ticket.")
    db.refresh(row)
    delivery = _deliver_ticket(booking, row.attendee_phone)
    item = _serialize_payment_proof(db, row)
    item["delivery"] = delivery
    item["booking"] = _serialize_booking(booking, db=db)
    return item
