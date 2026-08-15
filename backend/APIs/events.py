"""
Event CRUD routes.
"""

import json
from datetime import datetime, timezone
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

import os
from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.event import Event
from Models.user import User
from Models.organizer import OrganizerAccount
from APIs.organizers import to_public_verification_status, is_organizer_verified

ORGANIZER_VERIFICATION_REQUIRED = os.getenv("ORGANIZER_VERIFICATION_REQUIRED", "false").lower() in ("1", "true", "yes")
from Services.event_service import (
    create_event,
    get_event_by_id,
    get_public_event_by_id,
    list_events,
    list_nearby_events,
    search_events,
    update_event,
    delete_event,
)

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────
class EventCreateRequest(BaseModel):
    title: str
    description: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    start_date: datetime
    end_date: Optional[datetime] = None
    price: float = 0.0
    capacity: Optional[int] = None
    event_format: Optional[str] = "In-person"
    duration: Optional[str] = None
    age_limit: Optional[str] = None
    language: Optional[str] = None
    performers: Optional[Any] = None
    highlights: Optional[Any] = None
    ticket_types: Optional[Any] = None
    terms: Optional[str] = None
    is_published: bool = False


class EventUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    price: Optional[float] = None
    capacity: Optional[int] = None
    event_format: Optional[str] = None
    duration: Optional[str] = None
    age_limit: Optional[str] = None
    language: Optional[str] = None
    performers: Optional[Any] = None
    highlights: Optional[Any] = None
    ticket_types: Optional[Any] = None
    terms: Optional[str] = None
    is_published: Optional[bool] = None


class EventResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    location: Optional[str]
    venue: Optional[str]
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    distance_km: Optional[float] = None
    category: Optional[str]
    image_url: Optional[str]
    start_date: datetime
    end_date: Optional[datetime]
    price: float
    capacity: Optional[int]
    event_format: Optional[str] = "In-person"
    duration: Optional[str] = None
    age_limit: Optional[str] = None
    language: Optional[str] = None
    performers: Optional[Any] = None
    highlights: Optional[Any] = None
    ticket_types: Optional[Any] = None
    terms: Optional[str] = None
    policies: Optional[Any] = None
    is_published: bool
    is_cancelled: bool
    customer_id: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


def _parse_json_field(val: Any) -> Any:
    if val is None:
        return []
    if isinstance(val, (list, dict)):
        return val
    if isinstance(val, str):
        try:
            return json.loads(val)
        except Exception:
            return []
    return []


def _as_utc(dt: Optional[datetime]) -> Optional[datetime]:
    """Public catalog datetimes are stored naive UTC; expose them as aware UTC for the API."""
    if dt is None:
        return None
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


POLICY_FIELD_LABELS = [
    ("event_policy", "Event Policy"),
    ("cancellation_policy", "Cancellation Policy"),
    ("refund_policy", "Refund Policy"),
    ("terms_and_conditions", "Terms & Conditions"),
    ("privacy_policy", "Privacy Policy"),
    ("age_policy", "Age / Entry Policy"),
]


def _normalize_policies(raw: Any) -> Optional[dict]:
    if not raw:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return None
    if not isinstance(raw, dict):
        return None
    cleaned = {}
    for key, _label in POLICY_FIELD_LABELS:
        val = raw.get(key)
        if val and str(val).strip():
            cleaned[key] = str(val).strip()
    return cleaned or None


def _format_policies_text(policies: Optional[dict]) -> Optional[str]:
    if not policies:
        return None
    parts = []
    for key, label in POLICY_FIELD_LABELS:
        val = policies.get(key)
        if val:
            parts.append(f"{label}:\n{val}")
    return "\n\n".join(parts) if parts else None


def _host_policies_for_event(db: Session, event_id) -> Optional[dict]:
    from Models.event_management import EventManagement
    host = db.query(EventManagement).filter(EventManagement.event_id == event_id).first()
    if not host:
        try:
            host = db.query(EventManagement).filter(EventManagement.event_id == str(event_id)).first()
        except Exception:
            host = None
    if not host:
        return None
    return _normalize_policies(getattr(host, "policies_json", None))


# ── Routes ────────────────────────────────────────────────────────────────────
def _event_to_response(
    event: Event,
    distance_km: Optional[float] = None,
    policies: Optional[dict] = None,
) -> EventResponse:
    terms = event.terms
    if not terms and policies:
        terms = _format_policies_text(policies)
    return EventResponse(
        id=str(event.id),
        title=event.title,
        description=event.description,
        location=event.location,
        venue=event.venue,
        latitude=event.latitude,
        longitude=event.longitude,
        distance_km=round(distance_km, 2) if distance_km is not None else None,
        category=event.category,
        image_url=event.image_url,
        start_date=_as_utc(event.start_date),
        end_date=_as_utc(event.end_date),
        price=event.price,
        capacity=event.capacity,
        event_format=event.event_format,
        duration=event.duration,
        age_limit=event.age_limit,
        language=event.language,
        performers=_parse_json_field(event.performers),
        highlights=_parse_json_field(event.highlights),
        ticket_types=_parse_json_field(event.ticket_types),
        terms=terms,
        policies=policies or None,
        is_published=event.is_published,
        is_cancelled=event.is_cancelled,
        customer_id=getattr(event, "customer_id", None) or "CUST-SYSTEM",
        created_at=_as_utc(event.created_at) or datetime.now(timezone.utc),
    )


@router.get("/search", response_model=List[EventResponse])
def search_events_endpoint(
    q: Optional[str] = Query(default=""),
    limit: int = Query(default=15, ge=1, le=50),
    db: Session = Depends(get_db),
):
    """
    Real-time search events by title, category, venue, location, host, artists, or month.
    """
    if not q or not q.strip():
        return []
    return [_event_to_response(e) for e in search_events(db, query_str=q, limit=limit)]


@router.get("/nearby", response_model=List[EventResponse])
def get_nearby_events(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(20.0, ge=1, le=500),
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    category: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List published events within radius_km of the given coordinates (Haversine)."""
    pairs = list_nearby_events(
        db, lat=lat, lon=lon, radius_km=radius_km, skip=skip, limit=limit, category=category
    )
    return [_event_to_response(event, dist) for event, dist in pairs]


@router.get("/public", response_model=List[EventResponse])
def get_public_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    category: Optional[str] = None,
    event_format: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    date_filter: Optional[str] = None,
    location: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """Alias for published-only public event listing."""
    return get_events(
        skip=skip,
        limit=limit,
        category=category,
        event_format=event_format,
        min_price=min_price,
        max_price=max_price,
        date_filter=date_filter,
        location=location,
        db=db,
    )


@router.get("/public/{event_id}", response_model=EventResponse)
def get_public_event(event_id: UUID, db: Session = Depends(get_db)):
    """Get a single published event for public event details pages."""
    event = get_public_event_by_id(db, event_id)
    if not event:
        print(f"[EVENT DETAILS] unavailable event_id={event_id}", flush=True)
        raise HTTPException(status_code=404, detail="This event is currently unavailable.")
    print(f"[EVENT DETAILS] event_id={event_id} title={event.title!r} published={event.is_published}", flush=True)
    policies = _host_policies_for_event(db, event.id)
    if policies:
        formatted = _format_policies_text(policies)
        if formatted and event.terms != formatted:
            event.terms = formatted
            try:
                db.commit()
            except Exception:
                db.rollback()
    return _event_to_response(event, policies=policies)


@router.get("/", response_model=List[EventResponse])
def get_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    category: Optional[str] = None,
    event_format: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    date_filter: Optional[str] = None,
    location: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List all published events with optional category, format, price, date, and location filters."""
    events = list_events(
        db,
        skip=skip,
        limit=limit,
        category=category,
        event_format=event_format,
        min_price=min_price,
        max_price=max_price,
        date_filter=date_filter,
        location=location,
    )
    try:
        print(
            f"[PUBLIC EVENTS] returned={len(events)} category={category!r} "
            f"titles={[e.title for e in events[:5]]}",
            flush=True,
        )
    except Exception:
        pass
    return [_event_to_response(e) for e in events]


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: UUID, db: Session = Depends(get_db)):
    """Get a single published event by ID (public catalog)."""
    event = get_public_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="This event is currently unavailable.")
    policies = _host_policies_for_event(db, event.id)
    return _event_to_response(event, policies=policies)


@router.post("/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_new_event(
    payload: EventCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new event. Requires authentication. is_published=True blocked unless organizer is VERIFIED."""
    if payload.is_published and ORGANIZER_VERIFICATION_REQUIRED:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) |
            (OrganizerAccount.email == current_user.email.lower())
        ).first()
        if not org_acc or not is_organizer_verified(org_acc.status):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please complete organizer verification before publishing an event."
            )
    event = create_event(
        db, payload,
        customer_id=current_user.customer_id,
        organizer_id=getattr(current_user, "id", None),
    )
    return _event_to_response(event)


@router.put("/{event_id}", response_model=EventResponse)
def update_existing_event(
    event_id: UUID,
    payload: EventUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an event. Only the organizer can update. is_published=True blocked unless VERIFIED."""
    event = get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if event.customer_id != current_user.customer_id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized.")

    transitioning_to_publish = (
        payload.is_published is True
        and (not getattr(event, "is_published", False))
    )
    if transitioning_to_publish and ORGANIZER_VERIFICATION_REQUIRED:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) |
            (OrganizerAccount.email == current_user.email.lower())
        ).first()
        if not org_acc or not is_organizer_verified(org_acc.status):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Please complete organizer verification before publishing an event."
            )
    updated = update_event(db, event, payload)
    return _event_to_response(updated)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_existing_event(
    event_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Delete an event. Only the organizer or admin can delete."""
    event = get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if event.customer_id != current_user.customer_id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized.")
    delete_event(db, event)
