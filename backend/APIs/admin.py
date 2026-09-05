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
    _event_schedule_display,
    _mark_form_submission_paid,
    _same_event_id,
    _serialize_booking,
    _sql_set_booking_id,
    _ticket_from_answers,
)
from Utils.datetimes import json_datetime
from Utils.form_submission_query import (
    fetch_form_submissions,
    form_submission_booking_id,
    form_submission_by_id,
    hydrate_customers,
    parse_answers_json,
)

try:
    from Utils.text_sanitize import pick_attendee_identity
except ImportError:
    def pick_attendee_identity(*, names=(), emails=(), phones=()):
        email = next((str(v).strip() for v in emails if v and "@" in str(v)), "")
        name = next((str(v).strip() for v in names if v), "") or (
            email.split("@")[0].replace(".", " ").title() if email else "Guest"
        )
        phone = next((str(v).strip() for v in phones if v), "")
        return name, email, phone

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
    """Keep pending cancels in the Cancellation request tab only.

    Do not hide a new host/payment form just because an old cancelled booking
    is still linked — that is how a second buy disappeared from the portal.
    """
    booking_status = str(item.get("booking_status") or "").upper()
    row_status = str(item.get("form_status") or "").lower()
    kind = str(item.get("kind") or "form")
    if kind == "form":
        if booking_status == "CANCELLATION_REQUESTED":
            return True
        if row_status in ("cancelled", "canceled", "refunded"):
            return True
        return False
    if booking_status == "CANCELLATION_REQUESTED":
        return True
    in_progress = row_status in (
        "payment_pending",
        "payment_submitted",
        "submitted",
        "pending",
        "",
    )
    if kind == "payment":
        pay_status = str(item.get("form_status") or item.get("status") or "").lower()
        if pay_status in ("payment_submitted", "payment_pending", "submitted"):
            return False
        if pay_status == "qr_ready" and booking_status in ("CANCELLED", "CANCELED", "REFUNDED"):
            return True
        return False
    if in_progress:
        return False
    if booking_status in ("CANCELLED", "CANCELED", "REFUNDED"):
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
        rows = fetch_form_submissions(db)
    except Exception:
        _db_safe_rollback(db)
        rows = []
    email_l = email
    for row in rows:
        row_email = (getattr(row, "user_email", None) or "").lower().strip()
        if row_email != email_l:
            continue
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
    answers = parse_answers_json(getattr(row, "answers_json", None))
    ticket_type, price = _ticket_from_answers(answers)
    if not ticket_type:
        ticket_type = row.ticket_type or "General Admission"
    if price is None:
        price = row.ticket_price
    event = _lookup_event(db, row.event_id)
    if booking_id_text is None:
        booking_id_text = form_submission_booking_id(db, getattr(row, "id", None))
    booking = _reload_booking(db, booking_id_text)
    status_val = (row.status or "payment_pending").lower()
    if booking and _booking_status_value(booking) in HIDDEN_ADMIN_BOOKING_STATUSES and status_val not in ("paid", "qr_ready"):
        booking = None
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
        "submitted_at": json_datetime(row.submission_time),
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
    proof_status = (row.status or "payment_submitted").lower()
    if booking and _booking_status_value(booking) in HIDDEN_ADMIN_BOOKING_STATUSES and proof_status != "qr_ready":
        booking = None
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
        "submitted_at": json_datetime(row.created_at),
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
    # Do not reuse an older booking for the same event — each paid proof gets its own tickets.
    if not booking:
        booking = Booking(
            customer_id=user.customer_id,
            event_id=event.id,
            ticket_type=ticket_type or "Standard Access",
            quantity=qty,
            total_price=price,
            status="CONFIRMED",
            payment_id=row.transaction_id or f"PAY-ADMIN-{secrets.token_hex(4).upper()}",
            payment_mode=(
                "Razorpay"
                if (row.bank_name or "").strip().lower() == "razorpay"
                else "UPI / Card"
            ),
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
        if ticket_type and not (booking.ticket_type or "").strip():
            booking.ticket_type = ticket_type
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


def _deliver_ticket(booking: Booking, phone: str, db: Optional[Session] = None) -> dict:
    tickets = [t for t in (booking.tickets or []) if (t.qr_token or "").strip()]
    if not tickets:
        raise HTTPException(status_code=500, detail="No unique QR ticket was issued for this attendee.")
    ticket = tickets[0]
    token = ticket.qr_token
    event_title = booking.event.title if booking.event else "your event"
    event_when = "TBA"
    public_start = booking.event.start_date if booking.event else None
    if db is not None:
        try:
            start_display, _, _, _ = _event_schedule_display(
                db, booking.event_id, public_start, booking.event.end_date if booking.event else None
            )
            event_when = start_display or event_when
        except Exception:
            event_when = "TBA"
    if event_when == "TBA":
        try:
            from Utils.datetimes import format_utc_naive_as_ist_when
            event_when = format_utc_naive_as_ist_when(public_start) or "TBA"
        except Exception:
            event_when = str(public_start) if public_start else "TBA"
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
        f"Event date: {event_when}\n"
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
        pdf_bytes = build_mticket_pdf_from_booking(booking, qr_token=token, db=db)
    except Exception:
        pdf_bytes = None
    if not pdf_bytes:
        try:
            event = booking.event
            pdf_bytes = build_ticket_pdf_bytes(
                booking_id=booking.booking_id,
                event_name=event_title,
                event_date=event_when if event_when != "TBA" else (event.start_date if event else None),
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
        form_rows = fetch_form_submissions(db)
    except Exception:
        _db_safe_rollback(db)
        form_rows = []
    try:
        hydrate_customers(db, form_rows)
    except Exception:
        _db_safe_rollback(db)

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
                "submitted_at": json_datetime(getattr(row, "created_at", None)),
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
                    booking_id_text=form_submission_booking_id(db, row.id),
                )
            )
        except Exception:
            _db_safe_rollback(db)
            answers = parse_answers_json(getattr(row, "answers_json", None))
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
                "submitted_at": json_datetime(getattr(row, "submission_time", None)),
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
    row = form_submission_by_id(db, submission_id)
    if not row:
        raise HTTPException(status_code=404, detail="Form submission not found.")
    hydrate_customers(db, [row])

    booking = _issue_tickets(db, row)
    if not booking:
        raise HTTPException(status_code=500, detail="Could not create the QR ticket.")

    try:
        db.refresh(row)
    except Exception:
        _db_safe_rollback(db)
    phone = booking.receiver_phone or _answer_value(parse_answers_json(getattr(row, "answers_json", None)), PHONE_KEYS)
    delivery = _deliver_ticket(booking, phone, db=db)
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
    delivery = _deliver_ticket(booking, row.attendee_phone, db=db)
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
    from APIs.bookings import (
        _booking_is_cancelled,
        _booking_ticket_used,
        _lookup_booking_row,
        _serialize_booking,
        finalize_booking_cancellation,
    )
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


# ── Help & Support tickets (THP- IDs) ─────────────────────────


class SupportResolveRequest(BaseModel):
    resolution_note: Optional[str] = None


def _ensure_support_ticket_columns(db: Session) -> None:
    bind = db.get_bind()
    dialect = (bind.dialect.name if bind is not None else "") or ""
    if dialect == "postgresql":
        stmts = [
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_note TEXT",
            "ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP",
        ]
    else:
        stmts = [
            "ALTER TABLE support_tickets ADD COLUMN resolution_note TEXT",
            "ALTER TABLE support_tickets ADD COLUMN resolved_at DATETIME",
        ]
    for sql in stmts:
        try:
            db.execute(text(sql))
            db.commit()
        except Exception:
            db.rollback()


def _serialize_support_ticket(row) -> dict:
    return {
        "id": str(row.id),
        "ticket_code": row.ticket_code,
        "name": row.name,
        "email": row.email,
        "category": row.category,
        "priority": row.priority,
        "subject": row.subject,
        "message": row.message,
        "status": row.status,
        "resolution_note": getattr(row, "resolution_note", None),
        "resolved_at": json_datetime(getattr(row, "resolved_at", None)),
        "created_at": json_datetime(row.created_at),
        "updated_at": json_datetime(row.updated_at),
    }


def _notify_support_resolved(ticket) -> bool:
    email_addr = (ticket.email or "").strip()
    if not email_addr:
        return False
    code = ticket.ticket_code
    subject = f"Your support ticket {code} is solved — JOD Events"
    note = (getattr(ticket, "resolution_note", None) or "").strip()
    note_block = f"\n\nTeam note:\n{note}\n" if note else "\n"
    text_body = (
        f"Hi {ticket.name},\n\n"
        f"Good news — your Help & Support ticket {code} has been marked as solved.\n\n"
        f"Subject: {ticket.subject}\n"
        f"{note_block}"
        f"If you still need help, reply to this email or open a new ticket on jodevents.com/help "
        f"with a new THP- ID.\n\n"
        f"— JOD Events Support\n"
    )
    html_body = (
        f"<p>Hi {ticket.name},</p>"
        f"<p>Good news — your Help &amp; Support ticket <strong>{code}</strong> has been "
        f"<strong>marked as solved</strong>.</p>"
        f"<p><strong>Subject:</strong> {ticket.subject}</p>"
        + (f"<p><strong>Team note:</strong><br>{note}</p>" if note else "")
        + "<p>If you still need help, open a new ticket at "
        "<a href=\"https://jodevents.com/help\">jodevents.com/help</a>.</p>"
        "<p>— JOD Events Support</p>"
    )
    return bool(send_email(email_addr, subject, text_body, html_body=html_body))


@router.get("/support-tickets")
def admin_list_support_tickets(
    q: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    from Models.support_ticket import SupportTicket

    _ensure_support_ticket_columns(db)
    try:
        query = db.query(SupportTicket).order_by(SupportTicket.created_at.desc())
        rows = query.limit(200).all()
    except Exception:
        _db_safe_rollback(db)
        rows = []
    items = [_serialize_support_ticket(row) for row in rows]
    needle = (q or "").strip().lower()
    if needle:
        items = [
            item for item in items
            if needle in str(item.get("ticket_code") or "").lower()
            or needle in str(item.get("name") or "").lower()
            or needle in str(item.get("email") or "").lower()
            or needle in str(item.get("subject") or "").lower()
            or needle in str(item.get("message") or "").lower()
            or needle in str(item.get("category") or "").lower()
        ]
    wanted = (status_filter or "").strip().lower()
    if wanted in ("open", "in_progress", "resolved"):
        items = [item for item in items if str(item.get("status") or "").lower() == wanted]
    open_count = sum(
        1 for item in items if str(item.get("status") or "").lower() != "resolved"
    )
    return {"total": len(items), "open": open_count, "tickets": items}


@router.patch("/support-tickets/{ticket_code}")
def admin_update_support_ticket(
    ticket_code: str,
    payload: SupportResolveRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """Mark a Help & Support ticket resolved and email the customer."""
    from Models.support_ticket import SupportTicket
    from Utils.datetimes import utc_now

    _ensure_support_ticket_columns(db)
    code = str(ticket_code or "").strip().upper()
    if not code.startswith("THP-"):
        raise HTTPException(status_code=400, detail="Help tickets use THP- IDs (for example THP-1232).")
    row = db.query(SupportTicket).filter(SupportTicket.ticket_code == code).first()
    if not row:
        raise HTTPException(status_code=404, detail="Support ticket not found.")
    note = (payload.resolution_note or "").strip() or None
    row.status = "resolved"
    row.resolution_note = note
    row.resolved_at = utc_now()
    row.updated_at = utc_now()
    db.add(row)
    db.commit()
    db.refresh(row)
    emailed = _notify_support_resolved(row)
    return {
        "status": "success",
        "message": "Ticket marked as solved." + (" Customer emailed." if emailed else " Email could not be sent (check SMTP)."),
        "email_sent": emailed,
        "ticket": _serialize_support_ticket(row),
    }


class HostReviewRequest(BaseModel):
    action: str  # approve | reject | restrict
    rejection_reason: Optional[str] = None


def _serialize_host_application(app) -> Dict[str, Any]:
    status = (app.status or "pending").lower().strip()
    # Map application status to UI-friendly verification labels.
    verification = {
        "pending": "PENDING",
        "approved": "VERIFIED",
        "rejected": "REJECTED",
        "restricted": "RESTRICTED",
    }.get(status, status.upper())
    return {
        "id": str(app.id),
        "application_id": str(app.id),
        "organizer_account_id": str(app.organizer_account_id) if app.organizer_account_id else None,
        "email": app.email,
        "org_name": app.org_name,
        "host_id": app.host_id,
        "customer_id": app.customer_id,
        "contact_full_name": app.contact_full_name,
        "contact_email": app.contact_email,
        "contact_mobile": app.contact_mobile,
        "pan_number": app.pan_number,
        "org_address": app.org_address,
        "has_gstin": app.has_gstin,
        "gstin_number": app.gstin_number,
        "state": app.state,
        "beneficiary_name": app.beneficiary_name,
        "account_type": app.account_type,
        "bank_name": app.bank_name,
        "account_number": app.account_number,
        "bank_ifsc": app.bank_ifsc,
        "pan_card_url": app.pan_card_url,
        "cancelled_cheque_url": app.cancelled_cheque_url,
        "accepted_agreement": bool(app.accepted_agreement),
        "status": status,
        "action": app.action,
        "verification_status": verification,
        "rejection_reason": app.review_reason,
        "review_reason": app.review_reason,
        "reviewed_by": app.reviewed_by,
        "reviewed_at": json_datetime(app.reviewed_at) if app.reviewed_at else None,
        "submitted_at": json_datetime(app.submitted_at) if app.submitted_at else None,
        "created_at": json_datetime(app.created_at) if app.created_at else None,
        "dashboard_access": status == "approved",
        "can_approve": status == "pending",
        "can_reject": status == "pending",
        "can_restrict": status == "approved",
    }


def _backfill_host_applications(db: Session) -> None:
    """Seed application rows for organizer accounts that have no history yet."""
    from Models.organizer_accounts import OrganizerAccount
    from Models.host_application import HostApplication
    from APIs.organizers import is_setup_complete, snapshot_host_application
    from sqlalchemy import func

    try:
        accounted = {
            str(row[0]).lower()
            for row in db.query(func.lower(HostApplication.email)).distinct().all()
            if row and row[0]
        }
    except Exception:
        _db_safe_rollback(db)
        return

    rows = db.query(OrganizerAccount).all()
    created = 0
    for acc in rows:
        email = (acc.email or "").lower().strip()
        if not email or email in accounted:
            continue
        st = (acc.status or "").lower().strip()
        if st not in ("submitted", "verified", "rejected", "restricted") and not is_setup_complete(acc):
            continue
        if st == "verified":
            app_status, action = "approved", "approve"
        elif st == "rejected":
            app_status, action = "rejected", "reject"
        elif st == "restricted":
            app_status, action = "restricted", "restrict"
        else:
            app_status, action = "pending", "submit"
        row = snapshot_host_application(
            acc,
            status=app_status,
            action=action,
            review_reason=acc.rejection_reason,
            reviewed_by="system-backfill" if app_status != "pending" else None,
        )
        if acc.submitted_at:
            row.submitted_at = acc.submitted_at
        if acc.verified_at and app_status == "approved":
            row.reviewed_at = acc.verified_at
        db.add(row)
        created += 1
    if created:
        try:
            db.commit()
        except Exception:
            _db_safe_rollback(db)


def _notify_host_review(acc, *, approved: bool = False, restricted: bool = False) -> bool:
    email_addr = (acc.contact_email or acc.email or "").strip()
    if not email_addr or "@" not in email_addr:
        return False
    name = (acc.contact_full_name or acc.org_name or "Host").strip()
    if approved:
        subject = "Your JOD Events host account is approved"
        text_body = (
            f"Hi {name},\n\n"
            "Your host account setup has been verified. You can now open the Host Dashboard "
            "and start creating events.\n\n"
            "Sign in at jodevents.com and go to Host Your Event.\n\n"
            "— JOD Events\n"
        )
        html_body = (
            f"<p>Hi {name},</p>"
            "<p>Your host account setup has been <strong>verified</strong>. "
            "You can now open the Host Dashboard and start creating events.</p>"
            "<p>Sign in at <a href=\"https://jodevents.com\">jodevents.com</a> "
            "and go to Host Your Event.</p>"
            "<p>— JOD Events</p>"
        )
    elif restricted:
        reason = (acc.rejection_reason or "").strip() or "Access was restricted by JOD Events Authority."
        subject = "Your JOD Events host dashboard access was restricted"
        text_body = (
            f"Hi {name},\n\n"
            "Your Host Dashboard access has been restricted by JOD Events Authority.\n\n"
            f"Reason: {reason}\n\n"
            "Contact support if you need help.\n\n"
            "— JOD Events\n"
        )
        html_body = (
            f"<p>Hi {name},</p>"
            "<p>Your Host Dashboard access has been <strong>restricted</strong> by JOD Events Authority.</p>"
            f"<p><strong>Reason:</strong> {reason}</p>"
            "<p>Contact support if you need help.</p>"
            "<p>— JOD Events</p>"
        )
    else:
        reason = (acc.rejection_reason or "").strip() or "Please update your details and resubmit."
        subject = "Update needed on your JOD Events host application"
        text_body = (
            f"Hi {name},\n\n"
            "We could not approve your host account yet.\n\n"
            f"Reason: {reason}\n\n"
            "Please sign in, update your account setup, and resubmit for review.\n\n"
            "— JOD Events\n"
        )
        html_body = (
            f"<p>Hi {name},</p>"
            "<p>We could not approve your host account yet.</p>"
            f"<p><strong>Reason:</strong> {reason}</p>"
            "<p>Please sign in, update your account setup, and resubmit for review.</p>"
            "<p>— JOD Events</p>"
        )
    return bool(send_email(email_addr, subject, text_body, html_body=html_body))


@router.get("/hosts")
def admin_list_hosts(
    q: Optional[str] = Query(None),
    status_filter: Optional[str] = Query(None, alias="status"),
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """List host application history (each resubmit is a new entry)."""
    from Models.host_application import HostApplication

    _backfill_host_applications(db)
    try:
        rows = (
            db.query(HostApplication)
            .order_by(
                HostApplication.submitted_at.desc().nullslast(),
                HostApplication.created_at.desc().nullslast(),
            )
            .limit(500)
            .all()
        )
    except Exception:
        _db_safe_rollback(db)
        rows = []

    items = [_serialize_host_application(row) for row in rows]
    needle = (q or "").strip().lower()
    if needle:
        items = [
            item for item in items
            if needle in str(item.get("email") or "").lower()
            or needle in str(item.get("org_name") or "").lower()
            or needle in str(item.get("contact_full_name") or "").lower()
            or needle in str(item.get("host_id") or "").lower()
            or needle in str(item.get("customer_id") or "").lower()
            or needle in str(item.get("contact_mobile") or "").lower()
            or needle in str(item.get("status") or "").lower()
        ]
    wanted = (status_filter or "").strip().lower()
    if wanted in ("pending", "submitted", "approved", "verified", "rejected", "restricted"):
        if wanted in ("submitted",):
            wanted = "pending"
        if wanted in ("verified",):
            wanted = "approved"
        items = [item for item in items if str(item.get("status") or "").lower() == wanted]
    pending_count = sum(1 for item in items if str(item.get("status") or "").lower() == "pending")
    return {"total": len(items), "pending": pending_count, "hosts": items}


@router.patch("/hosts/{host_key}")
def admin_review_host(
    host_key: str,
    payload: HostReviewRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    """Approve, reject, or restrict a host application entry."""
    from datetime import datetime
    from Models.organizer_accounts import OrganizerAccount
    from Models.host_application import HostApplication
    from APIs.organizers import is_setup_complete, snapshot_host_application

    action = (payload.action or "").strip().lower()
    if action not in ("approve", "reject", "restrict", "verified", "rejected"):
        raise HTTPException(status_code=400, detail="action must be approve, reject, or restrict.")
    if action == "verified":
        action = "approve"
    if action == "rejected":
        action = "reject"

    key = str(host_key or "").strip()
    if not key:
        raise HTTPException(status_code=400, detail="Application id is required.")

    app = None
    try:
        import uuid as _uuid
        app = db.query(HostApplication).filter(HostApplication.id == _uuid.UUID(key)).first()
    except Exception:
        app = None

    org_acc = None
    if app and app.organizer_account_id:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.id == app.organizer_account_id).first()
    if not org_acc and app and app.email:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == app.email.lower()).first()

    # Legacy fallback: key may still be email / host_id / organizer id.
    if not app:
        if "@" in key:
            org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == key.lower()).first()
        if not org_acc:
            org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.host_id == key).first()
        if not org_acc:
            try:
                import uuid as _uuid
                org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.id == _uuid.UUID(key)).first()
            except Exception:
                org_acc = None
        if org_acc:
            app = (
                db.query(HostApplication)
                .filter(
                    (HostApplication.organizer_account_id == org_acc.id)
                    | (HostApplication.email == org_acc.email)
                )
                .order_by(HostApplication.submitted_at.desc().nullslast())
                .first()
            )

    if not org_acc:
        raise HTTPException(status_code=404, detail="Host account not found.")

    admin_email = (current_admin.email or "").strip() or "admin"
    now = datetime.utcnow()
    reason = (payload.rejection_reason or "").strip() or None

    if action == "approve":
        if not is_setup_complete(org_acc):
            raise HTTPException(status_code=400, detail="Host has not completed account setup yet.")
        if app and (app.status or "").lower() not in ("pending",):
            raise HTTPException(status_code=400, detail="Only pending applications can be approved.")
        org_acc.status = "verified"
        org_acc.verified_at = now
        org_acc.rejection_reason = None
        if app:
            app.status = "approved"
            app.action = "approve"
            app.review_reason = None
            app.reviewed_by = admin_email
            app.reviewed_at = now
            db.add(app)
        else:
            db.add(snapshot_host_application(org_acc, status="approved", action="approve", reviewed_by=admin_email))
        emailed = _notify_host_review(org_acc, approved=True)
        msg = "Host approved."
    elif action == "reject":
        if not reason:
            raise HTTPException(status_code=400, detail="rejection_reason is required when rejecting.")
        if app and (app.status or "").lower() not in ("pending",):
            raise HTTPException(status_code=400, detail="Only pending applications can be rejected.")
        org_acc.status = "rejected"
        org_acc.rejection_reason = reason
        org_acc.verified_at = None
        if app:
            app.status = "rejected"
            app.action = "reject"
            app.review_reason = reason
            app.reviewed_by = admin_email
            app.reviewed_at = now
            db.add(app)
        else:
            db.add(snapshot_host_application(
                org_acc, status="rejected", action="reject", review_reason=reason, reviewed_by=admin_email
            ))
        emailed = _notify_host_review(org_acc, approved=False)
        msg = "Host rejected."
    else:  # restrict
        if not reason:
            raise HTTPException(status_code=400, detail="rejection_reason is required when restricting access.")
        if (org_acc.status or "").lower() != "verified" and not (app and (app.status or "").lower() == "approved"):
            raise HTTPException(status_code=400, detail="Only approved hosts can be restricted.")
        org_acc.status = "restricted"
        org_acc.rejection_reason = reason
        org_acc.verified_at = None
        # Keep the approved history row; add a new restricted entry.
        db.add(snapshot_host_application(
            org_acc, status="restricted", action="restrict", review_reason=reason, reviewed_by=admin_email
        ))
        emailed = _notify_host_review(org_acc, restricted=True)
        msg = "Host access restricted."

    db.add(org_acc)
    db.commit()
    db.refresh(org_acc)

    # Prefer returning the application that was acted on / newest for this host.
    latest = (
        db.query(HostApplication)
        .filter(
            (HostApplication.organizer_account_id == org_acc.id)
            | (HostApplication.email == org_acc.email)
        )
        .order_by(HostApplication.submitted_at.desc().nullslast())
        .first()
    )
    return {
        "status": "success",
        "message": msg + (" Email sent." if emailed else " Email could not be sent (check SMTP)."),
        "email_sent": emailed,
        "host": _serialize_host_application(latest) if latest else None,
    }

