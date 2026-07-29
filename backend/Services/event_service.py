"""
Event business logic service.
"""

from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session

from Models.event import Event


def list_events(
    db: Session,
    skip: int = 0,
    limit: int = 20,
    category: Optional[str] = None,
) -> List[Event]:
    """Return published events, optionally filtered by category."""
    query = db.query(Event).filter(Event.is_published == True, Event.is_cancelled == False)
    if category:
        query = query.filter(Event.category.ilike(f"%{category}%"))
    return query.order_by(Event.start_date).offset(skip).limit(limit).all()


def get_event_by_id(db: Session, event_id: UUID) -> Optional[Event]:
    """Return a single event by ID."""
    return db.query(Event).filter(Event.id == event_id).first()


def create_event(db: Session, payload, organizer_id: UUID) -> Event:
    """Persist a new event to the database."""
    event = Event(**payload.model_dump(), organizer_id=organizer_id)
    db.add(event)
    db.commit()
    db.refresh(event)
    return event


def update_event(db: Session, event: Event, payload) -> Event:
    """Apply partial updates to an existing event."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(event, field, value)
    db.commit()
    db.refresh(event)
    return event


def delete_event(db: Session, event: Event) -> None:
    """Hard-delete an event."""
    db.delete(event)
    db.commit()
