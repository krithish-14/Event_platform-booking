"""
Booking routes — ticket bookings & event host tracking.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
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
from sqlalchemy import or_

from Models.ticket import Ticket, generate_qr_token

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
            s_num = b.seat_number or "General Admission"
            if qty > 1 and "Seat" not in s_num:
                s_num = f"{s_num} - Seat {i+1}"
            t = Ticket(
                booking_id=b.booking_id,
                event_id=b.event_id,
                customer_id=b.customer_id,
                ticket_type=b.ticket_type or "Standard Access",
                seat_number=s_num,
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
    qr_token = primary_ticket.qr_token if primary_ticket else f"JOD-TKT-{secrets.token_hex(16).upper()}"
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
@router.post("/", response_model=BookingResponse, status_code=status.HTTP_201_CREATED)
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

    qty = max(1, payload.quantity)
    calculated_price = payload.total_price if payload.total_price is not None else (event.price * qty)

    payment_id = payload.payment_id or f"PAY-JOD-{secrets.token_hex(4).upper()}"
    seat_num = payload.seat_number or f"Row {chr(65 + random.randint(0, 5))}, Seat {random.randint(1, 20)}"
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
        seat_number=seat_num,
        receiver_name=payload.receiver_name or current_user.full_name or current_user.username,
        receiver_email=payload.receiver_email or current_user.email,
        receiver_phone=payload.receiver_phone or "+91 98765 43210",
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)

    # Generate individual Ticket models for each unit
    for i in range(qty):
        s_num = seat_num
        if qty > 1:
            s_num = f"{seat_num} (Seat {i+1})"
        t = Ticket(
            booking_id=booking.booking_id,
            event_id=event.id,
            customer_id=current_user.customer_id,
            ticket_type=booking.ticket_type,
            seat_number=s_num,
            qr_token=generate_qr_token(),
            ticket_status="VALID",
        )
        db.add(t)
    db.commit()

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


