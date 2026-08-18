"""
Volunteer invitations, event-scoped scanner access, and ticket check-in.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.base import get_db
from Models.event_entry_gates import EventEntryGate
from Models.event_management import EventManagement
from Models.event_volunteer import (
    EventVolunteer,
    VolunteerAuditLog,
    VolunteerCheckin,
    VolunteerInvitation,
    default_invite_expiry,
)
from Models.ticket import Ticket
from Models.user import User
from Services.email import send_email

from APIs.tickets import _lookup_ticket, _serialize_ticket_success

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────
class InviteVolunteerRequest(BaseModel):
    volunteer_name: str = Field(..., min_length=1, max_length=200)
    email: EmailStr
    role: str = "SCANNER"
    event_id: Optional[str] = None
    gate_id: Optional[str] = None


class VerifyTicketRequest(BaseModel):
    token: Optional[str] = None
    qr_token: Optional[str] = None
    event_id: Optional[str] = None
    method: Optional[str] = "QR"


# ── Helpers ───────────────────────────────────────────────────────────────────
def _hash_token(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def _frontend_base(request: Optional[Request] = None) -> str:
    env = (os.getenv("FRONTEND_URL") or os.getenv("PUBLIC_SITE_URL") or "").strip().rstrip("/")
    if env:
        return env
    if request:
        origin = (request.headers.get("origin") or "").strip().rstrip("/")
        if origin:
            return origin
        referer = (request.headers.get("referer") or "").strip()
        if referer.startswith("http"):
            parts = referer.split("/", 3)
            if len(parts) >= 3:
                return f"{parts[0]}//{parts[2]}"
    return "http://127.0.0.1:5500"


def _invite_url(request: Optional[Request], raw_token: str) -> str:
    return f"{_frontend_base(request)}/volunteer-portal.html?token={raw_token}"


def _audit(db: Session, **kwargs) -> None:
    db.add(VolunteerAuditLog(**kwargs))


def _owned_event(db: Session, current_user: User, event_id: Optional[str]) -> EventManagement:
    query = db.query(EventManagement).filter(
        (EventManagement.customer_id == current_user.customer_id)
        | (EventManagement.organizer_email == (current_user.email or "").lower().strip())
    )
    event = None
    if event_id:
        try:
            event = query.filter(EventManagement.event_id == UUID(str(event_id))).first()
        except ValueError:
            event = None
    if not event:
        event = query.order_by(EventManagement.created_at.desc()).first()
    if not event:
        raise HTTPException(status_code=404, detail="No event found for this organizer.")
    return event


def _active_assignment(db: Session, current_user: User, event_id: Optional[str] = None) -> EventVolunteer:
    email = (current_user.email or "").lower().strip()
    rows = (
        db.query(EventVolunteer)
        .filter(EventVolunteer.status == "ACTIVE")
        .filter(
            (EventVolunteer.customer_id == current_user.customer_id)
            | (EventVolunteer.invited_email == email)
        )
        .all()
    )
    if not rows:
        raise HTTPException(status_code=403, detail="You do not have volunteer scanner access.")
    if event_id:
        try:
            eid = UUID(str(event_id))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid event.")
        match = next((row for row in rows if row.event_id == eid), None)
        if not match:
            raise HTTPException(status_code=403, detail="You are not assigned to this event.")
        return match
    if len(rows) == 1:
        return rows[0]
    raise HTTPException(status_code=400, detail="Select an assigned event to continue.")


def _gate_payload(gate: Optional[EventEntryGate]) -> dict:
    if not gate:
        return {"gate_id": None, "gate_name": None, "gate_code": None}
    return {
        "gate_id": str(gate.gate_id),
        "gate_name": gate.gate_name,
        "gate_code": gate.gate_code or "",
    }


def _event_gate(db: Session, event: EventManagement, gate_id: Optional[str]) -> EventEntryGate:
    if not gate_id:
        raise HTTPException(status_code=400, detail="Save an entry gate first, then assign the volunteer to that gate.")
    try:
        gid = UUID(str(gate_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Select a valid entry gate.")
    gate = (
        db.query(EventEntryGate)
        .filter(EventEntryGate.gate_id == gid, EventEntryGate.event_id == event.event_id)
        .first()
    )
    if not gate:
        raise HTTPException(status_code=404, detail="That gate was not found for this event.")
    if (gate.status or "").strip().lower() not in ("active", ""):
        raise HTTPException(status_code=400, detail="Assign the volunteer to an active gate.")
    return gate


def _serialize_volunteer(row: EventVolunteer, checkin_count: int = 0, gate: Optional[EventEntryGate] = None) -> dict:
    gate = gate if gate is not None else getattr(row, "entry_gate", None)
    payload = {
        "id": str(row.id),
        "event_id": str(row.event_id),
        "name": row.volunteer_name,
        "email": row.invited_email,
        "role": row.role or "SCANNER",
        "status": row.status,
        "invited_at": row.invited_at.isoformat() if row.invited_at else None,
        "accepted_at": row.accepted_at.isoformat() if row.accepted_at else None,
        "revoked_at": row.revoked_at.isoformat() if row.revoked_at else None,
        "checkins": checkin_count,
    }
    payload.update(_gate_payload(gate))
    return payload


def _booking_ref(ticket: Optional[Ticket]) -> Optional[str]:
    if not ticket or not ticket.booking_id:
        return None
    short = str(ticket.booking_id).replace("-", "")[:8].upper()
    return f"#JOD-{short}"


def _booking_ref_for_ticket_id(db: Session, ticket_id) -> Optional[str]:
    if not ticket_id:
        return None
    ticket = db.query(Ticket).filter(Ticket.ticket_id == ticket_id).first()
    return _booking_ref(ticket)


def _volunteer_ticket_extra(ticket: Optional[Ticket], **fields) -> dict:
    extra = {k: v for k, v in fields.items() if v is not None}
    if ticket:
        extra["booking_id"] = str(ticket.booking_id)
        ref = _booking_ref(ticket)
        if ref:
            extra["booking_ref"] = ref
    extra.pop("qr_token", None)
    return extra


def _volunteer_verify_result(ticket: Ticket, message: str, staff_name: str, today_checkins: int) -> dict:
    result = _serialize_ticket_success(ticket, message=message)
    result.pop("qr_token", None)
    result.pop("customer_email", None)
    result["booking_ref"] = _booking_ref(ticket)
    result["verified_by"] = staff_name
    result["today_checkins"] = today_checkins
    return result


def _resolve_invite_bundle(db: Session, raw_token: str):
    invite = db.query(VolunteerInvitation).filter(VolunteerInvitation.token_hash == _hash_token(raw_token)).first()
    if not invite:
        raise HTTPException(status_code=404, detail="This invitation is invalid.")
    volunteer = (
        db.query(EventVolunteer)
        .options(joinedload(EventVolunteer.entry_gate))
        .filter(EventVolunteer.id == invite.volunteer_id)
        .first()
    )
    if not volunteer:
        raise HTTPException(status_code=404, detail="Invitation is no longer valid.")
    event = db.query(EventManagement).filter(EventManagement.event_id == invite.event_id).first()
    return invite, volunteer, event


def _ensure_portal_access(db: Session, invite: VolunteerInvitation, volunteer: EventVolunteer) -> EventVolunteer:
    if volunteer.status == "REVOKED" or invite.status in ("REVOKED", "REPLACED"):
        raise HTTPException(status_code=410, detail="This volunteer access has been revoked.")
    if invite.is_expired():
        invite.status = "EXPIRED"
        if volunteer.status == "PENDING":
            volunteer.status = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=410, detail="This invitation has expired.")
    if volunteer.status == "PENDING" or invite.status == "PENDING":
        now = datetime.utcnow()
        volunteer.status = "ACTIVE"
        volunteer.accepted_at = now
        volunteer.updated_at = now
        invite.status = "ACCEPTED"
        invite.accepted_at = now
        _audit(
            db,
            event_id=volunteer.event_id,
            volunteer_id=volunteer.id,
            actor_customer_id=volunteer.customer_id,
            action="invitation_accepted",
            detail=volunteer.invited_email,
        )
        db.commit()
        db.refresh(volunteer)
    if volunteer.status != "ACTIVE":
        raise HTTPException(status_code=403, detail="Volunteer access is not active.")
    return volunteer


def _activity_booking_ref(db: Session, ticket_code: Optional[str], ticket_id=None) -> Optional[str]:
    code = (ticket_code or "").strip()
    if code.startswith("#JOD-"):
        return code
    if ticket_id:
        ref = _booking_ref_for_ticket_id(db, ticket_id)
        if ref:
            return ref
    if code and not code.upper().startswith("JOD-TKT"):
        return code
    return None


def _assignment_recent(db: Session, volunteer_id) -> list:
    recent_checkins = (
        db.query(VolunteerCheckin)
        .filter(VolunteerCheckin.volunteer_id == volunteer_id)
        .order_by(VolunteerCheckin.created_at.desc())
        .limit(12)
        .all()
    )
    recent_audits = (
        db.query(VolunteerAuditLog)
        .filter(
            VolunteerAuditLog.volunteer_id == volunteer_id,
            VolunteerAuditLog.action.in_(("ticket_checked_in", "failed_verification")),
        )
        .order_by(VolunteerAuditLog.created_at.desc())
        .limit(12)
        .all()
    )
    merged = []
    seen = set()
    for audit in recent_audits:
        detail = (audit.detail or "")
        status_code = "failed"
        if audit.action == "ticket_checked_in":
            status_code = "checked_in"
        elif "ALREADY_USED" in detail:
            status_code = "already_checked_in"
        elif "WRONG_EVENT" in detail:
            status_code = "wrong_event"
        elif "CANCELLED" in detail:
            status_code = "cancelled"
        ticket_code = detail.split(":")[-1].strip() if ":" in detail and audit.action != "ticket_checked_in" else detail
        if audit.action == "ticket_checked_in":
            ticket_code = detail
        booking_ref = _activity_booking_ref(db, ticket_code, audit.ticket_id)
        key = f"{status_code}:{booking_ref or ticket_code}:{_iso(audit.created_at)}"
        if key in seen:
            continue
        seen.add(key)
        merged.append({
            "booking_ref": booking_ref,
            "status": status_code,
            "checked_in_at": _iso(audit.created_at),
            "sort": audit.created_at.timestamp() if audit.created_at else 0,
        })
    for checkin in recent_checkins:
        booking_ref = _activity_booking_ref(db, checkin.ticket_code, checkin.ticket_id)
        key = f"checked_in:{booking_ref or checkin.ticket_code}:{_iso(checkin.created_at)}"
        if key in seen:
            continue
        seen.add(key)
        merged.append({
            "attendee_name": checkin.attendee_name,
            "booking_ref": booking_ref,
            "status": checkin.status or "checked_in",
            "checked_in_at": _iso(checkin.created_at),
            "sort": checkin.created_at.timestamp() if checkin.created_at else 0,
        })
    merged.sort(key=lambda row: row.get("sort") or 0, reverse=True)
    for row in merged:
        row.pop("sort", None)
    return merged[:12]


def _portal_payload(db: Session, volunteer: EventVolunteer, event: Optional[EventManagement]) -> dict:
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = (
        db.query(VolunteerCheckin)
        .filter(VolunteerCheckin.volunteer_id == volunteer.id, VolunteerCheckin.created_at >= today_start)
        .count()
    )
    return {
        "volunteer_name": volunteer.volunteer_name,
        "email": volunteer.invited_email,
        "event_id": str(volunteer.event_id),
        "event_title": event.event_title if event else "Event",
        "venue": event.venue if event else None,
        "role": _role_label(volunteer.role),
        "gate_id": str(volunteer.gate_id) if volunteer.gate_id else None,
        "gate_name": volunteer.entry_gate.gate_name if volunteer.entry_gate else None,
        "today_checkins": today_count,
        "recent": _assignment_recent(db, volunteer.id),
        "status": volunteer.status,
    }


def _verify_ticket_for_assignment(
    db: Session,
    assignment: EventVolunteer,
    token_str: str,
    method: str,
    staff_name: str,
    actor_customer_id: Optional[str] = None,
):
    ticket = _lookup_ticket(db, token_str, None)

    def fail(code: str, message: str, extra: Optional[dict] = None):
        _audit(
            db,
            event_id=assignment.event_id,
            volunteer_id=assignment.id,
            actor_customer_id=actor_customer_id,
            ticket_id=ticket.ticket_id if ticket else None,
            action="failed_verification",
            method=method,
            detail=f"{code}: {message}",
        )
        db.commit()
        body = {"valid": False, "status": code, "message": message}
        if extra:
            body.update(extra)
        return body

    if not ticket:
        return fail("INVALID", "This ticket could not be verified.")

    if str(ticket.event_id) != str(assignment.event_id):
        return fail("WRONG_EVENT", "This ticket belongs to another event.")

    booking_status = ((ticket.booking.status if ticket.booking else "") or "").upper()
    ticket_status = (ticket.ticket_status or "").upper()
    if booking_status in ("CANCELLED", "REFUNDED") or ticket_status in ("CANCELLED", "REFUNDED"):
        return fail("CANCELLED", "This ticket has been cancelled or refunded.")

    existing = db.query(VolunteerCheckin).filter(VolunteerCheckin.ticket_id == ticket.ticket_id).first()
    if existing or ticket_status == "USED":
        extra = _volunteer_ticket_extra(
            ticket,
            customer_name=(ticket.booking.receiver_name if ticket.booking else None),
            ticket_type=ticket.ticket_type,
            used_at=_iso(ticket.used_at or (existing.created_at if existing else None)),
            scanned_by=ticket.scanned_by or (existing.volunteer.volunteer_name if existing and existing.volunteer else None),
        )
        return fail("ALREADY_USED", "This ticket was already checked in.", extra)

    now_utc = datetime.utcnow()
    rows_updated = (
        db.query(Ticket)
        .filter(Ticket.ticket_id == ticket.ticket_id, Ticket.ticket_status == "VALID")
        .update(
            {
                Ticket.ticket_status: "USED",
                Ticket.used_at: now_utc,
                Ticket.scanned_by: staff_name,
            },
            synchronize_session=False,
        )
    )
    if rows_updated != 1:
        db.rollback()
        ticket = _lookup_ticket(db, token_str, str(assignment.event_id))
        extra = _volunteer_ticket_extra(
            ticket,
            customer_name=(ticket.booking.receiver_name if ticket and ticket.booking else None),
            used_at=_iso(ticket.used_at if ticket else None),
            scanned_by=ticket.scanned_by if ticket else None,
            ticket_type=ticket.ticket_type if ticket else None,
        )
        return fail("ALREADY_USED", "This ticket was already checked in.", extra)

    attendee = (ticket.booking.receiver_name if ticket.booking else None) or "Guest"
    booking_label = _booking_ref(ticket) or "Guest"
    checkin = VolunteerCheckin(
        ticket_id=ticket.ticket_id,
        event_id=assignment.event_id,
        volunteer_id=assignment.id,
        volunteer_customer_id=actor_customer_id,
        attendee_name=attendee,
        ticket_code=booking_label,
        method=method,
        status="checked_in",
        created_at=now_utc,
    )
    db.add(checkin)
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        ticket = _lookup_ticket(db, token_str, str(assignment.event_id))
        extra = _volunteer_ticket_extra(
            ticket,
            customer_name=(ticket.booking.receiver_name if ticket and ticket.booking else None),
            used_at=_iso(ticket.used_at if ticket else None),
            scanned_by=ticket.scanned_by if ticket else None,
        )
        return fail("ALREADY_USED", "This ticket was already checked in.", extra)

    _audit(
        db,
        event_id=assignment.event_id,
        volunteer_id=assignment.id,
        actor_customer_id=actor_customer_id,
        ticket_id=ticket.ticket_id,
        action="ticket_checked_in",
        method=method,
        detail=booking_label,
    )
    db.commit()

    ticket = (
        db.query(Ticket)
        .options(joinedload(Ticket.booking), joinedload(Ticket.event), joinedload(Ticket.customer))
        .filter(Ticket.ticket_id == ticket.ticket_id)
        .first()
    )
    today_count = (
        db.query(VolunteerCheckin)
        .filter(
            VolunteerCheckin.volunteer_id == assignment.id,
            VolunteerCheckin.created_at >= datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0),
        )
        .count()
    )
    result = _volunteer_verify_result(ticket, "CHECK-IN SUCCESSFUL", staff_name, today_count)
    result["method"] = method
    return result


def _create_invitation(db: Session, volunteer: EventVolunteer) -> tuple[VolunteerInvitation, str]:
    (
        db.query(VolunteerInvitation)
        .filter(VolunteerInvitation.volunteer_id == volunteer.id)
        .filter(VolunteerInvitation.status == "PENDING")
        .update({VolunteerInvitation.status: "REPLACED"}, synchronize_session=False)
    )
    raw = secrets.token_urlsafe(32)
    invite = VolunteerInvitation(
        volunteer_id=volunteer.id,
        event_id=volunteer.event_id,
        invited_email=volunteer.invited_email,
        token_hash=_hash_token(raw),
        status="PENDING",
        expires_at=default_invite_expiry(),
    )
    db.add(invite)
    return invite, raw


def _send_invite_email(event: EventManagement, volunteer: EventVolunteer, invite: VolunteerInvitation, url: str, gate: Optional[EventEntryGate] = None) -> None:
    expires = invite.expires_at.strftime("%d %b %Y, %I:%M %p UTC") if invite.expires_at else "soon"
    organizer = event.organizer_name or event.organizer_email or "the organizer"
    gate_name = (gate.gate_name if gate else None) or "Assigned gate"
    subject = f"You're invited to help check in guests at {event.event_title}"
    text = (
        f"You're invited to help manage event check-ins.\n\n"
        f"Event: {event.event_title}\n"
        f"Organizer: {organizer}\n"
        f"Role: Scanner Volunteer\n"
        f"Assigned Gate: {gate_name}\n\n"
        f"Accept Volunteer Invitation:\n{url}\n\n"
        f"This invitation expires on {expires}.\n"
    )
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px">You're invited to help manage event check-ins.</h2>
      <p><strong>Event:</strong> {event.event_title}<br/>
      <strong>Organizer:</strong> {organizer}<br/>
      <strong>Role:</strong> Scanner Volunteer<br/>
      <strong>Assigned Gate:</strong> {gate_name}</p>
      <p>You have been invited to verify attendee tickets during event day.</p>
      <p><a href="{url}" style="display:inline-block;background:#2563eb;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Accept Volunteer Invitation</a></p>
      <p style="color:#64748b;font-size:13px">This invitation expires on {expires}.</p>
    </div>
    """
    send_email(volunteer.invited_email, subject, text, html)


def _role_label(role: str) -> str:
    return "Scanner Volunteer" if (role or "SCANNER").upper() == "SCANNER" else (role or "Volunteer").title()


def _iso(value) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


# ── Host: invite / list / resend / revoke ─────────────────────────────────────
@router.post("", status_code=status.HTTP_201_CREATED)
def invite_volunteer(
    payload: InviteVolunteerRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _owned_event(db, current_user, payload.event_id)
    gate = _event_gate(db, event, payload.gate_id)
    email = payload.email.lower().strip()
    name = payload.volunteer_name.strip()
    role = (payload.role or "SCANNER").strip().upper() or "SCANNER"
    if role != "SCANNER":
        role = "SCANNER"

    existing = (
        db.query(EventVolunteer)
        .filter(EventVolunteer.event_id == event.event_id)
        .filter(EventVolunteer.invited_email == email)
        .order_by(EventVolunteer.created_at.desc())
        .first()
    )
    if existing and existing.status == "ACTIVE":
        raise HTTPException(status_code=409, detail="This volunteer is already assigned to this event.")
    if existing and existing.status == "PENDING":
        raise HTTPException(status_code=409, detail="An invitation is already pending for this email. Resend it instead.")

    if existing and existing.status in ("REVOKED", "EXPIRED"):
        volunteer = existing
        volunteer.volunteer_name = name
        volunteer.role = role
        volunteer.gate_id = gate.gate_id
        volunteer.status = "PENDING"
        volunteer.revoked_at = None
        volunteer.accepted_at = None
        volunteer.customer_id = None
        volunteer.invited_by_customer_id = current_user.customer_id
        volunteer.invited_at = datetime.utcnow()
        volunteer.updated_at = datetime.utcnow()
    else:
        volunteer = EventVolunteer(
            event_id=event.event_id,
            invited_email=email,
            volunteer_name=name,
            gate_id=gate.gate_id,
            role=role,
            status="PENDING",
            invited_by_customer_id=current_user.customer_id,
            invited_at=datetime.utcnow(),
        )
        db.add(volunteer)
        db.flush()

    invite, raw = _create_invitation(db, volunteer)
    url = _invite_url(request, raw)
    _audit(
        db,
        event_id=event.event_id,
        volunteer_id=volunteer.id,
        actor_customer_id=current_user.customer_id,
        action="volunteer_invited",
        detail=f"Invited {email} as {role} at {gate.gate_name}",
    )
    db.commit()
    db.refresh(volunteer)
    db.refresh(invite)
    _send_invite_email(event, volunteer, invite, url, gate)
    return {
        "status": "success",
        "volunteer": _serialize_volunteer(volunteer, gate=gate),
        "invite_url": url,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
    }


@router.get("")
def list_volunteers(
    event_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _owned_event(db, current_user, event_id)
    rows = (
        db.query(EventVolunteer)
        .options(joinedload(EventVolunteer.entry_gate))
        .filter(EventVolunteer.event_id == event.event_id)
        .order_by(EventVolunteer.invited_at.desc())
        .all()
    )
    counts = {}
    if rows:
        ids = [row.id for row in rows]
        from sqlalchemy import func
        tallies = (
            db.query(VolunteerCheckin.volunteer_id, func.count(VolunteerCheckin.id))
            .filter(VolunteerCheckin.volunteer_id.in_(ids))
            .group_by(VolunteerCheckin.volunteer_id)
            .all()
        )
        counts = {vid: n for vid, n in tallies}
    return {
        "event_id": str(event.event_id),
        "event_title": event.event_title,
        "volunteers": [_serialize_volunteer(row, counts.get(row.id, 0)) for row in rows],
    }


@router.post("/{volunteer_id}/resend")
def resend_invitation(
    volunteer_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        vid = UUID(str(volunteer_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid volunteer.")
    volunteer = db.query(EventVolunteer).filter(EventVolunteer.id == vid).first()
    if not volunteer:
        raise HTTPException(status_code=404, detail="Volunteer not found.")
    event = _owned_event(db, current_user, str(volunteer.event_id))
    if volunteer.event_id != event.event_id:
        raise HTTPException(status_code=403, detail="Not authorized.")
    if volunteer.status == "REVOKED":
        raise HTTPException(status_code=400, detail="This volunteer was revoked. Invite them again.")
    if volunteer.status == "ACTIVE":
        raise HTTPException(status_code=400, detail="This volunteer already accepted the invitation.")

    volunteer.status = "PENDING"
    volunteer.invited_at = datetime.utcnow()
    invite, raw = _create_invitation(db, volunteer)
    url = _invite_url(request, raw)
    _audit(
        db,
        event_id=event.event_id,
        volunteer_id=volunteer.id,
        actor_customer_id=current_user.customer_id,
        action="invitation_resent",
        detail=volunteer.invited_email,
    )
    db.commit()
    gate = volunteer.entry_gate
    _send_invite_email(event, volunteer, invite, url, gate)
    return {"status": "success", "invite_url": url, "expires_at": invite.expires_at.isoformat()}


@router.post("/{volunteer_id}/revoke")
def revoke_volunteer(
    volunteer_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    try:
        vid = UUID(str(volunteer_id))
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid volunteer.")
    volunteer = db.query(EventVolunteer).filter(EventVolunteer.id == vid).first()
    if not volunteer:
        raise HTTPException(status_code=404, detail="Volunteer not found.")
    event = _owned_event(db, current_user, str(volunteer.event_id))
    if volunteer.event_id != event.event_id:
        raise HTTPException(status_code=403, detail="Not authorized.")

    volunteer.status = "REVOKED"
    volunteer.revoked_at = datetime.utcnow()
    volunteer.updated_at = datetime.utcnow()
    (
        db.query(VolunteerInvitation)
        .filter(VolunteerInvitation.volunteer_id == volunteer.id)
        .filter(VolunteerInvitation.status == "PENDING")
        .update({VolunteerInvitation.status: "REVOKED"}, synchronize_session=False)
    )
    _audit(
        db,
        event_id=event.event_id,
        volunteer_id=volunteer.id,
        actor_customer_id=current_user.customer_id,
        action="volunteer_revoked",
        detail=volunteer.invited_email,
    )
    db.commit()
    return {"status": "success", "volunteer": _serialize_volunteer(volunteer)}


@router.get("/event-day-stats")
def event_day_stats(
    event_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event = _owned_event(db, current_user, event_id)
    from APIs.host_events_api import compute_live_event_stats

    live = compute_live_event_stats(db, event)
    sold = int(live.get("tickets_sold") or 0)
    checked = int(live.get("checked_in") or 0)
    remaining = max(0, sold - checked)
    rate = round((checked / sold * 100), 1) if sold else 0.0
    active_volunteers = (
        db.query(EventVolunteer)
        .filter(EventVolunteer.event_id == event.event_id, EventVolunteer.status == "ACTIVE")
        .count()
    )
    from sqlalchemy import func

    method_rows = (
        db.query(VolunteerCheckin.method, func.count(VolunteerCheckin.id))
        .filter(VolunteerCheckin.event_id == event.event_id)
        .group_by(VolunteerCheckin.method)
        .all()
    )
    qr_count = 0
    code_count = 0
    for method, count in method_rows:
        if (method or "").upper() == "QR":
            qr_count += int(count or 0)
        else:
            code_count += int(count or 0)

    volunteer_rows = (
        db.query(
            EventVolunteer.id,
            EventVolunteer.volunteer_name,
            EventVolunteer.invited_email,
            func.count(VolunteerCheckin.id),
        )
        .outerjoin(VolunteerCheckin, VolunteerCheckin.volunteer_id == EventVolunteer.id)
        .filter(EventVolunteer.event_id == event.event_id, EventVolunteer.status == "ACTIVE")
        .group_by(EventVolunteer.id, EventVolunteer.volunteer_name, EventVolunteer.invited_email)
        .all()
    )
    by_volunteer = [
        {
            "volunteer_id": str(vid),
            "name": name,
            "email": email,
            "checkins": int(count or 0),
        }
        for vid, name, email, count in volunteer_rows
    ]

    recent = (
        db.query(VolunteerCheckin, EventVolunteer)
        .outerjoin(EventVolunteer, EventVolunteer.id == VolunteerCheckin.volunteer_id)
        .filter(VolunteerCheckin.event_id == event.event_id)
        .order_by(VolunteerCheckin.created_at.desc())
        .limit(20)
        .all()
    )
    return {
        "event_id": str(event.event_id),
        "total_tickets": sold,
        "checked_in": checked,
        "not_checked_in": remaining,
        "checkin_rate": rate,
        "active_volunteers": active_volunteers,
        "qr_checkins": qr_count,
        "code_checkins": code_count,
        "checkins_by_volunteer": by_volunteer,
        "recent_checkins": [
            {
                "attendee_name": row.attendee_name,
                "booking_ref": _activity_booking_ref(db, row.ticket_code, row.ticket_id),
                "method": row.method,
                "volunteer_name": volunteer.volunteer_name if volunteer else None,
                "checked_in_at": _iso(row.created_at),
            }
            for row, volunteer in recent
        ],
    }


# ── Invitation peek / accept ──────────────────────────────────────────────────
@router.get("/portal/{token}")
def volunteer_portal(token: str, db: Session = Depends(get_db)):
    invite, volunteer, event = _resolve_invite_bundle(db, token)
    volunteer = _ensure_portal_access(db, invite, volunteer)
    volunteer = (
        db.query(EventVolunteer)
        .options(joinedload(EventVolunteer.entry_gate))
        .filter(EventVolunteer.id == volunteer.id)
        .first()
    )
    return _portal_payload(db, volunteer, event)


@router.post("/portal/{token}/verify-ticket")
def portal_verify_ticket(
    token: str,
    payload: VerifyTicketRequest,
    db: Session = Depends(get_db),
):
    invite, volunteer, _event = _resolve_invite_bundle(db, token)
    volunteer = _ensure_portal_access(db, invite, volunteer)
    token_str = (payload.qr_token or payload.token or "").strip()
    if not token_str:
        raise HTTPException(status_code=400, detail="Enter a ticket code or scan a QR code.")
    method = (payload.method or "TICKET_CODE").strip().upper()
    if method not in ("QR", "TICKET_CODE"):
        method = "TICKET_CODE"
    return _verify_ticket_for_assignment(
        db,
        volunteer,
        token_str,
        method,
        staff_name=volunteer.volunteer_name,
        actor_customer_id=volunteer.customer_id,
    )


@router.get("/invite/{token}")
def peek_invitation(token: str, db: Session = Depends(get_db)):
    invite = db.query(VolunteerInvitation).filter(VolunteerInvitation.token_hash == _hash_token(token)).first()
    if not invite:
        raise HTTPException(status_code=404, detail="This invitation is invalid.")
    volunteer = (
        db.query(EventVolunteer)
        .options(joinedload(EventVolunteer.entry_gate))
        .filter(EventVolunteer.id == invite.volunteer_id)
        .first()
    )
    event = db.query(EventManagement).filter(EventManagement.event_id == invite.event_id).first()
    gate_name = volunteer.entry_gate.gate_name if volunteer and volunteer.entry_gate else None
    volunteer_name = volunteer.volunteer_name if volunteer else None
    if invite.status == "ACCEPTED":
        return {
            "status": "already_accepted",
            "event_title": event.event_title if event else "Event",
            "organizer_name": (event.organizer_name if event else None),
            "role": _role_label(volunteer.role if volunteer else "SCANNER"),
            "gate_name": gate_name,
            "volunteer_name": volunteer_name,
            "email": invite.invited_email,
        }
    if invite.status in ("REVOKED", "REPLACED") or (volunteer and volunteer.status == "REVOKED"):
        raise HTTPException(status_code=410, detail="This invitation has been revoked.")
    if invite.is_expired():
        invite.status = "EXPIRED"
        if volunteer and volunteer.status == "PENDING":
            volunteer.status = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=410, detail="This invitation has expired.")
    return {
        "status": "pending",
        "event_title": event.event_title if event else "Event",
        "organizer_name": (event.organizer_name if event else None),
        "role": _role_label(volunteer.role if volunteer else "SCANNER"),
        "gate_name": gate_name,
        "volunteer_name": volunteer_name,
        "email": invite.invited_email,
        "expires_at": invite.expires_at.isoformat() if invite.expires_at else None,
    }


@router.post("/invite/{token}/accept")
def accept_invitation(
    token: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    invite = db.query(VolunteerInvitation).filter(VolunteerInvitation.token_hash == _hash_token(token)).first()
    if not invite:
        raise HTTPException(status_code=404, detail="This invitation is invalid.")
    volunteer = db.query(EventVolunteer).filter(EventVolunteer.id == invite.volunteer_id).first()
    if not volunteer:
        raise HTTPException(status_code=404, detail="Invitation is no longer valid.")
    if volunteer.status == "REVOKED" or invite.status in ("REVOKED", "REPLACED"):
        raise HTTPException(status_code=410, detail="This invitation has been revoked.")
    if invite.is_expired():
        invite.status = "EXPIRED"
        volunteer.status = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=410, detail="This invitation has expired.")

    user_email = (current_user.email or "").lower().strip()
    if user_email != (invite.invited_email or "").lower().strip():
        raise HTTPException(
            status_code=403,
            detail=f"Sign in with {invite.invited_email} to accept this invitation.",
        )

    if invite.status == "ACCEPTED" and volunteer.status == "ACTIVE":
        volunteer.customer_id = current_user.customer_id
        db.commit()
        return {"status": "already_accepted", "event_id": str(volunteer.event_id)}

    now = datetime.utcnow()
    volunteer.status = "ACTIVE"
    volunteer.customer_id = current_user.customer_id
    volunteer.accepted_at = now
    volunteer.updated_at = now
    invite.status = "ACCEPTED"
    invite.accepted_at = now
    _audit(
        db,
        event_id=volunteer.event_id,
        volunteer_id=volunteer.id,
        actor_customer_id=current_user.customer_id,
        action="invitation_accepted",
        detail=user_email,
    )
    db.commit()
    return {"status": "accepted", "event_id": str(volunteer.event_id)}


# ── Volunteer self ────────────────────────────────────────────────────────────
@router.get("/me")
def my_assignments(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    email = (current_user.email or "").lower().strip()
    rows = (
        db.query(EventVolunteer)
        .options(joinedload(EventVolunteer.entry_gate))
        .filter(EventVolunteer.status == "ACTIVE")
        .filter(
            (EventVolunteer.customer_id == current_user.customer_id)
            | (EventVolunteer.invited_email == email)
        )
        .all()
    )
    items = []
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    for row in rows:
        event = db.query(EventManagement).filter(EventManagement.event_id == row.event_id).first()
        today_count = (
            db.query(VolunteerCheckin)
            .filter(VolunteerCheckin.volunteer_id == row.id, VolunteerCheckin.created_at >= today_start)
            .count()
        )
        items.append({
            "id": str(row.id),
            "event_id": str(row.event_id),
            "event_title": event.event_title if event else "Event",
            "venue": event.venue if event else None,
            "role": _role_label(row.role),
            "volunteer_name": row.volunteer_name,
            "gate_id": str(row.gate_id) if row.gate_id else None,
            "gate_name": row.entry_gate.gate_name if row.entry_gate else None,
            "today_checkins": today_count,
            "recent": _assignment_recent(db, row.id),
        })
    display_name = rows[0].volunteer_name if len(rows) == 1 else (current_user.full_name or current_user.username)
    return {
        "volunteer_name": display_name,
        "email": current_user.email,
        "assignments": items,
    }


@router.get("/checkins")
def volunteer_checkins(
    event_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = _active_assignment(db, current_user, event_id)
    rows = (
        db.query(VolunteerCheckin)
        .filter(
            VolunteerCheckin.event_id == assignment.event_id,
            VolunteerCheckin.volunteer_id == assignment.id,
        )
        .order_by(VolunteerCheckin.created_at.desc())
        .limit(50)
        .all()
    )
    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    today_count = (
        db.query(VolunteerCheckin)
        .filter(
            VolunteerCheckin.volunteer_id == assignment.id,
            VolunteerCheckin.created_at >= today_start,
        )
        .count()
    )
    return {
        "event_id": str(assignment.event_id),
        "today_checkins": today_count,
        "checkins": [
            {
                "attendee_name": row.attendee_name,
                "booking_ref": _activity_booking_ref(db, row.ticket_code, row.ticket_id),
                "method": row.method,
                "status": row.status,
                "checked_in_at": _iso(row.created_at),
            }
            for row in rows
        ],
    }


@router.post("/verify-ticket")
def volunteer_verify_ticket(
    payload: VerifyTicketRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    assignment = _active_assignment(db, current_user, payload.event_id)
    token_str = (payload.qr_token or payload.token or "").strip()
    if not token_str:
        raise HTTPException(status_code=400, detail="Enter a ticket code or scan a QR code.")
    method = (payload.method or "TICKET_CODE").strip().upper()
    if method not in ("QR", "TICKET_CODE"):
        method = "TICKET_CODE"
    staff_name = assignment.volunteer_name or current_user.full_name or current_user.username
    return _verify_ticket_for_assignment(
        db,
        assignment,
        token_str,
        method,
        staff_name,
        current_user.customer_id,
    )
