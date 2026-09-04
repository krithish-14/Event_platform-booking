"""
Booking routes — ticket bookings & event host tracking.
"""

import json
import re
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import Response
from pydantic import BaseModel
from sqlalchemy.orm import Session, defer, joinedload

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.booking import Booking
from Models.event import Event
from Models.user import User

router = APIRouter()


from sqlalchemy import String, cast, func, or_, text

from Models.ticket import Ticket
from Models.form_submissions import FormSubmission


class PendingPaymentResponse(BaseModel):
    event_id: Optional[str] = None
    event_title: Optional[str] = None
    event_venue: Optional[str] = None
    event_start_date: Optional[datetime] = None
    ticket_type: Optional[str] = None
    price: Optional[float] = None
    quantity: int = 1
    image_url: Optional[str] = None
    status: str = "PAYMENT_PENDING"
    order_kind: str = "pending"


class RegistrationStatusResponse(BaseModel):
    state: str
    booking_id: Optional[str] = None
    qr_token: Optional[str] = None
    ticket_id: Optional[str] = None
    ticket_type: Optional[str] = None
    price: Optional[float] = None
    event_title: Optional[str] = None
    venue: Optional[str] = None
    has_ticket: bool = False
    can_buy_again: bool = True


def _event_id_matches(event_id):
    candidates = [event_id, str(event_id)]
    try:
        parsed = UUID(str(event_id))
        candidates.append(parsed)
    except Exception:
        pass
    return candidates


def _event_id_keys(event_id):
    keys = set()
    for c in _event_id_matches(event_id):
        s = str(c or "").strip().lower()
        if not s:
            continue
        keys.add(s)
        keys.add(s.replace("-", ""))
    return keys


def _same_event_id(stored_id, event_id) -> bool:
    stored = str(stored_id or "").strip().lower()
    if not stored:
        return False
    keys = _event_id_keys(event_id)
    return stored in keys or stored.replace("-", "") in keys


def _norm_event_title(value) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _titles_match(left, right) -> bool:
    a = _norm_event_title(left)
    b = _norm_event_title(right)
    if not a or not b:
        return False
    return a == b or a in b or b in a


def _safe_db_rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:
        pass


def _as_str(value: Any, default: str = "") -> str:
    if value is None:
        return default
    return str(value)


def _as_optional_str(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _as_float(value: Any, default: float = 0.0) -> float:
    try:
        if value is None:
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


def _as_optional_float(value: Any) -> Optional[float]:
    try:
        if value is None:
            return None
        return float(value)
    except (TypeError, ValueError):
        return None


def _lookup_public_event(db: Session, event_id):
    eid = str(event_id or "").strip()
    if not eid:
        return None
    compact = eid.replace("-", "").lower()
    try:
        row = db.query(Event).filter(cast(Event.id, String) == eid).first()
        if row:
            return row
        return db.query(Event).filter(
            func.lower(func.replace(cast(Event.id, String), "-", "")) == compact
        ).first()
    except Exception:
        _safe_db_rollback(db)
        return None


def _lookup_host_event(db: Session, event_id):
    eid = str(event_id or "").strip()
    if not eid:
        return None
    compact = eid.replace("-", "").lower()
    try:
        from Models.event_management import EventManagement
        row = db.query(EventManagement).filter(cast(EventManagement.event_id, String) == eid).first()
        if row:
            return row
        return db.query(EventManagement).filter(
            func.lower(func.replace(cast(EventManagement.event_id, String), "-", "")) == compact
        ).first()
    except Exception:
        _safe_db_rollback(db)
        return None


def _related_event_id_keys(db: Session, event_id) -> set:
    keys = _event_id_keys(event_id)
    public_event = _lookup_public_event(db, event_id)
    host_event = _lookup_host_event(db, event_id)
    if public_event is not None:
        keys |= _event_id_keys(public_event.id)
        host_match = _lookup_host_event(db, public_event.id)
        if host_match is not None:
            keys |= _event_id_keys(host_match.event_id)
    if host_event is not None:
        keys |= _event_id_keys(host_event.event_id)
        public_match = _lookup_public_event(db, host_event.event_id)
        if public_match is not None:
            keys |= _event_id_keys(public_match.id)
    return keys


def _booking_matches_event(db: Session, booking, event_id) -> bool:
    if _same_event_id(getattr(booking, "event_id", None), event_id):
        return True
    related = _related_event_id_keys(db, event_id)
    stored = _event_id_keys(getattr(booking, "event_id", None))
    if stored & related:
        return True
    public_event = _lookup_public_event(db, event_id)
    host_event = _lookup_host_event(db, event_id)
    booking_title = getattr(getattr(booking, "event", None), "title", None)
    if public_event is not None and _titles_match(booking_title, public_event.title):
        return True
    if host_event is not None and _titles_match(booking_title, getattr(host_event, "event_title", None)):
        return True
    return False


def _stored_event_matches(db: Session, stored_id, event_id) -> bool:
    if _same_event_id(stored_id, event_id):
        return True
    return bool(_event_id_keys(stored_id) & _related_event_id_keys(db, event_id))


def _user_identity_keys(user) -> set:
    keys = set()
    if not user:
        return keys
    for val in (getattr(user, "customer_id", None), getattr(user, "id", None)):
        s = str(val or "").strip()
        if s:
            keys.add(s)
            keys.add(s.lower())
    return keys


CANCEL_REQUEST_STATUS = "CANCELLATION_REQUESTED"
CANCELLED_BOOKING_STATUSES = ("CANCELLED", "CANCELED", "REFUNDED")


def _booking_is_cancelled(booking) -> bool:
    return (getattr(booking, "status", None) or "").upper() in CANCELLED_BOOKING_STATUSES


def _booking_cancel_requested(booking) -> bool:
    return (getattr(booking, "status", None) or "").upper() == CANCEL_REQUEST_STATUS


def _booking_ticket_used(booking, db: Optional[Session] = None) -> bool:
    tickets = _booking_tickets(booking, db=db)
    for ticket in tickets:
        status_now = (getattr(ticket, "ticket_status", None) or "").upper()
        if status_now == "USED" or getattr(ticket, "used_at", None):
            return True
    return False


def _mark_form_cancelled_for_booking(db: Session, booking) -> None:
    """Free the attendee to buy again after the host confirms cancellation."""
    email = (getattr(booking, "receiver_email", None) or "").lower().strip()
    customer = getattr(booking, "customer", None)
    if not email and customer is not None:
        email = (getattr(customer, "email", None) or "").lower().strip()
    event_compact = str(getattr(booking, "event_id", None) or "").replace("-", "").lower()
    if not email:
        return
    try:
        rows = (
            db.query(FormSubmission)
            .filter(func.lower(FormSubmission.user_email) == email)
            .all()
        )
    except Exception:
        _safe_db_rollback(db)
        return
    for row in rows:
        stored = str(getattr(row, "event_id", None) or "").replace("-", "").lower()
        if event_compact and stored and stored != event_compact:
            continue
        try:
            db.execute(
                text("UPDATE form_submissions SET status = :st WHERE id = :id"),
                {"st": "cancelled", "id": row.id},
            )
            db.commit()
        except Exception:
            _safe_db_rollback(db)


def finalize_booking_cancellation(db: Session, booking) -> Booking:
    """Host-confirmed cancel: void tickets and let the attendee buy again."""
    setattr(booking, "status", "CANCELLED")
    try:
        db.query(Ticket).filter(Ticket.booking_id == booking.booking_id).update(
            {Ticket.ticket_status: "CANCELLED"}
        )
        db.commit()
    except Exception:
        _safe_db_rollback(db)
        db.query(Ticket).filter(Ticket.booking_id == booking.booking_id).update(
            {Ticket.ticket_status: "CANCELLED"}
        )
        db.commit()
    db.refresh(booking)
    _mark_form_cancelled_for_booking(db, booking)
    return booking


def _active_booking_for_event(db: Session, user, event_id):
    if not user or not event_id:
        return None
    id_keys = _user_identity_keys(user)
    email = (getattr(user, "email", None) or "").lower().strip()
    owner_filters = []
    if id_keys:
        owner_filters.append(Booking.customer_id.in_(list(id_keys)))
    if email:
        owner_filters.append(func.lower(Booking.receiver_email) == email)

    query = db.query(Booking).options(
        joinedload(Booking.event),
        joinedload(Booking.customer),
        joinedload(Booking.tickets),
    )
    if owner_filters:
        query = query.filter(or_(*owner_filters))
    bookings = query.order_by(Booking.booked_at.desc()).all()

    for booking in bookings:
        if _booking_is_cancelled(booking):
            continue
        if not _booking_matches_event(db, booking, event_id):
            continue
        owner = str(booking.customer_id or "").strip()
        recv = (booking.receiver_email or "").lower().strip()
        cust_email = ""
        if getattr(booking, "customer", None):
            cust_email = (booking.customer.email or "").lower().strip()
        if owner in id_keys or owner.lower() in id_keys:
            return booking
        if email and (recv == email or cust_email == email):
            return booking

    if id_keys:
        related = _related_event_id_keys(db, event_id)
        tickets = (
            db.query(Ticket)
            .filter(Ticket.customer_id.in_(list(id_keys)))
            .order_by(Ticket.created_at.desc())
            .all()
        )
        for ticket in tickets:
            if (ticket.ticket_status or "").upper() in ("CANCELLED", "CANCELED"):
                continue
            if not (_same_event_id(ticket.event_id, event_id) or (_event_id_keys(ticket.event_id) & related)):
                continue
            booking = _lookup_booking_row(db, ticket.booking_id)
            if booking and not _booking_is_cancelled(booking):
                return booking
    return None

# ── Schemas ───────────────────────────────────────────────────────────────────
class BookingCreateRequest(BaseModel):
    event_id: str
    ticket_type: Optional[str] = "Standard Access"
    quantity: int = 1
    total_price: Optional[float] = None
    payment_id: Optional[str] = None
    payment_mode: Optional[str] = "UPI / Card"
    seat_number: Optional[str] = None
    receiver_name: Optional[str] = None
    receiver_email: Optional[str] = None
    receiver_phone: Optional[str] = None


class BookingResponse(BaseModel):
    booking_id: str
    ticket_id: Optional[str] = None
    qr_token: Optional[str] = None
    ticket_status: Optional[str] = "VALID"
    used_at: Optional[datetime] = None
    customer_id: str
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_city: Optional[str] = None
    event_id: str
    event_title: Optional[str] = None
    event_venue: Optional[str] = None
    event_start_date: Optional[datetime] = None
    event_is_cancelled: bool = False
    event_is_published: bool = True
    event_updated_at: Optional[datetime] = None
    ticket_type: str
    quantity: int
    total_price: float
    status: str
    payment_id: Optional[str] = None
    payment_mode: Optional[str] = "UPI / Card"
    gst_amount: float = 0.0
    seat_number: Optional[str] = "General Admission"
    receiver_name: Optional[str] = None
    receiver_email: Optional[str] = None
    receiver_phone: Optional[str] = None
    booked_at: datetime
    card_image: Optional[str] = None
    image_url: Optional[str] = None
    agenda: Optional[Any] = None
    event_end_date: Optional[datetime] = None
    event_start_display: Optional[str] = None
    event_end_display: Optional[str] = None
    event_start_time: Optional[str] = None
    event_end_time: Optional[str] = None
    language: Optional[str] = None
    event_format: Optional[str] = None
    has_qr: bool = False

    class Config:
        from_attributes = True


def _booking_event_images(b: Booking, db: Optional[Session] = None):
    """Resolve card + hero images for tickets; prefer card_image from catalog or design."""
    card_image = None
    hero_image = None
    if b.event:
        card_image = _as_optional_str(getattr(b.event, "card_image", None))
        hero_image = _as_optional_str(getattr(b.event, "image_url", None))
    event_id = getattr(b, "event_id", None)
    if not card_image and db is not None and event_id is not None:
        try:
            from Models.event_design import EventDesign
            design = db.query(EventDesign).filter(EventDesign.event_id == event_id).first()
            design_card = _as_optional_str(getattr(design, "card_image", None)) if design is not None else None
            if design_card:
                card_image = design_card
        except Exception:
            pass
    ticket_image = card_image or hero_image
    return ticket_image, card_image, hero_image


def _booking_event_agenda(event_id, db: Optional[Session] = None) -> list:
    if not event_id or db is None:
        return []
    try:
        from Models.event_management import EventManagement
        host = db.query(EventManagement).filter(EventManagement.event_id == event_id).first()
        if not host:
            try:
                host = db.query(EventManagement).filter(EventManagement.event_id == str(event_id)).first()
            except Exception:
                host = None
        raw = getattr(host, "agenda_json", None) if host else None
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except Exception:
                return []
        if not isinstance(raw, list):
            return []
        out = []
        for row in raw:
            if not isinstance(row, dict):
                continue
            title = str(row.get("title") or row.get("session") or row.get("name") or "").strip()
            if not title:
                continue
            out.append({
                "time": str(row.get("time") or row.get("slot") or "").strip(),
                "title": title,
                "speaker": str(row.get("speaker") or row.get("host") or "").strip(),
            })
        return out
    except Exception:
        return []


def _booking_tickets(b: Booking, db: Optional[Session] = None) -> List[Ticket]:
    """Return issued tickets only. Minting happens after payment verify (or admin Resend QR)."""
    tickets = list(getattr(b, "tickets", None) or [])
    if tickets:
        return tickets
    if db is None or not getattr(b, "booking_id", None):
        return []
    try:
        return db.query(Ticket).filter(Ticket.booking_id == b.booking_id).all()
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        try:
            compact = str(b.booking_id).replace("-", "").lower()
            return db.query(Ticket).filter(
                func.lower(func.replace(cast(Ticket.booking_id, String), "-", "")) == compact
            ).all()
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        return []


def _event_schedule_display(db: Optional[Session], event_id, public_start, public_end):
    """Host Manage date/time is the ticket clock. Catalog UTC is only a fallback."""
    from Utils.datetimes import format_host_event_when, format_utc_naive_as_ist_when

    host = None
    if db is not None and event_id is not None:
        host = _lookup_host_event(db, event_id)
        if host is None:
            try:
                for key in _related_event_id_keys(db, event_id):
                    host = _lookup_host_event(db, key)
                    if host is not None:
                        break
            except Exception:
                _safe_db_rollback(db)
                host = None
    start_time = _as_optional_str(getattr(host, "event_start_time", None)) if host else None
    end_time = _as_optional_str(getattr(host, "event_end_time", None)) if host else None
    start_display = ""
    if host is not None and (getattr(host, "event_start_date", None) or start_time):
        start_display = format_host_event_when(host.event_start_date, start_time)
    if not start_display:
        start_display = format_utc_naive_as_ist_when(public_start)
    end_display = ""
    if host is not None and (getattr(host, "event_end_date", None) or end_time):
        end_src = host.event_end_date or host.event_start_date
        end_display = format_host_event_when(end_src, end_time)
    if not end_display:
        end_display = format_utc_naive_as_ist_when(public_end)
    return start_display or None, end_display or None, start_time, end_time


def _serialize_booking(b: Booking, db: Optional[Session] = None) -> dict:
    event_title = b.event.title if b.event else "Event"
    event_venue = (b.event.venue or b.event.location) if b.event else None
    event_start = b.event.start_date if b.event else None
    user_name = (b.receiver_name or (b.customer.full_name if b.customer else None) or (b.customer.username if b.customer else None) or "Guest")
    user_email = (b.receiver_email or (b.customer.email if b.customer else None) or "")
    user_phone = b.receiver_phone or (getattr(b.customer, "phone", None) if b.customer else None) or ""
    user_city = b.customer.city if b.customer else None

    pid = getattr(b, "payment_id", None)
    pmode = getattr(b, "payment_mode", None) or "UPI"
    gst = _as_float(getattr(b, "gst_amount", None))
    seat = getattr(b, "seat_number", None) or ""

    tickets = _booking_tickets(b, db=db)
    primary_ticket = tickets[0] if tickets else None
    ticket_id = str(primary_ticket.ticket_id) if primary_ticket else None
    qr_token = primary_ticket.qr_token if primary_ticket else None
    ticket_status = primary_ticket.ticket_status if primary_ticket else (b.status or None)
    used_at = primary_ticket.used_at if primary_ticket else None
    ticket_image, card_image, hero_image = _booking_event_images(b, db=db)
    start_display, end_display, start_time, end_time = _event_schedule_display(
        db, b.event_id, event_start, b.event.end_date if b.event else None
    )

    return {
        "booking_id": str(b.booking_id),
        "ticket_id": ticket_id,
        "qr_token": qr_token,
        "has_qr": bool(qr_token),
        "ticket_status": ticket_status,
        "used_at": used_at,
        "customer_id": str(b.customer_id),
        "user_name": user_name,
        "user_email": user_email,
        "user_city": user_city,
        "event_id": str(b.event_id),
        "event_title": event_title,
        "event_venue": event_venue,
        "event_start_date": event_start,
        "event_start_display": start_display,
        "event_end_display": end_display,
        "event_start_time": start_time,
        "event_end_time": end_time,
        "event_is_cancelled": bool(getattr(b.event, "is_cancelled", False)) if b.event else False,
        "event_is_published": bool(getattr(b.event, "is_published", True)) if b.event else True,
        "event_updated_at": getattr(b.event, "updated_at", None) if b.event else None,
        "ticket_type": _as_optional_str(getattr(b, "ticket_type", None)) or "Standard Access",
        "quantity": b.quantity,
        "total_price": _as_float(getattr(b, "total_price", None)),
        "status": b.status or "CONFIRMED",
        "payment_id": pid,
        "payment_mode": pmode,
        "gst_amount": gst,
        "seat_number": seat,
        "receiver_name": user_name,
        "receiver_email": user_email,
        "receiver_phone": user_phone,
        "booked_at": b.booked_at,
        "card_image": card_image or ticket_image,
        "image_url": ticket_image or hero_image,
        "agenda": _booking_event_agenda(b.event_id, db),
        "event_end_date": b.event.end_date if b.event else None,
        "language": getattr(b.event, "language", None) if b.event else None,
        "event_format": getattr(b.event, "event_format", None) if b.event else None,
    }


# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("", response_model=BookingResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=BookingResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_ticket_booking(
    payload: BookingCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Public self-booking is disabled. Tickets are issued after verified payment (or admin Resend QR)."""
    existing = None
    try:
        existing = _active_booking_for_event(db, current_user, payload.event_id)
    except Exception:
        existing = None
    if existing and _booking_tickets(existing, db=db):
        return _serialize_booking(existing, db=db)
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Tickets are issued by JOD Events admin after payment verification. Complete the registration form and UPI payment, then wait for Generate QR.",
    )


@router.get("/my-bookings", response_model=List[BookingResponse])
def get_my_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch issued QR tickets for the currently authenticated user."""
    email = (current_user.email or "").lower().strip()
    owner_filters = [Booking.customer_id == current_user.customer_id]
    if email:
        owner_filters.append(func.lower(Booking.receiver_email) == email)
    bookings = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(or_(*owner_filters))
        .order_by(Booking.booked_at.desc())
        .all()
    )
    issued = []
    seen = set()
    for b in bookings:
        key = str(b.booking_id)
        if key in seen:
            continue
        seen.add(key)
        data = _serialize_booking(b, db=db)
        if data.get("qr_token") or data.get("ticket_id"):
            issued.append(data)
    return issued


@router.get("/my-pending", response_model=List[PendingPaymentResponse])
def get_my_pending_payments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Form submitted but payment / QR ticket not yet generated."""
    email = (current_user.email or "").lower().strip()
    customer_id = str(current_user.customer_id or "").strip()
    owner_filters = [func.lower(FormSubmission.user_email) == email]
    if customer_id:
        owner_filters.append(FormSubmission.customer_id == customer_id)
    rows = (
        db.query(FormSubmission)
        .filter(or_(*owner_filters))
        .order_by(FormSubmission.submission_time.desc())
        .all()
    )
    seen_events = set()
    pending = []
    for row in rows:
        status_val = (row.status or "").lower()
        if status_val == "paid":
            continue
        if status_val not in ("payment_pending", "completed", "pending", "submitted", ""):
            continue
        event_id = str(row.event_id or "").strip()
        if not event_id:
            continue
        event_key = event_id.lower().replace("-", "")
        if event_key in seen_events:
            continue
        if _active_booking_for_event(db, current_user, event_id):
            continue
        seen_events.add(event_key)
        event_row = _lookup_public_event(db, event_id)
        ticket, price = _ticket_from_answers(row.answers_json)
        ticket_name = _as_optional_str(ticket) or _as_optional_str(getattr(row, "ticket_type", None)) or "General Admission"
        price_val = _as_optional_float(price)
        if price_val is None:
            price_val = _as_optional_float(getattr(row, "ticket_price", None))
        if price_val is None:
            price_val = _as_float(getattr(event_row, "price", None) if event_row is not None else None)
        pending.append(PendingPaymentResponse(
            event_id=event_id,
            event_title=getattr(event_row, "title", None),
            event_venue=getattr(event_row, "venue", None) or getattr(event_row, "location", None),
            event_start_date=getattr(event_row, "start_date", None),
            ticket_type=ticket_name,
            price=price_val,
            quantity=1,
            image_url=getattr(event_row, "image_url", None),
            status="PAYMENT_PENDING",
            order_kind="pending",
        ))
    return pending


def _sql_set_booking_id(db: Session, table: str, id_col: str, row_id, booking_id) -> bool:
    """Set booking_id without GUID VARCHAR binds into a live UUID column."""
    if row_id is None or booking_id is None:
        return False
    if table not in ("form_submissions", "payment_proofs") or id_col not in ("id",):
        return False
    bid = str(booking_id)
    for sql in (
        f"UPDATE {table} SET booking_id = CAST(:bid AS uuid) WHERE {id_col} = :id",
        f"UPDATE {table} SET booking_id = CAST(:bid AS varchar) WHERE {id_col} = :id",
    ):
        try:
            db.execute(text(sql), {"bid": bid, "id": row_id})
            db.commit()
            return True
        except Exception:
            _safe_db_rollback(db)
    return False


def _mark_form_submission_paid(db: Session, event_id, user, booking_id=None) -> None:
    if not event_id or not user:
        return
    email = (getattr(user, "email", None) or "").lower().strip()
    customer_id = str(getattr(user, "customer_id", None) or "").strip()
    owner_filters = []
    if email:
        owner_filters.append(func.lower(FormSubmission.user_email) == email)
    if customer_id:
        owner_filters.append(FormSubmission.customer_id == customer_id)
    if not owner_filters:
        return
    try:
        rows = (
            db.query(FormSubmission)
            .options(defer(FormSubmission.booking_id))  # type: ignore[arg-type]
            .filter(or_(*owner_filters))
            .all()
        )
    except Exception:
        _safe_db_rollback(db)
        return
    for row in rows:
        if not _stored_event_matches(db, row.event_id, event_id):
            continue
        params = {"st": "paid", "id": row.id}
        status_sql = "UPDATE form_submissions SET status = :st WHERE id = :id"
        if customer_id:
            status_sql = (
                "UPDATE form_submissions SET status = :st, "
                "customer_id = COALESCE(customer_id, :cid) WHERE id = :id"
            )
            params["cid"] = customer_id
        try:
            db.execute(text(status_sql), params)
            db.commit()
        except Exception:
            _safe_db_rollback(db)
        if booking_id is not None:
            _sql_set_booking_id(db, "form_submissions", "id", row.id, booking_id)


def _ticket_from_answers(answers: Any) -> tuple:
    if not isinstance(answers, dict):
        return "", None
    ticket = (
        answers.get("_ticket_type")
        or answers.get("ticket_type")
        or answers.get("Ticket")
        or answers.get("Ticket Type")
        or ""
    )
    generic = {
        "general admission", "general pass", "general", "ga",
        "standard access", "standard access pass", "standard", "access pass", "ticket",
    }
    ticket_text = str(ticket or "").strip()
    if not ticket_text or ticket_text.lower() in generic:
        for key, val in answers.items():
            label = str(key or "").strip().lower()
            if any(skip in label for skip in ("price", "qty", "quantity", "amount", "passport", "password")):
                continue
            if "ticket" in label or re.search(r"\bpass(es)?\b", label):
                text = str(val or "").strip()
                if text and text.lower() not in generic:
                    ticket_text = text
                    break
    price = answers.get("_ticket_price")
    if price is None:
        price = answers.get("ticket_price")
    try:
        price_val = float(price) if price is not None and str(price).strip() != "" else None
    except (TypeError, ValueError):
        price_val = None
    return ticket_text, price_val


@router.get("/registration-status", response_model=RegistrationStatusResponse)
def get_registration_status(
    event_id: str = Query(..., description="Public event UUID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return ticket ownership and any open payment-pending registration for this event.

    Attendees may buy again after holding a ticket. `has_ticket` drives View Ticket /
    View Agenda; `state=payment_pending` resumes an unfinished second purchase.
    """
    ticket_booking = _active_booking_for_event(db, current_user, event_id)
    ticket_meta = {
        "booking_id": None,
        "qr_token": None,
        "ticket_id": None,
        "ticket_type": None,
        "price": None,
        "event_title": None,
        "venue": None,
        "has_ticket": False,
    }
    if ticket_booking and _booking_tickets(ticket_booking, db=db):
        try:
            _mark_form_submission_paid(db, event_id, current_user, booking_id=ticket_booking.booking_id)
        except Exception:
            try:
                db.rollback()
            except Exception:
                pass
        event = getattr(ticket_booking, "event", None)
        tickets = _booking_tickets(ticket_booking, db=db)
        qr_token = getattr(tickets[0], "qr_token", None) if tickets else None
        ticket_id = str(getattr(tickets[0], "ticket_id", None) or "") if tickets else None
        ticket_meta = {
            "booking_id": str(ticket_booking.booking_id),
            "qr_token": qr_token,
            "ticket_id": ticket_id or None,
            "ticket_type": _as_optional_str(getattr(ticket_booking, "ticket_type", None)),
            "price": _as_float(getattr(ticket_booking, "total_price", None)),
            "event_title": getattr(event, "title", None),
            "venue": getattr(event, "venue", None) or getattr(event, "location", None),
            "has_ticket": True,
        }

    email = (current_user.email or "").lower().strip()
    customer_id = str(current_user.customer_id or "").strip()
    owner_filters = [func.lower(FormSubmission.user_email) == email]
    if customer_id:
        owner_filters.append(FormSubmission.customer_id == customer_id)
    submissions = (
        db.query(FormSubmission)
        .filter(or_(*owner_filters))
        .order_by(FormSubmission.submission_time.desc())
        .all()
    )
    pending = None
    related = _related_event_id_keys(db, event_id)
    for row in submissions:
        if not (_same_event_id(row.event_id, event_id) or (_event_id_keys(row.event_id) & related)):
            continue
        status_val = (row.status or "").lower()
        if status_val == "paid":
            continue
        if status_val in ("payment_pending", "completed", "pending", "submitted", ""):
            pending = row
            break
    if pending:
        ticket, price = _ticket_from_answers(pending.answers_json)
        ticket_name = _as_optional_str(ticket) or _as_optional_str(getattr(pending, "ticket_type", None))
        price_val = _as_optional_float(price)
        if price_val is None:
            price_val = _as_optional_float(getattr(pending, "ticket_price", None))
        event_row = _lookup_public_event(db, event_id)
        if price_val is None and event_row is not None:
            price_val = _as_optional_float(getattr(event_row, "price", None))
        return RegistrationStatusResponse(
            state="payment_pending",
            booking_id=ticket_meta["booking_id"],
            qr_token=ticket_meta["qr_token"],
            ticket_id=ticket_meta["ticket_id"],
            ticket_type=ticket_name,
            price=price_val,
            event_title=getattr(event_row, "title", None) or ticket_meta["event_title"],
            venue=(getattr(event_row, "venue", None) or getattr(event_row, "location", None) or ticket_meta["venue"]),
            has_ticket=ticket_meta["has_ticket"],
            can_buy_again=True,
        )

    if ticket_meta["has_ticket"]:
        return RegistrationStatusResponse(
            state="ticket",
            booking_id=ticket_meta["booking_id"],
            qr_token=ticket_meta["qr_token"],
            ticket_id=ticket_meta["ticket_id"],
            ticket_type=ticket_meta["ticket_type"],
            price=ticket_meta["price"],
            event_title=ticket_meta["event_title"],
            venue=ticket_meta["venue"],
            has_ticket=True,
            can_buy_again=True,
        )

    return RegistrationStatusResponse(state="new", has_ticket=False, can_buy_again=True)


@router.get("/host/tracking", response_model=List[BookingResponse])
def get_host_tracking_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Bookings for events owned by the authenticated host — never the global booking list."""
    owned_event_ids = db.query(Event.id).filter(
        or_(
            Event.customer_id == current_user.customer_id,
            Event.organizer_id == current_user.id,
        )
    )
    bookings = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(Booking.event_id.in_(owned_event_ids))
        .order_by(Booking.booked_at.desc())
        .all()
    )
    return [_serialize_booking(b, db=db) for b in bookings]


def _assert_booking_owner(booking: Booking, current_user: User) -> None:
    if str(booking.customer_id) == str(current_user.customer_id):
        return
    email = (getattr(current_user, "email", None) or "").lower().strip()
    if email and (booking.receiver_email or "").lower().strip() == email:
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You can only access your own bookings.",
    )


def _lookup_booking_row(db: Session, booking_id) -> Optional[Booking]:
    bid = str(booking_id or "").strip()
    if not bid:
        return None
    compact = bid.replace("-", "").lower()
    try:
        row = (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(cast(Booking.booking_id, String) == bid)
            .first()
        )
        if row:
            return row
        return (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(func.lower(func.replace(cast(Booking.booking_id, String), "-", "")) == compact)
            .first()
        )
    except Exception:
        try:
            db.rollback()
        except Exception:
            pass
        return None


@router.get("/{booking_id}", response_model=BookingResponse)
def get_single_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get details for an individual booking owned by the authenticated user."""
    b = _lookup_booking_row(db, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found.")
    _assert_booking_owner(b, current_user)
    return _serialize_booking(b, db=db)


def _ticket_pdf_http_response(booking: Booking, db: Session, qr_token: str = "", kind: str = "ticket"):
    from Services.ticket_pdf import build_mticket_pdf_from_booking, ticket_pdf_filename

    kind_key = "invoice" if str(kind or "").strip().lower() == "invoice" else "ticket"
    include_qr = kind_key != "invoice"
    pdf = build_mticket_pdf_from_booking(
        booking, qr_token=qr_token, db=db, include_qr=include_qr
    )
    if not pdf:
        raise HTTPException(status_code=500, detail="Could not generate the ticket PDF.")
    filename = ticket_pdf_filename(booking.booking_id, kind=kind_key)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "private, no-store",
        },
    )


@router.get("/{booking_id}/pdf")
def download_booking_ticket_pdf(
    booking_id: str,
    kind: str = "ticket",
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Same rounded M-ticket card PDF that is emailed after Generate QR. Use kind=invoice to omit the QR."""
    booking = _lookup_booking_row(db, booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    _assert_booking_owner(booking, current_user)
    tickets = _booking_tickets(booking, db=db)
    token = ""
    if tickets:
        token = (getattr(tickets[0], "qr_token", None) or "").strip()
    kind_key = "invoice" if str(kind or "").strip().lower() == "invoice" else "ticket"
    if kind_key == "ticket" and not token:
        raise HTTPException(status_code=404, detail="QR ticket is not ready yet.")
    return _ticket_pdf_http_response(booking, db, token, kind=kind_key)


@router.post("/{booking_id}/cancel", response_model=BookingResponse)
def cancel_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Attendee cancellation request. The host must confirm before the ticket is voided."""
    b = _lookup_booking_row(db, booking_id)
    if not b:
        raise HTTPException(status_code=404, detail="Booking not found.")
    _assert_booking_owner(b, current_user)

    if _booking_is_cancelled(b) or _booking_cancel_requested(b):
        return _serialize_booking(b, db=db)

    if _booking_ticket_used(b, db=db):
        raise HTTPException(
            status_code=400,
            detail="This ticket is already checked in and cannot be cancelled.",
        )

    setattr(b, "status", CANCEL_REQUEST_STATUS)
    db.commit()
    db.refresh(b)
    b_full = _lookup_booking_row(db, b.booking_id)
    return _serialize_booking(b_full or b, db=db)


