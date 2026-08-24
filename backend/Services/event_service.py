"""
Event business logic service.
"""

from typing import List, Optional, Tuple
from uuid import UUID
from sqlalchemy import or_, extract, desc
from sqlalchemy.orm import Session

from Models.user import User
from Models.booking import Booking
from Models.event import Event
from Services.geo_service import filter_by_radius


from datetime import datetime, timedelta, timezone
from Utils.categories import normalize_category

IST = timezone(timedelta(hours=5, minutes=30))


def _parse_json_maybe(value):
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            import json
            return json.loads(text)
        except Exception:
            return None
    return None


def _parse_ticket_datetime(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            return dt.replace(tzinfo=IST).astimezone(timezone.utc).replace(tzinfo=None)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    text = str(value).strip()
    if not text:
        return None
    try:
        if text.endswith("Z"):
            text = text[:-1] + "+00:00"
        dt = datetime.fromisoformat(text)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=IST)
        return dt.astimezone(timezone.utc).replace(tzinfo=None)
    except Exception:
        return None


def is_ticket_on_sale(ticket, now=None) -> bool:
    if not isinstance(ticket, dict):
        return True
    now = now or datetime.utcnow()
    start = _parse_ticket_datetime(
        ticket.get("sales_start") or ticket.get("offer_start") or ticket.get("sale_start")
    )
    end = _parse_ticket_datetime(
        ticket.get("sales_end") or ticket.get("offer_end") or ticket.get("sale_end")
    )
    if start and now < start:
        return False
    if end and now >= end:
        return False
    return True


def event_currently_visible(event, now=None) -> bool:
    now = now or datetime.utcnow()
    if getattr(event, "end_date", None) and event.end_date <= now:
        return False
    tickets = _parse_json_maybe(getattr(event, "ticket_types", None))
    if not isinstance(tickets, list) or not tickets:
        return True
    return any(is_ticket_on_sale(item, now) for item in tickets)


def _heal_host_schedule(db: Session, events):
    """Prefer the host-entered start/end over a previously synced clock-now fallback."""
    try:
        from APIs.host_events_api import apply_host_schedule_to_public_events
        apply_host_schedule_to_public_events(db, events)
    except Exception:
        pass


def _apply_category_filter(query, category: Optional[str]):
    """Filter published events by the exact stored category. No title/alias inference."""
    if not category or str(category).lower().strip() == "all":
        return query
    canonical = normalize_category(category)
    if not canonical:
        return query.filter(Event.id.is_(None))
    return query.filter(Event.category == canonical)


def _published_events_query(db: Session):
    now = datetime.utcnow()
    return db.query(Event).filter(
        Event.is_published == True,
        Event.is_cancelled == False,
        or_(Event.end_date.is_(None), Event.end_date > now),
    )


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
    query = _published_events_query(db)
    query = _apply_category_filter(query, category)
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
    # Newest published/updated events first so freshly published items appear on Home immediately.
    rows = (
        query.order_by(desc(Event.updated_at), Event.start_date.asc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    _heal_host_schedule(db, rows)
    return [row for row in rows if event_currently_visible(row)]



def get_event_by_id(db: Session, event_id: UUID) -> Optional[Event]:
    """Return a single event by ID (any status — organizer/admin use)."""
    return db.query(Event).filter(or_(Event.id == event_id, Event.id == str(event_id))).first()


def get_public_event_by_id(db: Session, event_id: UUID) -> Optional[Event]:
    """Return a published, non-cancelled event for public pages."""
    event = (
        db.query(Event)
        .filter(
            or_(Event.id == event_id, Event.id == str(event_id)),
            Event.is_published == True,
            Event.is_cancelled == False,
        )
        .first()
    )
    if event:
        _heal_host_schedule(db, [event])
    return event


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
    query = _published_events_query(db)
    query = _apply_category_filter(query, category)
    candidates = query.all()
    nearby = [
        pair for pair in filter_by_radius(candidates, lat, lon, radius_km=radius_km)
        if event_currently_visible(pair[0])
    ]
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
        .filter(
            Event.is_published == True,
            Event.is_cancelled == False,
            or_(Event.end_date.is_(None), Event.end_date > datetime.utcnow()),
        )
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

    rows = query.filter(or_(*filters)).order_by(Event.start_date).limit(limit * 3).all()
    _heal_host_schedule(db, rows)
    return [row for row in rows if event_currently_visible(row)][:limit]
