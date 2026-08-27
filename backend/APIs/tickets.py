"""
Ticket Verification & Entry Check-in Router for JOD Events.
Handles QR token validation, atomic staff check-in, and ticket management.
"""

from datetime import datetime
from typing import Optional, List
from urllib.parse import parse_qs, unquote, urlparse
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.booking import Booking
from Models.event import Event
from Models.ticket import Ticket
from Models.user import User

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────
class TokenVerificationRequest(BaseModel):
    qr_token: Optional[str] = None
    token: Optional[str] = None
    event_id: Optional[str] = None

class TokenCheckinRequest(BaseModel):
    qr_token: Optional[str] = None
    token: Optional[str] = None
    scanned_by: Optional[str] = None


class TicketResponse(BaseModel):
    valid: bool
    status: str
    ticket_id: Optional[str] = None
    booking_id: Optional[str] = None
    event_id: Optional[str] = None
    qr_token: Optional[str] = None
    event: Optional[str] = None
    venue: Optional[str] = None
    event_start_date: Optional[datetime] = None
    ticket_type: Optional[str] = None
    seat: Optional[str] = None
    quantity: Optional[int] = 1
    customer_name: Optional[str] = None
    customer_email: Optional[str] = None
    used_at: Optional[datetime] = None
    scanned_by: Optional[str] = None
    message: Optional[str] = None

    class Config:
        from_attributes = True


CHECKED_IN_TICKET_STATUSES = {"USED", "CHECKED_IN", "CHECKED-IN", "CHECKEDIN"}
CANCELLED_TICKET_STATUSES = {"CANCELLED", "CANCELED", "REFUNDED"}
CHECKABLE_TICKET_STATUSES = {"VALID", "ISSUED", "CONFIRMED", "ACTIVE", "UNUSED", ""}


def extract_scan_token(value: str) -> str:
    """Pull the QR / booking token out of a raw scanner payload or ticket URL."""
    text = (value or "").strip()
    if not text:
        return ""
    candidate = text
    lowered = text.lower()
    looks_like_url = (
        "://" in text
        or lowered.startswith("www.")
        or "ticket-details" in lowered
        or "/ticket" in lowered
    )
    if looks_like_url:
        try:
            parsed = urlparse(text if "://" in text else f"https://{text.lstrip('/')}")
            params = parse_qs(parsed.query)
            if parsed.fragment:
                if "=" in parsed.fragment:
                    params.update(parse_qs(parsed.fragment))
                elif parsed.fragment.strip():
                    candidate = unquote(parsed.fragment).strip() or candidate
            for key in ("token", "qr_token", "qr", "code"):
                vals = params.get(key) or []
                if vals and str(vals[0]).strip():
                    return unquote(str(vals[0])).strip()
            path = unquote(parsed.path or "").rstrip("/")
            last = path.split("/")[-1] if path else ""
            skip = {"ticket-details.html", "ticket-details", "tickets", "ticket", "index.html", ""}
            if last.lower() not in skip:
                candidate = last
        except Exception:
            pass
    return (candidate or text).strip()


def _ticket_base_query(db: Session, event_id: Optional[str] = None):
    query = db.query(Ticket).options(
        joinedload(Ticket.booking), joinedload(Ticket.event), joinedload(Ticket.customer)
    )
    if event_id:
        try:
            query = query.filter(Ticket.event_id == UUID(str(event_id)))
        except Exception:
            query = query.filter(Ticket.event_id == event_id)
    return query


def _extract_token(payload: TokenVerificationRequest | TokenCheckinRequest) -> str:
    tok = extract_scan_token(payload.qr_token or payload.token or "")
    if not tok:
        raise HTTPException(status_code=400, detail="Missing ticket QR token.")
    return tok


def _lookup_ticket(db: Session, token_str: str, event_id: Optional[str] = None) -> Optional[Ticket]:
    raw = extract_scan_token(token_str)
    original = (token_str or "").strip()
    if not raw and not original:
        return None
    for candidate in dict.fromkeys([raw, original]):
        if not candidate:
            continue
        ticket = _ticket_base_query(db, event_id).filter(Ticket.qr_token == candidate).first()
        if ticket:
            return ticket
    compact = "".join(ch for ch in (raw or original).upper() if ch.isalnum())
    if compact.startswith("JODTKT"):
        return None
    if compact.startswith("JOD"):
        compact = compact[3:]
    if len(compact) < 8:
        return None
    from sqlalchemy import String, cast, func

    prefix = compact[:8].lower()
    bid_txt = func.replace(func.lower(cast(Ticket.booking_id, String)), "-", "")
    return _ticket_base_query(db, event_id).filter(bid_txt.like(prefix + "%")).first()


def _serialize_ticket_success(t: Ticket, message: str = "Ticket is valid for entry.") -> dict:
    b = t.booking
    ev = t.event or (b.event if b else None)
    cust = t.customer or (b.customer if b else None)

    cust_name = (b.receiver_name if b else None) or (cust.full_name if cust else None) or (cust.username if cust else "Guest Customer")
    cust_email = (b.receiver_email if b else None) or (cust.email if cust else "customer@jodevents.com")
    event_title = ev.title if ev else "Event Booking"
    event_venue = (ev.venue or ev.location) if ev else "Venue details at location"
    event_start = ev.start_date if ev else None
    qty = b.quantity if b else 1

    return {
        "valid": True,
        "status": t.ticket_status or "VALID",
        "ticket_id": str(t.ticket_id),
        "booking_id": str(t.booking_id),
        "event_id": str(t.event_id),
        "qr_token": t.qr_token,
        "event": event_title,
        "venue": event_venue,
        "event_start_date": event_start,
        "ticket_type": t.ticket_type or "Standard Access",
        "seat": t.seat_number or "General Admission",
        "quantity": qty,
        "customer_name": cust_name,
        "customer_email": None,
        "used_at": t.used_at,
        "scanned_by": t.scanned_by,
        "message": message,
    }


# ── Verification Endpoint ──────────────────────────────────────────────────────
@router.post("/verify", response_model=TicketResponse)
def verify_ticket_token(
    payload: TokenVerificationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Validate QR token format and entry status.
    All logic happens on the backend — scanner passes only the secure QR token string.
    """
    token_str = _extract_token(payload)

    ticket = _lookup_ticket(db, token_str, payload.event_id)

    if not ticket:
        return {
            "valid": False,
            "status": "INVALID",
            "message": f"Token '{token_str}' does not exist or is invalid.",
        }

    # Check booking status
    if ticket.booking and (ticket.booking.status or "").upper() == "CANCELLED":
        return {
            "valid": False,
            "status": "CANCELLED",
            "ticket_id": str(ticket.ticket_id),
            "booking_id": str(ticket.booking_id),
            "qr_token": ticket.qr_token,
            "event": ticket.event.title if ticket.event else None,
            "message": "Ticket booking has been cancelled.",
        }

    if (ticket.ticket_status or "").upper() in CANCELLED_TICKET_STATUSES:
        return {
            "valid": False,
            "status": "CANCELLED",
            "ticket_id": str(ticket.ticket_id),
            "booking_id": str(ticket.booking_id),
            "qr_token": ticket.qr_token,
            "event": ticket.event.title if ticket.event else None,
            "message": "This ticket was marked as CANCELLED.",
        }

    if (ticket.ticket_status or "").upper() in CHECKED_IN_TICKET_STATUSES:
        return {
            "valid": False,
            "status": "ALREADY_USED",
            "already_checked_in": True,
            "duplicate": True,
            "ticket_id": str(ticket.ticket_id),
            "booking_id": str(ticket.booking_id),
            "qr_token": ticket.qr_token,
            "event": ticket.event.title if ticket.event else None,
            "seat": ticket.seat_number,
            "ticket_type": ticket.ticket_type,
            "customer_name": ticket.booking.receiver_name if ticket.booking else "Guest Customer",
            "used_at": ticket.used_at,
            "scanned_by": ticket.scanned_by,
            "message": f"Duplicate — this ticket was already checked in at {ticket.used_at.strftime('%I:%M %p, %b %d') if ticket.used_at else 'an earlier time'}.",
        }

    # Optional event filter check
    if payload.event_id:
        if str(ticket.event_id) != payload.event_id:
            return {
                "valid": False,
                "status": "INVALID_EVENT",
                "message": "This ticket belongs to a different event.",
            }

    return _serialize_ticket_success(ticket, message="ENTRY ALLOWED — Ticket is valid.")


# ── Entry Check-in Endpoint ───────────────────────────────────────────────────
@router.post("/checkin", response_model=TicketResponse)
def checkin_ticket_entry(
    payload: TokenCheckinRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Atomically verify and check in a ticket at venue gate.
    Uses conditional DB updates to prevent double check-in under race conditions.
    """
    token_str = _extract_token(payload)
    ticket = _lookup_ticket(db, token_str)
    resolved_token = ticket.qr_token if ticket else token_str

    staff_name = payload.scanned_by
    if not staff_name:
        staff_name = current_user.full_name or current_user.username or "Gate Scanner Staff"

    now_utc = datetime.utcnow()

    # Atomic SQL UPDATE — only updates if ticket_status is currently 'VALID'
    rows_updated = (
        db.query(Ticket)
        .filter(Ticket.qr_token == resolved_token, Ticket.ticket_status.in_(tuple(CHECKABLE_TICKET_STATUSES)))
        .update(
            {
                Ticket.ticket_status: "USED",
                Ticket.used_at: now_utc,
                Ticket.scanned_by: staff_name,
            },
            synchronize_session=False,
        )
    )
    db.commit()

    # Re-fetch ticket to serialize complete details
    ticket = (
        db.query(Ticket)
        .options(joinedload(Ticket.booking), joinedload(Ticket.event), joinedload(Ticket.customer))
        .filter(Ticket.qr_token == resolved_token)
        .first()
    )

    if not ticket:
        return {
            "valid": False,
            "status": "INVALID",
            "message": "Ticket token not found.",
        }

    if rows_updated == 1:
        # Successfully checked in
        return _serialize_ticket_success(ticket, message="ENTRY ALLOWED — Ticket successfully checked in!")
    else:
        # Atomic update modified 0 rows -> ticket was either ALREADY_USED, CANCELLED, or invalid
        if (ticket.ticket_status or "").upper() in CHECKED_IN_TICKET_STATUSES:
            return {
                "valid": False,
                "status": "ALREADY_USED",
                "already_checked_in": True,
                "duplicate": True,
                "ticket_id": str(ticket.ticket_id),
                "booking_id": str(ticket.booking_id),
                "qr_token": ticket.qr_token,
                "event": ticket.event.title if ticket.event else None,
                "seat": ticket.seat_number,
                "ticket_type": ticket.ticket_type,
                "customer_name": ticket.booking.receiver_name if ticket.booking else "Guest Customer",
                "used_at": ticket.used_at,
                "scanned_by": ticket.scanned_by,
                "message": f"Duplicate — this ticket was already checked in at {ticket.used_at.strftime('%I:%M %p, %b %d') if ticket.used_at else 'earlier'}.",
            }
        elif (ticket.ticket_status or "").upper() in CANCELLED_TICKET_STATUSES:
            return {
                "valid": False,
                "status": "CANCELLED",
                "ticket_id": str(ticket.ticket_id),
                "booking_id": str(ticket.booking_id),
                "qr_token": ticket.qr_token,
                "message": "ENTRY DENIED — Ticket has been cancelled.",
            }
        else:
            return {
                "valid": False,
                "status": "INVALID",
                "message": f"ENTRY DENIED — Ticket status is {ticket.ticket_status}.",
            }


@router.get("/public/{qr_token}/pdf")
def download_public_ticket_pdf(qr_token: str, kind: str = "ticket", db: Session = Depends(get_db)):
    """Same M-ticket PDF attached to the confirmation email. Use kind=invoice to omit the QR."""
    from APIs.bookings import _lookup_booking_row, _ticket_pdf_http_response

    ticket = _lookup_ticket(db, qr_token)
    if not ticket or not ticket.booking_id:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    booking = _lookup_booking_row(db, ticket.booking_id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    return _ticket_pdf_http_response(
        booking,
        db,
        (ticket.qr_token or qr_token or "").strip(),
        kind=kind,
    )


@router.get("/public/{qr_token}")
def get_public_ticket_by_token(qr_token: str, db: Session = Depends(get_db)):
    """Open a ticket from the emailed / WhatsApp QR link without signing in.

    Returns only fields needed to render the attendee ticket page.
    Does not expose email, phone, customer_id, or payment identifiers.
    """
    from APIs.bookings import _serialize_booking

    ticket = _lookup_ticket(db, qr_token)
    if not ticket or not ticket.booking:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    booking = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(Booking.booking_id == ticket.booking_id)
        .first()
    )
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    full = _serialize_booking(booking, db=db)
    allowed = {
        "booking_id",
        "ticket_id",
        "qr_token",
        "has_qr",
        "ticket_status",
        "used_at",
        "user_name",
        "receiver_name",
        "event_id",
        "event_title",
        "event_venue",
        "event_start_date",
        "event_end_date",
        "ticket_type",
        "quantity",
        "total_price",
        "gst_amount",
        "status",
        "seat_number",
        "language",
        "event_format",
        "booked_at",
        "card_image",
        "image_url",
        "hero_image",
        "agenda",
    }
    return {key: full.get(key) for key in allowed if key in full}

# ── Additional Query Endpoints ────────────────────────────────────────────────
def _assert_ticket_owner(ticket: Ticket, current_user: User) -> None:
    if str(ticket.customer_id) != str(current_user.customer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access your own tickets.",
        )


@router.get("/booking/{booking_id}", response_model=List[TicketResponse])
def get_tickets_for_booking(
    booking_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve tickets for a booking owned by the authenticated user."""
    booking = None
    try:
        b_uuid = UUID(booking_id)
        booking = db.query(Booking).filter(Booking.booking_id == b_uuid).first()
    except Exception:
        booking = db.query(Booking).filter(Booking.booking_id == booking_id).first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found.")
    if str(booking.customer_id) != str(current_user.customer_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only access your own tickets.",
        )

    tickets = (
        db.query(Ticket)
        .options(joinedload(Ticket.booking), joinedload(Ticket.event), joinedload(Ticket.customer))
        .filter(Ticket.booking_id == booking.booking_id)
        .all()
    )
    return [_serialize_ticket_success(t) for t in tickets]


@router.get("/my-tickets", response_model=List[TicketResponse])
def get_my_tickets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Retrieve all tickets belonging to the currently authenticated user."""
    tickets = (
        db.query(Ticket)
        .options(joinedload(Ticket.booking), joinedload(Ticket.event), joinedload(Ticket.customer))
        .filter(Ticket.customer_id == current_user.customer_id)
        .order_by(Ticket.created_at.desc())
        .all()
    )
    return [_serialize_ticket_success(t) for t in tickets]


@router.get("/{ticket_id}", response_model=TicketResponse)
def get_single_ticket_by_id(
    ticket_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a single ticket owned by the authenticated user."""
    try:
        t_uuid = UUID(ticket_id)
        t = (
            db.query(Ticket)
            .options(joinedload(Ticket.booking), joinedload(Ticket.event), joinedload(Ticket.customer))
            .filter(Ticket.ticket_id == t_uuid)
            .first()
        )
    except Exception:
        t = (
            db.query(Ticket)
            .options(joinedload(Ticket.booking), joinedload(Ticket.event), joinedload(Ticket.customer))
            .filter(Ticket.ticket_id == ticket_id)
            .first()
        )

    if not t:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    _assert_ticket_owner(t, current_user)
    return _serialize_ticket_success(t)
