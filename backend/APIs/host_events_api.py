"""
API endpoints for Host Event Creation Workflow — Live Auto-Save & UPSERT for:
1. EventManagement (Manage Event page)
2. EventDesign (Design Event page)
3. EventRegistrationForm (Registration Form Builder)
"""

import uuid
from datetime import datetime, date
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy import or_, and_
from sqlalchemy.orm import Session
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
    EventEntryGate,
    EventStaffScanner,
)
from Authentication.dependencies import get_current_user_optional
from Utils.id_generator import generate_customer_id, generate_host_id_from_customer_id

router = APIRouter()


# ── Helper to resolve Customer ID & Host ID for an email ─────────────────────
def resolve_host_identifiers(db: Session, email: str, current_user: Optional[User] = None):
    email_clean = email.lower().strip()
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


def resolve_or_create_event(db: Session, email: str, event_id: Optional[str] = None, current_user: Optional[User] = None):
    email_clean = email.lower().strip()
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
            or_(
                EventManagement.organizer_email == email_clean,
                EventManagement.customer_id == customer_id,
                EventManagement.host_id == host_id
            )
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

    return event, customer_id, host_id


def sync_published_event_to_public_catalog(db: Session, event_mgt: EventManagement):
    """
    Bridge function: When a host publishes an event, sync its details
    to the public `events` table so normal users can browse and book it.
    """
    from Models.event import Event
    from Models.host_event import EventDesign
    from Models.organizer_accounts import OrganizerAccount
    from Models.user import User

    design = db.query(EventDesign).filter(EventDesign.event_id == event_mgt.event_id).first()
    image_url = design.banner_image if design else None

    # Resolve organizer_id (UUID PK of OrganizerAccount or User)
    org_acc = db.query(OrganizerAccount).filter(
        (OrganizerAccount.customer_id == event_mgt.customer_id) |
        (OrganizerAccount.email == event_mgt.organizer_email.lower().strip())
    ).first()
    user_acc = db.query(User).filter(
        (User.customer_id == event_mgt.customer_id) |
        (User.email == event_mgt.organizer_email.lower().strip())
    ).first()

    organizer_id = user_acc.id if user_acc else None

    start_dt = event_mgt.created_at or datetime.utcnow()
    if event_mgt.event_start_date:
        try:
            start_dt = datetime.strptime(str(event_mgt.event_start_date)[:10], "%Y-%m-%d")
        except Exception:
            pass

    end_dt = None
    if event_mgt.event_end_date:
        try:
            end_dt = datetime.strptime(str(event_mgt.event_end_date)[:10], "%Y-%m-%d")
        except Exception:
            pass

    # Check if corresponding public Event record exists
    public_event = db.query(Event).filter(Event.id == event_mgt.event_id).first()
    if not public_event:
        public_event = Event(
            id=event_mgt.event_id,
            title=event_mgt.event_title or "Untitled Event",
            description=design.event_description if (design and hasattr(design, "event_description")) else None,
            location=event_mgt.venue or "Chennai",
            venue=event_mgt.venue,
            category=event_mgt.event_category or "Corporate Conference",
            image_url=image_url or "images/hero-event.jpg",
            start_date=start_dt,
            end_date=end_dt,
            is_published=True,
            customer_id=event_mgt.customer_id,
            organizer_id=organizer_id
        )
        db.add(public_event)
    else:
        public_event.title = event_mgt.event_title or public_event.title
        public_event.location = event_mgt.venue or public_event.location
        public_event.venue = event_mgt.venue or public_event.venue
        public_event.category = event_mgt.event_category or public_event.category
        if image_url:
            public_event.image_url = image_url
        public_event.start_date = start_dt
        public_event.is_published = True
        public_event.customer_id = event_mgt.customer_id
        if organizer_id:
            public_event.organizer_id = organizer_id

    db.commit()


# ── Schemas ───────────────────────────────────────────────────────────────────
class SaveManageEventRequest(BaseModel):
    event_id: Optional[str] = None
    organizer_email: str
    event_title: Optional[str] = "My New Event"
    event_category: Optional[str] = "Conferences"
    event_type: Optional[str] = "General"
    event_mode: Optional[str] = "Hybrid"
    event_start_date: Optional[str] = None
    event_end_date: Optional[str] = None
    event_start_time: Optional[str] = None
    event_end_time: Optional[str] = None
    venue: Optional[str] = None
    address: Optional[str] = None
    organizer_name: Optional[str] = None
    organizer_phone: Optional[str] = None
    event_status: Optional[str] = "draft"
    tickets_json: Optional[List[Dict[str, Any]]] = None
    agenda_json: Optional[List[Dict[str, Any]]] = None


class SaveEventDesignRequest(BaseModel):
    event_id: Optional[str] = None
    organizer_email: str
    banner_image: Optional[str] = None
    logo: Optional[str] = None
    theme_color: Optional[str] = "#2563eb"
    font: Optional[str] = "Inter"
    gallery_images: Optional[List[str]] = None
    about_event: Optional[str] = None
    highlights: Optional[str] = None
    speaker_details: Optional[List[Dict[str, Any]]] = None
    sponsor_details: Optional[List[Dict[str, Any]]] = None
    social_links: Optional[Dict[str, Any]] = None
    custom_sections: Optional[List[Dict[str, Any]]] = None


class SaveRegistrationFormRequest(BaseModel):
    event_id: Optional[str] = None
    organizer_email: str
    form_json: Optional[Dict[str, Any]] = None
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
    audience: Optional[str] = "all_attendees"
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
    scan_method: Optional[str] = "manual"
    status: Optional[str] = "checked_in"
    notes: Optional[str] = None


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/manage")
def save_manage_event(
    payload: SaveManageEventRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """UPSERT endpoint for Manage Event step."""
    customer_id, host_id = resolve_host_identifiers(db, payload.organizer_email, current_user)
    email_clean = payload.organizer_email.lower().strip()

    event = None
    if payload.event_id:
        try:
            event_uuid = uuid.UUID(payload.event_id)
            event = db.query(EventManagement).filter(EventManagement.event_id == event_uuid).first()
            if event and current_user:
                if event.customer_id and current_user.customer_id and event.customer_id != current_user.customer_id and event.organizer_email.lower() != current_user.email.lower():
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Forbidden: You are not authorized to modify another host's event resource."
                    )
        except HTTPException:
            raise
        except ValueError:
            pass

    if not event:
        # Check for existing draft event for this organizer
        event = db.query(EventManagement).filter(
            EventManagement.organizer_email == email_clean,
            EventManagement.event_status == "draft"
        ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        event = EventManagement(
            event_id=uuid.uuid4(),
            organizer_email=email_clean,
            event_title=payload.event_title or "My New Event"
        )
        db.add(event)

    # Update attributes in place (UPSERT)
    event.customer_id = customer_id
    event.host_id = host_id
    if payload.event_title: event.event_title = payload.event_title
    if payload.event_category: event.event_category = payload.event_category
    if payload.event_type: event.event_type = payload.event_type
    if payload.event_mode: event.event_mode = payload.event_mode
    if payload.venue: event.venue = payload.venue
    if payload.address: event.address = payload.address
    if payload.organizer_name: event.organizer_name = payload.organizer_name
    if payload.organizer_phone: event.organizer_phone = payload.organizer_phone
    if payload.event_status: event.event_status = payload.event_status
    if payload.event_start_time is not None: event.event_start_time = payload.event_start_time
    if payload.event_end_time is not None: event.event_end_time = payload.event_end_time
    if payload.event_start_date:
        try:
            if isinstance(payload.event_start_date, str):
                event.event_start_date = datetime.fromisoformat(payload.event_start_date.replace("Z", "+00:00"))
            else:
                event.event_start_date = payload.event_start_date
        except Exception:
            pass
    if payload.event_end_date:
        try:
            if isinstance(payload.event_end_date, str):
                event.event_end_date = datetime.fromisoformat(payload.event_end_date.replace("Z", "+00:00"))
            else:
                event.event_end_date = payload.event_end_date
        except Exception:
            pass
    if payload.tickets_json is not None: event.tickets_json = payload.tickets_json
    if payload.agenda_json is not None: event.agenda_json = payload.agenda_json
    event.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(event)

    if event.event_status == "published":
        try:
            sync_published_event_to_public_catalog(db, event)
        except Exception:
            pass

    return {
        "status": "success",
        "message": "Manage event details saved (UPSERT)",
        "event_id": str(event.event_id),
        "customer_id": event.customer_id,
        "host_id": event.host_id,
        "event": {
            "event_id": str(event.event_id),
            "event_title": event.event_title,
            "event_category": event.event_category,
            "event_mode": event.event_mode,
            "venue": event.venue,
            "event_status": event.event_status,
            "tickets": event.tickets_json,
            "agenda": event.agenda_json,
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
    email_clean = payload.organizer_email.lower().strip()

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
    if payload.logo: design.logo = payload.logo
    if payload.theme_color: design.theme_color = payload.theme_color
    if payload.font: design.font = payload.font
    if payload.gallery_images is not None: design.gallery_images = payload.gallery_images
    if payload.about_event: design.about_event = payload.about_event
    if payload.highlights: design.highlights = payload.highlights
    if payload.speaker_details is not None: design.speaker_details = payload.speaker_details
    if payload.sponsor_details is not None: design.sponsor_details = payload.sponsor_details
    if payload.social_links is not None: design.social_links = payload.social_links
    if payload.custom_sections is not None: design.custom_sections = payload.custom_sections
    design.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(design)

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
            "speaker_details": design.speaker_details,
            "sponsor_details": design.sponsor_details,
            "gallery_images": design.gallery_images,
            "updated_at": design.updated_at.isoformat() if design.updated_at else None
        }
    }


@router.post("/registration-form")
def save_registration_form(
    payload: SaveRegistrationFormRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """UPSERT endpoint for Registration Form Builder step."""
    customer_id, host_id = resolve_host_identifiers(db, payload.organizer_email, current_user)
    email_clean = payload.organizer_email.lower().strip()

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

    if reg_form.published:
        event.event_status = "published"
        db.commit()
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
    email_clean = email.lower().strip()
    customer_id, host_id = resolve_host_identifiers(db, email_clean, current_user)

    event = db.query(EventManagement).filter(
        EventManagement.organizer_email == email_clean
    ).order_by(EventManagement.created_at.desc()).first()

    if not event:
        return {
            "has_event": False,
            "customer_id": customer_id,
            "host_id": host_id,
            "event": None,
            "design": None,
            "registration_form": None
        }

    design = db.query(EventDesign).filter(EventDesign.event_id == event.event_id).first()
    reg_form = db.query(EventRegistrationForm).filter(EventRegistrationForm.event_id == event.event_id).first()

    return {
        "has_event": True,
        "customer_id": customer_id,
        "host_id": host_id,
        "event": {
            "event_id": str(event.event_id),
            "customer_id": event.customer_id or customer_id,
            "host_id": event.host_id or host_id,
            "event_title": event.event_title,
            "event_category": event.event_category,
            "event_mode": event.event_mode,
            "venue": event.venue,
            "address": event.address,
            "organizer_name": event.organizer_name,
            "organizer_email": event.organizer_email,
            "organizer_phone": event.organizer_phone,
            "event_status": event.event_status,
            "tickets": event.tickets_json,
            "agenda": event.agenda_json,
            "updated_at": event.updated_at.isoformat() if event.updated_at else None
        },
        "design": {
            "design_id": str(design.design_id) if design else None,
            "banner_image": design.banner_image if design else None,
            "theme_color": design.theme_color if design else "#2563eb",
            "speaker_details": design.speaker_details if design else [],
            "sponsor_details": design.sponsor_details if design else [],
            "gallery_images": design.gallery_images if design else []
        } if design else None,
        "registration_form": {
            "form_id": str(reg_form.form_id) if reg_form else None,
            "form_json": reg_form.form_json if reg_form else {},
            "questions_json": reg_form.questions_json if reg_form else [],
            "published": reg_form.published if reg_form else False
        } if reg_form else None
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
    event, customer_id, host_id = resolve_or_create_event(db, email, event_id, current_user)

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
            "total_registrations": len(registrations),
            "pending_registrations": sum(1 for item in registrations if item.status == "pending"),
            "confirmed_registrations": sum(1 for item in registrations if item.status == "confirmed"),
            "checked_in_count": len(checkins),
            "tickets_available": sum(ticket.quantity or 0 for ticket in tickets),
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
    email_clean = payload.organizer_email.lower().strip()

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
    email_clean = payload.organizer_email.lower().strip()

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
    event, _, _ = resolve_or_create_event(db, email, event_id, current_user)
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
    email_clean = payload.organizer_email.lower().strip()

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
    """Create a check-in entry for a registration or attendee."""
    event, customer_id, host_id = resolve_or_create_event(db, payload.organizer_email, payload.event_id, current_user)
    email_clean = payload.organizer_email.lower().strip()

    registration = None
    if payload.registration_id:
        try:
            reg_uuid = uuid.UUID(payload.registration_id)
            registration = db.query(EventRegistration).filter(EventRegistration.id == reg_uuid).first()
        except ValueError:
            pass
    if not registration and payload.attendee_email:
        registration = db.query(EventRegistration).filter(
            EventRegistration.event_id == event.event_id,
            EventRegistration.attendee_email == payload.attendee_email.lower().strip()
        ).order_by(EventRegistration.created_at.desc()).first()

    checkin = EventAttendanceCheckin(
        id=uuid.uuid4(),
        event_id=event.event_id,
        customer_id=customer_id,
        host_id=host_id,
        created_by=email_clean,
        registration_id=registration.id if registration else None,
        attendee_name=payload.attendee_name or (registration.attendee_name if registration else None),
        attendee_email=payload.attendee_email or (registration.attendee_email if registration else None),
        scan_method=payload.scan_method or "manual",
        status=payload.status or "checked_in",
        notes=payload.notes,
    )
    db.add(checkin)

    if registration:
        registration.checkin_status = payload.status or "checked_in"
        registration.updated_at = datetime.utcnow()

    db.commit()
    db.refresh(checkin)

    return {"status": "success", "checkin_id": str(checkin.id), "message": "Check-in saved"}


# ── Communication Endpoints ────────────────────────────────────────────────
@router.get("/communications")
def get_communications(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Return saved communications for the organizer's event."""
    event, _, _ = resolve_or_create_event(db, email, event_id, current_user)
    items = db.query(EventCommunication).filter(
        EventCommunication.event_id == event.event_id,
        EventCommunication.deleted_at.is_(None)
    ).order_by(EventCommunication.created_at.desc()).all()

    return {"communications": [
        {
            "communication_id": str(item.id),
            "audience": item.audience or "all_attendees",
            "channel": item.channel or "email",
            "subject": item.subject or "",
            "message": item.message or "",
            "status": item.status or "scheduled",
            "delivery_status": item.delivery_status or "pending",
            "created_at": item.created_at.isoformat() if item.created_at else None,
        }
        for item in items
    ]}


@router.post("/communications")
def save_communication(
    payload: SaveCommunicationRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Create or update a communication message."""
    event, customer_id, host_id = resolve_or_create_event(db, payload.organizer_email, payload.event_id, current_user)
    email_clean = payload.organizer_email.lower().strip()

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


# ── Reports Endpoint ───────────────────────────────────────────────────────
@router.get("/reports")
def get_reports_summary(
    email: str = Query(..., description="Organizer email address"),
    event_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Return financial and engagement metrics for the reports tab."""
    event, _, _ = resolve_or_create_event(db, email, event_id, current_user)

    tickets = db.query(EventRegistrationTicket).filter(
        EventRegistrationTicket.event_id == event.event_id,
        EventRegistrationTicket.deleted_at.is_(None)
    ).all()
    registrations = db.query(EventRegistration).filter(
        EventRegistration.event_id == event.event_id,
        EventRegistration.deleted_at.is_(None)
    ).all()
    checkins = db.query(EventAttendanceCheckin).filter(
        EventAttendanceCheckin.event_id == event.event_id,
        EventAttendanceCheckin.deleted_at.is_(None)
    ).all()
    communications = db.query(EventCommunication).filter(
        EventCommunication.event_id == event.event_id,
        EventCommunication.deleted_at.is_(None)
    ).all()
    exhibitors = db.query(Exhibitor).filter(
        Exhibitor.event_id == event.event_id,
        Exhibitor.deleted_at.is_(None)
    ).all()

    gross_revenue = 0.0
    for registration in registrations:
        ticket = db.query(EventRegistrationTicket).filter(EventRegistrationTicket.id == registration.ticket_id).first() if registration.ticket_id else None
        if ticket:
            gross_revenue += float(ticket.price or 0.0)

    attendance_rate = round((len(checkins) / len(registrations) * 100) if registrations else 0.0, 1)
    conversion_rate = round((len(registrations) / max(sum(ticket.quantity or 0 for ticket in tickets), 1) * 100), 1)
    net_earnings = round(gross_revenue * 0.9, 2)

    return {
        "event_title": event.event_title,
        "gross_revenue": round(gross_revenue, 2),
        "net_earnings": net_earnings,
        "attendance_rate": attendance_rate,
        "conversion_rate": conversion_rate,
        "registrations_count": len(registrations),
        "checkins_count": len(checkins),
        "communications_count": len(communications),
        "exhibitors_count": len(exhibitors),
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
    email_clean = email.lower().strip()
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

    # Ticket capacity calculation
    total_capacity = 0
    if event.tickets_json and isinstance(event.tickets_json, list):
        for t in event.tickets_json:
            try:
                total_capacity += int(t.get("quantity", t.get("qty", 0)))
            except (ValueError, TypeError):
                pass

    return {
        "has_event": True,
        "event_id": str(event.event_id),
        "event_title": event.event_title,
        "event_status": event.event_status,
        "customer_id": event.customer_id or customer_id,
        "host_id": event.host_id or host_id,
        "total_sales": 0.0,  # Live booking integration placeholder
        "total_registrations": 0,
        "days_to_event": days_left,
        "tickets_sold": 0,
        "tickets_available": total_capacity,
        "checked_in": 0,
        "yet_to_checkin": 0,
        "speakers_count": speakers_count,
        "sponsors_count": sponsors_count,
        "exhibitors_count": exhibitors_count,
        "exhibitors_confirmed": exhibitors_confirmed,
        "exhibitors_pending": exhibitors_pending,
        "event_start_date": event.event_start_date.isoformat() if event.event_start_date else None,
        "venue": event.venue or "Venue TBD"
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
    email_clean = email.lower().strip()
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
    email_clean = payload.organizer_email.lower().strip()
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
    db: Session = Depends(get_db)
):
    """Resets and clears all host events, designs, registration forms, and exhibitors for an organizer."""
    email_clean = email.lower().strip()
    events = db.query(EventManagement).filter(EventManagement.organizer_email == email_clean).all()
    for ev in events:
        db.delete(ev)
    db.commit()
    return {"status": "success", "message": "Event cleared successfully"}


# ── Gates Endpoints ───────────────────────────────────────────────────────────

@router.get("/gates")
def get_gates(
    organizer_email: str,
    event_id: Optional[str] = None,
    db: Session = Depends(get_db)
):
    """Retrieve all gates for an event."""
    email_clean = organizer_email.lower().strip()
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
    email_clean = payload.organizer_email.lower().strip()
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
    db: Session = Depends(get_db)
):
    """Retrieve all volunteer scanners for an event."""
    email_clean = organizer_email.lower().strip()
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
    email_clean = payload.organizer_email.lower().strip()
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



