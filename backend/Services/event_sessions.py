"""
Multi-session events: validation, eligibility, per-session check-in, and attendance stats.

Attendee identity is the existing per-person Ticket row (one QR per person). A session
check-in never creates attendees or tickets; it records (session, ticket) once, enforced
by a unique constraint, and marks the ticket USED on its first check-in so the existing
unique-attendance reports stay correct.
"""

from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy import func, or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from Models.event_session import (
    ELIGIBILITY_MODES,
    SESSION_STATUSES,
    EventSession,
    EventSessionCheckin,
    EventSessionRegistration,
)
from Models.ticket import Ticket

IST = timezone(timedelta(hours=5, minutes=30))

MAX_SESSIONS_PER_EVENT = 50
CHECKIN_OPENS_MINUTES_BEFORE = 60
CHECKIN_CLOSES_MINUTES_AFTER = 60

CANCELLED_STATUSES = {"CANCELLED", "CANCELED", "REFUNDED", "REVOKED"}
CHECKED_IN_STATUSES = {"USED", "CHECKED_IN", "CHECKED-IN", "CHECKEDIN"}
CHECKABLE_STATUSES = ("VALID", "ISSUED", "CONFIRMED", "ACTIVE", "UNUSED")

_TIME_RE = re.compile(r"^\s*(\d{1,2})[:.](\d{2})\s*([AaPp][Mm])?\s*$")


class SessionValidationError(ValueError):
    def __init__(self, errors: Dict[str, str]):
        super().__init__("; ".join(f"{k}: {v}" for k, v in errors.items()))
        self.errors = errors


# ── Parsing & validation ──────────────────────────────────────────────────────
def parse_clock(value: Any) -> Optional[str]:
    """'08:15', '8:15 AM', '20:30' → 'HH:MM' (24h). None when invalid."""
    if value is None:
        return None
    if isinstance(value, time):
        return value.strftime("%H:%M")
    match = _TIME_RE.match(str(value))
    if not match:
        return None
    hour, minute, meridiem = int(match.group(1)), int(match.group(2)), match.group(3)
    if minute > 59:
        return None
    if meridiem:
        if hour < 1 or hour > 12:
            return None
        hour = hour % 12 + (12 if meridiem.lower() == "pm" else 0)
    elif hour > 23:
        return None
    return f"{hour:02d}:{minute:02d}"


def parse_day(value: Any) -> Optional[date]:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value).strip()[:10]
    try:
        return date.fromisoformat(text)
    except ValueError:
        return None


def _clean_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _ticket_type_key(value: Any) -> str:
    return _clean_text(value, 200).lower()


def validate_session_input(data: Dict[str, Any], *, partial_base: Optional[EventSession] = None) -> Dict[str, Any]:
    """Return cleaned session fields or raise SessionValidationError with per-field messages."""
    data = data or {}
    errors: Dict[str, str] = {}

    def pick(key, current=None):
        if key in data:
            return data.get(key)
        return current

    base = partial_base
    name = _clean_text(pick("session_name", base.session_name if base else None), 200)
    if not name:
        errors["session_name"] = "Enter a session name."

    description = str(pick("session_description", base.session_description if base else "") or "").strip()[:4000]

    day = parse_day(pick("session_date", base.session_date if base else None))
    if not day:
        errors["session_date"] = "Pick a valid session date."

    start = parse_clock(pick("start_time", base.start_time if base else None))
    end = parse_clock(pick("end_time", base.end_time if base else None))
    if not start:
        errors["start_time"] = "Enter a valid start time."
    if not end:
        errors["end_time"] = "Enter a valid end time."
    ends_next_day = bool(pick("ends_next_day", base.ends_next_day if base else False))
    if start and end:
        if start == end:
            errors["end_time"] = "End time must be later than start time."
        elif end < start and not ends_next_day:
            errors["end_time"] = "End time must be later than start time. Tick 'Ends after midnight' for overnight sessions."
        elif end > start and ends_next_day:
            # A same-day range does not span midnight; keep it a same-day session.
            ends_next_day = False

    venue_name = _clean_text(pick("venue_name", base.venue_name if base else None), 300)
    if not venue_name:
        errors["venue_name"] = "Enter the venue name."
    venue_address = str(pick("venue_address", base.venue_address if base else "") or "").strip()[:2000]

    def coord(key, limit, current):
        raw = pick(key, current)
        if raw in (None, ""):
            return None
        try:
            value = float(raw)
        except (TypeError, ValueError):
            errors[key] = "Pick the venue on the map again."
            return None
        if not -limit <= value <= limit:
            errors[key] = "Pick the venue on the map again."
            return None
        return round(value, 7)

    venue_lat = coord("venue_lat", 90, base.venue_lat if base else None)
    venue_lng = coord("venue_lng", 180, base.venue_lng if base else None)
    if (venue_lat is None) != (venue_lng is None):
        venue_lat = venue_lng = None
    venue_place_id = _clean_text(pick("venue_place_id", base.venue_place_id if base else None), 255) or None

    capacity_raw = pick("capacity", base.capacity if base else None)
    capacity: Optional[int] = None
    if capacity_raw not in (None, ""):
        try:
            capacity = int(capacity_raw)
            if capacity < 1:
                errors["capacity"] = "Capacity must be at least 1, or leave it empty."
        except (TypeError, ValueError):
            errors["capacity"] = "Capacity must be a whole number."

    mode = str(pick("eligibility_mode", base.eligibility_mode if base else "registered") or "registered").strip().lower()
    if mode not in ELIGIBILITY_MODES:
        errors["eligibility_mode"] = "Choose who can attend this session."
    raw_types = pick("eligible_ticket_types", base.eligible_ticket_types if base else None) or []
    if isinstance(raw_types, str):
        raw_types = [raw_types]
    ticket_types: List[str] = []
    for item in raw_types if isinstance(raw_types, list) else []:
        label = _clean_text(item, 200)
        if label and label.lower() not in {t.lower() for t in ticket_types}:
            ticket_types.append(label)
    if mode == "ticket_types" and not ticket_types:
        errors["eligible_ticket_types"] = "Select at least one ticket type or package for this session."

    status = str(pick("status", base.status if base else "active") or "active").strip().lower()
    if status not in SESSION_STATUSES:
        errors["status"] = "Choose a valid session status."

    if errors:
        raise SessionValidationError(errors)
    return {
        "session_name": name,
        "session_description": description or None,
        "session_date": day,
        "start_time": start,
        "end_time": end,
        "ends_next_day": ends_next_day,
        "venue_name": venue_name,
        "venue_address": venue_address or None,
        "venue_lat": venue_lat,
        "venue_lng": venue_lng,
        "venue_place_id": venue_place_id,
        "capacity": capacity,
        "eligibility_mode": mode,
        "eligible_ticket_types": ticket_types if mode == "ticket_types" else [],
        "status": status,
    }


# ── Session lookups ───────────────────────────────────────────────────────────
def _compact(value: Any) -> str:
    return str(value or "").replace("-", "").strip().lower()


def event_sessions(db: Session, event_id, *, include_deleted: bool = False) -> List[EventSession]:
    query = db.query(EventSession).filter(EventSession.event_id == event_id)
    if not include_deleted:
        query = query.filter(EventSession.deleted_at.is_(None))
    return query.order_by(EventSession.position.asc(), EventSession.created_at.asc()).all()


def bookable_sessions(db: Session, event_id) -> List[EventSession]:
    """Sessions that take part in scanning (not deleted, not cancelled)."""
    return [s for s in event_sessions(db, event_id) if (s.status or "") != "cancelled"]


def get_event_session(db: Session, event_id, session_id) -> Optional[EventSession]:
    if not session_id:
        return None
    for row in event_sessions(db, event_id):
        if _compact(row.session_id) == _compact(session_id):
            return row
    return None


def session_window(session: EventSession) -> Tuple[datetime, datetime]:
    """Naive IST start/end datetimes for a session (end on the next day when it spans midnight)."""
    start_h, start_m = (int(p) for p in session.start_time.split(":"))
    end_h, end_m = (int(p) for p in session.end_time.split(":"))
    start = datetime.combine(session.session_date, time(start_h, start_m))
    end = datetime.combine(session.session_date, time(end_h, end_m))
    if session.ends_next_day or end <= start:
        end += timedelta(days=1)
    return start, end


def now_ist() -> datetime:
    return datetime.now(IST).replace(tzinfo=None)


def checkin_window_state(session: EventSession, now: Optional[datetime] = None) -> str:
    """open | not_open | closed — check-in opens before the start and closes after the end."""
    now = now or now_ist()
    start, end = session_window(session)
    if now < start - timedelta(minutes=CHECKIN_OPENS_MINUTES_BEFORE):
        return "not_open"
    if now > end + timedelta(minutes=CHECKIN_CLOSES_MINUTES_AFTER):
        return "closed"
    return "open"


def _fmt_clock(hhmm: str) -> str:
    try:
        return datetime.strptime(hhmm, "%H:%M").strftime("%I:%M %p").lstrip("0")
    except (TypeError, ValueError):
        return hhmm or ""


def serialize_session(session: EventSession, stats: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    start, end = session_window(session)
    body = {
        "session_id": str(session.session_id),
        "event_id": str(session.event_id),
        "position": session.position,
        "session_name": session.session_name,
        "session_description": session.session_description or "",
        "session_date": session.session_date.isoformat() if session.session_date else None,
        "start_time": session.start_time,
        "end_time": session.end_time,
        "ends_next_day": bool(session.ends_next_day),
        "time_label": f"{_fmt_clock(session.start_time)} – {_fmt_clock(session.end_time)}",
        "starts_at": start.isoformat(),
        "ends_at": end.isoformat(),
        "venue_name": session.venue_name,
        "venue_address": session.venue_address or "",
        "venue_lat": session.venue_lat,
        "venue_lng": session.venue_lng,
        "venue_place_id": session.venue_place_id or "",
        "capacity": session.capacity,
        "eligibility_mode": session.eligibility_mode,
        "eligible_ticket_types": list(session.eligible_ticket_types or []),
        "status": session.status,
        "deleted": session.deleted_at is not None,
        "updated_at": session.updated_at.isoformat() if session.updated_at else None,
    }
    if stats is not None:
        body.update(stats)
    return body


# ── Tickets (attendee identity) ───────────────────────────────────────────────
def ticket_is_active(ticket: Ticket) -> bool:
    status = (ticket.ticket_status or "").upper()
    if status in CANCELLED_STATUSES:
        return False
    booking = getattr(ticket, "booking", None)
    if booking is not None and (booking.status or "").upper() in CANCELLED_STATUSES:
        return False
    return bool((ticket.qr_token or "").strip())


def event_public_id_set(db: Session, event_mgt) -> set:
    try:
        from APIs.host_events_api import _event_public_ids
        ids = _event_public_ids(db, event_mgt)
    except Exception:
        ids = [event_mgt.event_id]
    return {_compact(eid) for eid in ids}


def ticket_belongs_to_event(db: Session, ticket: Ticket, event_mgt, public_ids: Optional[set] = None) -> bool:
    ids = public_ids if public_ids is not None else event_public_id_set(db, event_mgt)
    return _compact(ticket.event_id) in ids


def event_tickets(db: Session, event_mgt) -> List[Ticket]:
    try:
        from APIs.host_events_api import _tickets_for_event
        rows = _tickets_for_event(db, event_mgt)
    except Exception:
        rows = []
    return [t for t in rows if ticket_is_active(t)]


def ticket_ref(ticket: Ticket) -> str:
    short = str(ticket.booking_id or ticket.ticket_id).replace("-", "")[:8].upper()
    return f"JOD-{short}"


def attendee_names(tickets: Iterable[Ticket]) -> Dict[str, str]:
    """Buyer name on the first ticket of a booking, 'Name (Guest)' on the others."""
    by_booking: Dict[str, List[Ticket]] = {}
    for ticket in tickets:
        by_booking.setdefault(str(ticket.booking_id), []).append(ticket)
    names: Dict[str, str] = {}
    for rows in by_booking.values():
        rows.sort(key=lambda t: (t.created_at or datetime.min, str(t.ticket_id)))
        for index, ticket in enumerate(rows):
            booking = getattr(ticket, "booking", None)
            base = ((booking.receiver_name if booking else None) or "Guest").strip() or "Guest"
            names[str(ticket.ticket_id)] = base if index == 0 else f"{base} (Guest)"
    return names


# ── Eligibility ───────────────────────────────────────────────────────────────
def registration_map(db: Session, session_ids: List[Any]) -> Dict[str, Dict[str, str]]:
    """{session_id: {ticket_id: registration_status}}"""
    if not session_ids:
        return {}
    rows = db.query(EventSessionRegistration).filter(EventSessionRegistration.session_id.in_(session_ids)).all()
    out: Dict[str, Dict[str, str]] = {}
    for row in rows:
        out.setdefault(str(row.session_id), {})[str(row.ticket_id)] = (row.registration_status or "registered").lower()
    return out


def checkin_map(db: Session, session_ids: List[Any]) -> Dict[str, Dict[str, EventSessionCheckin]]:
    if not session_ids:
        return {}
    rows = (
        db.query(EventSessionCheckin)
        .filter(EventSessionCheckin.session_id.in_(session_ids))
        .filter(EventSessionCheckin.checkin_status == "checked_in")
        .all()
    )
    out: Dict[str, Dict[str, EventSessionCheckin]] = {}
    for row in rows:
        out.setdefault(str(row.session_id), {})[str(row.ticket_id)] = row
    return out


def is_eligible(session: EventSession, ticket: Ticket, registration_status: Optional[str]) -> bool:
    """Explicit 'revoked' always wins; otherwise the session's rule decides."""
    reg = (registration_status or "").lower()
    if reg == "revoked":
        return False
    if reg == "registered":
        return True
    mode = (session.eligibility_mode or "registered").lower()
    if mode == "all_attendees":
        return True
    if mode == "ticket_types":
        allowed = {_ticket_type_key(t) for t in (session.eligible_ticket_types or [])}
        return _ticket_type_key(ticket.ticket_type) in allowed
    return False


def _single_session_legacy_used(ticket: Ticket, session_count: int) -> bool:
    """With exactly one session, a ticket already marked USED by an older scanner counts as checked in."""
    return session_count == 1 and (ticket.ticket_status or "").upper() in CHECKED_IN_STATUSES


def sessions_overview(db: Session, event_mgt, sessions: Optional[List[EventSession]] = None, now: Optional[datetime] = None) -> Dict[str, Any]:
    """Per-session eligible / checked-in / pending counts from real rows, plus unique attendee totals."""
    sessions = sessions if sessions is not None else event_sessions(db, event_mgt.event_id)
    tickets = event_tickets(db, event_mgt)
    ids = [s.session_id for s in sessions]
    regs = registration_map(db, ids)
    checks = checkin_map(db, ids)
    countable = [s for s in sessions if (s.status or "") != "cancelled"]
    session_count = len(countable)

    unique_eligible: set = set()
    unique_checked: set = set()
    total_registrations = 0
    total_checkins = 0
    cards = []
    for session in sessions:
        sid = str(session.session_id)
        session_regs = regs.get(sid, {})
        session_checks = checks.get(sid, {})
        eligible = 0
        checked = 0
        for ticket in tickets:
            tid = str(ticket.ticket_id)
            ok = is_eligible(session, ticket, session_regs.get(tid))
            is_checked = tid in session_checks or (ok and _single_session_legacy_used(ticket, session_count))
            if ok:
                eligible += 1
                if (session.status or "") != "cancelled":
                    unique_eligible.add(tid)
            if is_checked:
                checked += 1
                unique_checked.add(tid)
        if (session.status or "") != "cancelled":
            total_registrations += eligible
            total_checkins += checked
        pending = max(eligible - checked, 0)
        cards.append(serialize_session(session, {
            "eligible_count": eligible,
            "checked_in_count": checked,
            "pending_count": pending,
            "attendance_percent": round((checked / eligible * 100.0), 1) if eligible else 0.0,
            "checkin_window": checkin_window_state(session, now) if session.status == "active" else session.status,
        }))
    return {
        "event_id": str(event_mgt.event_id),
        "event_title": getattr(event_mgt, "event_title", None),
        "session_count": len(sessions),
        "structure": "multiple" if session_count > 1 else ("single" if session_count == 1 else "none"),
        "sessions": cards,
        "unique_attendees": len(unique_eligible),
        "unique_checked_in": len(unique_checked),
        "event_ticket_holders": len(tickets),
        "total_session_registrations": total_registrations,
        "total_session_checkins": total_checkins,
    }


def session_attendee_rows(db: Session, event_mgt, session: EventSession, *, include_ineligible: bool = False) -> List[Dict[str, Any]]:
    tickets = event_tickets(db, event_mgt)
    names = attendee_names(tickets)
    regs = registration_map(db, [session.session_id]).get(str(session.session_id), {})
    checks = checkin_map(db, [session.session_id]).get(str(session.session_id), {})
    session_count = len(bookable_sessions(db, event_mgt.event_id))
    rows = []
    for ticket in tickets:
        tid = str(ticket.ticket_id)
        ok = is_eligible(session, ticket, regs.get(tid))
        if not ok and not include_ineligible:
            continue
        check = checks.get(tid)
        legacy = ok and _single_session_legacy_used(ticket, session_count)
        booking = getattr(ticket, "booking", None)
        rows.append({
            "ticket_id": tid,
            "attendee_ref": ticket_ref(ticket),
            "attendee_name": names.get(tid, "Guest"),
            "attendee_email": (booking.receiver_email if booking else None) or "",
            "ticket_type": ticket.ticket_type or "",
            "eligible": ok,
            "registration_status": regs.get(tid) or ("rule" if ok else ""),
            "checked_in": bool(check) or legacy,
            "checked_in_at": (check.checkin_time.isoformat() if check and check.checkin_time else (ticket.used_at.isoformat() if legacy and ticket.used_at else None)),
            "checked_in_by": (check.checked_in_by if check else (ticket.scanned_by if legacy else None)) or "",
        })
    rows.sort(key=lambda r: (not r["eligible"], r["attendee_name"].lower(), r["attendee_ref"]))
    return rows


# ── Registrations ─────────────────────────────────────────────────────────────
def set_session_registrations(
    db: Session,
    event_mgt,
    session: EventSession,
    ticket_ids: List[str],
    action: str,
    actor: str,
) -> Dict[str, Any]:
    """Add ('register') or remove ('revoke') eligibility for tickets of this event."""
    action = (action or "register").strip().lower()
    if action not in ("register", "revoke", "clear"):
        raise SessionValidationError({"action": "Use register, revoke, or clear."})
    wanted = {_compact(t) for t in (ticket_ids or []) if str(t or "").strip()}
    if not wanted:
        raise SessionValidationError({"ticket_ids": "Select at least one attendee."})
    tickets = {_compact(t.ticket_id): t for t in event_tickets(db, event_mgt)}
    unknown = [t for t in wanted if t not in tickets]
    if unknown:
        raise SessionValidationError({"ticket_ids": "Some attendees do not hold an active ticket for this event."})

    existing = {
        _compact(row.ticket_id): row
        for row in db.query(EventSessionRegistration).filter(EventSessionRegistration.session_id == session.session_id).all()
    }
    if action == "register" and session.capacity:
        current_status = {key: (row.registration_status or "") for key, row in existing.items()}
        current = sum(1 for key, t in tickets.items() if is_eligible(session, t, current_status.get(key)))
        newly = sum(1 for key in wanted if not is_eligible(session, tickets[key], current_status.get(key)))
        if current + newly > session.capacity:
            raise SessionValidationError({"capacity": f"This session is limited to {session.capacity} attendees."})

    changed = 0
    for key in wanted:
        ticket = tickets[key]
        row = existing.get(key)
        if action == "clear":
            if row is not None:
                db.delete(row)
                changed += 1
            continue
        status = "registered" if action == "register" else "revoked"
        if row is None:
            db.add(EventSessionRegistration(
                session_id=session.session_id,
                ticket_id=ticket.ticket_id,
                registration_status=status,
                registered_by=actor,
            ))
            changed += 1
        elif (row.registration_status or "") != status:
            row.registration_status = status
            row.registered_by = actor
            row.updated_at = datetime.utcnow()
            changed += 1
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise SessionValidationError({"ticket_ids": "Another change was saved at the same time. Refresh and try again."})
    return {"changed": changed, "action": action}


# ── Check-in ──────────────────────────────────────────────────────────────────
def _fail(code: str, message: str, http_hint: str = "red", **extra) -> Dict[str, Any]:
    body = {
        "success": False,
        "valid": False,
        "error_code": code,
        "status": code,
        "result_tone": http_hint,
        "message": message,
        "duplicate": code == "ALREADY_CHECKED_IN",
    }
    body.update({k: v for k, v in extra.items() if v is not None})
    return body


def resolve_scan_session(db: Session, event_mgt, session_id: Optional[str]) -> Tuple[Optional[EventSession], Optional[Dict[str, Any]]]:
    """Pick the session a scan applies to. No sessions → (None, None) keeps the legacy single check-in."""
    sessions = bookable_sessions(db, event_mgt.event_id)
    if session_id:
        match = next((s for s in sessions if _compact(s.session_id) == _compact(session_id)), None)
        if not match:
            return None, _fail("SESSION_NOT_FOUND", "That session does not belong to this event.")
        return match, None
    if not sessions:
        return None, None
    if len(sessions) == 1:
        return sessions[0], None
    return None, _fail("SESSION_REQUIRED", "Select the session you are checking attendees in to.", "yellow")


def volunteer_allowed_session_ids(volunteer) -> Optional[set]:
    raw = getattr(volunteer, "session_ids", None) if volunteer is not None else None
    if not raw:
        return None
    return {_compact(s) for s in raw if str(s or "").strip()}


def perform_session_checkin(
    db: Session,
    event_mgt,
    session: EventSession,
    tickets: List[Ticket],
    *,
    checked_in_by: str,
    method: str = "QR",
    volunteer=None,
    now: Optional[datetime] = None,
) -> Dict[str, Any]:
    """Validate and record one attendee's check-in to one session (idempotent, race-safe)."""
    if not tickets:
        return _fail("INVALID_TICKET", "This ticket could not be verified.")

    # 5. Session belongs to the parent event.
    if _compact(session.event_id) != _compact(event_mgt.event_id) or session.deleted_at is not None:
        return _fail("SESSION_NOT_FOUND", "That session does not belong to this event.")

    # Volunteer session scope (server-side).
    allowed = volunteer_allowed_session_ids(volunteer)
    if allowed is not None and _compact(session.session_id) not in allowed:
        return _fail("SESSION_NOT_AUTHORIZED", "You are not assigned to check in attendees for this session.")

    # 1–3. Genuine ticket for this event.
    public_ids = event_public_id_set(db, event_mgt)
    scoped = [t for t in tickets if ticket_belongs_to_event(db, t, event_mgt, public_ids)]
    if not scoped:
        return _fail("WRONG_EVENT", "This ticket belongs to another event.")
    ticket = next((t for t in scoped if ticket_is_active(t)), scoped[0])
    if not ticket_is_active(ticket):
        return _fail("TICKET_CANCELLED", "This ticket has been cancelled or refunded.")

    session_label = {"session_id": str(session.session_id), "session_name": session.session_name}

    # 6. Session status and time window.
    if (session.status or "") != "active":
        return _fail("SESSION_NOT_ACTIVE", f"{session.session_name} is not accepting check-ins ({session.status}).", "yellow", **session_label)
    window = checkin_window_state(session, now)
    if window != "open":
        start, end = session_window(session)
        hint = (
            f"Check-in opens {CHECKIN_OPENS_MINUTES_BEFORE} minutes before {start.strftime('%d %b, %I:%M %p')}."
            if window == "not_open"
            else f"Check-in closed {CHECKIN_CLOSES_MINUTES_AFTER} minutes after {end.strftime('%d %b, %I:%M %p')}."
        )
        return _fail("SESSION_NOT_OPEN", f"{session.session_name} is not accepting check-ins right now. {hint}", "yellow", **session_label)

    tid = str(ticket.ticket_id)
    siblings = db.query(Ticket).filter(Ticket.booking_id == ticket.booking_id).all() if ticket.booking_id else []
    attendee = attendee_names(siblings or [ticket]).get(tid, "Guest")
    public = {
        "attendee_id": tid,
        "attendee_ref": ticket_ref(ticket),
        "customer_name": attendee,
        "attendee_name": attendee,
        "ticket_type": ticket.ticket_type or "",
        **session_label,
    }

    # 7. Eligibility.
    reg = (
        db.query(EventSessionRegistration)
        .filter(EventSessionRegistration.session_id == session.session_id, EventSessionRegistration.ticket_id == ticket.ticket_id)
        .first()
    )
    if not is_eligible(session, ticket, reg.registration_status if reg else None):
        return _fail("SESSION_NOT_ELIGIBLE", "This attendee is not registered for this session.", **public)

    # 8. Duplicate within this session only.
    existing = (
        db.query(EventSessionCheckin)
        .filter(EventSessionCheckin.session_id == session.session_id, EventSessionCheckin.ticket_id == ticket.ticket_id)
        .first()
    )
    session_count = len(bookable_sessions(db, event_mgt.event_id))
    if existing or (existing is None and _single_session_legacy_used(ticket, session_count)):
        when = existing.checkin_time if existing else ticket.used_at
        return _fail(
            "ALREADY_CHECKED_IN",
            "This attendee has already checked in to this session.",
            "red",
            checked_in_at=when.isoformat() if when else None,
            checked_in_by=(existing.checked_in_by if existing else ticket.scanned_by),
            check_in_type="duplicate",
            already_checked_in=True,
            **public,
        )

    # Capacity counts check-ins, not tickets, so a full room stops further entry.
    if session.capacity:
        taken = (
            db.query(func.count(EventSessionCheckin.checkin_id))
            .filter(EventSessionCheckin.session_id == session.session_id, EventSessionCheckin.checkin_status == "checked_in")
            .scalar()
        ) or 0
        if taken >= session.capacity:
            return _fail("SESSION_FULL", f"{session.session_name} has reached its capacity of {session.capacity}.", "yellow", **public)

    # 9. Record atomically; the unique (session_id, ticket_id) constraint settles races.
    stamp = datetime.utcnow()
    row = EventSessionCheckin(
        session_id=session.session_id,
        ticket_id=ticket.ticket_id,
        checkin_time=stamp,
        checked_in_by=(checked_in_by or "")[:255] or None,
        volunteer_id=getattr(volunteer, "id", None),
        method=(method or "QR")[:20],
        checkin_status="checked_in",
    )
    db.add(row)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        return _fail(
            "ALREADY_CHECKED_IN",
            "This attendee has already checked in to this session.",
            check_in_type="duplicate",
            already_checked_in=True,
            **public,
        )

    # First check-in anywhere marks the ticket used so unique-attendance reports stay correct.
    status_u = func.upper(func.coalesce(Ticket.ticket_status, ""))
    (
        db.query(Ticket)
        .filter(Ticket.ticket_id == ticket.ticket_id)
        .filter(or_(status_u.in_(CHECKABLE_STATUSES), Ticket.ticket_status.is_(None), Ticket.ticket_status == ""))
        .update({Ticket.ticket_status: "USED", Ticket.used_at: stamp, Ticket.scanned_by: (checked_in_by or "")[:100] or None}, synchronize_session=False)
    )
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return _fail("ALREADY_CHECKED_IN", "This attendee has already checked in to this session.", check_in_type="duplicate", already_checked_in=True, **public)

    return {
        "success": True,
        "valid": True,
        "status": "valid",
        "result_tone": "green",
        "checkin_status": "checked_in",
        "check_in_type": "new",
        "checked_in_at": stamp.isoformat(),
        "checked_in_by": checked_in_by,
        "message": "Check-in successful",
        **public,
    }


def attendee_attendance(db: Session, event_mgt, ticket: Ticket) -> Dict[str, Any]:
    sessions = event_sessions(db, event_mgt.event_id)
    ids = [s.session_id for s in sessions]
    regs = registration_map(db, ids)
    checks = checkin_map(db, ids)
    session_count = len([s for s in sessions if (s.status or "") != "cancelled"])
    tid = str(ticket.ticket_id)
    items = []
    for session in sessions:
        sid = str(session.session_id)
        ok = is_eligible(session, ticket, regs.get(sid, {}).get(tid))
        check = checks.get(sid, {}).get(tid)
        legacy = ok and _single_session_legacy_used(ticket, session_count)
        items.append({
            "session_id": sid,
            "session_name": session.session_name,
            "session_date": session.session_date.isoformat() if session.session_date else None,
            "status": session.status,
            "eligible": ok,
            "checked_in": bool(check) or legacy,
            "checked_in_at": check.checkin_time.isoformat() if check and check.checkin_time else None,
        })
    return {
        "attendee_id": tid,
        "attendee_ref": ticket_ref(ticket),
        "ticket_type": ticket.ticket_type or "",
        "ticket_status": ticket.ticket_status,
        "sessions": items,
        "sessions_eligible": sum(1 for i in items if i["eligible"]),
        "sessions_attended": sum(1 for i in items if i["checked_in"]),
    }
