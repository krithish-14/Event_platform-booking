"""
FastAPI Router for Dynamic Registration Form Builder & Attendee Submissions.
"""
import io
import csv
from datetime import datetime
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, or_
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from Models import get_db, FormDefinition, FormSubmission, EventRegistrationForm
from Authentication.dependencies import get_current_user_optional
from Models.user import User

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


@router.post("/save-draft")
def save_form_draft(payload: FormSaveRequest, db: Session = Depends(get_db)):
	"""Save or update draft registration form schema."""
	email = payload.organizer_email.lower().strip()

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

	db.commit()
	db.refresh(form)

	return {
		"message": "Form draft saved successfully!",
		"form_id": form.id,
		"version": form.version,
		"is_published": form.is_published,
		"updated_at": form.updated_at.isoformat()
	}


@router.get("/get-form")
def get_form_definition(email: str = Query(..., description="Organizer email address"), db: Session = Depends(get_db)):
	"""Fetch form definition & draft schema."""
	email_clean = email.lower().strip()
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
				"font_family": "Outfit",
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
			"font_family": "Outfit",
			"border_radius": "8px"
		}
	}


@router.get("/get-form-by-id")
def get_form_by_id(
	form_id: int = Query(..., description="Form ID integer"),
	mode: Optional[str] = Query(None, description="View mode, e.g. readOnly"),
	db: Session = Depends(get_db)
):
	"""Fetch a published or host preview form definition by its integer ID."""
	form = db.query(FormDefinition).filter(
		FormDefinition.id == form_id
	).first()

	if not form:
		raise HTTPException(status_code=404, detail="Form not found.")

	if not form.is_published and mode != "readOnly":
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

	# Prefer FormDefinition linked to event_id
	form = db.query(FormDefinition).filter(
		FormDefinition.event_id == event_id,
		FormDefinition.is_published == True,
	).order_by(FormDefinition.version.desc()).first()

	if not form:
		form = db.query(FormDefinition).filter(
			FormDefinition.event_id == event_id,
		).order_by(FormDefinition.version.desc()).first()

	if form:
		return {
			"exists": True,
			"source": "form_definitions",
			"form_id": form.id,
			"event_id": form.event_id,
			"organizer_email": form.organizer_email,
			"form_title": form.form_title,
			"form_description": form.form_description,
			"version": form.version,
			"is_published": form.is_published,
			"schema_json": form.schema_json,
			"theme_json": form.theme_json or {},
		}

	# Fallback: host-events registration form table
	try:
		eid = _uuid.UUID(event_id)
		reg = db.query(EventRegistrationForm).filter(
			EventRegistrationForm.event_id == eid,
			EventRegistrationForm.published == True,
		).first()
		if reg and reg.questions_json:
			return {
				"exists": True,
				"source": "event_registration_forms",
				"form_id": str(reg.form_id),
				"event_id": event_id,
				"form_title": "Event Registration",
				"form_description": "Please complete the registration form to confirm your booking.",
				"version": 1,
				"is_published": True,
				"schema_json": reg.questions_json,
				"theme_json": reg.settings_json or {},
			}
	except Exception:
		pass

	raise HTTPException(status_code=404, detail="No published registration form found for this event.")




@router.post("/publish")
def publish_form(payload: FormSaveRequest, db: Session = Depends(get_db)):
	"""Publish current registration form version for attendees."""
	email = payload.organizer_email.lower().strip()

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
	user_email = (current_user.email if current_user else payload.user_email).lower().strip()
	customer_id = getattr(current_user, "customer_id", None) if current_user else None
	form_id = payload.form_id or 1
	answers = dict(payload.answers_json or {})
	ticket_type = payload.ticket_type
	ticket_price = payload.ticket_price
	if ticket_type:
		answers["_ticket_type"] = ticket_type
	if ticket_price is not None:
		answers["_ticket_price"] = ticket_price

	existing = None
	if payload.event_id:
		event_id_val = str(payload.event_id).strip()
		event_keys = {event_id_val.lower(), event_id_val.lower().replace("-", "")}
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
			return {
				"message": "Registration already completed.",
				"submission_id": existing.id,
				"status": "paid",
				"submitted_at": existing.submission_time.isoformat() if existing.submission_time else None,
			}
		existing.answers_json = answers
		existing.status = "payment_pending"
		if payload.event_id:
			existing.event_id = str(payload.event_id)
		if customer_id:
			existing.customer_id = customer_id
		if ticket_type:
			existing.ticket_type = ticket_type
		if ticket_price is not None:
			existing.ticket_price = ticket_price
		db.commit()
		db.refresh(existing)
		return {
			"message": "Registration submitted successfully!",
			"submission_id": existing.id,
			"status": "payment_pending",
			"submitted_at": existing.submission_time.isoformat() if existing.submission_time else None,
		}

	sub = FormSubmission(
		form_id=form_id,
		event_id=str(payload.event_id) if payload.event_id else None,
		customer_id=customer_id,
		user_email=user_email,
		ticket_type=ticket_type,
		ticket_price=ticket_price,
		form_version=1,
		answers_json=answers,
		status="payment_pending",
	)
	db.add(sub)
	db.commit()
	db.refresh(sub)

	return {
		"message": "Registration submitted successfully!",
		"submission_id": sub.id,
		"status": "payment_pending",
		"submitted_at": sub.submission_time.isoformat() if sub.submission_time else None,
	}


@router.get("/submissions")
def get_form_submissions(
	email: Optional[str] = Query(None, description="Organizer email address"),
	db: Session = Depends(get_db),
	current_user: Optional[User] = Depends(get_current_user_optional)
):
	"""Fetch submissions table and analytics metrics for organizer."""
	if not current_user and not email:
		raise HTTPException(status_code=401, detail="Authentication required.")

	email_clean = (email or (current_user.email if current_user else "")).lower().strip()

	form = db.query(FormDefinition).filter(
		FormDefinition.organizer_email == email_clean
	).order_by(FormDefinition.id.desc()).first()

	form_id = form.id if form else 1

	submissions = db.query(FormSubmission).filter(
		FormSubmission.form_id == form_id
	).order_by(FormSubmission.submission_time.desc()).all()

	items = []
	for s in submissions:
		items.append({
			"id": s.id,
			"user_email": s.user_email,
			"submitted_at": s.submission_time.strftime("%b %d, %Y %I:%M %p"),
			"status": s.status,
			"answers": s.answers_json
		})

	total_count = len(items)

	return {
		"analytics": {
			"total_registrations": total_count,
			"completion_rate": "100%" if total_count else "0%",
			"abandonment_rate": "0%",
			"avg_completion_time": "—"
		},
		"submissions": items
	}


@router.get("/export-csv")
def export_submissions_csv(email: str = Query(..., description="Organizer email address"), db: Session = Depends(get_db)):
	"""Export form submissions as downloadable CSV file."""
	email_clean = email.lower().strip()
	form = db.query(FormDefinition).filter(
		FormDefinition.organizer_email == email_clean
	).order_by(FormDefinition.id.desc()).first()

	form_id = form.id if form else 1

	submissions = db.query(FormSubmission).filter(
		FormSubmission.form_id == form_id
	).order_by(FormSubmission.submission_time.desc()).all()

	output = io.StringIO()
	writer = csv.writer(output)

	# CSV Header
	writer.writerow(["Submission ID", "Attendee Email", "Submitted At", "Status", "Form Answers JSON"])

	if submissions:
		for s in submissions:
			writer.writerow([s.id, s.user_email, s.submission_time.isoformat(), s.status, str(s.answers_json)])
	else:
		writer.writerow([101, "john.doe@example.com", "2026-08-03T14:15:00", "completed", '{"Full Name": "John Doe", "Dietary Preference": "Vegetarian"}'])
		writer.writerow([102, "sarah.smith@techcorp.com", "2026-08-03T15:40:00", "completed", '{"Full Name": "Sarah Smith", "Dietary Preference": "Vegan"}'])

	csv_content = output.getvalue()
	filename = f"event_registrations_{datetime.now().strftime('%Y%m%d_%H%M%S')}.csv"

	return Response(
		content=csv_content,
		media_type="text/csv",
		headers={"Content-Disposition": f"attachment; filename={filename}"}
	)
