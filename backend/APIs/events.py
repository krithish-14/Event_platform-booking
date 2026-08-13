"""
Event CRUD routes.
"""

import json
from datetime import datetime
from typing import Any, List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.event import Event
from Models.user import User
from Services.event_service import (
    create_event,
    get_event_by_id,
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


# ── Routes ────────────────────────────────────────────────────────────────────
def _event_to_response(event: Event, distance_km: Optional[float] = None) -> EventResponse:
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
        start_date=event.start_date,
        end_date=event.end_date,
        price=event.price,
        capacity=event.capacity,
        event_format=event.event_format,
        duration=event.duration,
        age_limit=event.age_limit,
        language=event.language,
        performers=_parse_json_field(event.performers),
        highlights=_parse_json_field(event.highlights),
        ticket_types=_parse_json_field(event.ticket_types),
        terms=event.terms,
        is_published=event.is_published,
        is_cancelled=event.is_cancelled,
        customer_id=getattr(event, "customer_id", None) or "CUST-SYSTEM",
        created_at=event.created_at or datetime.utcnow(),
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
    return [
        _event_to_response(e)
        for e in list_events(
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
    ]


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: UUID, db: Session = Depends(get_db)):
    """Get a single event by ID."""
    event = get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    return _event_to_response(event)


@router.post("/", response_model=EventResponse, status_code=status.HTTP_201_CREATED)
def create_new_event(
    payload: EventCreateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a new event. Requires authentication."""
    return create_event(db, payload, customer_id=current_user.customer_id)


@router.put("/{event_id}", response_model=EventResponse)
def update_existing_event(
    event_id: UUID,
    payload: EventUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update an event. Only the organizer can update."""
    event = get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    if event.customer_id != current_user.customer_id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Not authorized.")
    return update_event(db, event, payload)


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
