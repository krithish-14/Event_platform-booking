"""
API endpoints for Host Event Creation Workflow — Live Auto-Save & UPSERT for:
1. EventManagement (Manage Event page)
2. EventDesign (Design Event page)
3. EventRegistrationForm (Registration Form Builder)
"""

import os
import uuid
import uuid as uuid_mod
from datetime import datetime, date, timedelta, timezone
from typing import Optional, List, Dict, Any, Tuple
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session, joinedload
from pydantic import BaseModel

from Models import (
    get_db,
    User,
    OrganizerAccount,
    EventManagement,
    EventDesign,
    EventRegistrationForm,
    EventRegistrationSetting as EventRegistrationSettings,
    EventRegistrationTicket,
    EventRegistration,
    EventCommunication,
    EventAttendanceCheckin,
    Exhibitor,
    VolunteerCheckin,
    EventEntryGate,
    EventStaffScanner,
    EventVolunteer,
)
from APIs.organizers import to_public_verification_status, is_organizer_verified
from Authentication.dependencies import get_current_user_optional
from Utils.id_generator import generate_customer_id, generate_host_id_from_customer_id
from Utils.categories import (
    normalize_category,
    is_allowed_image_filename,
    is_allowed_image_bytes,
    INVALID_IMAGE_MESSAGE,
    INVALID_IMAGE_TYPE_MESSAGE,
    INVALID_IMAGE_SIZE_MESSAGE,
    MAX_IMAGE_BYTES,
)

router = APIRouter()

# Set ORGANIZER_VERIFICATION_REQUIRED=true in .env when admin KYC portal is live.
ORGANIZER_VERIFICATION_REQUIRED = os.getenv("ORGANIZER_VERIFICATION_REQUIRED", "false").lower() in ("1", "true", "yes")


def _bound_email(email: Optional[str], current_user: Optional[User] = None) -> str:
    """Always prefer the authenticated user's email over a client-supplied value."""
    if current_user and getattr(current_user, "email", None):
        return current_user.email.lower().strip()
    return (email or "").lower().strip()

ACTIVE_EVENT_BLOCK_MESSAGE = (
    "You already have an active event. You can create and publish a new event "
    "only after your current event has ended."
)
ACTIVE_LIFECYCLE_STATES = ("published", "live")
IST = timezone(timedelta(hours=5, minutes=30))
UTC = timezone.utc


# ── Helper to resolve Customer ID & Host ID for an email ─────────────────────
def resolve_host_identifiers(db: Session, email: str, current_user: Optional[User] = None):
    email_clean = _bound_email(email, current_user)
    user = current_user if (current_user and current_user.email and current_user.email.lower() == email_clean) else None
    if not user:
        user = db.query(User).filter(User.email == email_clean).first()

    org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email_clean).first()

    customer_id = (user.customer_id if user and user.customer_id else None) or (org_acc.customer_id if org_acc and org_acc.customer_id else None)
    if not customer_id:
        customer_id = generate_customer_id()
        if user:
            user.customer_id = customer_id
        if org_acc:
            org_acc.customer_id = customer_id

    host_id = (org_acc.host_id if org_acc and org_acc.host_id else None) or generate_host_id_from_customer_id(customer_id)
    if org_acc and not org_acc.host_id:
        org_acc.host_id = host_id

    db.commit()
    return customer_id, host_id


def _host_events_query(db: Session, email_clean: str, customer_id: Optional[str], host_id: Optional[str]):
    clauses = [EventManagement.organizer_email == email_clean]
    if customer_id:
        clauses.append(EventManagement.customer_id == customer_id)
    if host_id:
        clauses.append(EventManagement.host_id == host_id)
    return db.query(EventManagement).filter(or_(*clauses))


def _event_owned(
    event: EventManagement,
    email_clean: str,
    customer_id: Optional[str],
    host_id: Optional[str],
    current_user: Optional[User] = None,
) -> bool:
    if event.organizer_email and event.organizer_email.lower() == email_clean:
        return True
    if customer_id and event.customer_id == customer_id:
        return True
    if host_id and event.host_id == host_id:
        return True
    if current_user:
        user_email = (current_user.email or "").lower()
        if event.organizer_email and event.organizer_email.lower() == user_email:
            return True
        if current_user.customer_id and event.customer_id == current_user.customer_id:
            return True
    return False


def _lookup_event_by_id(db: Session, event_id: Optional[str]) -> Optional[EventManagement]:
    if not event_id:
        return None
    try:
        event_uuid = uuid.UUID(str(event_id))
    except (ValueError, TypeError):
        return None
    return db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()


def resolve_or_create_event(
    db: Session,
    email: str,
    event_id: Optional[str] = None,
    current_user: Optional[User] = None,
    create_if_missing: bool = True,
):
    email_clean = _bound_email(email, current_user)
    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)

    event = _lookup_event_by_id(db, event_id)
    if event and not _event_owned(event, email_clean, customer_id, host_id, current_user):
        event = None

    if not event:
        event = find_working_event(db, email_clean, customer_id, host_id)

    if not event and create_if_missing:
        event = EventManagement(
            event_id=uuid.uuid4(),
            organizer_email=email_clean,
            customer_id=customer_id,
            host_id=host_id,
            event_title="My New Event",
            event_status="draft",
        )
        db.add(event)
        db.commit()
        db.refresh(event)

    return event, customer_id, host_id


def _parse_incoming_datetime(value):
    """Parse host datetime into naive IST wall-clock for DB storage."""
    if isinstance(value, datetime):
        dt = value
    else:
        s = str(value).strip()
        if "T" in s and "+" not in s and not s.endswith("Z"):
            s = s + "+05:30"
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if dt.tzinfo is None:
        return dt.replace(microsecond=0)
    return dt.astimezone(IST).replace(tzinfo=None, microsecond=0)


def _parse_time_components(time_str):
    """Parse HH:MM, HH:MM:SS, or h:mm AM/PM into (hour, minute)."""
    import re
    if not time_str:
        return None
    t = str(time_str).strip().upper()
    m = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$", t)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    meridiem = m.group(3)
    if meridiem == "PM" and hour < 12:
        hour += 12
    elif meridiem == "AM" and hour == 12:
        hour = 0
    return hour, minute


def _aware_ist(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=IST)
    return dt.astimezone(IST)


def _to_naive_utc(dt: datetime) -> datetime:
    return _aware_ist(dt).astimezone(UTC).replace(tzinfo=None, microsecond=0)


def _resolve_event_start_datetime(event_mgt: EventManagement):
    """Combine host date/time as Asia/Kolkata and return naive UTC. Never uses wall-clock now."""
    if not event_mgt.event_start_date:
        return None

    try:
        raw = event_mgt.event_start_date
        if isinstance(raw, datetime):
            dt = raw
        else:
            s = str(raw).strip()
            if "T" in s and "+" not in s and not s.endswith("Z"):
                if len(s) == 16:
                    s = s + ":00+05:30"
                else:
                    s = s + "+05:30"
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))

        dt = _aware_ist(dt)
        tc = _parse_time_components(getattr(event_mgt, "event_start_time", None))
        if tc:
            dt = dt.replace(hour=tc[0], minute=tc[1], second=0, microsecond=0)
        return _to_naive_utc(dt)
    except Exception:
        raw = event_mgt.event_start_date
        if isinstance(raw, datetime):
            return _to_naive_utc(raw)
        return None


def _resolve_event_end_datetime(event_mgt: EventManagement):
    if not event_mgt.event_end_date:
        return None
    try:
        raw = event_mgt.event_end_date
        if isinstance(raw, datetime):
            dt = raw
        else:
            s = str(raw).strip()
            if "T" in s and "+" not in s and not s.endswith("Z"):
                s = s + ("+05:30" if len(s) <= 16 else "+05:30")
            dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        tc = _parse_time_components(getattr(event_mgt, "event_end_time", None))
        if tc:
            dt = dt.replace(hour=tc[0], minute=tc[1], second=0, microsecond=0)
        return dt.astimezone(UTC).replace(tzinfo=None)
    except Exception:
        return None


def _effective_end_datetime(event: EventManagement):
    """End datetime used for one-event and lifecycle checks (UTC naive)."""
    end = _resolve_event_end_datetime(event)
    if end:
        return end
    start = _resolve_event_start_datetime(event)
    if start:
        return start + timedelta(hours=4)
    return None


def apply_host_schedule_to_public_events(db: Session, events) -> None:
    """Overwrite public catalog start/end with the host's saved datetime (source of truth)."""
    if not events:
        return
    event_list = events if isinstance(events, list) else [events]
    ids = [e.id for e in event_list if e is not None]
    if not ids:
        return
    rows = db.query(EventManagement).filter(EventManagement.event_id.in_(ids)).all()
    by_id = {str(r.event_id): r for r in rows}
    changed = False
    for public_event in event_list:
        host = by_id.get(str(public_event.id))
        if not host or not host.event_start_date:
            continue
        start = _resolve_event_start_datetime(host)
        end = _effective_end_datetime(host)
        if start and public_event.start_date != start:
            public_event.start_date = start
            changed = True
        if end is not None and public_event.end_date != end:
            public_event.end_date = end
            changed = True
    if changed:
        try:
            db.commit()
        except Exception:
            db.rollback()


def _to_datetime_local_ist(stored: Optional[datetime]) -> Optional[str]:
    """Format stored host datetime for <input type=datetime-local> (IST wall clock)."""
    if not stored:
        return None
    if stored.tzinfo is not None:
        stored = stored.astimezone(IST).replace(tzinfo=None)
    return stored.strftime("%Y-%m-%dT%H:%M")


def compute_event_lifecycle(event: EventManagement) -> str:
    """Backend-owned lifecycle. DB may still store draft/published/cancelled."""
    stored = (event.event_status or "draft").lower()
    if stored in ("cancelled", "unpublished"):
        return stored
    now = datetime.utcnow()
    if stored == "published":
        start = _resolve_event_start_datetime(event)
        end = _effective_end_datetime(event)
        if end and now >= end:
            return "ended"
        if start and now >= start:
            return "live"
        return "published"
    title = (event.event_title or "").strip()
    if (
        title
        and title not in ("My New Event", "My New Event 2026", "My Published Event")
        and event.event_category
        and event.event_start_date
        and event.venue
    ):
        return "ready_to_publish"
    return "draft"


def is_event_active(event: EventManagement) -> bool:
    return compute_event_lifecycle(event) in ACTIVE_LIFECYCLE_STATES


def find_blocking_active_event(
    db: Session,
    email_clean: str,
    customer_id: Optional[str],
    host_id: Optional[str],
    exclude_event_id=None,
) -> Optional[EventManagement]:
    events = _host_events_query(db, email_clean, customer_id, host_id).order_by(
        EventManagement.created_at.desc()
    ).all()
    exclude = str(exclude_event_id) if exclude_event_id else None
    for ev in events:
        if exclude and str(ev.event_id) == exclude:
            continue
        if is_event_active(ev):
            return ev
    return None


def find_working_event(
    db: Session,
    email_clean: str,
    customer_id: Optional[str],
    host_id: Optional[str],
) -> Optional[EventManagement]:
    """Draft first, then the host's active event, then the most recent event."""
    events = _host_events_query(db, email_clean, customer_id, host_id).order_by(
        EventManagement.created_at.desc()
    ).all()
    if not events:
        return None
    for ev in events:
        if compute_event_lifecycle(ev) in ("draft", "ready_to_publish"):
            return ev
    for ev in events:
        if is_event_active(ev):
            return ev
    return events[0]


def assert_can_publish_event(
    db: Session,
    email_clean: str,
    customer_id: Optional[str],
    host_id: Optional[str],
    event: EventManagement,
):
    blocker = find_blocking_active_event(
        db, email_clean, customer_id, host_id, exclude_event_id=event.event_id
    )
    if blocker:
        raise HTTPException(status_code=409, detail=ACTIVE_EVENT_BLOCK_MESSAGE)


def _lifecycle_payload(event: EventManagement, db: Session, email_clean: str, customer_id, host_id) -> dict:
    lifecycle = compute_event_lifecycle(event)
    other_active = find_blocking_active_event(
        db, email_clean, customer_id, host_id, exclude_event_id=event.event_id
    )
    any_active = find_blocking_active_event(db, email_clean, customer_id, host_id, exclude_event_id=None)
    start_utc = _resolve_event_start_datetime(event) if event.event_start_date else None
    end_utc = _effective_end_datetime(event)
    return {
        "lifecycle": lifecycle,
        "can_publish_this": other_active is None,
        "can_publish_new": any_active is None,
        "can_create_new": any_active is None,
        "blocking_event_id": str(other_active.event_id) if other_active else (
            str(any_active.event_id) if any_active and str(any_active.event_id) != str(event.event_id) else None
        ),
        "blocking_event_title": (
            other_active.event_title if other_active else (
                any_active.event_title if any_active and str(any_active.event_id) != str(event.event_id) else None
            )
        ),
        "event_start_date_local": _to_datetime_local_ist(event.event_start_date),
        "event_end_date_local": _to_datetime_local_ist(event.event_end_date),
        "event_start_datetime_utc": start_utc.isoformat() if start_utc else None,
        "event_end_datetime_utc": end_utc.isoformat() if end_utc else None,
    }


def _extract_min_ticket_price(event_mgt: EventManagement) -> float:
    import json
    tickets = event_mgt.tickets_json
    if not tickets:
        return 0.0
    if isinstance(tickets, str):
        try:
            tickets = json.loads(tickets)
        except Exception:
            return 0.0
    if not isinstance(tickets, list):
        return 0.0
    prices = []
    for t in tickets:
        if isinstance(t, dict) and t.get("price") is not None:
            try:
                prices.append(float(t["price"]))
            except (TypeError, ValueError):
                pass
    return min(prices) if prices else 0.0


def _guid_equals_clauses(column, event_id):
    """Match a UUID column without mixing uuid = text (which aborts PG sessions)."""
    try:
        return [column == uuid.UUID(str(event_id))]
    except (ValueError, TypeError, AttributeError):
        return [column == event_id]


def _public_event_id_matches(db, Event, event_id):
    """Find public catalog rows by UUID or string id."""
    found = {}
    for clause in _guid_equals_clauses(Event.id, event_id):
        try:
            row = db.query(Event).filter(clause).first()
        except Exception:
            db.rollback()
            row = None
        if row:
            found[str(row.id)] = row
    return list(found.values())


_CANCELLED_STATUSES = {"CANCELLED", "CANCELED", "REFUNDED"}
_CHECKED_IN_STATUSES = {"USED", "CHECKED_IN", "CHECKED-IN", "CHECKEDIN"}


def _normalize_scan_code(value: Optional[str]) -> str:
    return "".join(ch for ch in str(value or "").upper() if ch.isalnum())


def _event_public_ids(db: Session, event_mgt: EventManagement) -> List[Any]:
    from Models.event import Event

    rows = _public_event_id_matches(db, Event, event_mgt.event_id)
    ids: List[Any] = [row.id for row in rows]
    if event_mgt.event_id not in ids:
        ids.append(event_mgt.event_id)
    try:
        as_uuid = uuid.UUID(str(event_mgt.event_id))
        if as_uuid not in ids:
            ids.append(as_uuid)
    except (ValueError, TypeError, AttributeError):
        pass
    return ids


def _capacity_for_event(db: Session, event_mgt: EventManagement) -> int:
    total = 0
    if event_mgt.tickets_json and isinstance(event_mgt.tickets_json, list):
        for item in event_mgt.tickets_json:
            if not isinstance(item, dict):
                continue
            try:
                total += int(item.get("quantity") or item.get("qty") or 0)
            except (TypeError, ValueError):
                pass
    cfg_tickets = db.query(EventRegistrationTicket).filter(
        EventRegistrationTicket.event_id == event_mgt.event_id,
        EventRegistrationTicket.deleted_at.is_(None),
    ).all()
    cfg_qty = sum(int(ticket.quantity or 0) for ticket in cfg_tickets)
    total = max(total, cfg_qty)
    from Models.event import Event
    for public_event in _public_event_id_matches(db, Event, event_mgt.event_id):
        try:
            total = max(total, int(public_event.capacity or 0))
        except (TypeError, ValueError):
            pass
    return total


def _form_submissions_for_event(db: Session, event_mgt: EventManagement) -> list:
    from Models.form_definitions import FormDefinition
    from Models.form_submissions import FormSubmission
    from sqlalchemy import func, or_

    id_strs = {str(eid).lower().strip() for eid in _event_public_ids(db, event_mgt)}
    id_strs.add(str(event_mgt.event_id).lower().strip())
    compact = {value.replace("-", "") for value in id_strs}
    organizer_email = (event_mgt.organizer_email or "").lower().strip()

    forms = []
    form_ids = []
    form_event_by_id = {}
    if organizer_email:
        try:
            forms = db.query(FormDefinition).filter(func.lower(FormDefinition.organizer_email) == organizer_email).all()
        except Exception:
            db.rollback()
            forms = []
        form_ids = [form.id for form in forms if form.id is not None]
        form_event_by_id = {
            form.id: str(form.event_id or "").lower().strip()
            for form in forms
        }

    filters = []
    if form_ids:
        filters.append(FormSubmission.form_id.in_(form_ids))
    for value in id_strs:
        if value:
            filters.append(func.lower(FormSubmission.event_id) == value)
    if not filters:
        return []

    try:
        rows = db.query(FormSubmission).filter(or_(*filters)).all()
    except Exception:
        db.rollback()
        return []

    found = {}
    for row in rows:
        stored = str(row.event_id or "").lower().strip()
        compact_stored = stored.replace("-", "")
        form_eid = form_event_by_id.get(row.form_id, "")
        compact_form = form_eid.replace("-", "")
        if compact_stored:
            if compact_stored not in compact:
                continue
        elif compact_form:
            if compact_form not in compact:
                continue
        else:
            continue
        found[row.id] = row
    return [
        row for row in found.values()
        if (row.status or "").lower() not in ("abandoned", "draft", "cancelled", "canceled")
    ]


def _tickets_for_event(db: Session, event_mgt: EventManagement) -> list:
    from Models.ticket import Ticket
    from sqlalchemy.orm import joinedload
    from sqlalchemy import or_

    clauses = []
    for eid in _event_public_ids(db, event_mgt):
        clauses.extend(_guid_equals_clauses(Ticket.event_id, eid))
    if not clauses:
        return []
    try:
        rows = db.query(Ticket).options(joinedload(Ticket.booking)).filter(or_(*clauses)).all()
    except Exception:
        db.rollback()
        return []
    found = {str(ticket.ticket_id): ticket for ticket in rows}
    return list(found.values())


def _ticket_matches_scan(ticket, raw: str, needle: str) -> bool:
    token = (ticket.qr_token or "").strip()
    if raw and token == raw:
        return True
    token_n = _normalize_scan_code(token)
    tid_n = _normalize_scan_code(str(ticket.ticket_id))
    bid_n = _normalize_scan_code(str(ticket.booking_id))
    if needle and token_n and (needle == token_n or needle in token_n or token_n.endswith(needle)):
        return True
    return bool(needle and len(needle) >= 6 and (tid_n.startswith(needle) or bid_n.startswith(needle)))


def _find_event_ticket(db: Session, event_mgt: EventManagement, code: str):
    from Models.ticket import Ticket
    from sqlalchemy import cast, String, func, or_
    from sqlalchemy.orm import joinedload

    raw = (code or "").strip()
    if not raw:
        return None
    needle = _normalize_scan_code(raw)
    tickets = _tickets_for_event(db, event_mgt)

    exact = next((ticket for ticket in tickets if (ticket.qr_token or "").strip() == raw), None)
    if exact:
        return exact

    for ticket in tickets:
        if _ticket_matches_scan(ticket, raw, needle):
            return ticket

    if "@" in raw:
        email = raw.lower()
        for ticket in tickets:
            booking = ticket.booking
            receiver = ((booking.receiver_email if booking else "") or "").lower().strip()
            if receiver == email and (ticket.ticket_status or "").upper() == "VALID":
                return ticket
        for ticket in tickets:
            booking = ticket.booking
            receiver = ((booking.receiver_email if booking else "") or "").lower().strip()
            if receiver == email:
                return ticket

    try:
        global_match = db.query(Ticket).options(joinedload(Ticket.booking)).filter(Ticket.qr_token == raw).first()
    except Exception:
        db.rollback()
        global_match = None
    if global_match:
        return global_match

    if needle and len(needle) >= 6:
        compact = needle.lower()
        bid_txt = func.replace(func.lower(cast(Ticket.booking_id, String)), "-", "")
        tid_txt = func.replace(func.lower(cast(Ticket.ticket_id, String)), "-", "")
        try:
            prefix_match = (
                db.query(Ticket)
                .options(joinedload(Ticket.booking))
                .filter(or_(
                    bid_txt.like(compact + "%"),
                    tid_txt.like(compact + "%"),
                    Ticket.qr_token.ilike(f"%{raw}%"),
                ))
                .first()
            )
        except Exception:
            db.rollback()
            prefix_match = None
        if prefix_match:
            return prefix_match
    return None


def compute_live_event_stats(db: Session, event_mgt: EventManagement) -> Dict[str, Any]:
    """Live sold / available / check-in counts from bookings, tickets, and forms."""
    from Models.booking import Booking
    from sqlalchemy import or_

    public_ids = _event_public_ids(db, event_mgt)
    booking_clauses = []
    for eid in public_ids:
        booking_clauses.extend(_guid_equals_clauses(Booking.event_id, eid))
    bookings = []
    seen_bookings = set()
    if booking_clauses:
        try:
            booking_rows = db.query(Booking).filter(or_(*booking_clauses)).all()
        except Exception:
            db.rollback()
            booking_rows = []
        for booking in booking_rows:
            key = str(booking.booking_id)
            if key in seen_bookings:
                continue
            seen_bookings.add(key)
            bookings.append(booking)
    tickets = _tickets_for_event(db, event_mgt)
    try:
        submissions = _form_submissions_for_event(db, event_mgt)
    except Exception:
        db.rollback()
        submissions = []
    try:
        event_regs = db.query(EventRegistration).filter(
            EventRegistration.event_id == event_mgt.event_id,
            EventRegistration.deleted_at.is_(None),
        ).all()
    except Exception:
        db.rollback()
        event_regs = []
    try:
        checkin_rows = db.query(EventAttendanceCheckin).filter(
            EventAttendanceCheckin.event_id == event_mgt.event_id,
            EventAttendanceCheckin.deleted_at.is_(None),
        ).all()
    except Exception:
        db.rollback()
        checkin_rows = []
    try:
        volunteer_checkins = (
            db.query(VolunteerCheckin)
            .options(joinedload(VolunteerCheckin.volunteer))
            .filter(VolunteerCheckin.event_id == event_mgt.event_id)
            .all()
        )
    except Exception:
        db.rollback()
        volunteer_checkins = []
    volunteer_by_ticket = {}
    for vc in volunteer_checkins:
        if not vc.ticket_id:
            continue
        vname = vc.volunteer.volunteer_name if vc.volunteer else None
        if vname:
            volunteer_by_ticket[str(vc.ticket_id)] = vname

    active_bookings = [b for b in bookings if (b.status or "").upper() not in _CANCELLED_STATUSES]
    active_tickets = [t for t in tickets if (t.ticket_status or "").upper() not in _CANCELLED_STATUSES]
    used_tickets = [t for t in active_tickets if (t.ticket_status or "").upper() in _CHECKED_IN_STATUSES]

    sold = sum(max(1, int(b.quantity or 1)) for b in active_bookings)
    if sold == 0:
        sold = len(active_tickets)
    paid_subs = [s for s in submissions if (s.status or "").lower() in ("paid", "completed", "confirmed")]
    if sold == 0 and paid_subs:
        sold = len(paid_subs)

    total_sales = round(sum(float(b.total_price or 0) for b in active_bookings), 2)

    unique_emails = set()
    for row in submissions:
        if row.user_email:
            unique_emails.add(row.user_email.lower().strip())
    for booking in active_bookings:
        email = (booking.receiver_email or "").lower().strip()
        if email:
            unique_emails.add(email)
    for reg in event_regs:
        email = (reg.attendee_email or "").lower().strip()
        if email:
            unique_emails.add(email)

    total_registrations = len(submissions) if submissions else 0
    if total_registrations == 0:
        total_registrations = len(event_regs) if event_regs else len(active_bookings)
    if total_registrations == 0:
        total_registrations = len(unique_emails)

    pending_registrations = max(0, int(total_registrations or 0) - int(sold or 0))

    used_emails = set()
    attendees = []
    for ticket in active_tickets:
        booking = ticket.booking
        email = ((booking.receiver_email if booking else "") or "").lower().strip()
        name = (booking.receiver_name if booking else None) or "Guest"
        is_used = (ticket.ticket_status or "").upper() in _CHECKED_IN_STATUSES
        if is_used and email:
            used_emails.add(email)
        attendees.append({
            "ticket_id": str(ticket.ticket_id),
            "booking_id": str(ticket.booking_id),
            "attendee_name": name,
            "attendee_email": (booking.receiver_email if booking else "") or "",
            "ticket_type": ticket.ticket_type or "Standard Access",
            "status": "checked_in" if is_used else "yet_to_checkin",
            "checked_in_at": ticket.used_at.isoformat() if ticket.used_at else None,
            "scanned_by": ticket.scanned_by,
            "volunteer_name": volunteer_by_ticket.get(str(ticket.ticket_id)) or ticket.scanned_by,
        })

    extra_checkins = 0
    listed_emails = {(item.get("attendee_email") or "").lower().strip() for item in attendees}
    for row in checkin_rows:
        email = (row.attendee_email or "").lower().strip()
        status_ok = (row.status or "checked_in").lower() in ("checked_in", "checked-in", "used", "")
        if not status_ok:
            continue
        if email and email in used_emails:
            continue
        if not email and used_tickets:
            continue
        extra_checkins += 1
        if email:
            used_emails.add(email)
        if email and email in listed_emails:
            continue
        attendees.append({
            "ticket_id": None,
            "booking_id": None,
            "attendee_name": row.attendee_name or "Attendee",
            "attendee_email": row.attendee_email or "",
            "ticket_type": "",
            "status": "checked_in",
            "checked_in_at": row.created_at.isoformat() if row.created_at else None,
            "scanned_by": row.created_by,
            "volunteer_name": row.created_by,
        })
        if email:
            listed_emails.add(email)

    for row in submissions:
        email = (row.user_email or "").lower().strip()
        if email and email in listed_emails:
            continue
        answers = row.answers_json if isinstance(row.answers_json, dict) else {}
        name = (
            answers.get("Full Name")
            or answers.get("full_name")
            or answers.get("Name")
            or (row.user_email.split("@")[0] if row.user_email else "Attendee")
        )
        checked = bool(email and email in used_emails)
        attendees.append({
            "ticket_id": None,
            "booking_id": str(row.booking_id) if row.booking_id else None,
            "attendee_name": name,
            "attendee_email": row.user_email or "",
            "ticket_type": row.ticket_type or "",
            "status": "checked_in" if checked else "yet_to_checkin",
            "checked_in_at": None,
            "scanned_by": None,
            "volunteer_name": None,
        })
        if email:
            listed_emails.add(email)

    checked_in = len(used_tickets) + extra_checkins
    if checked_in == 0 and checkin_rows:
        checked_in = sum(
            1 for row in checkin_rows
            if (row.status or "checked_in").lower() in ("checked_in", "checked-in", "used", "")
        )
    if sold and checked_in > sold:
        checked_in = sold

    capacity = _capacity_for_event(db, event_mgt)
    claimed = int(sold or 0) + int(pending_registrations or 0)
    available = max(0, capacity - claimed) if capacity else 0
    yet_to_checkin = max(0, sold - checked_in)

    day_counts = {}
    if submissions:
        for row in submissions:
            when = getattr(row, "submission_time", None)
            if not when:
                continue
            day = when.date() if hasattr(when, "date") else when
            day_counts[day] = day_counts.get(day, 0) + 1
    else:
        for booking in active_bookings:
            when = booking.booked_at
            if not when:
                continue
            day = when.date() if hasattr(when, "date") else when
            day_counts[day] = day_counts.get(day, 0) + 1
    registration_trend = [
        {"date": day.strftime("%b %d"), "value": count}
        for day, count in sorted(day_counts.items())[-8:]
    ]
    if not registration_trend and total_registrations:
        registration_trend = [{"date": "Now", "value": total_registrations}]

    return {
        "total_sales": total_sales,
        "total_registrations": total_registrations,
        "pending_registrations": pending_registrations,
        "unique_attendees": len(unique_emails),
        "tickets_sold": sold,
        "tickets_available": available,
        "ticket_capacity": capacity,
        "checked_in": checked_in,
        "yet_to_checkin": yet_to_checkin,
        "attendees_count": sold,
        "attendees": attendees,
        "registration_trend": registration_trend,
    }


def hide_public_catalog_events(
    db: Session,
    event_ids=None,
    customer_id: Optional[str] = None,
    host_id: Optional[str] = None,
    cancel: bool = True,
) -> int:
    """Unpublish (and optionally cancel) matching public `events` rows."""
    from Models.event import Event

    clauses = []
    for eid in event_ids or []:
        clauses.append(Event.id == eid)
        try:
            clauses.append(Event.id == uuid.UUID(str(eid)))
        except (ValueError, TypeError, AttributeError):
            pass
        clauses.append(Event.id == str(eid))
    if customer_id:
        clauses.append(Event.customer_id == customer_id)
    if host_id:
        clauses.append(Event.host_id == host_id)
    if not clauses:
        return 0

    rows = db.query(Event).filter(or_(*clauses)).all()
    for public_event in rows:
        public_event.is_published = False
        if cancel:
            public_event.is_cancelled = True
        public_event.updated_at = datetime.utcnow()
    return len(rows)


def sync_unpublished_event_from_catalog(db: Session, event_mgt: EventManagement, cancel: bool = False):
    """Hide or cancel a public catalog row when host unpublishes or cancels."""
    from Models.event import Event

    status = (event_mgt.event_status or "draft").lower()
    should_cancel = cancel or status in ("cancelled",)
    rows = _public_event_id_matches(db, Event, event_mgt.event_id)
    if not rows:
        hide_public_catalog_events(
            db,
            event_ids=[event_mgt.event_id],
            customer_id=event_mgt.customer_id,
            host_id=event_mgt.host_id,
            cancel=should_cancel,
        )
    else:
        for public_event in rows:
            public_event.is_published = False
            if should_cancel:
                public_event.is_cancelled = True
            public_event.updated_at = datetime.utcnow()
    db.commit()


def sync_published_event_to_public_catalog(db: Session, event_mgt: EventManagement):
    """
    Bridge function: When a host publishes an event, sync its details
    to the public `events` table so normal users can browse and book it.
    """
    import json
    from Models.event import Event
    from Models.event_design import EventDesign
    from Models.event_registration_settings import EventRegistrationSetting
    from Models.user import User

    design = db.query(EventDesign).filter(EventDesign.event_id == event_mgt.event_id).first()
    image_url = design.banner_image if design else None
    card_image = design.card_image if design else None

    user_acc = db.query(User).filter(
        (User.customer_id == event_mgt.customer_id) |
        (User.email == event_mgt.organizer_email.lower().strip())
    ).first()

    organizer_id = user_acc.id if user_acc else None

    start_dt = _resolve_event_start_datetime(event_mgt)
    end_dt = _effective_end_datetime(event_mgt)
    if not start_dt:
        raise ValueError("Event start date from the host is required to publish.")
    min_price = _extract_min_ticket_price(event_mgt)

    # Map design speakers/sponsors to public Event.performers/highlights JSON
    performers = []
    if design and design.speaker_details:
        for sp in (design.speaker_details or []):
            if isinstance(sp, dict) and sp.get("name"):
                performers.append({
                    "name": sp.get("name"),
                    "role": sp.get("role") or sp.get("title") or "",
                    "image_url": sp.get("photo_url") or sp.get("image_url") or ""
                })

    highlights = []
    if design and design.sponsor_details:
        for sp in (design.sponsor_details or []):
            if isinstance(sp, dict) and sp.get("name"):
                highlights.append({
                    "title": sp.get("name"),
                    "subtitle": sp.get("tier") or sp.get("category") or "",
                    "image_url": sp.get("logo_url") or sp.get("image_url") or ""
                })
    if design and design.highlights:
        try:
            hl = design.highlights if isinstance(design.highlights, list) else json.loads(design.highlights)
            if isinstance(hl, list):
                highlights.extend(hl)
        except Exception:
            pass

    gallery_images = []
    if design and design.gallery_images:
        raw_gallery = design.gallery_images
        if isinstance(raw_gallery, str):
            try:
                raw_gallery = json.loads(raw_gallery)
            except Exception:
                raw_gallery = [raw_gallery] if raw_gallery.strip() else []
        if isinstance(raw_gallery, list):
            for item in raw_gallery:
                if isinstance(item, str) and item.strip():
                    gallery_images.append(item.strip())
                elif isinstance(item, dict):
                    url = item.get("url") or item.get("image_url") or item.get("src") or ""
                    if url:
                        gallery_images.append(str(url).strip())

    # Build terms text from policies_json
    terms_text = None
    policies = getattr(event_mgt, "policies_json", None) or {}
    if isinstance(policies, dict) and policies:
        parts = []
        for key, label in [
            ("event_policy", "Event Policy"),
            ("cancellation_policy", "Cancellation Policy"),
            ("refund_policy", "Refund Policy"),
            ("terms_and_conditions", "Terms & Conditions"),
            ("privacy_policy", "Privacy Policy"),
            ("age_policy", "Age / Entry Policy"),
        ]:
            val = policies.get(key)
            if val and str(val).strip():
                parts.append(f"{label}:\n{str(val).strip()}")
        if parts:
            terms_text = "\n\n".join(parts)

    reg_settings = db.query(EventRegistrationSetting).filter(
        EventRegistrationSetting.event_id == event_mgt.event_id
    ).first()
    if not terms_text and reg_settings and reg_settings.cancellation_policy:
        terms_text = reg_settings.cancellation_policy

    description = design.about_event if (design and design.about_event) else None

    ticket_types = event_mgt.tickets_json
    if ticket_types and not isinstance(ticket_types, str):
        ticket_types = json.dumps(ticket_types)

    public_event = db.query(Event).filter(Event.id == event_mgt.event_id).first()
    was_published = bool(public_event and public_event.is_published)
    if not public_event:
        public_event = Event(
            id=event_mgt.event_id,
            title=event_mgt.event_title or "Untitled Event",
            description=description,
            location=event_mgt.venue or event_mgt.address or "Chennai",
            venue=event_mgt.venue,
            latitude=getattr(event_mgt, "latitude", None),
            longitude=getattr(event_mgt, "longitude", None),
            category=normalize_category(event_mgt.event_category) or event_mgt.event_category,
            image_url=image_url or "images/hero-event.jpg",
            card_image=card_image,
            start_date=start_dt,
            end_date=end_dt,
            price=min_price,
            event_format=event_mgt.event_mode or "In-person",
            is_published=True,
            is_cancelled=False,
            customer_id=event_mgt.customer_id,
            host_id=event_mgt.host_id,
            organizer_id=organizer_id,
            performers=json.dumps(performers) if performers else None,
            highlights=json.dumps(highlights) if highlights else None,
            gallery_images=json.dumps(gallery_images) if gallery_images else None,
            ticket_types=ticket_types,
            terms=terms_text,
        )
        db.add(public_event)
    else:
        public_event.title = event_mgt.event_title or public_event.title
        public_event.description = description or public_event.description
        public_event.location = event_mgt.venue or event_mgt.address or public_event.location
        public_event.venue = event_mgt.venue or public_event.venue
        if getattr(event_mgt, "latitude", None) is not None:
            public_event.latitude = event_mgt.latitude
        if getattr(event_mgt, "longitude", None) is not None:
            public_event.longitude = event_mgt.longitude
        public_event.category = normalize_category(event_mgt.event_category) or event_mgt.event_category or public_event.category
        public_event.event_format = event_mgt.event_mode or public_event.event_format
        if image_url:
            public_event.image_url = image_url
        if card_image:
            public_event.card_image = card_image
        elif design and design.card_image:
            public_event.card_image = design.card_image
        public_event.start_date = start_dt
        if end_dt:
            public_event.end_date = end_dt
        public_event.price = min_price
        public_event.is_published = True
        public_event.is_cancelled = False
        public_event.customer_id = event_mgt.customer_id
        public_event.host_id = event_mgt.host_id
        if organizer_id:
            public_event.organizer_id = organizer_id
        if performers:
            public_event.performers = json.dumps(performers)
        if highlights:
            public_event.highlights = json.dumps(highlights)
        public_event.gallery_images = json.dumps(gallery_images) if gallery_images else None
        if ticket_types:
            public_event.ticket_types = ticket_types
        public_event.terms = terms_text

    public_event.updated_at = datetime.utcnow()
    db.commit()

    if not was_published:
        try:
            from Services.notifications import ensure_published_event_announcement
            ensure_published_event_announcement(
                db,
                event_id=event_mgt.event_id,
                title=public_event.title or event_mgt.event_title or "Untitled Event",
                venue=event_mgt.venue or public_event.venue,
                address=event_mgt.address,
                location=public_event.location,
                publisher_customer_id=event_mgt.customer_id,
            )
        except Exception as exc:
            print(f"[EVENT PUBLISH] announcement failed event_id={event_mgt.event_id}: {exc}", flush=True)


# ── Schemas ───────────────────────────────────────────────────────────────────
class SaveManageEventRequest(BaseModel):
    event_id: Optional[str] = None
    organizer_email: str
    event_title: Optional[str] = None
    event_category: Optional[str] = None
    event_type: Optional[str] = None
    event_mode: Optional[str] = None
    event_start_date: Optional[str] = None
    event_end_date: Optional[str] = None
    event_start_time: Optional[str] = None
    event_end_time: Optional[str] = None
    venue: Optional[str] = None
    address: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    organizer_name: Optional[str] = None
    organizer_phone: Optional[str] = None
    event_status: Optional[str] = None
    tickets_json: Optional[List[Dict[str, Any]]] = None
    agenda_json: Optional[List[Dict[str, Any]]] = None
    policies_json: Optional[Dict[str, Any]] = None
    about_event: Optional[str] = None


class SaveEventDesignRequest(BaseModel):
    event_id: Optional[str] = None
    organizer_email: str
    banner_image: Optional[str] = None
    card_image: Optional[str] = None
    logo: Optional[str] = None
    theme_color: Optional[str] = "#2563eb"
    font: Optional[str] = "Inter"
    gallery_images: Optional[List[Any]] = None
    about_event: Optional[str] = None
    highlights: Optional[str] = None
    speaker_details: Optional[List[Dict[str, Any]]] = None
    sponsor_details: Optional[List[Dict[str, Any]]] = None
    social_links: Optional[Dict[str, Any]] = None
    custom_sections: Optional[List[Dict[str, Any]]] = None


class SaveRegistrationFormRequest(BaseModel):
    event_id: Optional[str] = None
    organizer_email: str
    form_json: Optional[Any] = None
    questions_json: Optional[List[Dict[str, Any]]] = None
    required_fields: Optional[List[str]] = None
    field_order: Optional[List[str]] = None
    settings_json: Optional[Dict[str, Any]] = None
    published: Optional[bool] = False


class SaveExhibitorRequest(BaseModel):
    exhibitor_id: Optional[str] = None
    event_id: Optional[str] = None
    organizer_email: str
    company_name: str
    contact_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None
    category: Optional[str] = "General"
    package: Optional[str] = "Standard"
    notes: Optional[str] = None
    status: Optional[str] = "pending"


class SaveGateRequest(BaseModel):
    gate_id: Optional[str] = None
    event_id: Optional[str] = None
    organizer_email: str
    gate_name: str
    gate_code: Optional[str] = None
    gate_description: Optional[str] = None
    status: Optional[str] = "Active"


class SaveScannerRequest(BaseModel):
    scanner_id: Optional[str] = None
    event_id: Optional[str] = None
    organizer_email: str
    name: str
    gate_id: str
    passcode: str
    status: Optional[str] = "Live Scanning"
    scans_processed: Optional[int] = 0


class SaveRegistrationSettingsRequest(BaseModel):
    settings_id: Optional[str] = None
    event_id: Optional[str] = None
    organizer_email: str
    registration_status: Optional[str] = "open"
    registration_start_date: Optional[str] = None
    registration_end_date: Optional[str] = None
    max_capacity: Optional[int] = 0
    allow_waitlist: Optional[bool] = False
    approval_required: Optional[bool] = False
    registration_type: Optional[str] = "free"
    auto_confirmation: Optional[bool] = True
    confirmation_email: Optional[bool] = True
    cancellation_policy: Optional[str] = None
    status: Optional[str] = "active"


class SaveRegistrationTicketRequest(BaseModel):
    ticket_id: Optional[str] = None
    settings_id: Optional[str] = None
    event_id: Optional[str] = None
    organizer_email: str
    ticket_name: str
    ticket_type: Optional[str] = "standard"
    price: Optional[float] = 0.0
    quantity: Optional[int] = 0
    sales_start: Optional[str] = None
    sales_end: Optional[str] = None
    description: Optional[str] = None
    available_seats: Optional[int] = None
    status: Optional[str] = "active"


class SaveRegistrationRequest(BaseModel):
    registration_id: Optional[str] = None
    event_id: Optional[str] = None
    organizer_email: str
    ticket_id: Optional[str] = None
    attendee_name: str
    attendee_email: str
    attendee_phone: Optional[str] = None
    registration_number: Optional[str] = None
    status: Optional[str] = "pending"
    payment_status: Optional[str] = "pending"
    checkin_status: Optional[str] = "pending"
    notes: Optional[str] = None


class SaveCommunicationRequest(BaseModel):
    communication_id: Optional[str] = None
    event_id: Optional[str] = None
    organizer_email: str
    audience: Optional[str] = "all_tickets"
    channel: Optional[str] = "email"
    subject: str
    message: str
    attachment_url: Optional[str] = None
    schedule_date: Optional[str] = None
    schedule_time: Optional[str] = None
    status: Optional[str] = "scheduled"
    delivery_status: Optional[str] = "pending"


class SaveCheckinRequest(BaseModel):
    event_id: Optional[str] = None
    organizer_email: str
    registration_id: Optional[str] = None
    attendee_name: Optional[str] = None
    attendee_email: Optional[str] = None
    qr_token: Optional[str] = None
    ticket_code: Optional[str] = None
    scan_method: Optional[str] = "manual"
    status: Optional[str] = "checked_in"
    notes: Optional[str] = None
    scanned_by: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/manage")
def save_manage_event(
    payload: SaveManageEventRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """UPSERT endpoint for Manage Event step with VERIFIED-only publish gate."""
    customer_id, host_id = resolve_host_identifiers(db, payload.organizer_email, current_user)
    email_clean = _bound_email(payload.organizer_email, current_user)

    # ── PUBLISH VERIFICATION GATE (backend-enforced) ─────────────────────────
    requested_publish = (
        payload.event_status
        and isinstance(payload.event_status, str)
        and payload.event_status.lower() in ("published", "publish", "live")
    )

    org_acc = db.query(OrganizerAccount).filter(
        (OrganizerAccount.email == email_clean) |
        (OrganizerAccount.customer_id == customer_id) |
        (OrganizerAccount.host_id == host_id)
    ).first()

    public_ver_status = to_public_verification_status(org_acc.status if org_acc else None)
    rejection_reason = org_acc.rejection_reason if org_acc else None

    if requested_publish:
        # Gate #1: must be authenticated (not anonymous)
        if not current_user:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required to publish an event."
            )
        if current_user.email.lower() != email_clean:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only publish events for your own organizer account."
            )
        # Gate #2 (optional): organizer KYC — disabled until admin portal is live
        if ORGANIZER_VERIFICATION_REQUIRED:
            if not org_acc:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Please complete organizer verification before publishing an event."
                )
            if not is_organizer_verified(org_acc.status):
                msg_map = {
                    "NOT_SUBMITTED": "Please complete organizer verification before publishing an event.",
                    "PENDING": "Your organizer verification is currently under review. You can publish this event after verification is approved.",
                    "REJECTED": f"Your organizer verification was rejected. {rejection_reason or 'Please update your verification details and resubmit.'}"
                }
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=msg_map.get(public_ver_status, "Organizer verification required before publishing.")
                )

    event = _lookup_event_by_id(db, payload.event_id)
    if event:
        owner_ok = _event_owned(event, email_clean, customer_id, host_id, current_user)
        if not owner_ok:
            if requested_publish or current_user:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not own this event and cannot modify or publish it.",
                )
            event = None

    if not event:
        event = find_working_event(db, email_clean, customer_id, host_id)
        # Do not reuse an ended/cancelled event as a new draft — create a fresh row.
        if event and compute_event_lifecycle(event) in ("ended", "cancelled", "unpublished"):
            if not payload.event_id or str(payload.event_id) != str(event.event_id):
                event = None

    if not event:
        active = find_blocking_active_event(db, email_clean, customer_id, host_id)
        if active:
            if requested_publish:
                raise HTTPException(status_code=409, detail=ACTIVE_EVENT_BLOCK_MESSAGE)
            event = active
        else:
            event = EventManagement(
                event_id=uuid.uuid4(),
                organizer_email=email_clean,
                event_title=payload.event_title or "My New Event",
                event_status="draft",
            )
            db.add(event)

    if requested_publish:
        assert_can_publish_event(db, email_clean, customer_id, host_id, event)

    # Update attributes in place (UPSERT)
    event.customer_id = customer_id
    event.host_id = host_id
    if payload.event_title: event.event_title = payload.event_title
    if payload.event_category:
        event.event_category = normalize_category(payload.event_category) or payload.event_category
    if payload.event_type: event.event_type = payload.event_type
    if payload.event_mode: event.event_mode = payload.event_mode
    if payload.venue: event.venue = payload.venue
    if payload.address: event.address = payload.address
    if payload.latitude is not None: event.latitude = payload.latitude
    if payload.longitude is not None: event.longitude = payload.longitude
    if payload.organizer_name: event.organizer_name = payload.organizer_name
    if payload.organizer_phone: event.organizer_phone = payload.organizer_phone
    if payload.event_status:
        incoming = payload.event_status.lower()
        current = (event.event_status or "draft").lower()
        if incoming in ("published", "publish", "live"):
            if requested_publish:
                event.event_status = "published"
                event.published_at = getattr(event, "published_at", None) or datetime.utcnow()
        elif incoming in ("unpublished", "cancelled"):
            event.event_status = incoming
        elif incoming == "draft" and current != "published":
            event.event_status = "draft"
    if payload.event_start_time is not None: event.event_start_time = payload.event_start_time
    if payload.event_end_time is not None: event.event_end_time = payload.event_end_time
    if payload.event_start_date:
        try:
            event.event_start_date = _parse_incoming_datetime(payload.event_start_date)
        except Exception:
            pass
    if payload.event_end_date:
        try:
            event.event_end_date = _parse_incoming_datetime(payload.event_end_date)
        except Exception:
            pass
    if event.event_start_date and not event.event_end_date:
        try:
            event.event_end_date = event.event_start_date + timedelta(hours=4)
        except Exception:
            pass
    if payload.tickets_json is not None: event.tickets_json = payload.tickets_json
    if payload.agenda_json is not None: event.agenda_json = payload.agenda_json
    if payload.policies_json is not None: event.policies_json = payload.policies_json
    event.updated_at = datetime.utcnow()

    if payload.about_event is not None:
        design = db.query(EventDesign).filter(EventDesign.event_id == event.event_id).first()
        if not design:
            design = EventDesign(
                design_id=uuid.uuid4(),
                event_id=event.event_id,
                customer_id=customer_id,
                host_id=host_id,
            )
            db.add(design)
        design.about_event = payload.about_event
        design.customer_id = customer_id
        design.host_id = host_id
        design.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(event)

    status_lower = (event.event_status or "draft").lower()
    catalog_synced = False
    catalog_sync_error = None
    if status_lower in ("draft", "cancelled", "unpublished"):
        try:
            sync_unpublished_event_from_catalog(db, event)
            catalog_synced = True
        except Exception as exc:
            catalog_sync_error = str(exc)
            print(f"[EVENT PUBLISH] unpublish catalog sync failed event_id={event.event_id}: {exc}", flush=True)
    elif (event.event_status or "").lower() == "published":
        try:
            sync_published_event_to_public_catalog(db, event)
            catalog_synced = True
            print(
                f"[EVENT PUBLISH] catalog synced event_id={event.event_id} "
                f"title={event.event_title!r} status={event.event_status}",
                flush=True,
            )
        except Exception as exc:
            catalog_sync_error = str(exc)
            print(f"[EVENT PUBLISH] catalog sync failed event_id={event.event_id}: {exc}", flush=True)

    life = _lifecycle_payload(event, db, email_clean, customer_id, host_id)
    return {
        "status": "success",
        "message": "Manage event details saved (UPSERT)",
        "event_id": str(event.event_id),
        "customer_id": event.customer_id,
        "host_id": event.host_id,
        "catalog_synced": catalog_synced,
        "catalog_sync_error": catalog_sync_error,
        **life,
        "organizer_verification": {
            "verification_status": public_ver_status,
            "can_publish_events": is_organizer_verified(org_acc.status if org_acc else None),
            "rejection_reason": rejection_reason
        },
        "event": {
            "event_id": str(event.event_id),
            "event_title": event.event_title,
            "event_category": event.event_category,
            "event_mode": event.event_mode,
            "venue": event.venue,
            "latitude": getattr(event, "latitude", None),
            "longitude": getattr(event, "longitude", None),
            "event_status": event.event_status,
            "tickets": event.tickets_json,
            "agenda": event.agenda_json,
            "policies": event.policies_json,
            "updated_at": event.updated_at.isoformat() if event.updated_at else None
        }
    }


@router.post("/design")
def save_event_design(
    payload: SaveEventDesignRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """UPSERT endpoint for Event Design step."""
    customer_id, host_id = resolve_host_identifiers(db, payload.organizer_email, current_user)
    email_clean = _bound_email(payload.organizer_email, current_user)

    event = _lookup_event_by_id(db, payload.event_id)
    if event and not _event_owned(event, email_clean, customer_id, host_id, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this event.")
    if not event:
        event = find_working_event(db, email_clean, customer_id, host_id)
    if not event:
        raise HTTPException(
            status_code=404,
            detail="Save Manage details first before saving Design. No event exists for this host.",
        )

    design = db.query(EventDesign).filter(EventDesign.event_id == event.event_id).first()
    if not design:
        design = EventDesign(
            design_id=uuid.uuid4(),
            event_id=event.event_id,
            customer_id=customer_id,
            host_id=host_id
        )
        db.add(design)

    design.customer_id = customer_id
    design.host_id = host_id
    if payload.banner_image: design.banner_image = payload.banner_image
    if payload.card_image is not None: design.card_image = payload.card_image or None
    if payload.logo: design.logo = payload.logo
    if payload.theme_color: design.theme_color = payload.theme_color
    if payload.font: design.font = payload.font
    if payload.gallery_images is not None: design.gallery_images = payload.gallery_images
    if payload.about_event is not None: design.about_event = payload.about_event
    if payload.highlights: design.highlights = payload.highlights
    if payload.speaker_details is not None: design.speaker_details = payload.speaker_details
    if payload.sponsor_details is not None: design.sponsor_details = payload.sponsor_details
    if payload.social_links is not None: design.social_links = payload.social_links
    if payload.custom_sections is not None: design.custom_sections = payload.custom_sections
    design.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(design)

    if (event.event_status or "").lower() == "published":
        try:
            sync_published_event_to_public_catalog(db, event)
        except Exception as exc:
            print(f"[EVENT DESIGN] catalog resync failed event_id={event.event_id}: {exc}", flush=True)

    return {
        "status": "success",
        "message": "Event design details saved (UPSERT)",
        "design_id": str(design.design_id),
        "event_id": str(event.event_id),
        "customer_id": design.customer_id,
        "host_id": design.host_id,
        "design": {
            "design_id": str(design.design_id),
            "theme_color": design.theme_color,
            "banner_image": design.banner_image,
            "card_image": design.card_image,
            "speaker_details": design.speaker_details,
            "sponsor_details": design.sponsor_details,
            "gallery_images": design.gallery_images,
            "updated_at": design.updated_at.isoformat() if design.updated_at else None
        }
    }


@router.post("/upload-asset")
async def upload_design_asset(
    email: str = Form(...),
    asset_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Upload banner, sponsor logo, artist photo, or gallery image for event design."""
    email_clean = _bound_email(email, current_user)

    if current_user and current_user.email.lower() != email_clean:
        raise HTTPException(status_code=403, detail="You can only upload assets for your own account.")

    allowed_types = {"banner", "card_image", "sponsor_logo", "artist_photo", "gallery", "logo"}
    if asset_type not in allowed_types:
        raise HTTPException(status_code=400, detail=f"Invalid asset_type. Allowed: {', '.join(sorted(allowed_types))}")

    if not is_allowed_image_filename(file.filename or ""):
        raise HTTPException(status_code=400, detail=INVALID_IMAGE_TYPE_MESSAGE)

    contents = await file.read()
    if len(contents) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail=INVALID_IMAGE_SIZE_MESSAGE)
    if not is_allowed_image_bytes(contents, file.content_type or ""):
        raise HTTPException(status_code=400, detail=INVALID_IMAGE_TYPE_MESSAGE)

    from Services.file_storage import public_url, store_bytes

    try:
        stored = store_bytes(
            db,
            data=contents,
            filename=file.filename or f"{asset_type}.jpg",
            content_type=file.content_type,
            kind="event_media",
            purpose=asset_type,
            owner_customer_id=current_user.customer_id if current_user else None,
            owner_email=email_clean,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    file_url = public_url(stored)
    db.commit()
    return {
        "message": f"{asset_type.replace('_', ' ').title()} uploaded successfully.",
        "file_url": file_url,
        "asset_type": asset_type,
    }


@router.post("/registration-form")
def save_registration_form(
    payload: SaveRegistrationFormRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """UPSERT endpoint for Registration Form Builder step."""
    customer_id, host_id = resolve_host_identifiers(db, payload.organizer_email, current_user)
    email_clean = _bound_email(payload.organizer_email, current_user)

    event = _lookup_event_by_id(db, payload.event_id)
    if event and not _event_owned(event, email_clean, customer_id, host_id, current_user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="You do not own this event.")
    if not event:
        event = find_working_event(db, email_clean, customer_id, host_id)
    if not event:
        raise HTTPException(
            status_code=404,
            detail="Save Manage details first before saving the registration form. No event exists for this host.",
        )

    reg_form = db.query(EventRegistrationForm).filter(EventRegistrationForm.event_id == event.event_id).first()
    if not reg_form:
        reg_form = EventRegistrationForm(
            form_id=uuid.uuid4(),
            event_id=event.event_id,
            customer_id=customer_id,
            host_id=host_id
        )
        db.add(reg_form)

    reg_form.customer_id = customer_id
    reg_form.host_id = host_id
    if payload.form_json is not None: reg_form.form_json = payload.form_json
    if payload.questions_json is not None: reg_form.questions_json = payload.questions_json
    if payload.required_fields is not None: reg_form.required_fields = payload.required_fields
    if payload.field_order is not None: reg_form.field_order = payload.field_order
    if payload.settings_json is not None: reg_form.settings_json = payload.settings_json
    if payload.published is not None: reg_form.published = payload.published
    reg_form.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(reg_form)

    if (event.event_status or "").lower() == "published":
        try:
            sync_published_event_to_public_catalog(db, event)
        except Exception:
            pass

    return {
        "status": "success",
        "message": "Registration form details saved (UPSERT)",
        "form_id": str(reg_form.form_id),
        "event_id": str(event.event_id),
        "customer_id": reg_form.customer_id,
        "host_id": reg_form.host_id,
        "published": reg_form.published,
        "form": {
            "form_id": str(reg_form.form_id),
            "questions_count": len(reg_form.questions_json) if reg_form.questions_json else 0,
            "published": reg_form.published,
            "updated_at": reg_form.updated_at.isoformat() if reg_form.updated_at else None
        }
    }


@router.get("/current")
def get_current_host_event(
    email: str = Query(..., description="Organizer email address"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Retrieve full event data across all 3 steps for the host."""
    email_clean = _bound_email(email, current_user)
    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)

    event = find_working_event(db, email_clean, customer_id, host_id)
    any_active = find_blocking_active_event(db, email_clean, customer_id, host_id)

    if not event:
        return {
            "has_event": False,
            "customer_id": customer_id,
            "host_id": host_id,
            "lifecycle": None,
            "can_publish_new": True,
            "can_publish_this": True,
            "can_create_new": True,
            "blocking_event_id": None,
            "event": None,
            "design": None,
            "registration_form": None,
        }

    design = db.query(EventDesign).filter(EventDesign.event_id == event.event_id).first()
    reg_form = db.query(EventRegistrationForm).filter(EventRegistrationForm.event_id == event.event_id).first()
    life = _lifecycle_payload(event, db, email_clean, customer_id, host_id)
    start_local = life.get("event_start_date_local")
    end_local = life.get("event_end_date_local")

    return {
        "has_event": True,
        "customer_id": customer_id,
        "host_id": host_id,
        **life,
        "has_active_event": any_active is not None,
        "event": {
            "event_id": str(event.event_id),
            "customer_id": event.customer_id or customer_id,
            "host_id": event.host_id or host_id,
            "event_title": event.event_title,
            "event_category": event.event_category,
            "event_mode": event.event_mode,
            "event_type": event.event_type,
            "venue": event.venue,
            "address": event.address,
            "latitude": event.latitude,
            "longitude": event.longitude,
            "organizer_name": event.organizer_name,
            "organizer_email": event.organizer_email,
            "organizer_phone": event.organizer_phone,
            "event_status": event.event_status,
            "lifecycle": life["lifecycle"],
            "event_start_date": start_local,
            "event_end_date": end_local,
            "event_start_time": event.event_start_time,
            "event_end_time": event.event_end_time,
            "tickets": event.tickets_json,
            "agenda": event.agenda_json,
            "policies": event.policies_json,
            "updated_at": event.updated_at.isoformat() if event.updated_at else None,
        },
        "design": {
            "design_id": str(design.design_id) if design else None,
            "banner_image": design.banner_image if design else None,
            "card_image": design.card_image if design else None,
            "theme_color": design.theme_color if design else "#2563eb",
            "about_event": design.about_event if design else None,
            "speaker_details": design.speaker_details if design else [],
            "sponsor_details": design.sponsor_details if design else [],
            "gallery_images": design.gallery_images if design else [],
        } if design else None,
        "registration_form": {
            "form_id": str(reg_form.form_id) if reg_form else None,
            "form_json": reg_form.form_json if reg_form else {},
            "questions_json": reg_form.questions_json if reg_form else [],
            "settings_json": reg_form.settings_json if reg_form else {},
            "published": reg_form.published if reg_form else False,
        } if reg_form else None,
    }


# ── Registration Module Endpoints ────────────────────────────────────────
@router.get("/registrations")
def get_registration_module_data(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Return registration settings, ticket inventory, attendee registrations, and summary counts."""
    event, customer_id, host_id = resolve_or_create_event(
        db, email, event_id, current_user, create_if_missing=False
    )
    if not event:
        return {
            "event_id": None,
            "customer_id": customer_id,
            "host_id": host_id,
            "settings": None,
            "tickets": [],
            "registrations": [],
            "summary": {
                "total_registrations": 0,
                "pending_registrations": 0,
                "confirmed_registrations": 0,
                "checked_in_count": 0,
                "tickets_available": 0,
            },
        }

    settings = db.query(EventRegistrationSettings).filter(
        EventRegistrationSettings.event_id == event.event_id,
        EventRegistrationSettings.deleted_at.is_(None)
    ).order_by(EventRegistrationSettings.created_at.desc()).first()

    tickets = db.query(EventRegistrationTicket).filter(
        EventRegistrationTicket.event_id == event.event_id,
        EventRegistrationTicket.deleted_at.is_(None)
    ).order_by(EventRegistrationTicket.created_at.asc()).all()

    registrations = db.query(EventRegistration).filter(
        EventRegistration.event_id == event.event_id,
        EventRegistration.deleted_at.is_(None)
    ).order_by(EventRegistration.created_at.desc()).all()

    checkins = db.query(EventAttendanceCheckin).filter(
        EventAttendanceCheckin.event_id == event.event_id,
        EventAttendanceCheckin.deleted_at.is_(None)
    ).all()
    live = compute_live_event_stats(db, event)

    return {
        "event_id": str(event.event_id),
        "customer_id": event.customer_id or customer_id,
        "host_id": event.host_id or host_id,
        "settings": {
            "settings_id": str(settings.id) if settings else None,
            "registration_status": settings.registration_status if settings else "open",
            "registration_start_date": settings.registration_start_date.isoformat() if settings and settings.registration_start_date else None,
            "registration_end_date": settings.registration_end_date.isoformat() if settings and settings.registration_end_date else None,
            "max_capacity": settings.max_capacity if settings else 0,
            "allow_waitlist": bool(settings.allow_waitlist) if settings else False,
            "approval_required": bool(settings.approval_required) if settings else False,
            "registration_type": settings.registration_type if settings else "free",
            "auto_confirmation": bool(settings.auto_confirmation) if settings else True,
            "confirmation_email": bool(settings.confirmation_email) if settings else True,
            "cancellation_policy": settings.cancellation_policy if settings else None,
            "status": settings.status if settings else "active",
        },
        "tickets": [
            {
                "ticket_id": str(ticket.id),
                "ticket_name": ticket.ticket_name,
                "ticket_type": ticket.ticket_type or "standard",
                "price": ticket.price or 0.0,
                "quantity": ticket.quantity or 0,
                "available_seats": ticket.available_seats if ticket.available_seats is not None else (ticket.quantity or 0),
                "sales_start": ticket.sales_start.isoformat() if ticket.sales_start else None,
                "sales_end": ticket.sales_end.isoformat() if ticket.sales_end else None,
                "description": ticket.description or "",
                "status": ticket.status or "active",
            }
            for ticket in tickets
        ],
        "registrations": [
            {
                "registration_id": str(item.id),
                "attendee_name": item.attendee_name,
                "attendee_email": item.attendee_email,
                "attendee_phone": item.attendee_phone or "",
                "registration_number": item.registration_number or "",
                "status": item.status or "pending",
                "payment_status": item.payment_status or "pending",
                "checkin_status": item.checkin_status or "pending",
                "notes": item.notes or "",
                "created_at": item.created_at.isoformat() if item.created_at else None,
            }
            for item in registrations
        ],
        "summary": {
            "total_registrations": live.get("total_registrations", len(registrations)),
            "pending_registrations": sum(1 for item in registrations if item.status == "pending"),
            "confirmed_registrations": sum(1 for item in registrations if item.status == "confirmed"),
            "checked_in_count": live.get("checked_in", len(checkins)),
            "tickets_sold": live.get("tickets_sold", 0),
            "tickets_available": live.get("tickets_available", sum(ticket.quantity or 0 for ticket in tickets)),
        },
    }


@router.post("/registrations/settings")
def save_registration_settings(
    payload: SaveRegistrationSettingsRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Create or update registration settings for an event."""
    event, customer_id, host_id = resolve_or_create_event(db, payload.organizer_email, payload.event_id, current_user)
    email_clean = _bound_email(payload.organizer_email, current_user)

    settings = None
    if payload.settings_id:
        try:
            settings_uuid = uuid.UUID(payload.settings_id)
            settings = db.query(EventRegistrationSettings).filter(EventRegistrationSettings.id == settings_uuid).first()
        except ValueError:
            pass

    if not settings:
        settings = EventRegistrationSettings(
            id=uuid.uuid4(),
            event_id=event.event_id,
            customer_id=customer_id,
            host_id=host_id,
            created_by=email_clean,
        )
        db.add(settings)

    settings.customer_id = customer_id
    settings.host_id = host_id
    settings.created_by = email_clean
    if payload.registration_status is not None: settings.registration_status = payload.registration_status
    if payload.registration_start_date is not None:
        settings.registration_start_date = date.fromisoformat(payload.registration_start_date) if isinstance(payload.registration_start_date, str) and payload.registration_start_date else None
    if payload.registration_end_date is not None:
        settings.registration_end_date = date.fromisoformat(payload.registration_end_date) if isinstance(payload.registration_end_date, str) and payload.registration_end_date else None
    if payload.max_capacity is not None: settings.max_capacity = payload.max_capacity
    if payload.allow_waitlist is not None: settings.allow_waitlist = payload.allow_waitlist
    if payload.approval_required is not None: settings.approval_required = payload.approval_required
    if payload.registration_type is not None: settings.registration_type = payload.registration_type
    if payload.auto_confirmation is not None: settings.auto_confirmation = payload.auto_confirmation
    if payload.confirmation_email is not None: settings.confirmation_email = payload.confirmation_email
    if payload.cancellation_policy is not None: settings.cancellation_policy = payload.cancellation_policy
    if payload.status is not None: settings.status = payload.status
    settings.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(settings)

    return {"status": "success", "settings_id": str(settings.id), "message": "Registration settings saved"}


@router.post("/registrations/tickets")
def save_registration_ticket(
    payload: SaveRegistrationTicketRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Create or update a registration ticket for an event."""
    event, customer_id, host_id = resolve_or_create_event(db, payload.organizer_email, payload.event_id, current_user)
    email_clean = _bound_email(payload.organizer_email, current_user)

    ticket = None
    if payload.ticket_id:
        try:
            ticket_uuid = uuid.UUID(payload.ticket_id)
            ticket = db.query(EventRegistrationTicket).filter(EventRegistrationTicket.id == ticket_uuid).first()
        except ValueError:
            pass

    if not ticket:
        ticket = EventRegistrationTicket(
            id=uuid.uuid4(),
            event_id=event.event_id,
            customer_id=customer_id,
            host_id=host_id,
            created_by=email_clean,
        )
        db.add(ticket)

    ticket.customer_id = customer_id
    ticket.host_id = host_id
    ticket.created_by = email_clean
    if payload.settings_id is not None: ticket.settings_id = uuid.UUID(payload.settings_id) if payload.settings_id else None
    if payload.ticket_name is not None: ticket.ticket_name = payload.ticket_name
    if payload.ticket_type is not None: ticket.ticket_type = payload.ticket_type
    if payload.price is not None: ticket.price = payload.price
    if payload.quantity is not None: ticket.quantity = payload.quantity
    if payload.sales_start is not None:
        ticket.sales_start = date.fromisoformat(payload.sales_start) if isinstance(payload.sales_start, str) and payload.sales_start else None
    if payload.sales_end is not None:
        ticket.sales_end = date.fromisoformat(payload.sales_end) if isinstance(payload.sales_end, str) and payload.sales_end else None
    if payload.description is not None: ticket.description = payload.description
    if payload.available_seats is not None: ticket.available_seats = payload.available_seats
    if payload.status is not None: ticket.status = payload.status
    ticket.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(ticket)

    return {"status": "success", "ticket_id": str(ticket.id), "message": "Ticket saved"}


@router.delete("/registrations/tickets/{ticket_id}")
def delete_registration_ticket(ticket_id: str, db: Session = Depends(get_db)):
    """Soft-delete a registration ticket."""
    try:
        ticket_uuid = uuid.UUID(ticket_id)
        ticket = db.query(EventRegistrationTicket).filter(EventRegistrationTicket.id == ticket_uuid).first()
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")
        ticket.deleted_at = datetime.utcnow()
        ticket.status = "inactive"
        db.commit()
        return {"status": "success", "message": "Ticket removed"}
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid ticket UUID")


@router.get("/registrations/attendees")
def get_registration_attendees(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Retrieve attendee registration records."""
    event, _, _ = resolve_or_create_event(db, email, event_id, current_user, create_if_missing=False)
    if not event:
        return {"registrations": []}
    registrations = db.query(EventRegistration).filter(
        EventRegistration.event_id == event.event_id,
        EventRegistration.deleted_at.is_(None)
    ).order_by(EventRegistration.created_at.desc()).all()
    return {"registrations": [
        {
            "registration_id": str(item.id),
            "attendee_name": item.attendee_name,
            "attendee_email": item.attendee_email,
            "status": item.status or "pending",
            "payment_status": item.payment_status or "pending",
            "checkin_status": item.checkin_status or "pending",
            "registration_number": item.registration_number or "",
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }
        for item in registrations
    ]}


@router.post("/registrations/attendees")
def save_registration_attendee(
    payload: SaveRegistrationRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Create or update an attendee registration record."""
    event, customer_id, host_id = resolve_or_create_event(db, payload.organizer_email, payload.event_id, current_user)
    email_clean = _bound_email(payload.organizer_email, current_user)

    registration = None
    if payload.registration_id:
        try:
            reg_uuid = uuid.UUID(payload.registration_id)
            registration = db.query(EventRegistration).filter(EventRegistration.id == reg_uuid).first()
        except ValueError:
            pass

    if not registration:
        registration = EventRegistration(
            id=uuid.uuid4(),
            event_id=event.event_id,
            customer_id=customer_id,
            host_id=host_id,
            created_by=email_clean,
        )
        db.add(registration)

    registration.customer_id = customer_id
    registration.host_id = host_id
    registration.created_by = email_clean
    if payload.ticket_id is not None: registration.ticket_id = uuid.UUID(payload.ticket_id) if payload.ticket_id else None
    if payload.attendee_name is not None: registration.attendee_name = payload.attendee_name
    if payload.attendee_email is not None: registration.attendee_email = payload.attendee_email.lower().strip()
    if payload.attendee_phone is not None: registration.attendee_phone = payload.attendee_phone
    if payload.registration_number is not None: registration.registration_number = payload.registration_number
    if payload.status is not None: registration.status = payload.status
    if payload.payment_status is not None: registration.payment_status = payload.payment_status
    if payload.checkin_status is not None: registration.checkin_status = payload.checkin_status
    if payload.notes is not None: registration.notes = payload.notes
    if not registration.registration_number:
        registration.registration_number = f"REG-{int(datetime.utcnow().timestamp())}"
    registration.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(registration)

    return {"status": "success", "registration_id": str(registration.id), "message": "Registration saved"}


@router.post("/registrations/checkin")
def save_registration_checkin(
    payload: SaveCheckinRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Validate a ticket QR/code or attendee email and record a live check-in."""
    event, customer_id, host_id = resolve_or_create_event(
        db, payload.organizer_email, payload.event_id, current_user, create_if_missing=False
    )
    if not event:
        raise HTTPException(status_code=404, detail="No event found for this host.")

    email_clean = _bound_email(payload.organizer_email, current_user)
    scan_code = (payload.qr_token or payload.ticket_code or payload.attendee_email or "").strip()
    staff_name = payload.scanned_by or (current_user.full_name if current_user else None) or email_clean
    now_utc = datetime.utcnow()

    ticket = _find_event_ticket(db, event, scan_code)
    if ticket:
        status_now = (ticket.ticket_status or "").upper()
        booking = ticket.booking
        attendee_name = payload.attendee_name or (booking.receiver_name if booking else None) or "Guest"
        attendee_email = (
            payload.attendee_email
            if payload.attendee_email and "@" in payload.attendee_email
            else ((booking.receiver_email if booking else None) or None)
        )
        if status_now in _CANCELLED_STATUSES:
            stats = compute_live_event_stats(db, event)
            return {
                "status": "cancelled",
                "valid": False,
                "message": "This ticket has been cancelled.",
                "attendee_name": attendee_name,
                "attendee_email": attendee_email,
                **{k: stats[k] for k in ("checked_in", "yet_to_checkin", "tickets_sold", "total_registrations")},
            }
        if status_now in _CHECKED_IN_STATUSES:
            stats = compute_live_event_stats(db, event)
            when = ticket.used_at.strftime("%I:%M %p, %b %d") if ticket.used_at else "earlier"
            return {
                "status": "already_used",
                "valid": False,
                "already_checked_in": True,
                "message": f"Already checked in at {when}.",
                "attendee_name": attendee_name,
                "attendee_email": attendee_email,
                "used_at": ticket.used_at.isoformat() if ticket.used_at else None,
                **{k: stats[k] for k in ("checked_in", "yet_to_checkin", "tickets_sold", "total_registrations")},
            }

        ticket.ticket_status = "USED"
        ticket.used_at = now_utc
        ticket.scanned_by = staff_name

        existing_ci = None
        if attendee_email:
            existing_ci = db.query(EventAttendanceCheckin).filter(
                EventAttendanceCheckin.event_id == event.event_id,
                EventAttendanceCheckin.attendee_email == attendee_email.lower().strip(),
                EventAttendanceCheckin.deleted_at.is_(None),
            ).first()
        if not existing_ci:
            db.add(EventAttendanceCheckin(
                id=uuid.uuid4(),
                event_id=event.event_id,
                customer_id=customer_id,
                host_id=host_id,
                created_by=staff_name,
                attendee_name=attendee_name,
                attendee_email=(attendee_email or "").lower().strip() if attendee_email else None,
                scan_method=payload.scan_method or "manual",
                status="checked_in",
                notes=payload.notes or f"Ticket {ticket.ticket_id}",
            ))
        db.commit()
        stats = compute_live_event_stats(db, event)
        return {
            "status": "success",
            "valid": True,
            "message": f"{attendee_name} checked in successfully.",
            "attendee_name": attendee_name,
            "attendee_email": attendee_email,
            "ticket_id": str(ticket.ticket_id),
            "ticket_status": "USED",
            **{k: stats[k] for k in ("checked_in", "yet_to_checkin", "tickets_sold", "total_registrations")},
        }

    registration = None
    if payload.registration_id:
        try:
            reg_uuid = uuid.UUID(payload.registration_id)
            registration = db.query(EventRegistration).filter(EventRegistration.id == reg_uuid).first()
        except ValueError:
            pass
    lookup_email = payload.attendee_email if payload.attendee_email and "@" in payload.attendee_email else None
    if not registration and lookup_email:
        registration = db.query(EventRegistration).filter(
            EventRegistration.event_id == event.event_id,
            EventRegistration.attendee_email == lookup_email.lower().strip()
        ).order_by(EventRegistration.created_at.desc()).first()

    if not registration and not lookup_email:
        raise HTTPException(status_code=404, detail="Ticket code not found for this event.")

    if registration and (registration.checkin_status or "").lower() in ("checked_in", "used"):
        stats = compute_live_event_stats(db, event)
        return {
            "status": "already_used",
            "valid": False,
            "already_checked_in": True,
            "message": "This attendee is already checked in.",
            "attendee_name": registration.attendee_name,
            "attendee_email": registration.attendee_email,
            **{k: stats[k] for k in ("checked_in", "yet_to_checkin", "tickets_sold", "total_registrations")},
        }

    checkin = EventAttendanceCheckin(
        id=uuid.uuid4(),
        event_id=event.event_id,
        customer_id=customer_id,
        host_id=host_id,
        created_by=staff_name,
        registration_id=registration.id if registration else None,
        attendee_name=payload.attendee_name or (registration.attendee_name if registration else None),
        attendee_email=lookup_email or (registration.attendee_email if registration else None),
        scan_method=payload.scan_method or "manual",
        status=payload.status or "checked_in",
        notes=payload.notes,
    )
    db.add(checkin)
    if registration:
        registration.checkin_status = payload.status or "checked_in"
        registration.updated_at = now_utc
    db.commit()
    db.refresh(checkin)
    stats = compute_live_event_stats(db, event)
    name = checkin.attendee_name or scan_code
    return {
        "status": "success",
        "valid": True,
        "checkin_id": str(checkin.id),
        "message": f"{name} checked in successfully.",
        "attendee_name": checkin.attendee_name,
        "attendee_email": checkin.attendee_email,
        **{k: stats[k] for k in ("checked_in", "yet_to_checkin", "tickets_sold", "total_registrations")},
    }


@router.get("/attendance")
def get_event_attendance(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Checked-in vs yet-to-check-in attendees for the host sidebar Attendance tab."""
    event, customer_id, host_id = resolve_or_create_event(
        db, email, event_id, current_user, create_if_missing=False
    )
    if not event:
        return {
            "event_id": None,
            "customer_id": customer_id,
            "host_id": host_id,
            "checked_in": 0,
            "yet_to_checkin": 0,
            "tickets_sold": 0,
            "total_registrations": 0,
            "attendees": [],
        }
    stats = compute_live_event_stats(db, event)
    return {
        "event_id": str(event.event_id),
        "event_title": event.event_title,
        "customer_id": event.customer_id or customer_id,
        "host_id": event.host_id or host_id,
        **stats,
    }


# ── Communication Endpoints ────────────────────────────────────────────────
def _ticket_holder_counts(db: Session, event_mgt: EventManagement) -> Tuple[Dict[str, Dict[str, Any]], int]:
    """Group sold ticket holders by ticket type — active tickets/bookings only."""
    tickets = _tickets_for_event(db, event_mgt)
    active_tickets = [
        t for t in tickets
        if (t.ticket_status or "").upper() not in _CANCELLED_STATUSES
    ]
    counts: Dict[str, Dict[str, Any]] = {}
    for ticket in active_tickets:
        label = (ticket.ticket_type or "Standard Access").strip() or "Standard Access"
        key = label.lower()
        if key not in counts:
            counts[key] = {"label": label, "count": 0}
        counts[key]["count"] += 1

    if active_tickets:
        return counts, len(active_tickets)

    from Models.booking import Booking

    public_ids = _event_public_ids(db, event_mgt)
    booking_clauses = []
    for eid in public_ids:
        booking_clauses.extend(_guid_equals_clauses(Booking.event_id, eid))
    active_bookings = []
    if booking_clauses:
        try:
            booking_rows = db.query(Booking).filter(or_(*booking_clauses)).all()
        except Exception:
            db.rollback()
            booking_rows = []
        active_bookings = [
            b for b in booking_rows
            if (b.status or "").upper() not in _CANCELLED_STATUSES
        ]
    for booking in active_bookings:
        label = (booking.ticket_type or "Standard Access").strip() or "Standard Access"
        key = label.lower()
        qty = max(1, int(booking.quantity or 1))
        if key not in counts:
            counts[key] = {"label": label, "count": 0}
        counts[key]["count"] += qty
    total = sum(max(1, int(b.quantity or 1)) for b in active_bookings)
    return counts, total


def _count_for_ticket_label(counts: Dict[str, Dict[str, Any]], *labels: Optional[str]) -> int:
    for label in labels:
        if not label:
            continue
        entry = counts.get(label.strip().lower())
        if entry:
            return int(entry.get("count") or 0)
    return 0


def _communication_audience_options(db: Session, event_mgt: EventManagement) -> List[Dict[str, Any]]:
    """Build communicate-tab audience choices from configured ticket tiers and live sales."""
    import json

    counts, total_sold = _ticket_holder_counts(db, event_mgt)
    catalog: List[Dict[str, Any]] = []
    seen_values = set()

    reg_tickets = (
        db.query(EventRegistrationTicket)
        .filter(
            EventRegistrationTicket.event_id == event_mgt.event_id,
            EventRegistrationTicket.deleted_at.is_(None),
        )
        .order_by(EventRegistrationTicket.created_at.asc())
        .all()
    )
    for ticket in reg_tickets:
        label = (ticket.ticket_name or ticket.ticket_type or "Ticket").strip()
        value = f"ticket:{ticket.id}"
        if value in seen_values:
            continue
        seen_values.add(value)
        holder_count = _count_for_ticket_label(counts, ticket.ticket_name, ticket.ticket_type, label)
        catalog.append({
            "value": value,
            "label": label,
            "count": holder_count,
            "ticket_id": str(ticket.id),
            "ticket_type": ticket.ticket_type or label,
        })

    if not catalog:
        raw_tickets = event_mgt.tickets_json
        if isinstance(raw_tickets, str):
            try:
                raw_tickets = json.loads(raw_tickets)
            except Exception:
                raw_tickets = []
        if isinstance(raw_tickets, list):
            for idx, item in enumerate(raw_tickets):
                if not isinstance(item, dict):
                    continue
                label = (item.get("name") or item.get("ticket_name") or item.get("type") or "").strip()
                if not label:
                    continue
                value = f"ticket_type:{label.lower().replace(' ', '_')}"
                if value in seen_values:
                    continue
                seen_values.add(value)
                catalog.append({
                    "value": value,
                    "label": label,
                    "count": _count_for_ticket_label(counts, label),
                    "ticket_type": label,
                })

    if not catalog:
        for key, info in counts.items():
            value = f"ticket_type:{key.replace(' ', '_')}"
            if value in seen_values:
                continue
            seen_values.add(value)
            catalog.append({
                "value": value,
                "label": info["label"],
                "count": int(info.get("count") or 0),
                "ticket_type": info["label"],
            })

    total = total_sold if total_sold else sum(int(opt.get("count") or 0) for opt in catalog)
    options = [{
        "value": "all_tickets",
        "label": "All Ticket Holders",
        "count": total,
    }]
    options.extend(catalog)
    return options


@router.get("/communications")
def get_communications(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Return saved communications and ticket-based audience options for the organizer's event."""
    event, _, _ = resolve_or_create_event(db, email, event_id, current_user, create_if_missing=False)
    if not event:
        return {"communications": [], "audience_options": []}
    items = db.query(EventCommunication).filter(
        EventCommunication.event_id == event.event_id,
        EventCommunication.deleted_at.is_(None)
    ).order_by(EventCommunication.created_at.desc()).all()
    audience_options = _communication_audience_options(db, event)

    return {
        "communications": [
            {
                "communication_id": str(item.id),
                "audience": item.audience or "all_tickets",
                "channel": item.channel or "email",
                "subject": item.subject or "",
                "message": item.message or "",
                "status": item.status or "scheduled",
                "delivery_status": item.delivery_status or "pending",
                "created_at": item.created_at.isoformat() if item.created_at else None,
            }
            for item in items
        ],
        "audience_options": audience_options,
    }


@router.post("/communications")
def save_communication(
    payload: SaveCommunicationRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Create or update a communication message."""
    event, customer_id, host_id = resolve_or_create_event(db, payload.organizer_email, payload.event_id, current_user)
    email_clean = _bound_email(payload.organizer_email, current_user)

    communication = None
    if payload.communication_id:
        try:
            comm_uuid = uuid.UUID(payload.communication_id)
            communication = db.query(EventCommunication).filter(EventCommunication.id == comm_uuid).first()
        except ValueError:
            pass

    if not communication:
        communication = EventCommunication(
            id=uuid.uuid4(),
            event_id=event.event_id,
            customer_id=customer_id,
            host_id=host_id,
            created_by=email_clean,
        )
        db.add(communication)

    communication.customer_id = customer_id
    communication.host_id = host_id
    communication.created_by = email_clean
    if payload.audience is not None: communication.audience = payload.audience
    if payload.channel is not None: communication.channel = payload.channel
    if payload.subject is not None: communication.subject = payload.subject
    if payload.message is not None: communication.message = payload.message
    if payload.attachment_url is not None: communication.attachment_url = payload.attachment_url
    if payload.schedule_date is not None:
        communication.schedule_date = date.fromisoformat(payload.schedule_date) if isinstance(payload.schedule_date, str) and payload.schedule_date else None
    if payload.schedule_time is not None: communication.schedule_time = payload.schedule_time
    if payload.status is not None: communication.status = payload.status
    if payload.delivery_status is not None: communication.delivery_status = payload.delivery_status
    communication.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(communication)

    return {"status": "success", "communication_id": str(communication.id), "message": "Communication saved"}


def _city_from_form_answers(answers: Any) -> str:
    if not isinstance(answers, dict):
        return ""
    for key, value in answers.items():
        label = str(key or "").strip().lower()
        if label in {"city", "town", "location", "city / town"} or label.endswith(" city") or label == "city/town":
            text = " ".join(str(value or "").replace(",", " ").split())
            if text:
                return text.title()
    return ""


def _audience_top_cities(db: Session, event_mgt: EventManagement) -> List[Dict[str, Any]]:
    """Unique attendees grouped by city from form answers and user profiles."""
    from Models.user import User
    from Models.booking import Booking
    from sqlalchemy import or_, func

    people: Dict[str, str] = {}

    def remember(email: Optional[str], city: str = ""):
        key = (email or "").lower().strip()
        if not key:
            return
        current = people.get(key, "")
        if city and (not current or current == "Location not shared"):
            people[key] = city
        elif key not in people:
            people[key] = city or "Location not shared"

    submissions = _form_submissions_for_event(db, event_mgt)
    emails = set()
    customer_ids = set()
    for row in submissions:
        city = _city_from_form_answers(row.answers_json)
        remember(row.user_email, city)
        if row.user_email:
            emails.add(row.user_email.lower().strip())
        if row.customer_id:
            customer_ids.add(row.customer_id)

    public_ids = _event_public_ids(db, event_mgt)
    booking_clauses = []
    for eid in public_ids:
        booking_clauses.extend(_guid_equals_clauses(Booking.event_id, eid))
    bookings = []
    if booking_clauses:
        try:
            bookings = db.query(Booking).filter(or_(*booking_clauses)).all()
        except Exception:
            db.rollback()
            bookings = []
    for booking in bookings:
        if (booking.status or "").upper() in _CANCELLED_STATUSES:
            continue
        remember(booking.receiver_email)
        if booking.receiver_email:
            emails.add(booking.receiver_email.lower().strip())
        if booking.customer_id:
            customer_ids.add(booking.customer_id)

    user_filters = []
    if emails:
        user_filters.append(func.lower(User.email).in_(list(emails)))
    if customer_ids:
        user_filters.append(User.customer_id.in_(list(customer_ids)))
    users = []
    if user_filters:
        try:
            users = db.query(User).filter(or_(*user_filters)).all()
        except Exception:
            db.rollback()
            users = []
    city_by_email = {}
    city_by_customer = {}
    for user in users:
        city = " ".join(str(user.city or "").split()).title()
        if not city:
            continue
        if user.email:
            city_by_email[user.email.lower().strip()] = city
        if user.customer_id:
            city_by_customer[user.customer_id] = city

    for email, city in list(people.items()):
        if city and city != "Location not shared":
            continue
        people[email] = city_by_email.get(email) or city or "Location not shared"

    for booking in bookings:
        if (booking.status or "").upper() in _CANCELLED_STATUSES:
            continue
        email = (booking.receiver_email or "").lower().strip()
        if not email:
            continue
        if people.get(email) and people[email] != "Location not shared":
            continue
        people[email] = city_by_customer.get(booking.customer_id) or city_by_email.get(email) or people.get(email) or "Location not shared"

    counts: Dict[str, int] = {}
    for city in people.values():
        label = city or "Location not shared"
        counts[label] = counts.get(label, 0) + 1
    total = sum(counts.values()) or 1
    ranked = sorted(counts.items(), key=lambda item: (-item[1], item[0]))
    named = [(name, count) for name, count in ranked if name != "Location not shared"]
    unknown = counts.get("Location not shared", 0)

    rows = []
    other_count = 0
    for index, (name, count) in enumerate(named):
        if index < 3:
            rows.append({
                "city": name,
                "count": count,
                "percent": round(count * 100 / total),
            })
        else:
            other_count += count
    other_count += unknown
    if other_count and rows:
        rows.append({
            "city": "Other Locations",
            "count": other_count,
            "percent": round(other_count * 100 / total),
        })
    elif other_count and not rows:
        rows.append({
            "city": "Location not shared",
            "count": other_count,
            "percent": 100,
        })
    return rows


# ── Reports Endpoint ───────────────────────────────────────────────────────
@router.get("/reports")
def get_reports_summary(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Return financial and engagement metrics for the reports tab."""
    event, _, _ = resolve_or_create_event(db, email, event_id, current_user, create_if_missing=False)
    if not event:
        return {
            "event_title": None,
            "gross_revenue": 0,
            "platform_fee": 0,
            "gst_fee": 0,
            "net_earnings": 0,
            "platform_fee_pct": 5,
            "gst_fee_pct": 5,
            "attendance_rate": 0,
            "conversion_rate": 0,
            "registrations_count": 0,
            "tickets_sold": 0,
            "ticket_capacity": 0,
            "checkins_count": 0,
            "communications_count": 0,
            "exhibitors_count": 0,
            "top_cities": [],
        }

    tickets = db.query(EventRegistrationTicket).filter(
        EventRegistrationTicket.event_id == event.event_id,
        EventRegistrationTicket.deleted_at.is_(None)
    ).all()
    communications = db.query(EventCommunication).filter(
        EventCommunication.event_id == event.event_id,
        EventCommunication.deleted_at.is_(None)
    ).all()
    exhibitors = db.query(Exhibitor).filter(
        Exhibitor.event_id == event.event_id,
        Exhibitor.deleted_at.is_(None)
    ).all()

    live = compute_live_event_stats(db, event)
    sold = live["tickets_sold"] or 0
    checked = live["checked_in"] or 0
    capacity = live["ticket_capacity"] or sum(ticket.quantity or 0 for ticket in tickets)
    gross_revenue = round(float(live["total_sales"] or 0), 2)
    platform_fee_pct = 5
    gst_fee_pct = 5
    platform_fee = round(gross_revenue * platform_fee_pct / 100, 2)
    gst_fee = round(gross_revenue * gst_fee_pct / 100, 2)
    net_earnings = round(gross_revenue - platform_fee - gst_fee, 2)
    attendance_rate = round((checked / sold * 100) if sold else 0.0, 1)
    conversion_rate = round((sold / max(capacity, 1) * 100), 1)

    return {
        "event_title": event.event_title,
        "gross_revenue": gross_revenue,
        "platform_fee": platform_fee,
        "gst_fee": gst_fee,
        "net_earnings": net_earnings,
        "platform_fee_pct": platform_fee_pct,
        "gst_fee_pct": gst_fee_pct,
        "attendance_rate": attendance_rate,
        "conversion_rate": conversion_rate,
        "registrations_count": live["total_registrations"],
        "tickets_sold": sold,
        "ticket_capacity": capacity,
        "checkins_count": checked,
        "communications_count": len(communications),
        "exhibitors_count": len(exhibitors),
        "top_cities": _audience_top_cities(db, event),
    }


# ── Dashboard Dynamic Statistics Endpoint ────────────────────────────────────
@router.get("/dashboard")
def get_dashboard_summary(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None, description="Optional specific event ID"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Returns dynamic KPI metrics, counts, and stats for the selected event."""
    email_clean = _bound_email(email, current_user)
    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)

    event = None
    if event_id:
        try:
            event_uuid = uuid.UUID(event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
        except ValueError:
            pass

    if not event:
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        return {
            "has_event": False,
            "customer_id": customer_id,
            "host_id": host_id,
            "total_sales": 0.0,
            "total_registrations": 0,
            "pending_registrations": 0,
            "days_to_event": 0,
            "tickets_sold": 0,
            "tickets_available": 0,
            "checked_in": 0,
            "yet_to_checkin": 0,
            "speakers_count": 0,
            "sponsors_count": 0,
            "exhibitors_count": 0,
            "registration_trend": []
        }

    # Calculate days to event start
    days_left = 0
    if event.event_start_date:
        delta = event.event_start_date - datetime.utcnow()
        days_left = max(0, delta.days)

    # Speakers & Sponsors count from EventDesign
    design = db.query(EventDesign).filter(EventDesign.event_id == event.event_id).first()
    speakers_count = len(design.speaker_details) if (design and design.speaker_details) else 0
    sponsors_count = len(design.sponsor_details) if (design and design.sponsor_details) else 0

    # Exhibitors count from Exhibitor table
    exhibitors_list = db.query(Exhibitor).filter(Exhibitor.event_id == event.event_id).all()
    exhibitors_count = len(exhibitors_list)
    exhibitors_confirmed = sum(1 for e in exhibitors_list if e.status == "confirmed")
    exhibitors_pending = sum(1 for e in exhibitors_list if e.status == "pending")

    try:
        live = compute_live_event_stats(db, event)
    except Exception:
        db.rollback()
        live = {
            "total_sales": 0.0,
            "total_registrations": 0,
            "pending_registrations": 0,
            "tickets_sold": 0,
            "tickets_available": 0,
            "ticket_capacity": 0,
            "checked_in": 0,
            "yet_to_checkin": 0,
            "attendees_count": 0,
            "attendees": [],
            "registration_trend": [],
        }

    banner_image = design.banner_image if design else None
    from Models.event import Event
    public_event = db.query(Event).filter(Event.id == event.event_id).first()
    preview_image = banner_image or (public_event.image_url if public_event else None) or "images/hero-event.jpg"

    return {
        "has_event": True,
        "event_id": str(event.event_id),
        "event_title": event.event_title,
        "event_status": event.event_status,
        "customer_id": event.customer_id or customer_id,
        "host_id": event.host_id or host_id,
        "banner_image": preview_image,
        "image_url": preview_image,
        "total_sales": live["total_sales"],
        "total_registrations": live["total_registrations"],
        "pending_registrations": live.get("pending_registrations", 0),
        "days_to_event": days_left,
        "tickets_sold": live["tickets_sold"],
        "tickets_available": live["tickets_available"],
        "ticket_capacity": live["ticket_capacity"],
        "checked_in": live["checked_in"],
        "yet_to_checkin": live["yet_to_checkin"],
        "attendees_count": live["attendees_count"],
        "attendees": live.get("attendees") or [],
        "speakers_count": speakers_count,
        "sponsors_count": sponsors_count,
        "exhibitors_count": exhibitors_count,
        "exhibitors_confirmed": exhibitors_confirmed,
        "exhibitors_pending": exhibitors_pending,
        "event_start_date": event.event_start_date.isoformat() if event.event_start_date else None,
        "venue": event.venue or "Venue TBD",
        "registration_trend": live.get("registration_trend") or [],
    }


# ── Exhibitors CRUD Endpoints ────────────────────────────────────────────────
@router.get("/exhibitors")
def get_exhibitors(
    email: str = Query(..., description="Organizer email"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Retrieve all exhibitors for an event."""
    email_clean = _bound_email(email, current_user)
    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)

    event = None
    if event_id:
        try:
            event_uuid = uuid.UUID(event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
        except ValueError:
            pass

    if not event:
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        return {"exhibitors": [], "total": 0, "confirmed": 0, "pending": 0}

    exhibitors = db.query(Exhibitor).filter(Exhibitor.event_id == event.event_id).order_by(Exhibitor.created_at.desc()).all()
    confirmed = sum(1 for e in exhibitors if e.status == "confirmed")
    pending = sum(1 for e in exhibitors if e.status == "pending")

    return {
        "event_id": str(event.event_id),
        "total": len(exhibitors),
        "confirmed": confirmed,
        "pending": pending,
        "exhibitors": [
            {
                "exhibitor_id": str(e.exhibitor_id),
                "company_name": e.company_name,
                "contact_name": e.contact_name or "N/A",
                "contact_email": e.contact_email or "",
                "contact_phone": e.contact_phone or "",
                "category": e.category or "General",
                "package": e.package or "Standard",
                "status": e.status or "pending",
                "notes": e.notes or "",
                "created_at": e.created_at.isoformat() if e.created_at else None
            }
            for e in exhibitors
        ]
    }


@router.post("/exhibitors")
def create_or_update_exhibitor(
    payload: SaveExhibitorRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Create or update an exhibitor record."""
    email_clean = _bound_email(payload.organizer_email, current_user)
    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)

    event = None
    if payload.event_id:
        try:
            event_uuid = uuid.UUID(payload.event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
        except ValueError:
            pass

    if not event:
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        event = EventManagement(
            event_id=uuid.uuid4(),
            organizer_email=email_clean,
            customer_id=customer_id,
            host_id=host_id,
            event_title="My New Event"
        )
        db.add(event)
        db.commit()
        db.refresh(event)

    exhibitor = None
    if payload.exhibitor_id:
        try:
            ex_uuid = uuid.UUID(payload.exhibitor_id)
            exhibitor = db.query(Exhibitor).filter(Exhibitor.exhibitor_id == ex_uuid).first()
        except ValueError:
            pass

    if not exhibitor:
        exhibitor = Exhibitor(
            exhibitor_id=uuid.uuid4(),
            event_id=event.event_id,
            customer_id=customer_id,
            host_id=host_id,
            company_name=payload.company_name
        )
        db.add(exhibitor)

    exhibitor.company_name = payload.company_name
    if payload.contact_name is not None: exhibitor.contact_name = payload.contact_name
    if payload.contact_email is not None: exhibitor.contact_email = payload.contact_email
    if payload.contact_phone is not None: exhibitor.contact_phone = payload.contact_phone
    if payload.category is not None: exhibitor.category = payload.category
    if payload.package is not None: exhibitor.package = payload.package
    if payload.notes is not None: exhibitor.notes = payload.notes
    if payload.status is not None: exhibitor.status = payload.status
    exhibitor.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(exhibitor)

    return {
        "status": "success",
        "message": "Exhibitor saved successfully",
        "exhibitor_id": str(exhibitor.exhibitor_id),
        "company_name": exhibitor.company_name
    }


@router.delete("/exhibitors/{exhibitor_id}")
def delete_exhibitor(
    exhibitor_id: str,
    db: Session = Depends(get_db)
):
    """Delete an exhibitor record."""
    try:
        ex_uuid = uuid.UUID(exhibitor_id)
        exhibitor = db.query(Exhibitor).filter(Exhibitor.exhibitor_id == ex_uuid).first()
        if not exhibitor:
            raise HTTPException(status_code=404, detail="Exhibitor not found")
        db.delete(exhibitor)
        db.commit()
        return {"status": "success", "message": "Exhibitor deleted"}
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid exhibitor_id UUID format")


@router.delete("/clear")
def clear_host_events(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None, description="Optional event id to cancel"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Cancel the host event, hide it from public pages, then clear host dashboard data."""
    email_clean = _bound_email(email, current_user)
    if not current_user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required to cancel an event.",
        )
    if (current_user.email or "").lower().strip() != email_clean:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only cancel events for your own organizer account.",
        )

    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)
    query = _host_events_query(db, email_clean, customer_id, host_id)
    if event_id:
        try:
            event_uuid = uuid.UUID(str(event_id))
            query = query.filter(EventManagement.event_id == event_uuid)
        except (ValueError, TypeError):
            pass
    events = query.all()
    if event_id and not events:
        events = _host_events_query(db, email_clean, customer_id, host_id).all()
    cancelled_ids = [ev.event_id for ev in events]

    for ev in events:
        ev.event_status = "cancelled"
        ev.updated_at = datetime.utcnow()

    hidden = hide_public_catalog_events(
        db,
        event_ids=cancelled_ids,
        customer_id=customer_id,
        host_id=host_id,
        cancel=True,
    )

    try:
        from Models.form_definitions import FormDefinition
        for eid in cancelled_ids:
            db.query(FormDefinition).filter(
                or_(FormDefinition.event_id == str(eid), FormDefinition.event_id == eid)
            ).update({"is_published": False}, synchronize_session=False)
    except Exception:
        pass

    db.commit()

    try:
        for ev in events:
            db.delete(ev)
        db.commit()
    except Exception as exc:
        db.rollback()
        print(f"[EVENT CANCEL] host row delete skipped: {exc}", flush=True)

    print(
        f"[EVENT CANCEL] email={email_clean} cancelled={len(cancelled_ids)} "
        f"public_hidden={hidden} ids={[str(i) for i in cancelled_ids]}",
        flush=True,
    )
    return {
        "status": "success",
        "message": "Event cancelled and removed from Home, Category, and Event Details.",
        "cancelled_event_ids": [str(i) for i in cancelled_ids],
        "public_hidden": hidden,
    }


# ── Gates Endpoints ───────────────────────────────────────────────────────────

@router.get("/gates")
def get_gates(
    organizer_email: str,
    event_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Retrieve all gates for an event."""
    email_clean = _bound_email(organizer_email, current_user)
    event = None
    if event_id:
        try:
            event_uuid = uuid.UUID(event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
        except ValueError:
            pass
    if not event:
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        return {"event_id": None, "gates": []}

    gates = db.query(EventEntryGate).filter(EventEntryGate.event_id == event.event_id).order_by(EventEntryGate.created_at.asc()).all()
    return {
        "event_id": str(event.event_id),
        "gates": [
            {
                "gate_id": str(g.gate_id),
                "gate_name": g.gate_name,
                "gate_code": g.gate_code or "",
                "gate_description": g.gate_description or "",
                "status": g.status or "Active"
            }
            for g in gates
        ]
    }


@router.post("/gates")
def save_gate(
    payload: SaveGateRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Create or update an entry gate."""
    email_clean = _bound_email(payload.organizer_email, current_user)
    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)

    event = None
    if payload.event_id:
        try:
            event_uuid = uuid.UUID(payload.event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
        except ValueError:
            pass
    if not event:
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        event = EventManagement(
            event_id=uuid.uuid4(),
            organizer_email=email_clean,
            customer_id=customer_id,
            host_id=host_id,
            event_title="My New Event"
        )
        db.add(event)
        db.commit()
        db.refresh(event)

    # Check for duplicate gate name within same event
    existing_gate = db.query(EventEntryGate).filter(
        EventEntryGate.event_id == event.event_id,
        EventEntryGate.gate_name == payload.gate_name.strip()
    ).first()

    gate = None
    if payload.gate_id:
        try:
            g_uuid = uuid.UUID(payload.gate_id)
            gate = db.query(EventEntryGate).filter(EventEntryGate.gate_id == g_uuid).first()
        except ValueError:
            pass

    if gate:
        # If updating, make sure new name doesn't conflict with another gate
        if existing_gate and existing_gate.gate_id != gate.gate_id:
            raise HTTPException(status_code=400, detail="A gate with this name already exists for this event.")
        gate.gate_name = payload.gate_name.strip()
        if payload.gate_code is not None: gate.gate_code = payload.gate_code
        if payload.gate_description is not None: gate.gate_description = payload.gate_description
        if payload.status is not None: gate.status = payload.status
        gate.updated_at = datetime.utcnow()
    else:
        # If creating new
        if existing_gate:
            raise HTTPException(status_code=400, detail="A gate with this name already exists for this event.")
        gate = EventEntryGate(
            gate_id=uuid.uuid4(),
            event_id=event.event_id,
            gate_name=payload.gate_name.strip(),
            gate_code=payload.gate_code,
            gate_description=payload.gate_description,
            status=payload.status or "Active"
        )
        db.add(gate)

    db.commit()
    db.refresh(gate)

    return {
        "status": "success",
        "message": "Gate saved successfully",
        "gate_id": str(gate.gate_id),
        "gate_name": gate.gate_name
    }


@router.delete("/gates/{gate_id}")
def delete_gate(
    gate_id: str,
    db: Session = Depends(get_db)
):
    """Delete a gate if not assigned to any scanners."""
    try:
        g_uuid = uuid.UUID(gate_id)
        gate = db.query(EventEntryGate).filter(EventEntryGate.gate_id == g_uuid).first()
        if not gate:
            raise HTTPException(status_code=404, detail="Gate not found")

        # Check if any staff/scanners are assigned to this gate
        assigned_scanners = db.query(EventStaffScanner).filter(EventStaffScanner.gate_id == g_uuid).first()
        if assigned_scanners:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete gate. It is currently assigned to volunteer '{assigned_scanners.name}'."
            )

        assigned_volunteers = db.query(EventVolunteer).filter(
            EventVolunteer.gate_id == g_uuid,
            EventVolunteer.status.in_(("PENDING", "ACTIVE")),
        ).first()
        if assigned_volunteers:
            raise HTTPException(
                status_code=400,
                detail=f"Cannot delete gate. It is currently assigned to volunteer '{assigned_volunteers.volunteer_name}'."
            )

        db.delete(gate)
        db.commit()
        return {"status": "success", "message": "Gate deleted successfully"}
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid gate_id UUID format")


# ── Staff Scanners Endpoints ─────────────────────────────────────────────────

@router.get("/scanners")
def get_scanners(
    organizer_email: str,
    event_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Retrieve all volunteer scanners for an event."""
    email_clean = _bound_email(organizer_email, current_user)
    event = None
    if event_id:
        try:
            event_uuid = uuid.UUID(event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
        except ValueError:
            pass
    if not event:
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        return {"event_id": None, "scanners": []}

    scanners = db.query(EventStaffScanner).filter(EventStaffScanner.event_id == event.event_id).order_by(EventStaffScanner.created_at.desc()).all()
    return {
        "event_id": str(event.event_id),
        "scanners": [
            {
                "scanner_id": str(s.scanner_id),
                "name": s.name,
                "gate_id": str(s.gate_id),
                "gate_name": s.gate.gate_name if s.gate else "Unknown Gate",
                "passcode": s.passcode,
                "status": s.status or "Live Scanning",
                "scans_processed": s.scans_processed or 0
            }
            for s in scanners
        ]
    }


@router.post("/scanners")
def save_scanner(
    payload: SaveScannerRequest,
    db: Session = Depends(get_db)
):
    """Create or update a volunteer scanner."""
    email_clean = _bound_email(payload.organizer_email, current_user)
    event = None
    if payload.event_id:
        try:
            event_uuid = uuid.UUID(payload.event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
        except ValueError:
            pass
    if not event:
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        raise HTTPException(status_code=404, detail="No active event found to attach scanner to")

    try:
        g_uuid = uuid.UUID(payload.gate_id)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid gate_id UUID format")

    gate = db.query(EventEntryGate).filter(EventEntryGate.gate_id == g_uuid).first()
    if not gate:
        raise HTTPException(status_code=404, detail="Assigned entry gate not found")

    scanner = None
    if payload.scanner_id:
        try:
            s_uuid = uuid.UUID(payload.scanner_id)
            scanner = db.query(EventStaffScanner).filter(EventStaffScanner.scanner_id == s_uuid).first()
        except ValueError:
            pass

    if scanner:
        scanner.name = payload.name
        scanner.gate_id = g_uuid
        scanner.passcode = payload.passcode
        if payload.status: scanner.status = payload.status
        scanner.updated_at = datetime.utcnow()
    else:
        scanner = EventStaffScanner(
            scanner_id=uuid.uuid4(),
            event_id=event.event_id,
            name=payload.name,
            gate_id=g_uuid,
            passcode=payload.passcode,
            status=payload.status or "Live Scanning",
            scans_processed=payload.scans_processed or 0
        )
        db.add(scanner)

    db.commit()
    db.refresh(scanner)

    return {
        "status": "success",
        "scanner_id": str(scanner.scanner_id),
        "name": scanner.name,
        "gate_name": gate.gate_name
    }


@router.delete("/scanners/{scanner_id}")
def delete_scanner(
    scanner_id: str,
    db: Session = Depends(get_db)
):
    """Revoke a volunteer scanner's access."""
    try:
        s_uuid = uuid.UUID(scanner_id)
        scanner = db.query(EventStaffScanner).filter(EventStaffScanner.scanner_id == s_uuid).first()
        if not scanner:
            raise HTTPException(status_code=404, detail="Scanner not found")
        db.delete(scanner)
        db.commit()
        return {"status": "success", "message": "Scanner revoked successfully"}
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid scanner_id UUID format")



