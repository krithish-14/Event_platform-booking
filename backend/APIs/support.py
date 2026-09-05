"""
Help & Support tickets — guests and signed-in users can raise a query.
Public ticket IDs use THP-#### (separate from booking tickets).
"""

import random
import re
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user_optional
from Models.base import get_db
from Models.support_ticket import SupportTicket, generate_ticket_code
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
}
ALLOWED_PRIORITIES = {"normal", "high", "urgent"}
_SCHEMA_READY = False


class SupportTicketCreate(BaseModel):
	name: str = Field(..., min_length=2, max_length=200)
	email: EmailStr
	category: str = Field(..., min_length=2, max_length=80)
	priority: str = "normal"
	subject: str = Field(..., min_length=6, max_length=250)
	message: str = Field(..., min_length=20, max_length=4000)


class SupportTicketResponse(BaseModel):
	id: str
	ticket_code: str
	name: str
	email: str
	category: str
	priority: str
	subject: str
	message: str
	status: str
	resolution_note: Optional[str] = None
	resolved_at: Optional[str] = None
	created_at: Optional[str] = None
	updated_at: Optional[str] = None


def _ensure_support_schema(db: Session) -> None:
	"""Add newer columns on existing DBs that only ran create_all once."""
	global _SCHEMA_READY
	if _SCHEMA_READY:
		return
	statements = [
		"ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolution_note TEXT",
		"ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP",
	]
	# SQLite does not support IF NOT EXISTS on ADD COLUMN in older versions
	sqlite_statements = [
		"ALTER TABLE support_tickets ADD COLUMN resolution_note TEXT",
		"ALTER TABLE support_tickets ADD COLUMN resolved_at DATETIME",
	]
	bind = db.get_bind()
	dialect = (bind.dialect.name if bind is not None else "") or ""
	to_run = statements if dialect == "postgresql" else sqlite_statements
	for sql in to_run:
		try:
			db.execute(text(sql))
			db.commit()
		except Exception:
			db.rollback()
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
		category=ticket.category,
		priority=ticket.priority,
		subject=ticket.subject,
		message=ticket.message,
		status=ticket.status,
		resolution_note=getattr(ticket, "resolution_note", None),
		resolved_at=json_datetime(getattr(ticket, "resolved_at", None)),
		created_at=json_datetime(ticket.created_at),
		updated_at=json_datetime(ticket.updated_at),
	)


def _unique_code(db: Session) -> str:
	for _ in range(24):
		code = generate_ticket_code()
		exists = db.query(SupportTicket.ticket_code).filter(SupportTicket.ticket_code == code).first()
		if not exists:
			return code
	# Exhausted short pool — widen digits so create never fails.
	return f"THP-{random.randint(10000, 999999)}"


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
