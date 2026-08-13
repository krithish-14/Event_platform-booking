"""
Event CRUD routes.
"""

from datetime import datetime
from typing import List, Optional
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
    category: Optional[str] = None
    image_url: Optional[str] = None
    start_date: datetime
    end_date: Optional[datetime] = None
    price: float = 0.0
    capacity: Optional[int] = None
    is_published: bool = False


class EventUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    location: Optional[str] = None
    venue: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    start_date: Optional[datetime] = None
    end_date: Optional[datetime] = None
    price: Optional[float] = None
    capacity: Optional[int] = None
    is_published: Optional[bool] = None


class EventResponse(BaseModel):
    id: str
    title: str
    description: Optional[str]
    location: Optional[str]
    venue: Optional[str]
    category: Optional[str]
    image_url: Optional[str]
    start_date: datetime
    end_date: Optional[datetime]
    price: float
    capacity: Optional[int]
    is_published: bool
    is_cancelled: bool
    customer_id: str
    created_at: datetime

    class Config:
        from_attributes = True


# ── Routes ────────────────────────────────────────────────────────────────────
@router.get("/", response_model=List[EventResponse])
def get_events(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    category: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List all published events with optional category filter."""
    return list_events(db, skip=skip, limit=limit, category=category)


@router.get("/{event_id}", response_model=EventResponse)
def get_event(event_id: UUID, db: Session = Depends(get_db)):
    """Get a single event by ID."""
    event = get_event_by_id(db, event_id)
    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")
    return event


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
