"""
Linked events: a private event linked to another host's public event.

Once the public event's host approves the link, the private event's tickets also pass
the public event's check-in. Those entries are stored in event_link_checkins and never
change the ticket's own status, so the same QR still works at the private event.
"""

import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from Models.event_attendance_checkins import EventAttendanceCheckin
from Models.event_link import EventLinkCheckin
from Models.event_management import EventManagement


LINK_PENDING = "pending"
LINK_APPROVED = "approved"
LINK_REJECTED = "rejected"
LINK_STATUSES = (LINK_PENDING, LINK_APPROVED, LINK_REJECTED)

_TARGET_LIFECYCLES = ("published", "live")
_CANCELLED = ("CANCELLED", "REFUNDED", "VOID", "REVOKED")


def _compact(value) -> str:
    return str(value or "").replace("-", "").lower().strip()


def _lifecycle(event: EventManagement) -> str:
    from APIs.host_events_api import compute_event_lifecycle
    return compute_event_lifecycle(event)


def is_linkable_target(event: Optional[EventManagement]) -> bool:
    """A public event that is published or live (not ended, cancelled or private)."""
    if event is None or bool(getattr(event, "is_private", False)):
        return False
    return _lifecycle(event) in _TARGET_LIFECYCLES


def find_event(db: Session, event_id) -> Optional[EventManagement]:
    from APIs.host_events_api import _lookup_event_by_id
    return _lookup_event_by_id(db, str(event_id or "").strip()) if event_id else None


def linkable_events(
    db: Session,
    exclude_event_ids: Optional[set] = None,
    exclude_owner_email: Optional[str] = None,
    search: str = "",
    limit: int = 100,
) -> List[Dict[str, Any]]:
    """Live / upcoming public events another host's private event can link to."""
    excluded = {_compact(eid) for eid in (exclude_event_ids or set())}
    owner = (exclude_owner_email or "").lower().strip()
    needle = (search or "").lower().strip()
    rows = (
        db.query(EventManagement)
        .filter(func.lower(EventManagement.event_status) == "published")
        .order_by(EventManagement.event_start_date.asc())
        .all()
    )
    out = []
    for row in rows:
        if _compact(row.event_id) in excluded:
            continue
        if owner and (row.organizer_email or "").lower().strip() == owner:
            continue
        if not is_linkable_target(row):
            continue
        title = (row.event_title or "").strip()
        if needle and needle not in title.lower() and needle not in (row.venue or "").lower():
            continue
        out.append(serialize_target(row))
        if len(out) >= limit:
            break
    return out


def serialize_target(row: EventManagement) -> Dict[str, Any]:
    return {
        "event_id": str(row.event_id),
        "event_title": row.event_title or "Untitled event",
        "event_start_date": row.event_start_date.isoformat() if row.event_start_date else None,
        "event_start_time": row.event_start_time or "",
        "venue": row.venue or "",
        "organizer_name": row.organizer_name or "",
        "lifecycle": _lifecycle(row),
    }


def link_summary(db: Session, event: EventManagement) -> Dict[str, Any]:
    """Link fields for the private event's own dashboard."""
    linked_id = (getattr(event, "linked_event_id", None) or "").strip()
    if not linked_id:
        return {"linked_event_id": None, "link_status": None, "linked_event": None}
    target = find_event(db, linked_id)
    return {
        "linked_event_id": linked_id,
        "link_status": (event.link_status or LINK_PENDING).lower(),
        "linked_event": serialize_target(target) if target else None,
    }


def set_link(db: Session, event: EventManagement, target_id: Optional[str], is_private: bool) -> None:
    """Request (or clear) a link from this private event to a public event. Caller commits."""
    target_id = (target_id or "").strip()
    if not target_id or not is_private:
        event.linked_event_id = None
        event.link_status = None
        event.link_requested_at = None
        event.link_decided_at = None
        return
    target = find_event(db, target_id)
    if target is None:
        raise ValueError("The selected public event was not found.")
    if _compact(target.event_id) == _compact(event.event_id):
        raise ValueError("An event cannot be linked to itself.")
    owner = (event.organizer_email or "").lower().strip()
    if owner and (target.organizer_email or "").lower().strip() == owner:
        raise ValueError("Pick another host's public event. Your own events use members-only tickets instead.")
    canonical = str(target.event_id)
    if _compact(event.linked_event_id) == _compact(canonical) and event.link_status in LINK_STATUSES:
        return
    if not is_linkable_target(target):
        raise ValueError("Only live or upcoming public events can be linked.")
    event.linked_event_id = canonical
    event.link_status = LINK_PENDING
    event.link_requested_at = datetime.utcnow()
    event.link_decided_at = None


def incoming_requests(db: Session, target_events: List[EventManagement]) -> List[Dict[str, Any]]:
    """Private events asking to link to any of these (public) events."""
    by_id = {str(ev.event_id): ev for ev in target_events}
    if not by_id:
        return []
    rows = (
        db.query(EventManagement)
        .filter(EventManagement.linked_event_id.in_(list(by_id.keys())))
        .order_by(EventManagement.link_requested_at.desc())
        .all()
    )
    out = []
    for row in rows:
        if not bool(getattr(row, "is_private", False)):
            continue
        if _lifecycle(row) in ("cancelled", "unpublished"):
            continue
        target = by_id.get(row.linked_event_id)
        out.append({
            "private_event_id": str(row.event_id),
            "private_event_title": row.event_title or "Untitled event",
            "private_event_start_date": row.event_start_date.isoformat() if row.event_start_date else None,
            "private_event_lifecycle": _lifecycle(row),
            "organizer_name": row.organizer_name or "",
            "organizer_email": row.organizer_email or "",
            "target_event_id": row.linked_event_id,
            "target_event_title": (target.event_title if target else "") or "",
            "link_status": (row.link_status or LINK_PENDING).lower(),
            "requested_at": row.link_requested_at.isoformat() if row.link_requested_at else None,
            "decided_at": row.link_decided_at.isoformat() if row.link_decided_at else None,
        })
    return out


def decide(row: EventManagement, approve: bool) -> None:
    row.link_status = LINK_APPROVED if approve else LINK_REJECTED
    row.link_decided_at = datetime.utcnow()


def approved_sources(db: Session, target: EventManagement) -> List[EventManagement]:
    """Private events whose tickets may enter this public event."""
    rows = (
        db.query(EventManagement)
        .filter(EventManagement.linked_event_id == str(target.event_id))
        .filter(func.lower(EventManagement.link_status) == LINK_APPROVED)
        .all()
    )
    return [
        row for row in rows
        if bool(getattr(row, "is_private", False)) and _lifecycle(row) not in ("cancelled", "unpublished")
    ]


def source_for_ticket(db: Session, target: EventManagement, ticket) -> Optional[EventManagement]:
    from Services.event_sessions import event_public_id_set
    ticket_eid = _compact(getattr(ticket, "event_id", None))
    if not ticket_eid:
        return None
    for source in approved_sources(db, target):
        if ticket_eid in event_public_id_set(db, source):
            return source
    return None


def find_linked_ticket(db: Session, target: EventManagement, code: str) -> Tuple[Any, Optional[EventManagement]]:
    """Ticket (and its private event) matching a scan code among approved linked events."""
    from APIs.host_events_api import _normalize_scan_code, _ticket_matches_scan, _tickets_for_event
    from APIs.tickets import extract_scan_token

    original = (code or "").strip()
    raw = extract_scan_token(original) or original
    if not raw:
        return None, None
    needle = _normalize_scan_code(raw)
    for source in approved_sources(db, target):
        tickets = _tickets_for_event(db, source)
        exact = next((t for t in tickets if (t.qr_token or "").strip() == raw), None)
        if exact:
            return exact, source
        for ticket in tickets:
            if _ticket_matches_scan(ticket, raw, needle):
                return ticket, source
    return None, None


def _fail(code: str, message: str, **extra) -> Dict[str, Any]:
    body = {
        "success": False,
        "valid": False,
        "error_code": code,
        "status": code,
        "message": message,
        "duplicate": code == "ALREADY_CHECKED_IN",
        "linked_event": True,
    }
    body.update({k: v for k, v in extra.items() if v is not None})
    return body


def perform_link_checkin(
    db: Session,
    target: EventManagement,
    source: EventManagement,
    ticket,
    *,
    checked_in_by: str,
    method: str = "QR",
    session=None,
) -> Dict[str, Any]:
    """Record a linked ticket's entry at the public event. Commits on success."""
    booking = getattr(ticket, "booking", None)
    attendee_name = ((booking.receiver_name if booking else None) or "Guest").strip() or "Guest"
    attendee_email = ((booking.receiver_email if booking else None) or "").lower().strip() or None
    source_title = source.event_title or "linked event"
    base = {
        "ticket_id": str(ticket.ticket_id),
        "booking_id": str(ticket.booking_id) if ticket.booking_id else None,
        "attendee_name": attendee_name,
        "attendee_email": attendee_email,
        "ticket_type": ticket.ticket_type or "",
        "linked_event_id": str(source.event_id),
        "linked_event_title": source_title,
    }

    status = (ticket.ticket_status or "").upper()
    booking_status = ((booking.status if booking else "") or "").upper()
    if status in _CANCELLED or booking_status in _CANCELLED:
        return _fail("TICKET_CANCELLED", "This ticket has been cancelled or refunded.", **base)

    session_key = ""
    if session is not None:
        from Services.event_sessions import checkin_window_state
        if (session.status or "") != "active":
            return _fail("SESSION_NOT_ACTIVE", f"{session.session_name} is not accepting check-ins ({session.status}).", **base)
        if checkin_window_state(session) != "open":
            return _fail("SESSION_NOT_OPEN", f"{session.session_name} is not accepting check-ins right now.", **base)
        session_key = str(session.session_id)
        base.update({"session_id": session_key, "session_name": session.session_name})

    existing = (
        db.query(EventLinkCheckin)
        .filter(EventLinkCheckin.target_event_id == target.event_id)
        .filter(EventLinkCheckin.ticket_id == ticket.ticket_id)
        .filter(EventLinkCheckin.session_key == session_key)
        .first()
    )
    if existing:
        when = existing.checkin_time.strftime("%I:%M %p, %b %d") if existing.checkin_time else "earlier"
        return _fail(
            "ALREADY_CHECKED_IN",
            f"Duplicate check-in — this {source_title} ticket was already checked in here at {when}.",
            already_checked_in=True,
            used_at=existing.checkin_time.isoformat() if existing.checkin_time else None,
            **base,
        )

    now = datetime.utcnow()
    db.add(EventLinkCheckin(
        id=uuid.uuid4(),
        target_event_id=target.event_id,
        source_event_id=source.event_id,
        ticket_id=ticket.ticket_id,
        session_key=session_key,
        attendee_name=attendee_name,
        attendee_email=attendee_email,
        checked_in_by=checked_in_by,
        method=(method or "QR").upper()[:20],
        checkin_time=now,
    ))
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return _fail("ALREADY_CHECKED_IN", f"Duplicate check-in — this {source_title} ticket was already checked in here.", already_checked_in=True, **base)

    already_listed = None
    if attendee_email:
        already_listed = (
            db.query(EventAttendanceCheckin)
            .filter(EventAttendanceCheckin.event_id == target.event_id)
            .filter(EventAttendanceCheckin.attendee_email == attendee_email)
            .filter(EventAttendanceCheckin.deleted_at.is_(None))
            .first()
        )
    if not already_listed:
        db.add(EventAttendanceCheckin(
            id=uuid.uuid4(),
            event_id=target.event_id,
            customer_id=target.customer_id,
            host_id=target.host_id,
            created_by=checked_in_by,
            attendee_name=attendee_name,
            attendee_email=attendee_email,
            scan_method=(method or "QR").lower()[:50],
            status="checked_in",
            notes=f"Linked event · {source_title} · ticket {ticket.ticket_id}"[:500],
        ))
    db.commit()
    return {
        "success": True,
        "valid": True,
        "status": "success",
        "check_in_type": "new",
        "linked_event": True,
        "message": f"New check-in — {attendee_name} (linked event: {source_title}).",
        "checked_in_at": now.isoformat(),
        **base,
    }
