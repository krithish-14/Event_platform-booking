"""
Booking routes — ticket bookings & event host tracking.
"""

from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.booking import Booking
from Models.event import Event
from Models.user import User

router = APIRouter()


import random
import secrets
from sqlalchemy import func, or_

from Models.ticket import Ticket, generate_qr_token
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
    ticket_type: Optional[str] = None
    price: Optional[float] = None
    event_title: Optional[str] = None
    venue: Optional[str] = None


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


def _booking_is_cancelled(booking) -> bool:
    return (getattr(booking, "status", None) or "").upper() in ("CANCELLED", "CANCELED", "REFUNDED")


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
        if not _same_event_id(booking.event_id, event_id):
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
        tickets = (
            db.query(Ticket)
            .filter(Ticket.customer_id.in_(list(id_keys)))
            .order_by(Ticket.created_at.desc())
            .all()
        )
        for ticket in tickets:
            if (ticket.ticket_status or "").upper() in ("CANCELLED", "CANCELED"):
                continue
            if not _same_event_id(ticket.event_id, event_id):
                continue
            booking = (
                db.query(Booking)
                .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
                .filter(Booking.booking_id == ticket.booking_id)
                .first()
            )
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
    customer_id: str
    user_name: Optional[str] = None
    user_email: Optional[str] = None
    user_city: Optional[str] = None
    event_id: str
    event_title: Optional[str] = None
    event_venue: Optional[str] = None
    event_start_date: Optional[datetime] = None
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

    class Config:
        from_attributes = True


def _ensure_tickets_exist(b: Booking, db: Session = None) -> List[Ticket]:
    """Ensure at least one Ticket with a secure QR token exists for the given Booking."""
    tickets = getattr(b, "tickets", []) or []
    if tickets:
        return tickets

    if db is None:
        from Models.base import get_session_factory
        db_factory = get_session_factory()
        db = db_factory()
        close_on_exit = True
    else:
        close_on_exit = False

    try:
        existing = db.query(Ticket).filter(Ticket.booking_id == b.booking_id).all()
        if existing:
            return existing

        qty = max(1, b.quantity or 1)
        created_tickets = []
        is_cancelled = (b.status or "").upper() == "CANCELLED"
        t_status = "CANCELLED" if is_cancelled else "VALID"

        for i in range(qty):
            t = Ticket(
                booking_id=b.booking_id,
                event_id=b.event_id,
                customer_id=b.customer_id,
                ticket_type=b.ticket_type or "Standard Access",
                seat_number=None,
                qr_token=generate_qr_token(),
                ticket_status=t_status,
            )
            db.add(t)
            created_tickets.append(t)

        db.commit()
        for t in created_tickets:
            db.refresh(t)
        return created_tickets
    except Exception as err:
        print(f"  [WARN] Ticket auto-generation fallback notice: {err}")
        return []
    finally:
        if close_on_exit:
            db.close()


def _serialize_booking(b: Booking, db: Session = None) -> dict:
    event_title = b.event.title if b.event else "Event"
    event_venue = (b.event.venue or b.event.location) if b.event else None
    event_start = b.event.start_date if b.event else None
    user_name = (b.receiver_name or (b.customer.full_name if b.customer else None) or (b.customer.username if b.customer else None) or "Guest Customer")
    user_email = (b.receiver_email or (b.customer.email if b.customer else None) or "customer@jodevents.com")
    user_phone = (b.receiver_phone or "+91 98765 43210")
    user_city = b.customer.city if b.customer else "Chennai"

    pid = getattr(b, "payment_id", None) or f"PAY-JOD-{str(b.booking_id)[:8].upper()}"
    pmode = getattr(b, "payment_mode", None) or "UPI / Card"
    gst = float(getattr(b, "gst_amount", 0.0) or round(float(b.total_price or 0.0) * 0.18, 2))
    seat = getattr(b, "seat_number", None) or "Row B, Seat 12-14"

    # Get linked Ticket records
    tickets = _ensure_tickets_exist(b, db=db)
    primary_ticket = tickets[0] if tickets else None
    ticket_id = str(primary_ticket.ticket_id) if primary_ticket else f"TKT-JOD-{str(b.booking_id)[:8].upper()}"
    qr_token = primary_ticket.qr_token if primary_ticket else None
    ticket_status = primary_ticket.ticket_status if primary_ticket else (b.status or "VALID")

    return {
        "booking_id": str(b.booking_id),
        "ticket_id": ticket_id,
        "qr_token": qr_token,
        "ticket_status": ticket_status,
        "customer_id": str(b.customer_id),
        "user_name": user_name,
        "user_email": user_email,
        "user_city": user_city,
        "event_id": str(b.event_id),
        "event_title": event_title,
        "event_venue": event_venue,
        "event_start_date": event_start,
        "ticket_type": b.ticket_type or "Standard Access",
        "quantity": b.quantity,
        "total_price": float(b.total_price or 0.0),
        "status": b.status or "CONFIRMED",
        "payment_id": pid,
        "payment_mode": pmode,
        "gst_amount": gst,
        "seat_number": seat,
        "receiver_name": user_name,
        "receiver_email": user_email,
        "receiver_phone": user_phone,
        "booked_at": b.booked_at,
    }


# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("", response_model=BookingResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=BookingResponse, status_code=status.HTTP_201_CREATED, include_in_schema=False)
def create_ticket_booking(
    payload: BookingCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new ticket booking for the logged-in user using their customer_id."""
    try:
        ev_uuid = UUID(payload.event_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid event ID format.")

    event = db.query(Event).filter(
        Event.id == ev_uuid,
        Event.is_published == True,
        Event.is_cancelled == False,
    ).first()
    if not event:
        raise HTTPException(status_code=404, detail="This event is currently unavailable.")

    existing = _active_booking_for_event(db, current_user, event.id)
    if existing:
        try:
            _mark_form_submission_paid(db, event.id, current_user, booking_id=existing.booking_id)
        except Exception:
            pass
        return _serialize_booking(existing, db=db)

    qty = max(1, payload.quantity)
    calculated_price = payload.total_price if payload.total_price is not None else (event.price * qty)

    payment_id = payload.payment_id or f"PAY-JOD-{secrets.token_hex(4).upper()}"
    gst_calc = round(calculated_price * 0.18, 2)

    booking = Booking(
        customer_id=current_user.customer_id,
        event_id=event.id,
        ticket_type=payload.ticket_type or "Standard Access",
        quantity=qty,
        total_price=calculated_price,
        status="CONFIRMED",
        payment_id=payment_id,
        payment_mode=payload.payment_mode or "UPI / Card",
        gst_amount=gst_calc,
        seat_number=payload.seat_number,
        receiver_name=payload.receiver_name or current_user.full_name or current_user.username,
        receiver_email=payload.receiver_email or current_user.email,
        receiver_phone=payload.receiver_phone or getattr(current_user, "phone", None),
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)

    for _ in range(qty):
        t = Ticket(
            booking_id=booking.booking_id,
            event_id=event.id,
            customer_id=current_user.customer_id,
            ticket_type=booking.ticket_type,
            seat_number=None,
            qr_token=generate_qr_token(),
            ticket_status="VALID",
        )
        db.add(t)
    db.commit()

    try:
        _mark_form_submission_paid(db, event.id, current_user, booking_id=booking.booking_id)
    except Exception:
        pass

    b_full = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(Booking.booking_id == booking.booking_id)
        .first()
    )
    return _serialize_booking(b_full or booking, db=db)


@router.get("/my-bookings", response_model=List[BookingResponse])
def get_my_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch all bookings for the currently authenticated user by customer_id."""
    bookings = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(Booking.customer_id == current_user.customer_id)
        .order_by(Booking.booked_at.desc())
        .all()
    )
    return [_serialize_booking(b, db=db) for b in bookings]


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
        ticket, price = _ticket_from_answers(row.answers_json)
        if not ticket:
            ticket = row.ticket_type or "General Admission"
        if price is None:
            price = row.ticket_price
        event_row = None
        for cand in _event_id_matches(event_id):
            try:
                event_row = db.query(Event).filter(Event.id == cand).first()
            except Exception:
                event_row = None
            if event_row:
                break
        pending.append(PendingPaymentResponse(
            event_id=event_id,
            event_title=getattr(event_row, "title", None),
            event_venue=getattr(event_row, "venue", None) or getattr(event_row, "location", None),
            event_start_date=getattr(event_row, "start_date", None),
            ticket_type=ticket or None,
            price=float(price) if price is not None else float(getattr(event_row, "price", 0) or 0),
            quantity=1,
            image_url=getattr(event_row, "image_url", None),
            status="PAYMENT_PENDING",
            order_kind="pending",
        ))
    return pending


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
    rows = db.query(FormSubmission).filter(or_(*owner_filters)).all()
    changed = False
    for row in rows:
        if not _same_event_id(row.event_id, event_id):
            continue
        if (row.status or "").lower() != "paid":
            row.status = "paid"
            changed = True
        if customer_id and not row.customer_id:
            row.customer_id = customer_id
            changed = True
        if booking_id is not None and not getattr(row, "booking_id", None):
            row.booking_id = booking_id
            changed = True
    if changed:
        db.commit()


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
    price = answers.get("_ticket_price")
    if price is None:
        price = answers.get("ticket_price")
    try:
        price_val = float(price) if price is not None and str(price).strip() != "" else None
    except (TypeError, ValueError):
        price_val = None
    return str(ticket or "").strip(), price_val


@router.get("/registration-status", response_model=RegistrationStatusResponse)
def get_registration_status(
    event_id: str = Query(..., description="Public event UUID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return whether this user already has a ticket or a payment-pending registration."""
    event_candidates = _event_id_matches(event_id)
    booking = _active_booking_for_event(db, current_user, event_id)
    if booking:
        try:
            _mark_form_submission_paid(db, event_id, current_user, booking_id=booking.booking_id)
        except Exception:
            pass
        event = getattr(booking, "event", None)
        return RegistrationStatusResponse(
            state="ticket",
            booking_id=str(booking.booking_id),
            ticket_type=booking.ticket_type,
            price=float(booking.total_price or 0),
            event_title=getattr(event, "title", None),
            venue=getattr(event, "venue", None) or getattr(event, "location", None),
        )

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
    for row in submissions:
        if not _same_event_id(row.event_id, event_id):
            continue
        status_val = (row.status or "").lower()
        if status_val == "paid":
            continue
        if status_val in ("payment_pending", "completed", "pending", "submitted", ""):
            pending = row
            break
    if pending:
        ticket, price = _ticket_from_answers(pending.answers_json)
        if not ticket:
            ticket = pending.ticket_type or ""
        if price is None:
            price = pending.ticket_price
        event_row = None
        for cand in event_candidates:
            try:
                event_row = db.query(Event).filter(Event.id == cand).first()
            except Exception:
                event_row = None
            if event_row:
                break
        return RegistrationStatusResponse(
            state="payment_pending",
            ticket_type=ticket or None,
            price=price if price is not None else getattr(event_row, "price", None),
            event_title=getattr(event_row, "title", None),
            venue=getattr(event_row, "venue", None) or getattr(event_row, "location", None),
        )

    return RegistrationStatusResponse(state="new")


@router.get("/host/tracking", response_model=List[BookingResponse])
def get_host_tracking_analytics(
    db: Session = Depends(get_db),
):
    """Event Host & Admin verification endpoint."""
    bookings = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .order_by(Booking.booked_at.desc())
        .all()
    )
    return [_serialize_booking(b, db=db) for b in bookings]


@router.get("/{booking_id}", response_model=BookingResponse)
def get_single_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get details for an individual booking by ID."""
    try:
        b_uuid = UUID(booking_id)
        b = (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(Booking.booking_id == b_uuid)
            .first()
        )
    except Exception:
        b = (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(Booking.booking_id == booking_id)
            .first()
        )

    if not b:
        raise HTTPException(status_code=404, detail="Booking not found.")
    return _serialize_booking(b, db=db)


@router.post("/{booking_id}/cancel", response_model=BookingResponse)
def cancel_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Cancel a booking by ID and invalidate tickets."""
    try:
        b_uuid = UUID(booking_id)
        b = db.query(Booking).filter(Booking.booking_id == b_uuid).first()
    except Exception:
        b = db.query(Booking).filter(Booking.booking_id == booking_id).first()

    if not b:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if str(b.customer_id) != str(current_user.customer_id):
        raise HTTPException(status_code=403, detail="You can only cancel your own tickets.")

    if (b.status or "").upper() in ("CANCELLED", "CANCELED"):
        b_full = (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(Booking.booking_id == b.booking_id)
            .first()
        )
        return _serialize_booking(b_full or b, db=db)

    b.status = "CANCELLED"
    db.query(Ticket).filter(Ticket.booking_id == b.booking_id).update({Ticket.ticket_status: "CANCELLED"})
    db.commit()
    db.refresh(b)

    b_full = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(Booking.booking_id == b.booking_id)
        .first()
    )
    return _serialize_booking(b_full or b, db=db)


