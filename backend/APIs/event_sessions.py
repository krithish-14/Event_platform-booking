"""
Event Schedule & Session Management API.

Mounted at /api/events (see FastAPI/main.py):
  GET/PUT/POST  /{event_id}/sessions
  GET/PUT/DELETE /{event_id}/sessions/{session_id}
  GET/POST      /{event_id}/sessions/{session_id}/registrations
  POST          /{event_id}/sessions/{session_id}/check-in
  GET           /{event_id}/sessions/{session_id}/attendance  (?format=csv)
  GET           /{event_id}/attendees/{attendee_id}/attendance

{event_id} is the host event id (event_management.event_id) used everywhere in the host dashboard.
"""

from __future__ import annotations

import csv
import io
from datetime import datetime
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.event_management import EventManagement
from Models.event_session import EventSession, EventSessionCheckin, EventSessionRegistration
from Models.event_volunteer import EventVolunteer
from Models.user import User
from Services import event_sessions as svc

router = APIRouter()


class SessionIn(BaseModel):
    session_id: Optional[str] = None
    session_name: Optional[str] = None
    session_description: Optional[str] = None
    session_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    ends_next_day: Optional[bool] = None
    venue_name: Optional[str] = None
    venue_address: Optional[str] = None
    venue_lat: Optional[Any] = None
    venue_lng: Optional[Any] = None
    venue_place_id: Optional[str] = None
    capacity: Optional[Any] = None
    eligibility_mode: Optional[str] = None
    eligible_ticket_types: Optional[List[str]] = None
    status: Optional[str] = None


class SessionsBulkIn(BaseModel):
    structure: str = Field("multiple", description="single | multiple")
    sessions: List[SessionIn] = Field(default_factory=list)


class RegistrationsIn(BaseModel):
    ticket_ids: List[str] = Field(default_factory=list)
    action: str = "register"


class SessionCheckinIn(BaseModel):
    qr_token: Optional[str] = None
    token: Optional[str] = None
    method: Optional[str] = "QR"


# ── Access control ────────────────────────────────────────────────────────────
def _load_event(db: Session, event_id: str) -> EventManagement:
    from APIs.host_events_api import _lookup_event_by_id

    event = _lookup_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    return event


def _is_host(event: EventManagement, user: User) -> bool:
    from APIs.host_events_api import _event_owned

    if getattr(user, "is_admin", False):
        return True
    email = (user.email or "").lower().strip()
    return _event_owned(event, email, user.customer_id, None, user)


def _host_event(db: Session, event_id: str, user: User) -> EventManagement:
    event = _load_event(db, event_id)
    if not _is_host(event, user):
        raise HTTPException(status_code=403, detail="You do not own this event.")
    return event


def _volunteer_for(db: Session, event: EventManagement, user: User) -> Optional[EventVolunteer]:
    email = (user.email or "").lower().strip()
    rows = (
        db.query(EventVolunteer)
        .filter(EventVolunteer.event_id == event.event_id, EventVolunteer.status == "ACTIVE")
        .all()
    )
    for row in rows:
        if (row.customer_id and row.customer_id == user.customer_id) or (row.invited_email or "").lower() == email:
            return row
    return None


def _session_or_404(db: Session, event: EventManagement, session_id: str, *, include_deleted: bool = False) -> EventSession:
    rows = svc.event_sessions(db, event.event_id, include_deleted=include_deleted)
    match = next((s for s in rows if svc._compact(s.session_id) == svc._compact(session_id)), None)
    if not match:
        raise HTTPException(status_code=404, detail="Session not found for this event.")
    return match


def _validation_422(err: svc.SessionValidationError, index: Optional[int] = None):
    detail = {"message": "Please fix the highlighted session fields.", "errors": err.errors}
    if index is not None:
        detail["index"] = index
    raise HTTPException(status_code=422, detail=detail)


def _actor_name(user: User) -> str:
    return (user.full_name or user.username or user.email or "Host").strip()


def _apply(row: EventSession, clean: dict) -> None:
    for key, value in clean.items():
        setattr(row, key, value)
    row.updated_at = datetime.utcnow()


def _ticket_type_names(event: EventManagement) -> List[str]:
    names: List[str] = []
    for offer in event.tickets_json or []:
        if isinstance(offer, dict):
            label = str(offer.get("name") or offer.get("ticket_name") or "").strip()
            if label and label not in names:
                names.append(label)
    return names


# ── Sessions CRUD ─────────────────────────────────────────────────────────────
@router.get("/{event_id}/sessions")
def list_sessions(
    event_id: str,
    include_deleted: bool = False,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _load_event(db, event_id)
    if _is_host(event, current_user):
        sessions = svc.event_sessions(db, event.event_id, include_deleted=include_deleted)
        body = svc.sessions_overview(db, event, sessions)
        body["ticket_types"] = _ticket_type_names(event)
        body["role"] = "host"
        return body
    volunteer = _volunteer_for(db, event, current_user)
    if not volunteer:
        raise HTTPException(status_code=403, detail="You do not have access to this event's sessions.")
    allowed = svc.volunteer_allowed_session_ids(volunteer)
    sessions = [
        s for s in svc.bookable_sessions(db, event.event_id)
        if allowed is None or svc._compact(s.session_id) in allowed
    ]
    overview = svc.sessions_overview(db, event, sessions)
    # Volunteers get counts only — no attendee details.
    return {
        "event_id": str(event.event_id),
        "event_title": event.event_title,
        "role": "volunteer",
        "sessions": overview["sessions"],
    }


@router.put("/{event_id}/sessions")
def save_sessions(
    event_id: str,
    payload: SessionsBulkIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create/update the event's sessions in order. Sessions missing from the payload are never deleted here."""
    event = _host_event(db, event_id, current_user)
    structure = (payload.structure or "multiple").strip().lower()
    if structure not in ("single", "multiple"):
        raise HTTPException(status_code=422, detail={"message": "Choose Single Session or Multiple Sessions.", "errors": {"structure": "Invalid structure."}})
    items = payload.sessions or []
    if not items:
        raise HTTPException(status_code=422, detail={"message": "Add at least one session.", "errors": {"sessions": "Add at least one session."}})
    if structure == "single" and len(items) != 1:
        raise HTTPException(status_code=422, detail={"message": "A single-session event has exactly one session.", "errors": {"sessions": "Keep one session."}})
    if len(items) > svc.MAX_SESSIONS_PER_EVENT:
        raise HTTPException(status_code=422, detail={"message": f"An event can have up to {svc.MAX_SESSIONS_PER_EVENT} sessions.", "errors": {"sessions": "Too many sessions."}})

    existing = {svc._compact(s.session_id): s for s in svc.event_sessions(db, event.event_id)}
    kept_ids = {svc._compact(i.session_id) for i in items if i.session_id}
    unknown = [sid for sid in kept_ids if sid not in existing]
    if unknown:
        raise HTTPException(status_code=404, detail="One of these sessions does not belong to this event.")
    remaining = [s for key, s in existing.items() if key not in kept_ids and (s.status or "") != "cancelled"]
    if structure == "single" and remaining:
        raise HTTPException(
            status_code=409,
            detail={"message": "Remove the other saved sessions before switching to a single session.", "errors": {"structure": "Other sessions still exist."}},
        )

    cleaned = []
    for index, item in enumerate(items):
        data = item.model_dump(exclude_unset=True) if hasattr(item, "model_dump") else item.dict(exclude_unset=True)
        base = existing.get(svc._compact(item.session_id)) if item.session_id else None
        if structure == "single" and "eligibility_mode" not in data and base is None:
            data["eligibility_mode"] = "all_attendees"
        try:
            cleaned.append((base, svc.validate_session_input(data, partial_base=base)))
        except svc.SessionValidationError as err:
            _validation_422(err, index)

    actor = _actor_name(current_user)
    saved: List[EventSession] = []
    for position, (base, clean) in enumerate(cleaned, start=1):
        if base is None:
            base = EventSession(event_id=event.event_id, created_by=actor, created_at=datetime.utcnow())
            db.add(base)
        _apply(base, clean)
        base.position = position
        saved.append(base)
    for offset, row in enumerate(remaining, start=len(saved) + 1):
        row.position = offset
    db.commit()
    body = svc.sessions_overview(db, event)
    body["ticket_types"] = _ticket_type_names(event)
    body["message"] = "Sessions saved."
    return body


@router.post("/{event_id}/sessions", status_code=status.HTTP_201_CREATED)
def create_session(
    event_id: str,
    payload: SessionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _host_event(db, event_id, current_user)
    current = svc.event_sessions(db, event.event_id)
    if len(current) >= svc.MAX_SESSIONS_PER_EVENT:
        raise HTTPException(status_code=422, detail={"message": f"An event can have up to {svc.MAX_SESSIONS_PER_EVENT} sessions.", "errors": {}})
    data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    data.pop("session_id", None)
    try:
        clean = svc.validate_session_input(data)
    except svc.SessionValidationError as err:
        _validation_422(err)
    row = EventSession(event_id=event.event_id, created_by=_actor_name(current_user), position=len(current) + 1)
    _apply(row, clean)
    db.add(row)
    db.commit()
    db.refresh(row)
    return svc.serialize_session(row)


@router.get("/{event_id}/sessions/{session_id}")
def get_session(
    event_id: str,
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _host_event(db, event_id, current_user)
    session = _session_or_404(db, event, session_id, include_deleted=True)
    overview = svc.sessions_overview(db, event, [session])
    return overview["sessions"][0]


@router.put("/{event_id}/sessions/{session_id}")
def update_session(
    event_id: str,
    session_id: str,
    payload: SessionIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _host_event(db, event_id, current_user)
    session = _session_or_404(db, event, session_id)
    data = payload.model_dump(exclude_unset=True) if hasattr(payload, "model_dump") else payload.dict(exclude_unset=True)
    data.pop("session_id", None)
    try:
        clean = svc.validate_session_input(data, partial_base=session)
    except svc.SessionValidationError as err:
        _validation_422(err)
    _apply(session, clean)
    db.commit()
    db.refresh(session)
    return svc.serialize_session(session)


@router.delete("/{event_id}/sessions/{session_id}")
def remove_session(
    event_id: str,
    session_id: str,
    confirm: bool = Query(False, description="Required when the session has registrations or check-ins"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Soft-delete. Registrations and attendance rows are kept for history."""
    event = _host_event(db, event_id, current_user)
    session = _session_or_404(db, event, session_id)
    checkins = db.query(EventSessionCheckin).filter(EventSessionCheckin.session_id == session.session_id).count()
    registrations = db.query(EventSessionRegistration).filter(EventSessionRegistration.session_id == session.session_id).count()
    if (checkins or registrations) and not confirm:
        raise HTTPException(
            status_code=409,
            detail={
                "message": f"{session.session_name} has {checkins} check-in(s) and {registrations} registration(s). Confirm to remove it; its attendance history is kept.",
                "checkins": checkins,
                "registrations": registrations,
                "requires_confirmation": True,
            },
        )
    session.deleted_at = datetime.utcnow()
    session.status = "cancelled"
    session.updated_at = datetime.utcnow()
    db.commit()
    return {"status": "removed", "session_id": str(session.session_id), "history_kept": bool(checkins or registrations)}


# ── Registrations / eligibility ───────────────────────────────────────────────
@router.get("/{event_id}/sessions/{session_id}/registrations")
def list_session_registrations(
    event_id: str,
    session_id: str,
    include_ineligible: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _host_event(db, event_id, current_user)
    session = _session_or_404(db, event, session_id)
    rows = svc.session_attendee_rows(db, event, session, include_ineligible=include_ineligible)
    return {
        "session": svc.serialize_session(session),
        "attendees": rows,
        "eligible_count": sum(1 for r in rows if r["eligible"]),
    }


@router.post("/{event_id}/sessions/{session_id}/registrations")
def update_session_registrations(
    event_id: str,
    session_id: str,
    payload: RegistrationsIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _host_event(db, event_id, current_user)
    session = _session_or_404(db, event, session_id)
    try:
        result = svc.set_session_registrations(db, event, session, payload.ticket_ids, payload.action, _actor_name(current_user))
    except svc.SessionValidationError as err:
        _validation_422(err)
    overview = svc.sessions_overview(db, event, [session])
    result["session"] = overview["sessions"][0]
    return result


# ── Check-in ──────────────────────────────────────────────────────────────────
@router.post("/{event_id}/sessions/{session_id}/check-in")
def session_check_in(
    event_id: str,
    session_id: str,
    payload: SessionCheckinIn,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    from APIs.tickets import _lookup_matching_tickets

    event = _load_event(db, event_id)
    volunteer = None
    if not _is_host(event, current_user):
        volunteer = _volunteer_for(db, event, current_user)
        if not volunteer:
            raise HTTPException(status_code=403, detail="You are not authorized to check in attendees for this event.")
    session = _session_or_404(db, event, session_id)
    token = (payload.qr_token or payload.token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Scan a QR code or enter a ticket code.")
    method = (payload.method or "QR").strip().upper()
    actor = (volunteer.volunteer_name if volunteer else None) or _actor_name(current_user)
    tickets = _lookup_matching_tickets(db, token, None)
    return svc.perform_session_checkin(db, event, session, tickets, checked_in_by=actor, method=method, volunteer=volunteer)


# ── Attendance ────────────────────────────────────────────────────────────────
@router.get("/{event_id}/sessions/{session_id}/attendance")
def session_attendance(
    event_id: str,
    session_id: str,
    search: Optional[str] = None,
    filter: Optional[str] = Query(None, description="all | checked_in | pending"),
    format: Optional[str] = Query(None, description="json | csv"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _host_event(db, event_id, current_user)
    session = _session_or_404(db, event, session_id, include_deleted=True)
    rows = svc.session_attendee_rows(db, event, session)
    needle = (search or "").strip().lower()
    if needle:
        rows = [
            r for r in rows
            if needle in r["attendee_name"].lower()
            or needle in r["attendee_email"].lower()
            or needle in r["attendee_ref"].lower()
            or needle in r["ticket_type"].lower()
        ]
    mode = (filter or "all").strip().lower()
    if mode == "checked_in":
        rows = [r for r in rows if r["checked_in"]]
    elif mode == "pending":
        rows = [r for r in rows if not r["checked_in"]]

    if (format or "").lower() == "csv":
        buf = io.StringIO()
        writer = csv.writer(buf)
        writer.writerow(["Session", "Attendee", "Email", "Ticket ref", "Ticket type", "Checked in", "Checked in at (UTC)", "Checked in by"])
        for r in rows:
            writer.writerow([
                session.session_name, r["attendee_name"], r["attendee_email"], r["attendee_ref"], r["ticket_type"],
                "Yes" if r["checked_in"] else "No", r["checked_in_at"] or "", r["checked_in_by"],
            ])
        safe = "".join(ch if ch.isalnum() else "-" for ch in session.session_name).strip("-")[:40] or "session"
        return StreamingResponse(
            iter([buf.getvalue()]),
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="attendance-{safe}.csv"', "Cache-Control": "private, no-store"},
        )
    overview = svc.sessions_overview(db, event, [session])["sessions"][0]
    return {"session": overview, "attendees": rows, "count": len(rows)}


@router.get("/{event_id}/attendees/{attendee_id}/attendance")
def attendee_attendance(
    event_id: str,
    attendee_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """attendee_id is the attendee's ticket id or their ticket QR/booking code."""
    from APIs.tickets import _lookup_matching_tickets
    from Models.ticket import Ticket

    event = _host_event(db, event_id, current_user)
    public_ids = svc.event_public_id_set(db, event)
    ticket = None
    try:
        ticket = db.query(Ticket).filter(Ticket.ticket_id == attendee_id).first()
    except Exception:
        db.rollback()
    candidates = [ticket] if ticket else _lookup_matching_tickets(db, attendee_id, None)
    candidates = [t for t in candidates if t is not None and svc.ticket_belongs_to_event(db, t, event, public_ids)]
    if not candidates:
        raise HTTPException(status_code=404, detail="Attendee not found for this event.")
    return svc.attendee_attendance(db, event, candidates[0])
