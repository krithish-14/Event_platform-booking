"""
Booking routes — ticket bookings & event host tracking.
"""

import json
import re
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


from sqlalchemy import func, or_

from Models.ticket import Ticket
from Models.form_submissions import FormSubmission
from Models.payment_proof import PaymentProof


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
    used_at: Optional[datetime] = None
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
    card_image: Optional[str] = None
    image_url: Optional[str] = None
    agenda: Optional[Any] = None
    event_end_date: Optional[datetime] = None
    language: Optional[str] = None
    event_format: Optional[str] = None
    has_qr: bool = False

    class Config:
        from_attributes = True


def _booking_event_images(b: Booking, db: Session = None):
    """Resolve card + hero images for tickets; prefer card_image from catalog or design."""
    card_image = None
    hero_image = None
    if b.event:
        card_image = getattr(b.event, "card_image", None) or None
        hero_image = getattr(b.event, "image_url", None) or None
    if not card_image and db is not None and b.event_id:
        try:
            from Models.event_design import EventDesign
            design = db.query(EventDesign).filter(EventDesign.event_id == b.event_id).first()
            if design and design.card_image:
                card_image = design.card_image
        except Exception:
            pass
    ticket_image = card_image or hero_image
    return ticket_image, card_image, hero_image


def _booking_event_agenda(event_id, db: Session = None) -> list:
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


def _booking_tickets(b: Booking, db: Session = None) -> List[Ticket]:
    """Return issued tickets only. Never mint QR codes here — admin Generate QR does that."""
    tickets = list(getattr(b, "tickets", None) or [])
    if tickets:
        return tickets
    if db is None or not getattr(b, "booking_id", None):
        return []
    try:
        return db.query(Ticket).filter(Ticket.booking_id == b.booking_id).all()
    except Exception:
        return []


def _serialize_booking(b: Booking, db: Session = None) -> dict:
    event_title = b.event.title if b.event else "Event"
    event_venue = (b.event.venue or b.event.location) if b.event else None
    event_start = b.event.start_date if b.event else None
    user_name = (b.receiver_name or (b.customer.full_name if b.customer else None) or (b.customer.username if b.customer else None) or "Guest")
    user_email = (b.receiver_email or (b.customer.email if b.customer else None) or "")
    user_phone = b.receiver_phone or (getattr(b.customer, "phone", None) if b.customer else None) or ""
    user_city = b.customer.city if b.customer else None

    pid = getattr(b, "payment_id", None)
    pmode = getattr(b, "payment_mode", None) or "UPI"
    gst = float(getattr(b, "gst_amount", 0.0) or 0.0)
    seat = getattr(b, "seat_number", None) or ""

    tickets = _booking_tickets(b, db=db)
    primary_ticket = tickets[0] if tickets else None
    ticket_id = str(primary_ticket.ticket_id) if primary_ticket else None
    qr_token = primary_ticket.qr_token if primary_ticket else None
    ticket_status = primary_ticket.ticket_status if primary_ticket else (b.status or None)
    used_at = primary_ticket.used_at if primary_ticket else None
    ticket_image, card_image, hero_image = _booking_event_images(b, db=db)

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
    """Public self-booking is disabled. Admin Generate QR is the only ticket-issue path."""
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
    include_all: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch the current user's bookings. Issued QR tickets by default; include_all adds awaiting-ticket rows."""
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
        if include_all or data.get("qr_token") or data.get("ticket_id"):
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
    """Return registration/payment hold state. Tickets exist only after admin Generate QR."""
    event_candidates = _event_id_matches(event_id)
    email = (current_user.email or "").lower().strip()
    customer_id = str(current_user.customer_id or "").strip()

    proof = None
    if email or customer_id:
        proofs = db.query(PaymentProof).order_by(PaymentProof.created_at.desc()).all()
        for row in proofs:
            if not _same_event_id(row.event_id, event_id):
                continue
            row_email = (row.attendee_email or "").lower().strip()
            row_cust = str(row.customer_id or "").strip()
            if email and row_email == email:
                proof = row
                break
            if customer_id and row_cust and row_cust == customer_id:
                proof = row
                break

    booking = _active_booking_for_event(db, current_user, event_id)
    if proof and proof.booking_id and not booking:
        booking = (
            db.query(Booking)
            .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
            .filter(Booking.booking_id == proof.booking_id)
            .first()
        )
    issued_tickets = _booking_tickets(booking, db=db) if booking else []
    # Admin Generate QR is the only mint path — issued tickets mean the CTA can switch.
    if booking and issued_tickets:
        try:
            _mark_form_submission_paid(db, event_id, current_user, booking_id=booking.booking_id)
        except Exception:
            pass
        event = getattr(booking, "event", None)
        return RegistrationStatusResponse(
            state="ticket",
            booking_id=str(booking.booking_id),
            ticket_type=booking.ticket_type or (proof.ticket_type if proof else None),
            price=float(booking.total_price or (proof.amount if proof else 0) or 0),
            event_title=getattr(event, "title", None),
            venue=getattr(event, "venue", None) or getattr(event, "location", None),
        )

    if proof and (proof.status or "").lower() != "qr_ready":
        event_row = None
        for cand in event_candidates:
            try:
                event_row = db.query(Event).filter(Event.id == cand).first()
            except Exception:
                event_row = None
            if event_row:
                break
        return RegistrationStatusResponse(
            state="payment_submitted",
            ticket_type=proof.ticket_type or None,
            price=float(proof.amount or 0) if proof.amount is not None else getattr(event_row, "price", None),
            event_title=getattr(event_row, "title", None),
            venue=getattr(event_row, "venue", None) or getattr(event_row, "location", None),
        )
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
    recv = (booking.receiver_email or "").lower().strip()
    cust_email = ""
    if getattr(booking, "customer", None):
        cust_email = (booking.customer.email or "").lower().strip()
    if email and (recv == email or cust_email == email):
        return
    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="You can only access your own bookings.",
    )


@router.get("/{booking_id}", response_model=BookingResponse)
def get_single_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get details for an individual booking owned by the authenticated user."""
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
    _assert_booking_owner(b, current_user)
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
    _assert_booking_owner(b, current_user)

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


