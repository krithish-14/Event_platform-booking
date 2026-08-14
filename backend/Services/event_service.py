"""
Event business logic service.
"""

from typing import List, Optional, Tuple
from uuid import UUID
from sqlalchemy import or_, extract
from sqlalchemy.orm import Session

from Models.user import User
from Models.booking import Booking
from Models.event import Event
from Services.geo_service import filter_by_radius


from datetime import datetime, timedelta


def list_events(
    db: Session,
    skip: int = 0,
    limit: int = 50,
    category: Optional[str] = None,
    event_format: Optional[str] = None,
    min_price: Optional[float] = None,
    max_price: Optional[float] = None,
    date_filter: Optional[str] = None,
    location: Optional[str] = None,
) -> List[Event]:
    """Return published events, optionally filtered by category, format, price, date, and location."""
    query = db.query(Event).filter(Event.is_published == True, Event.is_cancelled == False)
    if category and category.lower() != "all":
        query = query.filter(Event.category.ilike(f"%{category}%"))
    if event_format and event_format.lower() != "all":
        query = query.filter(Event.event_format.ilike(f"%{event_format}%"))
    if min_price is not None:
        query = query.filter(Event.price >= min_price)
    if max_price is not None:
        query = query.filter(Event.price <= max_price)
    if location and location.lower() != "all":
        query = query.filter(or_(Event.location.ilike(f"%{location}%"), Event.venue.ilike(f"%{location}%")))
    if date_filter:
        now = datetime.utcnow()
        df = date_filter.lower().strip()
        if df == "today":
            start = datetime(now.year, now.month, now.day)
            end = start + timedelta(days=1)
            query = query.filter(Event.start_date >= start, Event.start_date < end)
        elif df == "tomorrow":
            start = datetime(now.year, now.month, now.day) + timedelta(days=1)
            end = start + timedelta(days=1)
            query = query.filter(Event.start_date >= start, Event.start_date < end)
        elif df in ("weekend", "this_weekend"):
            days_to_sat = (5 - now.weekday()) % 7
            sat_start = datetime(now.year, now.month, now.day) + timedelta(days=days_to_sat)
            mon_start = sat_start + timedelta(days=2)
            query = query.filter(Event.start_date >= sat_start, Event.start_date < mon_start)
    return query.order_by(Event.start_date).offset(skip).limit(limit).all()



def get_event_by_id(db: Session, event_id: UUID) -> Optional[Event]:
    """Return a single event by ID."""
    return db.query(Event).filter(or_(Event.id == event_id, Event.id == str(event_id))).first()


def create_event(db: Session, payload, customer_id: str, organizer_id=None) -> Event:
    """Persist a new event to the database."""
    data = payload.model_dump()
    data["customer_id"] = customer_id
    if organizer_id is not None:
        data["organizer_id"] = organizer_id
    event = Event(**data)
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


def list_nearby_events(
    db: Session,
    lat: float,
    lon: float,
    radius_km: float = 20.0,
    skip: int = 0,
    limit: int = 20,
    category: Optional[str] = None,
) -> List[Tuple[Event, float]]:
    """Return published events within radius_km of (lat, lon), sorted by distance."""
    query = db.query(Event).filter(Event.is_published == True, Event.is_cancelled == False)
    if category:
        query = query.filter(Event.category.ilike(f"%{category}%"))
    candidates = query.all()
    nearby = filter_by_radius(candidates, lat, lon, radius_km=radius_km)
    return nearby[skip : skip + limit]


MONTH_MAP = {
    "january": 1, "jan": 1, "february": 2, "feb": 2, "march": 3, "mar": 3,
    "april": 4, "apr": 4, "may": 5, "june": 6, "jun": 6, "july": 7, "jul": 7,
    "august": 8, "aug": 8, "september": 9, "sep": 9, "sept": 9, "october": 10,
    "oct": 10, "november": 11, "nov": 11, "december": 12, "dec": 12
}


def search_events(
    db: Session,
    query_str: str,
    limit: int = 15,
) -> List[Event]:
    """
    Search published events across title, description, location, venue, category,
    performers, organizer/host name, and start month.
    """
    if not query_str or not query_str.strip():
        return []

    from sqlalchemy import or_, extract
    from Models.user import User

    q_clean = query_str.strip().lower()
    pattern = f"%{q_clean}%"

    query = (
        db.query(Event)
        .outerjoin(User, Event.organizer_id == User.id)
        .filter(Event.is_published == True, Event.is_cancelled == False)
    )

    # Check if query matches a month name
    matched_month = None
    for word in q_clean.split():
        if word in MONTH_MAP:
            matched_month = MONTH_MAP[word]
            break

    # Build OR filters across all searchable fields
    filters = [
        Event.title.ilike(pattern),
        Event.description.ilike(pattern),
        Event.location.ilike(pattern),
        Event.venue.ilike(pattern),
        Event.category.ilike(pattern),
        Event.performers.ilike(pattern),
        User.full_name.ilike(pattern),
    ]

    if matched_month:
        filters.append(extract("month", Event.start_date) == matched_month)

    return query.filter(or_(*filters)).order_by(Event.start_date).limit(limit).all()
