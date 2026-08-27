"""
FastAPI Router for Dynamic Registration Form Builder & Attendee Submissions.
"""
import io
import csv
import logging
import re
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, insert as sa_insert, or_
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, field_validator

from Models import get_db, FormDefinition, FormSubmission, EventRegistrationForm
from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.user import User

try:
	from Utils.text_sanitize import pick_attendee_identity
except ImportError:
	def pick_attendee_identity(*, names=(), emails=(), phones=()):
		email = next((str(v).strip() for v in emails if v and "@" in str(v)), "")
		name = next((str(v).strip() for v in names if v), "") or (
			email.split("@")[0].replace(".", " ").title() if email else "Guest"
		)
		phone = next((str(v).strip() for v in phones if v), "")
		return name, email, phone

logger = logging.getLogger("jod")

router = APIRouter(prefix="/api/forms", tags=["Dynamic Form Builder"])


class FormSaveRequest(BaseModel):
	organizer_email: EmailStr
	event_id: Optional[str] = None
	form_title: str = "Event Registration Form"
	form_description: Optional[str] = None
	schema_json: List[Dict[str, Any]]
	theme_json: Optional[Dict[str, Any]] = None


class SubmissionRequest(BaseModel):
	form_id: Optional[int] = None
	organizer_email: Optional[str] = None
	event_id: Optional[str] = None
	user_email: EmailStr
	answers_json: Dict[str, Any]
	ticket_type: Optional[str] = None
	ticket_price: Optional[float] = None

	@field_validator("form_id", mode="before")
	@classmethod
	def coerce_form_id(cls, value: Any) -> Optional[int]:
		"""Host forms use UUID ids; submissions.form_id is an integer. Ignore non-integers."""
		if value is None or value == "":
			return None
		if isinstance(value, bool):
			return None
		if isinstance(value, int):
			return value if value > 0 else None
		if isinstance(value, float) and value.is_integer() and value > 0:
			return int(value)
		text = str(value).strip()
		if text.isdigit():
			parsed = int(text)
			return parsed if parsed > 0 else None
		return None

	@field_validator("ticket_type", mode="before")
	@classmethod
	def coerce_ticket_type(cls, value: Any) -> Optional[str]:
		if value is None:
			return None
		text = str(value).strip()
		return text[:100] if text else None


def _integer_form_id_for_event(db: Session, event_id: Optional[str], requested: Optional[int] = None) -> Optional[int]:
	"""Map an event (and optional client form_id) onto form_definitions.id."""
	if requested:
		exists = db.query(FormDefinition.id).filter(FormDefinition.id == requested).first()
		if exists:
			return requested
	event_key = str(event_id or "").strip()
	if not event_key:
		return requested
	form = (
		db.query(FormDefinition)
		.filter(FormDefinition.event_id == event_key)
		.order_by(
			FormDefinition.is_published.desc(),
			FormDefinition.version.desc(),
			FormDefinition.id.desc(),
		)
		.first()
	)
	if form:
		return form.id
	compact = event_key.replace("-", "").lower()
	for row in (
		db.query(FormDefinition)
		.filter(FormDefinition.event_id.isnot(None))
		.order_by(FormDefinition.id.desc())
		.all()
	):
		stored = str(row.event_id or "").strip()
		if stored.lower() == event_key.lower() or stored.replace("-", "").lower() == compact:
			return row.id
	return requested


def _submission_payload(row: FormSubmission, message: str) -> dict:
	return {
		"message": message,
		"submission_id": row.id,
		"status": row.status or "payment_pending",
		"submitted_at": row.submission_time.isoformat() if row.submission_time else None,
	}


def _insert_form_submission(db: Session, values: Dict[str, Any]) -> FormSubmission:
	"""Insert without booking_id so PostgreSQL never receives VARCHAR into a UUID column."""
	table = FormSubmission.__table__
	optional_omit_if_none = {"customer_id", "ticket_type", "ticket_price", "event_id"}
	clean = {
		key: val
		for key, val in values.items()
		if key != "booking_id" and (val is not None or key not in optional_omit_if_none)
	}
	result = db.execute(sa_insert(table).values(**clean).returning(table.c.id))
	new_id = result.scalar_one()
	db.commit()
	return db.query(FormSubmission).filter(FormSubmission.id == new_id).one()


@router.post("/save-draft")
def save_form_draft(
    payload: FormSaveRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
	"""Save or update draft registration form schema. No OTP — OTP is only for event publish."""
	email = current_user.email.lower().strip()

	form = None
	if payload.event_id:
		form = db.query(FormDefinition).filter(
			FormDefinition.organizer_email == email,
			FormDefinition.event_id == str(payload.event_id),
		).order_by(FormDefinition.version.desc(), FormDefinition.id.desc()).first()
	if not form:
		# Only reuse an unscoped/latest form when it belongs to this event (or has no event yet).
		candidate = db.query(FormDefinition).filter(
			FormDefinition.organizer_email == email
		).order_by(FormDefinition.id.desc()).first()
		if candidate:
			if not payload.event_id or not candidate.event_id or str(candidate.event_id) == str(payload.event_id):
				form = candidate

	was_published = bool(form and form.is_published)

	if not form:
		form = FormDefinition(
			organizer_email=email,
			event_id=payload.event_id,
			form_title=payload.form_title,
			form_description=payload.form_description,
			version=1,
			is_published=False,
			schema_json=payload.schema_json,
			theme_json=payload.theme_json or {}
		)
		db.add(form)
	else:
		form.form_title = payload.form_title
		form.form_description = payload.form_description
		form.schema_json = payload.schema_json
		if payload.event_id:
			form.event_id = payload.event_id
		if payload.theme_json:
			form.theme_json = payload.theme_json
		form.updated_at = datetime.utcnow()
		# Updating a live form must not unpublish it (attendees keep seeing the latest schema).
		if was_published:
			form.is_published = True

	# If the host event is already published, keep FormDefinition live after edits.
	if payload.event_id:
		try:
			from Models.event_management import EventManagement
			import uuid as _uuid
			eid = _uuid.UUID(str(payload.event_id))
			host = db.query(EventManagement).filter(EventManagement.event_id == eid).first()
			if host and (host.event_status or "").lower() == "published" and form.schema_json:
				form.is_published = True
		except Exception:
			pass

	db.commit()
	db.refresh(form)

	# Mirror schema into host registration table for Buy Ticket lookups.
	if payload.event_id:
		try:
			import uuid as _uuid
			eid = _uuid.UUID(str(payload.event_id))
			reg = db.query(EventRegistrationForm).filter(EventRegistrationForm.event_id == eid).first()
			if not reg:
				reg = EventRegistrationForm(
					form_id=_uuid.uuid4(),
					event_id=eid,
				)
				db.add(reg)
			reg.questions_json = payload.schema_json
			reg.settings_json = payload.theme_json or {}
			reg.form_json = {
				"form_title": payload.form_title,
				"form_description": payload.form_description or "",
				"schema": payload.schema_json,
				"theme_json": payload.theme_json or {},
			}
			if form.is_published:
				reg.published = True
			reg.updated_at = datetime.utcnow()
			db.commit()
		except Exception:
			db.rollback()

	return {
		"message": "Form draft saved successfully!",
		"form_id": form.id,
		"version": form.version,
		"is_published": form.is_published,
		"updated_at": form.updated_at.isoformat()
	}


@router.get("/get-form")
def get_form_definition(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None, description="Optional host event UUID"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
	"""Fetch form definition & draft schema for the logged-in organizer."""
	email_clean = current_user.email.lower().strip()
	if email and email.lower().strip() != email_clean:
		raise HTTPException(status_code=403, detail="You can only load your own registration form.")
	form = None
	if event_id:
		form = db.query(FormDefinition).filter(
			FormDefinition.organizer_email == email_clean,
			FormDefinition.event_id == str(event_id),
		).order_by(FormDefinition.version.desc(), FormDefinition.id.desc()).first()
	if not form:
		form = db.query(FormDefinition).filter(
			FormDefinition.organizer_email == email_clean
		).order_by(FormDefinition.id.desc()).first()

	if not form:
		# Return default initial schema if no form created yet
		return {
			"exists": False,
			"form_title": "Event Registration Form",
			"form_description": "Please complete the registration form below to confirm your seat.",
			"version": 1,
			"is_published": False,
			"schema_json": [
				{
					"id": "q_name",
					"type": "short_answer",
					"title": "Full Name",
					"placeholder": "Enter your full name",
					"required": True,
					"help_text": "Enter full name as on government ID."
				},
				{
					"id": "q_email",
					"type": "email",
					"title": "Email Address",
					"placeholder": "example@domain.com",
					"required": True
				},
				{
					"id": "q_phone",
					"type": "phone",
					"title": "Mobile Phone Number",
					"placeholder": "9876543210",
					"required": True
				},
				{
					"id": "q_food",
					"type": "radio",
					"title": "Dietary Preference",
					"required": False,
					"options": ["Vegetarian", "Non-Vegetarian", "Vegan"]
				}
			],
			"theme_json": {
				"primary_color": "#2563eb",
				"bg_color": "#f8fafc",
				"font_family": "Grift",
				"border_radius": "8px"
			}
		}

	return {
		"exists": True,
		"form_id": form.id,
		"form_title": form.form_title,
		"form_description": form.form_description,
		"version": form.version,
		"is_published": form.is_published,
		"schema_json": form.schema_json,
		"theme_json": form.theme_json or {
			"primary_color": "#2563eb",
			"bg_color": "#f8fafc",
			"font_family": "Grift",
			"border_radius": "8px"
		}
	}


@router.get("/get-form-by-id")
def get_form_by_id(
	form_id: int = Query(..., description="Form ID integer"),
	mode: Optional[str] = Query(None, description="View mode, e.g. readOnly"),
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional),
):
	"""Fetch a published form, or a host-only unpublished preview."""
	form = db.query(FormDefinition).filter(
		FormDefinition.id == form_id
	).first()

	if not form:
		raise HTTPException(status_code=404, detail="Form not found.")

	if not form.is_published:
		owner_email = (form.organizer_email or "").lower().strip()
		user_email = (current_user.email or "").lower().strip() if current_user else ""
		if mode != "readOnly" or not user_email or user_email != owner_email:
			raise HTTPException(status_code=404, detail="This form has not been published yet.")

	return {
		"exists": True,
		"form_id": form.id,
		"form_title": form.form_title,
		"form_description": form.form_description,
		"version": form.version,
		"is_published": form.is_published,
		"organizer_email": form.organizer_email,
		"event_id": form.event_id,
		"schema_json": form.schema_json,
		"theme_json": form.theme_json or {
			"primary_color": "#2563eb",
			"page_bg_color": "#f8fafc",
			"card_bg_color": "#ffffff",
			"border_radius": "8px",
			"banner_url": "",
			"page_bg_url": ""
		},
		"published_at": form.updated_at.isoformat() if form.updated_at else None
	}


@router.get("/get-form-by-event")
def get_form_by_event(
	event_id: str = Query(..., description="Public event UUID"),
	db: Session = Depends(get_db),
):
	"""Fetch the published registration form for a specific event."""
	import uuid as _uuid
	from Models.event import Event

	def _form_definition_payload(form: FormDefinition):
		return {
			"exists": True,
			"source": "form_definitions",
			"form_id": form.id,
			"event_id": form.event_id,
			"organizer_email": form.organizer_email,
			"form_title": form.form_title,
			"form_description": form.form_description,
			"version": form.version,
			"is_published": True,
			"schema_json": form.schema_json,
			"theme_json": form.theme_json or {},
		}

	def _host_form_payload(reg: EventRegistrationForm, eid: str):
		title = "Event Registration"
		desc = "Please complete the registration form to confirm your booking."
		meta = reg.form_json if isinstance(reg.form_json, dict) else {}
		if meta.get("form_title"):
			title = str(meta.get("form_title"))
		if meta.get("form_description"):
			desc = str(meta.get("form_description"))
		int_form_id = _integer_form_id_for_event(db, eid)
		return {
			"exists": True,
			"source": "event_registration_forms",
			"form_id": int_form_id if int_form_id is not None else str(reg.form_id),
			"registration_form_id": str(reg.form_id),
			"event_id": eid,
			"form_title": title,
			"form_description": desc,
			"version": 1,
			"is_published": True,
			"schema_json": reg.questions_json,
			"theme_json": reg.settings_json or meta.get("theme_json") or {},
		}

	# Prefer FormDefinition linked to event_id
	form = db.query(FormDefinition).filter(
		FormDefinition.event_id == event_id,
		FormDefinition.is_published == True,
	).order_by(FormDefinition.version.desc()).first()

	if form:
		return _form_definition_payload(form)

	# Fallback: host-events registration form table (explicitly published)
	try:
		eid = _uuid.UUID(event_id)
	except Exception:
		eid = None

	if eid is not None:
		reg = db.query(EventRegistrationForm).filter(
			EventRegistrationForm.event_id == eid,
			EventRegistrationForm.published == True,
		).first()
		if reg and reg.questions_json:
			return _host_form_payload(reg, event_id)

		# Heal: live public events should expose their saved host form even if
		# the dashboard previously saved it only as a draft.
		public_event = db.query(Event).filter(
			Event.id == eid,
			Event.is_published == True,
			Event.is_cancelled == False,
		).first()
		if public_event:
			draft_form = db.query(FormDefinition).filter(
				FormDefinition.event_id == event_id,
			).order_by(FormDefinition.version.desc(), FormDefinition.id.desc()).first()
			if draft_form and draft_form.schema_json:
				if not draft_form.is_published:
					draft_form.is_published = True
					draft_form.updated_at = datetime.utcnow()
					db.commit()
					db.refresh(draft_form)
				return _form_definition_payload(draft_form)

			draft_reg = db.query(EventRegistrationForm).filter(
				EventRegistrationForm.event_id == eid,
			).first()
			if draft_reg and draft_reg.questions_json:
				if not draft_reg.published:
					draft_reg.published = True
					draft_reg.updated_at = datetime.utcnow()
					db.commit()
					db.refresh(draft_reg)
				return _host_form_payload(draft_reg, event_id)

	raise HTTPException(status_code=404, detail="No published registration form found for this event.")




@router.post("/publish")
def publish_form(
	payload: FormSaveRequest,
	db: Session = Depends(get_db),
	current_user: User = Depends(get_current_user),
):
	"""Publish current registration form version for attendees."""
	email = current_user.email.lower().strip()

	form = None
	if payload.event_id:
		form = db.query(FormDefinition).filter(
			FormDefinition.organizer_email == email,
			FormDefinition.event_id == payload.event_id,
		).order_by(FormDefinition.version.desc(), FormDefinition.id.desc()).first()
	if not form:
		form = db.query(FormDefinition).filter(
			FormDefinition.organizer_email == email
		).order_by(FormDefinition.id.desc()).first()

	if not form:
		form = FormDefinition(
			organizer_email=email,
			event_id=payload.event_id,
			form_title=payload.form_title,
			form_description=payload.form_description,
			version=1,
			is_published=True,
			schema_json=payload.schema_json,
			theme_json=payload.theme_json or {}
		)
		db.add(form)
	else:
		form.form_title = payload.form_title
		form.form_description = payload.form_description
		form.schema_json = payload.schema_json
		if payload.event_id:
			form.event_id = payload.event_id
		if payload.theme_json:
			form.theme_json = payload.theme_json
		form.version += 1
		form.is_published = True
		form.updated_at = datetime.utcnow()

	db.commit()
	db.refresh(form)

	# Keep host registration form table in sync for Buy Ticket lookups.
	if payload.event_id:
		try:
			import uuid as _uuid
			eid = _uuid.UUID(str(payload.event_id))
			reg = db.query(EventRegistrationForm).filter(EventRegistrationForm.event_id == eid).first()
			if not reg:
				reg = EventRegistrationForm(
					form_id=_uuid.uuid4(),
					event_id=eid,
				)
				db.add(reg)
			reg.questions_json = payload.schema_json
			reg.settings_json = payload.theme_json or {}
			reg.form_json = {
				"form_title": payload.form_title,
				"form_description": payload.form_description or "",
				"schema": payload.schema_json,
				"theme_json": payload.theme_json or {},
			}
			reg.published = True
			reg.updated_at = datetime.utcnow()
			db.commit()
		except Exception:
			db.rollback()

	return {
		"message": f"Form version {form.version} published live for attendees!",
		"form_id": form.id,
		"version": form.version,
		"is_published": True
	}


@router.post("/submissions")
def submit_attendee_response(
	payload: SubmissionRequest,
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional),
):
	"""Submit an attendee registration response. Marks payment as pending until booking is paid."""
	raw_email = ""
	if current_user and getattr(current_user, "email", None):
		raw_email = current_user.email
	elif payload.user_email:
		raw_email = str(payload.user_email)
	user_email = raw_email.lower().strip()
	if not user_email or "@" not in user_email:
		raise HTTPException(status_code=400, detail="A valid email is required to book this ticket.")

	customer_id = getattr(current_user, "customer_id", None) if current_user else None
	if customer_id:
		customer_id = str(customer_id).strip() or None
	event_id_str = str(payload.event_id).strip() if payload.event_id else None
	form_id = _integer_form_id_for_event(db, event_id_str, payload.form_id) or 1

	answers = dict(payload.answers_json or {})
	ticket_type = (payload.ticket_type or "").strip() or None
	ticket_price = payload.ticket_price
	if not ticket_type:
		ticket_type = str(
			answers.get("_ticket_type")
			or answers.get("ticket_type")
			or answers.get("Ticket Type")
			or answers.get("Ticket")
			or ""
		).strip() or None
	if ticket_type:
		ticket_type = ticket_type[:100]
		answers["_ticket_type"] = ticket_type
	if ticket_price is not None:
		answers["_ticket_price"] = ticket_price

	try:
		existing = None
		if event_id_str:
			event_keys = {event_id_str.lower(), event_id_str.lower().replace("-", "")}
			owner_filters = [func.lower(FormSubmission.user_email) == user_email]
			if customer_id:
				owner_filters.append(FormSubmission.customer_id == customer_id)
			candidates = (
				db.query(FormSubmission)
				.filter(or_(*owner_filters))
				.order_by(FormSubmission.submission_time.desc())
				.all()
			)
			for row in candidates:
				stored = str(row.event_id or "").strip().lower()
				if stored in event_keys or stored.replace("-", "") in event_keys:
					existing = row
					break

		if existing:
			status_val = (existing.status or "").lower()
			if status_val == "paid":
				return _submission_payload(existing, "Registration already completed.")
			existing.answers_json = answers
			existing.status = "payment_pending"
			existing.form_id = form_id
			if event_id_str:
				existing.event_id = event_id_str
			if customer_id:
				existing.customer_id = customer_id
			if ticket_type:
				existing.ticket_type = ticket_type
			if ticket_price is not None:
				existing.ticket_price = ticket_price
			db.commit()
			db.refresh(existing)
			return _submission_payload(existing, "Registration submitted successfully!")

		sub = _insert_form_submission(
			db,
			{
				"form_id": form_id,
				"event_id": event_id_str,
				"customer_id": customer_id,
				"user_email": user_email,
				"ticket_type": ticket_type,
				"ticket_price": ticket_price,
				"form_version": 1,
				"answers_json": answers,
				"status": "payment_pending",
				"submission_time": datetime.utcnow(),
			},
		)
		return _submission_payload(sub, "Registration submitted successfully!")
	except HTTPException:
		raise
	except SQLAlchemyError:
		db.rollback()
		logger.exception("form_submission_failed")
		raise HTTPException(
			status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
			detail="Could not save your registration. Please try again.",
		)


INTERNAL_ANSWER_KEYS = {
	"_ticket_type",
	"_ticket_price",
	"ticket_type",
	"ticket_price",
}


def _pretty_answer(value: Any) -> str:
	if value is None:
		return ""
	if isinstance(value, list):
		return ", ".join(str(item).strip() for item in value if str(item).strip())
	if isinstance(value, dict):
		return ", ".join(f"{k}: {v}" for k, v in value.items() if str(v).strip())
	return str(value).strip()


def _answers_dict(row: FormSubmission) -> dict:
	raw = row.answers_json
	if isinstance(raw, str):
		try:
			import json
			raw = json.loads(raw)
		except Exception:
			raw = {}
	return raw if isinstance(raw, dict) else {}


def _pick_answer(answers: dict, *needles: str) -> str:
	for key, val in answers.items():
		label = re.sub(r"\s+", " ", str(key or "")).strip().lower()
		if any(n in label for n in needles):
			text = _pretty_answer(val)
			if text:
				return text
	return ""


GENERIC_TICKET_LABELS = {
	"general admission",
	"general pass",
	"general",
	"ga",
	"standard access",
	"standard access pass",
	"standard",
	"access pass",
	"ticket",
}


def _is_generic_ticket(value: str) -> bool:
	label = re.sub(r"\s+", " ", str(value or "")).strip().lower()
	return (not label) or label in GENERIC_TICKET_LABELS


def _ticket_candidates_from_answers(answers: dict) -> List[str]:
	found: List[str] = []
	seen = set()

	def add(raw: Any) -> None:
		text = _pretty_answer(raw)
		if not text:
			return
		key = text.lower()
		if key in seen:
			return
		seen.add(key)
		found.append(text)

	for key in ("_ticket_type", "ticket_type", "Ticket Type", "Ticket", "Pass Type", "Pass"):
		direct = answers.get(key)
		if direct is not None:
			add(direct)
			continue
		match = next((k for k in answers.keys() if str(k).strip().lower() == key.lower()), None)
		if match:
			add(answers.get(match))

	for key, val in answers.items():
		label = re.sub(r"\s+", " ", str(key or "")).strip().lower()
		if any(skip in label for skip in ("price", "qty", "quantity", "amount", "passport", "password")):
			continue
		if "ticket" in label or re.search(r"\bpass(es)?\b", label):
			add(val)
	return found


def _lookup_related_ticket_data(db: Session, row: FormSubmission) -> tuple:
	found: List[str] = []
	prices: List[float] = []
	try:
		from APIs.bookings import _same_event_id
		from Models.booking import Booking
		from Models.payment_proof import PaymentProof
		from Models.ticket import Ticket
	except Exception:
		return found, prices

	def add_price(raw: Any) -> None:
		try:
			if raw is None or str(raw).strip() == "":
				return
			prices.append(float(raw))
		except (TypeError, ValueError):
			pass

	email = (row.user_email or "").lower().strip()
	customer_id = str(row.customer_id or "").strip()
	event_id = row.event_id

	if row.booking_id:
		try:
			booking = db.query(Booking).filter(Booking.booking_id == row.booking_id).first()
		except Exception:
			booking = None
		if booking:
			found.append(booking.ticket_type)
			add_price(booking.total_price)
			try:
				for ticket in db.query(Ticket).filter(Ticket.booking_id == booking.booking_id).all():
					found.append(ticket.ticket_type)
			except Exception:
				pass

	if email:
		try:
			proofs = (
				db.query(PaymentProof)
				.filter(func.lower(PaymentProof.attendee_email) == email)
				.order_by(PaymentProof.created_at.desc())
				.all()
			)
			for proof in proofs:
				if event_id and proof.event_id and not _same_event_id(proof.event_id, event_id):
					continue
				found.append(proof.ticket_type)
				add_price(proof.amount)
		except Exception:
			pass

		try:
			owner_filters = [func.lower(Booking.receiver_email) == email]
			if customer_id:
				owner_filters.append(Booking.customer_id == customer_id)
			bookings = (
				db.query(Booking)
				.filter(or_(*owner_filters))
				.order_by(Booking.booked_at.desc())
				.all()
			)
			for booking in bookings:
				if event_id and booking.event_id and not _same_event_id(booking.event_id, event_id):
					continue
				found.append(booking.ticket_type)
				add_price(booking.total_price)
				try:
					for ticket in db.query(Ticket).filter(Ticket.booking_id == booking.booking_id).all():
						found.append(ticket.ticket_type)
				except Exception:
					pass
		except Exception:
			pass
	return found, prices


def _ticket_names_by_unique_price(event) -> dict:
	raw = getattr(event, "tickets_json", None) if event is not None else None
	if isinstance(raw, str):
		try:
			import json
			raw = json.loads(raw)
		except Exception:
			raw = []
	if not isinstance(raw, list):
		return {}
	grouped = {}
	for item in raw:
		if not isinstance(item, dict):
			continue
		name = str(item.get("name") or item.get("ticket_name") or item.get("type") or "").strip()
		if not name or _is_generic_ticket(name):
			continue
		try:
			price = float(item.get("price") or item.get("ticket_price") or 0)
		except (TypeError, ValueError):
			continue
		key = round(price, 2)
		grouped.setdefault(key, set()).add(name)
	return {price: next(iter(names)) for price, names in grouped.items() if len(names) == 1}


def _pick_best_ticket(candidates: List[Any]) -> str:
	cleaned = [str(item or "").strip() for item in candidates if str(item or "").strip()]
	for item in cleaned:
		if not _is_generic_ticket(item):
			return item
	return cleaned[0] if cleaned else ""


def _submission_ticket(
	db: Optional[Session],
	row: FormSubmission,
	answers: dict,
	cache: Optional[dict] = None,
	event=None,
) -> str:
	candidates = _ticket_candidates_from_answers(answers)
	if row.ticket_type:
		candidates.append(row.ticket_type)
	related_prices: List[float] = []
	if db is not None:
		cache = cache if cache is not None else {}
		key = (
			(row.user_email or "").lower().strip(),
			str(row.event_id or ""),
			str(row.booking_id or ""),
			str(row.id or ""),
		)
		if key not in cache:
			cache[key] = _lookup_related_ticket_data(db, row)
		related_names, related_prices = cache[key]
		candidates.extend(related_names)
	best = _pick_best_ticket(candidates)
	if best and not _is_generic_ticket(best):
		return best

	price_map = _ticket_names_by_unique_price(event)
	if price_map:
		price_candidates = []
		if row.ticket_price is not None:
			price_candidates.append(row.ticket_price)
		ans_price = answers.get("_ticket_price") or answers.get("ticket_price")
		if ans_price is not None:
			price_candidates.append(ans_price)
		price_candidates.extend(related_prices)
		for raw in price_candidates:
			try:
				mapped = price_map.get(round(float(raw), 2))
			except (TypeError, ValueError):
				mapped = None
			if mapped:
				return mapped
	return best


def _question_columns(db: Session, event, submissions: list) -> List[str]:
	titles: List[str] = []
	seen = set()

	def add_title(raw: Any) -> None:
		title = str(raw or "").strip()
		if not title or title.startswith("_"):
			return
		key = title.lower()
		if key in seen or key in INTERNAL_ANSWER_KEYS:
			return
		seen.add(key)
		titles.append(title)

	if event is not None:
		try:
			reg_form = (
				db.query(EventRegistrationForm)
				.filter(EventRegistrationForm.event_id == event.event_id)
				.first()
			)
		except Exception:
			reg_form = None
		questions = []
		if reg_form:
			if isinstance(reg_form.questions_json, list):
				questions = reg_form.questions_json
			elif isinstance(reg_form.form_json, dict):
				questions = reg_form.form_json.get("questions") or []
			elif isinstance(reg_form.form_json, list):
				questions = reg_form.form_json
		for item in questions:
			if isinstance(item, dict):
				add_title(item.get("title") or item.get("label") or item.get("name") or item.get("id"))
			elif item:
				add_title(item)

		organizer_email = (getattr(event, "organizer_email", None) or "").lower().strip()
		if organizer_email:
			form_def = (
				db.query(FormDefinition)
				.filter(func.lower(FormDefinition.organizer_email) == organizer_email)
				.order_by(FormDefinition.id.desc())
				.first()
			)
			schema = form_def.schema_json if form_def else None
			if isinstance(schema, list):
				for item in schema:
					if isinstance(item, dict):
						add_title(item.get("title") or item.get("label") or item.get("id"))

	for row in submissions:
		answers = _answers_dict(row)
		for key in answers.keys():
			add_title(key)
	return titles


def _extend_columns_from_items(columns: List[str], items: list) -> List[str]:
	seen = {str(col).strip().lower() for col in columns}
	extra: List[str] = []
	for item in items:
		for key in (item.get("answer_values") or {}):
			title = str(key or "").strip()
			if not title or title.lower() in seen:
				continue
			seen.add(title.lower())
			extra.append(title)
	return list(columns) + extra


def _serialize_submission(
	row: FormSubmission,
	columns: List[str],
	db: Optional[Session] = None,
	ticket_cache: Optional[dict] = None,
	event=None,
) -> dict:
	answers = _answers_dict(row)
	answer_values = {}
	for title in columns:
		direct = answers.get(title)
		if direct is None:
			match_key = next(
				(k for k in answers.keys() if str(k).strip().lower() == title.strip().lower()),
				None,
			)
			direct = answers.get(match_key) if match_key else ""
		answer_values[title] = _pretty_answer(direct)
	for key, val in answers.items():
		title = str(key or "").strip()
		if not title or title.startswith("_") or title.lower() in INTERNAL_ANSWER_KEYS:
			continue
		if not any(title.lower() == col.lower() for col in columns):
			answer_values[title] = _pretty_answer(val)
	submitted = row.submission_time
	ticket_type = _submission_ticket(db, row, answers, ticket_cache, event)
	customer = getattr(row, "customer", None)
	name, email, phone = pick_attendee_identity(
		names=(
			getattr(customer, "full_name", None) if customer is not None else None,
			_pick_answer(answers, "full name", "attendee name", "your name", "name"),
		),
		emails=(
			row.user_email,
			getattr(customer, "email", None) if customer is not None else None,
		),
		phones=(
			getattr(customer, "phone", None) if customer is not None else None,
			_pick_answer(answers, "phone", "mobile", "whatsapp"),
		),
	)
	return {
		"id": row.id,
		"user_email": email or row.user_email or "",
		"attendee_name": name,
		"phone": phone,
		"ticket_type": ticket_type or row.ticket_type or "",
		"submitted_at": submitted.strftime("%b %d, %Y %I:%M %p") if submitted else "",
		"submitted_at_iso": submitted.isoformat() if submitted else "",
		"status": row.status or "submitted",
		"answers": {k: v for k, v in answers.items() if not str(k).startswith("_")},
		"answer_values": answer_values,
	}


def _host_event_for_submissions(db: Session, email: str, event_id: Optional[str], current_user):
	from APIs.host_events_api import resolve_or_create_event

	event, _, _ = resolve_or_create_event(
		db, email, event_id, current_user, create_if_missing=False
	)
	return event


@router.get("/submissions")
def get_form_submissions(
	email: Optional[str] = Query(None, description="Organizer email address"),
	event_id: Optional[str] = Query(None),
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional)
):
	"""Fetch completed registration forms for the organizer's current event."""
	if not current_user:
		raise HTTPException(status_code=401, detail="Authentication required.")
	email_clean = (email or current_user.email or "").lower().strip()
	event = _host_event_for_submissions(db, email_clean, event_id, current_user)
	from APIs.host_events_api import _form_submissions_for_event

	submissions = _form_submissions_for_event(db, event) if event else []
	submissions = sorted(
		submissions,
		key=lambda row: row.submission_time or datetime.min,
		reverse=True,
	)
	columns = _question_columns(db, event, submissions)
	ticket_cache = {}
	items = [_serialize_submission(row, columns, db, ticket_cache, event) for row in submissions]
	columns = _extend_columns_from_items(columns, items)
	total_count = len(items)
	paid_count = sum(1 for item in items if str(item.get("status") or "").lower() in ("paid", "completed", "confirmed"))

	return {
		"columns": columns,
		"analytics": {
			"total_registrations": total_count,
			"completion_rate": f"{round((paid_count / total_count) * 100)}%" if total_count else "0%",
			"abandonment_rate": "0%",
			"avg_completion_time": "—"
		},
		"submissions": items
	}


@router.get("/export-csv")
def export_submissions_csv(
	email: Optional[str] = Query(None, description="Organizer email address"),
	event_id: Optional[str] = Query(None),
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional),
):
	"""Export one registration per row, with form questions as readable columns."""
	if not current_user:
		raise HTTPException(status_code=401, detail="Authentication required.")
	email_clean = (email or current_user.email or "").lower().strip()
	event = _host_event_for_submissions(db, email_clean, event_id, current_user)
	from APIs.host_events_api import _form_submissions_for_event

	submissions = _form_submissions_for_event(db, event) if event else []
	submissions = sorted(
		submissions,
		key=lambda row: row.submission_time or datetime.min,
		reverse=True,
	)
	columns = _question_columns(db, event, submissions)
	ticket_cache = {}
	items = [_serialize_submission(row, columns, db, ticket_cache, event) for row in submissions]
	columns = _extend_columns_from_items(columns, items)

	output = io.StringIO()
	writer = csv.writer(output)
	header = [
		"Submission ID",
		"Submitted At",
		"Status",
		"Attendee Name",
		"Attendee Email",
		"Phone",
		"Ticket Type",
	] + columns
	writer.writerow(header)
	for item in items:
		writer.writerow([
			item["id"],
			item["submitted_at"],
			item["status"],
			item["attendee_name"],
			item["user_email"],
			item["phone"],
			item["ticket_type"],
		] + [item["answer_values"].get(col, "") for col in columns])

	filename = f"event_registrations_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"
	return Response(
		content="\ufeff" + output.getvalue(),
		media_type="text/csv; charset=utf-8",
		headers={"Content-Disposition": f'attachment; filename="{filename}"'}
	)
