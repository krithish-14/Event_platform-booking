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
from sqlalchemy import String, cast, func, text
from sqlalchemy.orm import Session, defer, joinedload

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
from Services.ticket_pdf import build_ticket_pdf_bytes

from APIs.bookings import (
    _active_booking_for_event,
    _booking_is_cancelled,
    _booking_ticket_used,
    _lookup_booking_row,
    _mark_form_submission_paid,
    _same_event_id,
    _serialize_booking,
    _sql_set_booking_id,
    _ticket_from_answers,
    finalize_booking_cancellation,
)
from Utils.text_sanitize import pick_attendee_identity

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

HIDDEN_ADMIN_BOOKING_STATUSES = (
    "CANCELLED",
    "CANCELED",
    "REFUNDED",
    "CANCELLATION_REQUESTED",
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


def _db_safe_rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:
        pass


def _text_or_none(value) -> Optional[str]:
    text_val = str(value or "").strip()
    if not text_val or text_val.lower() in ("none", "null"):
        return None
    return text_val


def _column_as_text(db: Session, table: str, pk_col: str, pk_val, col: str) -> Optional[str]:
    if pk_val is None:
        return None
    try:
        row = db.execute(
            text(f"SELECT CAST({col} AS TEXT) FROM {table} WHERE {pk_col} = :pk"),
            {"pk": pk_val},
        ).first()
        return _text_or_none(row[0] if row else None)
    except Exception:
        _db_safe_rollback(db)
        return None


def _lookup_event(db: Session, event_id) -> Optional[Event]:
    eid = _text_or_none(event_id)
    if not eid:
        return None
    compact = eid.replace("-", "").lower()
    try:
        row = db.query(Event).filter(cast(Event.id, String) == eid).first()
        if row:
            return row
        return (
            db.query(Event)
            .filter(func.lower(func.replace(cast(Event.id, String), "-", "")) == compact)
            .first()
        )
    except Exception:
        _db_safe_rollback(db)
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
    bid = _text_or_none(booking_id)
    if not bid:
        return None
    try:
        return (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(cast(Booking.booking_id, String) == bid)
            .first()
        )
    except Exception:
        _db_safe_rollback(db)
        try:
            return db.query(Booking).filter(cast(Booking.booking_id, String) == bid).first()
        except Exception:
            _db_safe_rollback(db)
            return None


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


def _user_by_email(db: Session, email: str) -> Optional[User]:
    clean = (email or "").strip().lower()
    if not clean:
        return None
    try:
        return db.query(User).filter(func.lower(User.email) == clean).first()
    except Exception:
        _db_safe_rollback(db)
        return None


def _resolve_attendee_identity(
    db: Session,
    *,
    booking=None,
    user=None,
    form_name: str = "",
    form_email: str = "",
    form_phone: str = "",
):
    if user is None and booking is not None:
        user = getattr(booking, "customer", None)
    if user is None and form_email:
        user = _user_by_email(db, form_email)
    return pick_attendee_identity(
		names=(
			getattr(user, "full_name", None) if user is not None else None,
			getattr(booking, "receiver_name", None) if booking is not None else None,
			form_name,
		),
        emails=(
            getattr(booking, "receiver_email", None) if booking is not None else None,
            getattr(user, "email", None) if user is not None else None,
            form_email,
        ),
        phones=(
            getattr(user, "phone", None) if user is not None else None,
            getattr(booking, "receiver_phone", None) if booking is not None else None,
            form_phone,
        ),
    )


def _booking_status_value(booking) -> str:
    return str(getattr(booking, "status", None) or "").strip().upper()


def _hide_from_admin_lists(item: dict) -> bool:
    booking_status = str(item.get("booking_status") or "").upper()
    row_status = str(item.get("form_status") or item.get("status") or "").lower()
    if booking_status in HIDDEN_ADMIN_BOOKING_STATUSES:
        return True
    if row_status in ("cancelled", "canceled", "refunded"):
        return True
    return False


def _event_id_compact(value) -> str:
    return str(value or "").replace("-", "").lower()


def _form_submission_for_booking(db: Session, booking) -> Optional[FormSubmission]:
    email = (getattr(booking, "receiver_email", None) or "").lower().strip()
    customer = getattr(booking, "customer", None)
    if not email and customer is not None:
        email = (getattr(customer, "email", None) or "").lower().strip()
    if not email:
        return None
    compact = _event_id_compact(getattr(booking, "event_id", None))
    try:
        rows = (
            db.query(FormSubmission)
            .options(defer(FormSubmission.booking_id))
            .filter(func.lower(FormSubmission.user_email) == email)
            .order_by(FormSubmission.submission_time.desc())
            .all()
        )
    except Exception:
        _db_safe_rollback(db)
        rows = []
    for row in rows:
        stored = _event_id_compact(getattr(row, "event_id", None))
        if compact and stored and stored != compact:
            continue
        return row
    return None


def _payment_proof_for_booking(db: Session, booking) -> Optional[PaymentProof]:
    email = (getattr(booking, "receiver_email", None) or "").lower().strip()
    customer = getattr(booking, "customer", None)
    if not email and customer is not None:
        email = (getattr(customer, "email", None) or "").lower().strip()
    if not email:
        return None
    compact = _event_id_compact(getattr(booking, "event_id", None))
    try:
        rows = (
            db.query(PaymentProof)
            .options(defer(PaymentProof.booking_id), defer(PaymentProof.screenshot_file_id))
            .filter(func.lower(PaymentProof.attendee_email) == email)
            .order_by(PaymentProof.created_at.desc())
            .all()
        )
    except Exception:
        _db_safe_rollback(db)
        rows = []
    for row in rows:
        stored = _event_id_compact(getattr(row, "event_id", None))
        if compact and stored and stored != compact:
            continue
        return row
    return None


def _serialize_admin_cancellation(db: Session, booking: Booking) -> dict:
    event = getattr(booking, "event", None) or _lookup_event(db, booking.event_id)
    form_row = _form_submission_for_booking(db, booking)
    proof_row = _payment_proof_for_booking(db, booking)
    form_answers = form_row.answers_json if form_row and isinstance(form_row.answers_json, dict) else {}
    name, email, phone = _resolve_attendee_identity(
        db,
        booking=booking,
        user=getattr(booking, "customer", None),
        form_name=_answer_value(form_answers, NAME_KEYS) or (getattr(proof_row, "attendee_name", None) or ""),
        form_email=(getattr(form_row, "user_email", None) if form_row else "") or (getattr(proof_row, "attendee_email", None) or ""),
        form_phone=_answer_value(form_answers, PHONE_KEYS) or (getattr(proof_row, "attendee_phone", None) or ""),
    )
    attendee_answers = {
        "Name": name,
        "Email": email,
        "Phone": phone or "—",
        "Form status": getattr(form_row, "status", None) or "—",
        "Submitted": form_row.submission_time.isoformat() if form_row and form_row.submission_time else None,
    }
    attendee_answers.update(_pretty_answers(form_answers))
    shot_id = None
    if proof_row is not None:
        shot_id = _column_as_text(db, "payment_proofs", "id", proof_row.id, "screenshot_file_id")
    shot = _screenshot_url(shot_id)
    payment_answers = {
        "Name": name,
        "Email": email,
        "Phone": phone or getattr(proof_row, "attendee_phone", None) or "—",
        "Ticket": booking.ticket_type,
        "Quantity": booking.quantity,
        "Amount": booking.total_price,
        "GST": getattr(booking, "gst_amount", None),
        "Payment mode": getattr(booking, "payment_mode", None),
        "Payment ID": getattr(booking, "payment_id", None),
        "Bank name": getattr(proof_row, "bank_name", None) if proof_row is not None else None,
        "Transaction ID": getattr(proof_row, "transaction_id", None) if proof_row is not None else None,
        "Proof status": getattr(proof_row, "status", None) if proof_row is not None else None,
        "Booked at": booking.booked_at.isoformat() if booking.booked_at else None,
    }
    if shot:
        payment_answers["Screenshot"] = shot
    return {
        "kind": "cancel",
        "id": str(booking.booking_id),
        "booking_id": str(booking.booking_id),
        "event_id": str(booking.event_id or ""),
        "event_title": getattr(event, "title", None) or "Event",
        "event_venue": getattr(event, "venue", None) or getattr(event, "location", None),
        "user_email": email,
        "attendee_name": name,
        "attendee_email": email,
        "attendee_phone": phone,
        "ticket_type": booking.ticket_type or "Ticket",
        "ticket_price": float(booking.total_price or 0),
        "quantity": booking.quantity or 1,
        "status": "cancellation_requested",
        "booking_status": _booking_status_value(booking),
        "submitted_at": booking.booked_at.isoformat() if booking.booked_at else None,
        "answers": attendee_answers,
        "payment_answers": payment_answers,
        "screenshot_url": shot,
        "has_qr": False,
    }


def _serialize_submission(db: Session, row: FormSubmission, booking_id_text: Optional[str] = None) -> dict:
    answers = row.answers_json if isinstance(row.answers_json, dict) else {}
    ticket_type, price = _ticket_from_answers(answers)
    if not ticket_type:
        ticket_type = row.ticket_type or "General Admission"
    if price is None:
        price = row.ticket_price
    event = _lookup_event(db, row.event_id)
    booking = _reload_booking(db, booking_id_text if booking_id_text is not None else getattr(row, "booking_id", None))
    name, email, phone = _resolve_attendee_identity(
        db,
        booking=booking,
        user=getattr(row, "customer", None),
        form_name=_answer_value(answers, NAME_KEYS),
        form_email=row.user_email or "",
        form_phone=_answer_value(answers, PHONE_KEYS),
    )
    tickets = []
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
        "user_email": email or row.user_email,
        "attendee_name": name,
        "attendee_phone": phone,
        "ticket_type": ticket_type,
        "ticket_price": float(price) if price is not None else float(getattr(event, "price", 0) or 0),
        "status": "qr_ready" if has_qr else status_val,
        "form_status": status_val,
        "booking_status": _booking_status_value(booking) if booking else "",
        "submitted_at": row.submission_time.isoformat() if row.submission_time else None,
        "answers": _pretty_answers(answers),
        "booking_id": str(booking.booking_id) if booking else booking_id_text,
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


def _serialize_payment_proof(db: Session, row: PaymentProof, booking_id_text: Optional[str] = None, screenshot_id_text: Optional[str] = None) -> dict:
    event = _lookup_event(db, row.event_id)
    tickets = []
    booking = _reload_booking(db, booking_id_text if booking_id_text is not None else getattr(row, "booking_id", None))
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
    shot = _screenshot_url(screenshot_id_text if screenshot_id_text is not None else getattr(row, "screenshot_file_id", None))
    name, email, phone = _resolve_attendee_identity(
        db,
        booking=booking,
        form_name=row.attendee_name or "",
        form_email=row.attendee_email or "",
        form_phone=row.attendee_phone or "",
    )
    answers = {
        "Name": name,
        "Email": email,
        "Number": phone,
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
        "user_email": email or row.attendee_email,
        "attendee_name": name,
        "attendee_phone": phone,
        "ticket_type": row.ticket_type or "General Admission",
        "ticket_price": float(row.amount or 0),
        "status": "qr_ready" if has_qr else (row.status or "payment_submitted"),
        "form_status": (row.status or "payment_submitted"),
        "booking_status": _booking_status_value(booking) if booking else "",
        "submitted_at": row.created_at.isoformat() if row.created_at else None,
        "answers": answers,
        "screenshot_url": shot,
        "bank_name": row.bank_name,
        "transaction_id": row.transaction_id,
        "booking_id": str(booking.booking_id) if booking else booking_id_text,
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

    booking = _reload_booking(db, _column_as_text(db, "payment_proofs", "id", row.id, "booking_id"))
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
    try:
        db.execute(
            text("UPDATE payment_proofs SET status = :st WHERE id = :id"),
            {"st": "qr_ready", "id": row.id},
        )
        db.commit()
    except Exception:
        _db_safe_rollback(db)
        try:
            row.status = "qr_ready"
            db.commit()
        except Exception:
            _db_safe_rollback(db)
    _sql_set_booking_id(db, "payment_proofs", "id", row.id, booking.booking_id)
    try:
        _mark_form_submission_paid(db, event.id, user, booking_id=booking.booking_id)
    except Exception:
        _db_safe_rollback(db)
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
        f"Booking ID: JOD-{(str(booking.booking_id).replace('-', '')[:8] or '00000000').upper()}\n"
        f"Event date: {booking.event.start_date if booking.event else 'TBA'}\n"
        f"Ticket type: {booking.ticket_type or 'General Admission'}\n"
        f"Your ticket PDF is attached. Open your e-ticket: {ticket_link}\n"
        f"{extra_text + chr(10) if extra_text else ''}"
        f"Show the QR code at the gate. Token: {token}\n"
        "This QR is unique to you. Do not share it."
    )
    html_body = f"""
    <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;color:#201d19;">
      <h2 style="color:#FF7508;">Your ticket is ready</h2>
      <p>Hi {attendee},</p>
      <p>Your unique QR ticket for <strong>{event_title}</strong> ({booking.ticket_type or "General Admission"}) is ready. A PDF with booking ID, event date, and QR is attached.</p>
      <p style="text-align:center;margin:24px 0;">
        <img src="{image}" alt="Ticket QR" width="220" height="220" style="border:8px solid #fff8f0;border-radius:12px;" />
      </p>
      <p style="text-align:center;">
        <a href="{ticket_link}" style="background:#FF7508;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:700;">View ticket on website</a>
      </p>
      {extra_links}
      <p style="font-size:13px;color:#64748b;">Booking ID: JOD-{(str(booking.booking_id).replace('-', '')[:8] or '00000000').upper()} · Gate token: {token}</p>
    </div>
    """
    pdf_bytes = None
    try:
        from Services.ticket_pdf import build_mticket_pdf_from_booking
        pdf_bytes = build_mticket_pdf_from_booking(booking, qr_token=token)
    except Exception:
        pdf_bytes = None
    if not pdf_bytes:
        try:
            event = booking.event
            pdf_bytes = build_ticket_pdf_bytes(
                booking_id=booking.booking_id,
                event_name=event_title,
                event_date=event.start_date if event else None,
                qr_token=token,
                venue=(event.venue or event.location or "") if event else "",
                language=getattr(event, "language", None) if event else "English",
                event_format=getattr(event, "event_format", None) if event else "Live Event",
                ticket_type=booking.ticket_type or "General Admission",
                quantity=max(1, int(booking.quantity or 1)),
                total_price=float(booking.total_price or 0),
                gst_amount=float(getattr(booking, "gst_amount", 0) or 0),
                poster_url=(getattr(event, "card_image", None) or getattr(event, "image_url", None) or "") if event else "",
                seat_number=getattr(booking, "seat_number", None) or "General Admission",
                payment_mode=getattr(booking, "payment_mode", None) or "",
            )
        except Exception:
            pdf_bytes = None
    attachments = []
    if pdf_bytes:
        short = (str(booking.booking_id).replace("-", "")[:8] or "ticket").upper()
        attachments.append((f"JOD-Ticket-{short}.pdf", pdf_bytes, "application/pdf"))
    email_sent = send_email(
        email_addr,
        f"Your QR ticket — {event_title}",
        text_body,
        html_body,
        attachments=attachments or None,
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
    pay_rows = []
    form_rows = []
    try:
        pay_rows = (
            db.query(PaymentProof)
            .options(defer(PaymentProof.booking_id), defer(PaymentProof.screenshot_file_id))
            .order_by(PaymentProof.created_at.desc())
            .all()
        )
    except Exception:
        _db_safe_rollback(db)
        try:
            pay_rows = db.query(PaymentProof).order_by(PaymentProof.created_at.desc()).all()
        except Exception:
            _db_safe_rollback(db)
            pay_rows = []
    try:
        form_rows = (
            db.query(FormSubmission)
            .options(joinedload(FormSubmission.customer), defer(FormSubmission.booking_id))
            .order_by(FormSubmission.submission_time.desc())
            .all()
        )
    except Exception:
        _db_safe_rollback(db)
        try:
            form_rows = (
                db.query(FormSubmission)
                .options(defer(FormSubmission.booking_id))
                .order_by(FormSubmission.submission_time.desc())
                .all()
            )
        except Exception:
            _db_safe_rollback(db)
            form_rows = []

    items = []
    for row in pay_rows:
        try:
            items.append(
                _serialize_payment_proof(
                    db,
                    row,
                    booking_id_text=_column_as_text(db, "payment_proofs", "id", row.id, "booking_id"),
                    screenshot_id_text=_column_as_text(db, "payment_proofs", "id", row.id, "screenshot_file_id"),
                )
            )
        except Exception:
            _db_safe_rollback(db)
            items.append({
                "kind": "payment",
                "id": row.id,
                "submission_id": row.id,
                "event_id": str(getattr(row, "event_id", "") or ""),
                "event_title": "Event",
                "event_venue": None,
                "user_email": getattr(row, "attendee_email", "") or "",
                "attendee_name": getattr(row, "attendee_name", None) or getattr(row, "attendee_email", "") or "Attendee",
                "attendee_phone": getattr(row, "attendee_phone", "") or "",
                "ticket_type": getattr(row, "ticket_type", None) or "General Admission",
                "ticket_price": float(getattr(row, "amount", 0) or 0),
                "status": getattr(row, "status", None) or "payment_submitted",
                "submitted_at": row.created_at.isoformat() if getattr(row, "created_at", None) else None,
                "answers": {
                    "Name": getattr(row, "attendee_name", None),
                    "Email": getattr(row, "attendee_email", None),
                    "Number": getattr(row, "attendee_phone", None),
                    "Bank name": getattr(row, "bank_name", None),
                    "Transaction ID": getattr(row, "transaction_id", None),
                },
                "screenshot_url": None,
                "bank_name": getattr(row, "bank_name", None),
                "transaction_id": getattr(row, "transaction_id", None),
                "booking_id": None,
                "has_qr": False,
                "qr_token": None,
                "qr_image_url": None,
                "ticket_url": None,
                "tickets": [],
            })
    for row in form_rows:
        try:
            items.append(
                _serialize_submission(
                    db,
                    row,
                    booking_id_text=_column_as_text(db, "form_submissions", "id", row.id, "booking_id"),
                )
            )
        except Exception:
            _db_safe_rollback(db)
            answers = row.answers_json if isinstance(getattr(row, "answers_json", None), dict) else {}
            items.append({
                "kind": "form",
                "id": row.id,
                "submission_id": row.id,
                "event_id": str(getattr(row, "event_id", "") or ""),
                "event_title": "Event",
                "event_venue": None,
                "user_email": getattr(row, "user_email", "") or "",
                "attendee_name": getattr(row, "user_email", "") or "Attendee",
                "attendee_phone": "",
                "ticket_type": getattr(row, "ticket_type", None) or "General Admission",
                "ticket_price": float(getattr(row, "ticket_price", 0) or 0),
                "status": getattr(row, "status", None) or "payment_pending",
                "form_status": getattr(row, "status", None) or "payment_pending",
                "booking_status": "",
                "submitted_at": row.submission_time.isoformat() if getattr(row, "submission_time", None) else None,
                "answers": _pretty_answers(answers),
                "booking_id": None,
                "has_qr": False,
                "qr_token": None,
                "qr_image_url": None,
                "ticket_url": None,
                "tickets": [],
            })
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
    items = [item for item in items if not _hide_from_admin_lists(item)]
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
        .options(joinedload(FormSubmission.customer), defer(FormSubmission.booking_id))
        .filter(FormSubmission.id == submission_id)
        .first()
    )
    if not row:
        raise HTTPException(status_code=404, detail="Form submission not found.")

    booking = _issue_tickets(db, row)
    if not booking:
        raise HTTPException(status_code=500, detail="Could not create the QR ticket.")

    try:
        db.refresh(row)
    except Exception:
        _db_safe_rollback(db)
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
    try:
        db.refresh(row)
    except Exception:
        _db_safe_rollback(db)
    delivery = _deliver_ticket(booking, row.attendee_phone)
    item = _serialize_payment_proof(db, row)
    item["delivery"] = delivery
    item["booking"] = _serialize_booking(booking, db=db)
    return item


@router.get("/cancellation-requests")
def list_cancellation_requests(
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """Pending attendee cancellation requests across all events."""
    rows = []
    try:
        rows = (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(func.upper(Booking.status) == "CANCELLATION_REQUESTED")
            .order_by(Booking.booked_at.desc())
            .all()
        )
    except Exception:
        _db_safe_rollback(db)
        try:
            rows = (
                db.query(Booking)
                .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
                .order_by(Booking.booked_at.desc())
                .all()
            )
            rows = [b for b in rows if _booking_status_value(b) == "CANCELLATION_REQUESTED"]
        except Exception:
            _db_safe_rollback(db)
            rows = []
    items = []
    for booking in rows:
        try:
            items.append(_serialize_admin_cancellation(db, booking))
        except Exception:
            _db_safe_rollback(db)
    needle = (q or "").strip().lower()
    if needle:
        items = [
            item for item in items
            if needle in str(item.get("attendee_name") or "").lower()
            or needle in str(item.get("user_email") or "").lower()
            or needle in str(item.get("attendee_phone") or "").lower()
            or needle in str(item.get("event_title") or "").lower()
        ]
    return {"total": len(items), "requests": items}


@router.post("/bookings/{booking_id}/accept-cancellation")
def admin_accept_cancellation(
    booking_id: str,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """Staff accepts a cancellation request and voids the ticket."""
    booking = _lookup_booking_row(db, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if _booking_is_cancelled(booking):
        return {
            "status": "success",
            "message": "Ticket already cancelled.",
            "booking": _serialize_booking(booking, db=db),
        }
    if _booking_ticket_used(booking, db=db):
        raise HTTPException(
            status_code=400,
            detail="This ticket is already checked in and cannot be cancelled.",
        )
    booking = finalize_booking_cancellation(db, booking)
    refreshed = _lookup_booking_row(db, booking.booking_id) or booking
    return {
        "status": "success",
        "message": "Cancellation accepted. The attendee can buy again.",
        "booking": _serialize_booking(refreshed, db=db),
    }
