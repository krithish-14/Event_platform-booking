"""
Help & Support tickets — guests and signed-in users can raise a query.
Public ticket IDs use THP-#### (separate from booking tickets).
"""

import html
import os
import random
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.base import get_db
from Models.support_ticket import SupportTicket, ensure_support_ticket_columns, generate_ticket_code
from Models.user import User
from Services.rate_limit import limit_support
from Utils.datetimes import json_datetime

router = APIRouter()

ALLOWED_CATEGORIES = {
	"bookings",
	"tickets",
	"payments",
	"hosting",
	"account",
	"checkin",
	"other",
	"event_cancellation",
	"event_changes",
	"payouts",
}
HOST_CATEGORIES = {
	"event_cancellation",
	"event_changes",
	"payouts",
	"tickets",
	"checkin",
	"account",
	"other",
}
ALLOWED_PRIORITIES = {"normal", "high", "urgent"}
_SCHEMA_READY = False


class SupportTicketCreate(BaseModel):
	name: str = Field(..., min_length=2, max_length=200)
	email: EmailStr
	phone: Optional[str] = Field(None, max_length=50)
	category: str = Field(..., min_length=2, max_length=80)
	priority: str = "normal"
	subject: str = Field(..., min_length=6, max_length=250)
	message: str = Field(..., min_length=20, max_length=4000)


class SupportTicketResponse(BaseModel):
	id: str
	ticket_code: str
	name: str
	email: str
	phone: Optional[str] = None
	category: str
	priority: str
	subject: str
	message: str
	status: str
	resolution_note: Optional[str] = None
	resolved_at: Optional[str] = None
	created_at: Optional[str] = None
	updated_at: Optional[str] = None
	event_id: Optional[str] = None
	event_title: Optional[str] = None
	decision: Optional[str] = None
	decided_at: Optional[str] = None


class HostSupportRequestCreate(BaseModel):
	category: str = Field(..., min_length=2, max_length=80)
	subject: str = Field(..., min_length=6, max_length=250)
	message: str = Field(..., min_length=20, max_length=4000)
	event_id: Optional[str] = Field(None, max_length=64)
	priority: str = "normal"
	phone: Optional[str] = Field(None, max_length=50)


def _ensure_support_schema(db: Session) -> None:
	"""Add newer columns on existing DBs that only ran create_all once."""
	global _SCHEMA_READY
	if _SCHEMA_READY:
		return
	ensure_support_ticket_columns(db)
	_SCHEMA_READY = True


def _normalize_category(raw: str) -> str:
	value = str(raw or "").strip().lower().replace(" ", "_").replace("&", "")
	aliases = {
		"e-tickets": "tickets",
		"e_tickets": "tickets",
		"etickets": "tickets",
		"payments_refunds": "payments",
		"refunds": "payments",
		"check-in": "checkin",
		"check_in": "checkin",
	}
	value = aliases.get(value, value)
	if value not in ALLOWED_CATEGORIES:
		raise HTTPException(status_code=400, detail="Choose a valid support category.")
	return value


def _normalize_priority(raw: str) -> str:
	value = str(raw or "normal").strip().lower()
	if value not in ALLOWED_PRIORITIES:
		return "normal"
	return value


def _normalize_ticket_code(raw: str) -> str:
	code = str(raw or "").strip().upper().replace(" ", "")
	if not code:
		raise HTTPException(status_code=400, detail="Enter a support ticket ID.")
	if not code.startswith("THP-"):
		# Allow bare digits → THP-1232
		if re.fullmatch(r"\d{4,8}", code):
			code = f"THP-{code}"
		elif code.startswith("HT-"):
			raise HTTPException(
				status_code=400,
				detail="Help tickets now use THP- IDs (for example THP-1232), not HT- or booking ticket codes.",
			)
		else:
			raise HTTPException(status_code=400, detail="Use a Help & Support ID like THP-1232.")
	if not re.fullmatch(r"THP-\d{4,8}", code):
		raise HTTPException(status_code=400, detail="Use a Help & Support ID like THP-1232.")
	return code


def _serialize(ticket: SupportTicket) -> SupportTicketResponse:
	return SupportTicketResponse(
		id=str(ticket.id),
		ticket_code=ticket.ticket_code,
		name=ticket.name,
		email=ticket.email,
		phone=getattr(ticket, "phone", None),
		category=ticket.category,
		priority=ticket.priority,
		subject=ticket.subject,
		message=ticket.message,
		status=ticket.status,
		resolution_note=getattr(ticket, "resolution_note", None),
		resolved_at=json_datetime(getattr(ticket, "resolved_at", None)),
		created_at=json_datetime(ticket.created_at),
		updated_at=json_datetime(ticket.updated_at),
		event_id=getattr(ticket, "event_id", None),
		event_title=getattr(ticket, "event_title", None),
		decision=getattr(ticket, "decision", None),
		decided_at=json_datetime(getattr(ticket, "decided_at", None)),
	)


def _unique_code(db: Session) -> str:
	for _ in range(24):
		code = generate_ticket_code()
		exists = db.query(SupportTicket.ticket_code).filter(SupportTicket.ticket_code == code).first()
		if not exists:
			return code
	# Exhausted short pool — widen digits so create never fails.
	return f"THP-{random.randint(10000, 999999)}"


def _notify_admin_new_support_ticket(ticket: SupportTicket) -> bool:
	admin_addr = (os.getenv("ADMIN_EMAIL") or "contact@jodevents.com").strip()
	if not admin_addr or "@" not in admin_addr:
		return False
	code = ticket.ticket_code
	phone_str = ticket.phone or "Not provided"
	is_cancel = ticket.category == "event_cancellation"
	event_line = ""
	event_html = ""
	if getattr(ticket, "event_id", None):
		event_label = f"{ticket.event_title or 'Untitled event'} ({ticket.event_id})"
		event_line = f"Event: {event_label}\n"
		event_html = f"<p><strong>Event:</strong> {html.escape(event_label)}</p>"
	if is_cancel:
		event_line += "Action needed: approve or reject this event cancellation in the Admin Portal.\n"
		event_html += "<p style='color:#b91c1c;'><strong>Action needed:</strong> approve or reject this event cancellation in the Admin Portal. The host cannot cancel until you approve.</p>"
	prefix = "Event Cancellation Request" if is_cancel else "Support Ticket"
	subject = f"[{prefix} {code}] {ticket.subject} — from {ticket.name}"
	text_body = (
		f"A new Help & Support ticket has been submitted.\n\n"
		f"Ticket ID: {code}\n"
		f"Customer Name: {ticket.name}\n"
		f"Customer Email: {ticket.email}\n"
		f"Customer Phone: {phone_str}\n"
		f"Category: {ticket.category}\n"
		f"Priority: {ticket.priority}\n"
		f"{event_line}"
		f"Subject: {ticket.subject}\n\n"
		f"Message:\n{ticket.message}\n\n"
		f"View this ticket in Admin Portal:\n"
		f"https://jodevents.com/admin.html?section=support\n"
	)
	html_body = (
		f"<h2 style='color:#1e293b;margin-bottom:12px;'>New Support Ticket: {code}</h2>"
		f"<p><strong>Name:</strong> {ticket.name}</p>"
		f"<p><strong>Email:</strong> <a href='mailto:{ticket.email}'>{ticket.email}</a></p>"
		f"<p><strong>Phone:</strong> {phone_str}</p>"
		f"<p><strong>Category:</strong> {ticket.category} &middot; <strong>Priority:</strong> {ticket.priority}</p>"
		f"{event_html}"
		f"<p><strong>Subject:</strong> {ticket.subject}</p>"
		f"<hr style='border:0;border-top:1px solid #e2e8f0;margin:16px 0;'/>"
		f"<p><strong>Message:</strong></p>"
		f"<div style='background:#f8fafc;padding:14px 18px;border-left:4px solid #f97316;border-radius:6px;white-space:pre-wrap;line-height:1.5;'>{ticket.message}</div>"
		f"<p style='margin-top:20px;'><a href='https://jodevents.com/admin.html?section=support' style='display:inline-block;background:#f97316;color:#ffffff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;'>Open in Admin Portal</a></p>"
	)
	try:
		from Services.email import send_email
		return bool(send_email(admin_addr, subject, text_body, html_body=html_body))
	except Exception:
		return False


@router.post("/tickets", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
def create_support_ticket(
	payload: SupportTicketCreate,
	request: Request,
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional),
):
	_ensure_support_schema(db)
	name = payload.name.strip()
	email = str(payload.email).strip().lower()
	if current_user and current_user.email:
		email = current_user.email.lower().strip()
		if current_user.full_name:
			name = current_user.full_name.strip() or name
	phone = (payload.phone or "").strip() or None
	if not phone and current_user and getattr(current_user, "phone", None):
		phone = str(current_user.phone).strip() or None
	limit_support(request, email)
	subject = payload.subject.strip()
	message = payload.message.strip()
	if not name or not subject or not message:
		raise HTTPException(status_code=400, detail="Name, subject, and message are required.")

	ticket = SupportTicket(
		ticket_code=_unique_code(db),
		customer_id=current_user.customer_id if current_user else None,
		name=name,
		email=current_user.email.lower() if current_user and current_user.email else email,
		phone=phone,
		category=_normalize_category(payload.category),
		priority=_normalize_priority(payload.priority),
		subject=subject,
		message=message,
		status="open",
	)
	db.add(ticket)
	try:
		db.commit()
	except IntegrityError:
		db.rollback()
		ticket.ticket_code = _unique_code(db)
		db.add(ticket)
		db.commit()
	db.refresh(ticket)
	try:
		_notify_admin_new_support_ticket(ticket)
	except Exception:
		pass
	return _serialize(ticket)


@router.get("/tickets", response_model=List[SupportTicketResponse])
def list_support_tickets(
	email: Optional[str] = Query(None),
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional),
):
	_ensure_support_schema(db)
	query = db.query(SupportTicket)
	if current_user:
		query = query.filter(
			or_(
				SupportTicket.customer_id == current_user.customer_id,
				SupportTicket.email == (current_user.email or "").lower(),
			)
		)
	else:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Sign in to view your support tickets.",
		)

	rows = query.order_by(SupportTicket.created_at.desc()).limit(40).all()
	return [_serialize(row) for row in rows]


@router.get("/tickets/lookup", response_model=SupportTicketResponse)
def lookup_support_ticket(
	request: Request,
	code: str = Query(..., min_length=4, max_length=20),
	db: Session = Depends(get_db),
):
	"""Look up one Help & Support ticket by THP- ID (not booking tickets)."""
	_ensure_support_schema(db)
	ticket_code = _normalize_ticket_code(code)
	try:
		limit_support(request, ticket_code.lower())
	except HTTPException:
		raise
	except Exception:
		pass
	row = db.query(SupportTicket).filter(SupportTicket.ticket_code == ticket_code).first()
	if not row:
		raise HTTPException(status_code=404, detail="No Help & Support ticket found for that ID.")
	return _serialize(row)


# ── Host Help & Support (dashboard) ───────────────────────────


def _owned_host_event(db: Session, event_id: str, current_user: User):
	from APIs.host_events_api import _event_owned, _lookup_event_by_id

	event = _lookup_event_by_id(db, event_id)
	if not event:
		raise HTTPException(status_code=404, detail="That event was not found on your host account.")
	email_clean = (current_user.email or "").lower().strip()
	if not _event_owned(event, email_clean, current_user.customer_id, None, current_user):
		raise HTTPException(status_code=403, detail="You can only raise requests for your own events.")
	return event


def _host_tickets_query(db: Session, current_user: User):
	return db.query(SupportTicket).filter(
		or_(
			SupportTicket.customer_id == current_user.customer_id,
			SupportTicket.email == (current_user.email or "").lower(),
		)
	)


@router.get("/host/requests", response_model=List[SupportTicketResponse])
def list_host_requests(
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	_ensure_support_schema(db)
	rows = _host_tickets_query(db, current_user).order_by(SupportTicket.created_at.desc()).limit(50).all()
	return [_serialize(row) for row in rows]


@router.get("/host/cancellation-status")
def host_cancellation_status(
	event_id: str = Query(..., min_length=4, max_length=64),
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	from Services.event_cancellation import cancellation_state

	_ensure_support_schema(db)
	event = _owned_host_event(db, event_id, current_user)
	state = cancellation_state(db, event.event_id)
	state["event_id"] = str(event.event_id)
	state["event_status"] = (event.event_status or "").lower()
	return state


@router.post("/host/requests", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
def create_host_request(
	payload: HostSupportRequestCreate,
	request: Request,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	from Services.event_cancellation import (
		CANCEL_CATEGORY,
		DECISION_APPROVED,
		DECISION_PENDING,
		cancellation_state,
	)

	_ensure_support_schema(db)
	category = _normalize_category(payload.category)
	if category not in HOST_CATEGORIES:
		raise HTTPException(status_code=400, detail="Choose a valid host request category.")
	email = (current_user.email or "").lower().strip()
	if not email:
		raise HTTPException(status_code=400, detail="Your account needs an email address to raise a request.")
	limit_support(request, email)

	event = None
	if payload.event_id:
		event = _owned_host_event(db, payload.event_id, current_user)
	if category == CANCEL_CATEGORY:
		if not event:
			raise HTTPException(status_code=400, detail="Choose the event you want to cancel.")
		if (event.event_status or "").lower() in ("cancelled", "unpublished"):
			raise HTTPException(status_code=409, detail="This event is already cancelled.")
		current = cancellation_state(db, event.event_id)
		if current["state"] == DECISION_PENDING:
			raise HTTPException(
				status_code=409,
				detail=f"Your cancellation request {current['ticket_code']} is already waiting for admin approval.",
			)
		if current["state"] == DECISION_APPROVED:
			raise HTTPException(
				status_code=409,
				detail="Cancellation is already approved. You can cancel the event from Help & Support or Settings.",
			)

	name = (current_user.full_name or "").strip() or email.split("@")[0]
	phone = (payload.phone or "").strip() or (str(current_user.phone).strip() if getattr(current_user, "phone", None) else None)
	ticket = SupportTicket(
		ticket_code=_unique_code(db),
		customer_id=current_user.customer_id,
		name=name[:200],
		email=email,
		phone=phone,
		category=category,
		priority="high" if category == CANCEL_CATEGORY else _normalize_priority(payload.priority),
		subject=payload.subject.strip(),
		message=payload.message.strip(),
		status="open",
		event_id=str(event.event_id) if event else None,
		event_title=(event.event_title or "")[:300] if event else None,
		decision=DECISION_PENDING if category == CANCEL_CATEGORY else None,
	)
	db.add(ticket)
	try:
		db.commit()
	except IntegrityError:
		db.rollback()
		ticket.ticket_code = _unique_code(db)
		db.add(ticket)
		db.commit()
	db.refresh(ticket)
	try:
		_notify_admin_new_support_ticket(ticket)
	except Exception:
		pass
	return _serialize(ticket)
