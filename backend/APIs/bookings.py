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


# ── Schemas ───────────────────────────────────────────────────────────────────
class BookingCreateRequest(BaseModel):
    event_id: str
    ticket_type: Optional[str] = "Standard Access"
    quantity: int = 1
    total_price: Optional[float] = None


class BookingResponse(BaseModel):
    booking_id: str
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
    booked_at: datetime

    class Config:
        from_attributes = True


def _serialize_booking(b: Booking) -> dict:
    event_title = b.event.title if b.event else "Event"
    event_venue = (b.event.venue or b.event.location) if b.event else None
    event_start = b.event.start_date if b.event else None
    user_name = b.customer.full_name or b.customer.username if b.customer else None
    user_email = b.customer.email if b.customer else None
    user_city = b.customer.city if b.customer else None

    return {
        "booking_id": str(b.booking_id),
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

    event = db.query(Event).filter(Event.id == ev_uuid).first()
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")

    qty = max(1, payload.quantity)
    calculated_price = payload.total_price if payload.total_price is not None else (event.price * qty)

    booking = Booking(
        customer_id=current_user.customer_id,
        event_id=event.id,
        ticket_type=payload.ticket_type or "Standard Access",
        quantity=qty,
        total_price=calculated_price,
        status="CONFIRMED",
    )
    db.add(booking)
    db.commit()
    db.refresh(booking)

    # Re-query with eager relationships
    b_full = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer))
        .filter(Booking.booking_id == booking.booking_id)
        .first()
    )
    return _serialize_booking(b_full or booking)


@router.get("/my-bookings", response_model=List[BookingResponse])
def get_my_bookings(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Fetch all bookings for the currently authenticated user by customer_id."""
    bookings = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer))
        .filter(Booking.customer_id == current_user.customer_id)
        .order_by(Booking.booked_at.desc())
        .all()
    )
    return [_serialize_booking(b) for b in bookings]


@router.get("/host/tracking", response_model=List[BookingResponse])
def get_host_tracking_analytics(
    db: Session = Depends(get_db),
):
    """
    Event Host & Admin verification endpoint.
    Returns all bookings tracked by customer_id with full user and event details.
    """
    bookings = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer))
        .order_by(Booking.booked_at.desc())
        .all()
    )
    return [_serialize_booking(b) for b in bookings]
