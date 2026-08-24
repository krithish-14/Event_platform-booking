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
    card_image: Optional[str] = None
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
    gallery_images: Optional[Any] = None
    sponsors: Optional[Any] = None
    ticket_types: Optional[Any] = None
    terms: Optional[str] = None
    policies: Optional[Any] = None
    agenda: Optional[Any] = None
    performers_title: Optional[str] = None
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


def _parse_list_field(val: Any) -> list:
    if val is None:
        return []
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except Exception:
            return []
    return val if isinstance(val, list) else []


def _normalize_gallery_images(raw: Any) -> list:
    if raw is None or raw == "":
        return []
    if isinstance(raw, str):
        stripped = raw.strip()
        if stripped.startswith("[") or stripped.startswith("{"):
            raw = _parse_list_field(stripped)
        elif stripped.startswith("http") or stripped.startswith("/") or stripped.startswith("images/"):
            return [stripped]
        else:
            raw = _parse_list_field(stripped)
    urls = []
    items = raw if isinstance(raw, list) else _parse_list_field(raw)
    for item in items:
        if isinstance(item, str) and item.strip():
            urls.append(item.strip())
        elif isinstance(item, dict):
            url = item.get("url") or item.get("image_url") or item.get("src") or ""
            if url:
                urls.append(str(url).strip())
    return urls


def _normalize_sponsors(raw: Any) -> list:
    items = []
    for sp in _parse_list_field(raw):
        if not isinstance(sp, dict):
            continue
        name = str(sp.get("name") or sp.get("title") or "").strip()
        logo = str(sp.get("logo_url") or sp.get("image_url") or "").strip()
        if not name and not logo:
            continue
        items.append({
            "name": name,
            "tier": str(sp.get("tier") or sp.get("subtitle") or sp.get("category") or "").strip(),
            "logo_url": logo,
        })
    return items


def _design_lookup_candidates(event_id) -> list:
    candidates = [event_id]
    text_id = str(event_id) if event_id is not None else ""
    if text_id and text_id not in candidates:
        candidates.append(text_id)
    try:
        parsed = UUID(text_id)
        if parsed not in candidates:
            candidates.append(parsed)
    except Exception:
        pass
    return candidates


def _host_design_for_event(db: Session, event_id) -> tuple:
    from Models.event_design import EventDesign
    from Models.event_management import EventManagement

    design = None
    for cand in _design_lookup_candidates(event_id):
        try:
            design = db.query(EventDesign).filter(EventDesign.event_id == cand).first()
        except Exception:
            design = None
        if design:
            break

    if not design:
        host = None
        for cand in _design_lookup_candidates(event_id):
            try:
                host = db.query(EventManagement).filter(EventManagement.event_id == cand).first()
            except Exception:
                host = None
            if host:
                break
        if host:
            try:
                design = db.query(EventDesign).filter(EventDesign.event_id == host.event_id).first()
            except Exception:
                design = None

    if not design:
        return [], [], None
    title = getattr(design, "performers_title", None)
    performers_title = str(title).strip() if title and str(title).strip() else None
    return (
        _normalize_gallery_images(design.gallery_images),
        _normalize_sponsors(design.sponsor_details),
        performers_title,
    )


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


def _host_agenda_for_event(db: Session, event_id) -> list:
    from Models.event_management import EventManagement
    host = None
    for cand in _design_lookup_candidates(event_id):
        try:
            host = db.query(EventManagement).filter(EventManagement.event_id == cand).first()
        except Exception:
            host = None
        if host:
            break
    if not host:
        return []
    raw = getattr(host, "agenda_json", None)
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return []
    if not isinstance(raw, list):
        return []
    out = []
    for row in raw:
        if not isinstance(row, dict):
            continue
        title = str(row.get("title") or row.get("session") or row.get("name") or "").strip()
        if not title:
            continue
        out.append({
            "time": str(row.get("time") or row.get("slot") or "").strip(),
            "title": title,
            "speaker": str(row.get("speaker") or row.get("host") or "").strip(),
        })
    return out


def _host_tickets_for_event(db: Session, event_id) -> Optional[list]:
    """Live ticket tiers + offer windows from host Manage (preferred over catalog snapshot)."""
    from Models.event_management import EventManagement
    host = None
    for cand in _design_lookup_candidates(event_id):
        try:
            host = db.query(EventManagement).filter(EventManagement.event_id == cand).first()
        except Exception:
            host = None
        if host:
            break
    if not host:
        return None
    raw = getattr(host, "tickets_json", None)
    if raw is None:
        return None
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except Exception:
            return None
    if not isinstance(raw, list):
        return None
    return raw


# ── Routes ────────────────────────────────────────────────────────────────────
def _event_to_response(
    event: Event,
    distance_km: Optional[float] = None,
    policies: Optional[dict] = None,
    gallery_images: Optional[Any] = None,
    sponsors: Optional[Any] = None,
    agenda: Optional[Any] = None,
    performers_title: Optional[str] = None,
    ticket_types: Optional[Any] = None,
) -> EventResponse:
    terms = event.terms
    if not terms and policies:
        terms = _format_policies_text(policies)
    if gallery_images is None:
        gallery_images = []
    stored_gallery = _normalize_gallery_images(_parse_json_field(getattr(event, "gallery_images", None)))
    if not gallery_images and stored_gallery:
        gallery_images = stored_gallery
    if sponsors is None:
        sponsors = _normalize_sponsors(_parse_json_field(event.highlights))
    resolved_tickets = ticket_types if ticket_types is not None else _parse_json_field(event.ticket_types)
    if isinstance(resolved_tickets, str):
        resolved_tickets = _parse_json_field(resolved_tickets)
    if not isinstance(resolved_tickets, list):
        resolved_tickets = []
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
        card_image=getattr(event, "card_image", None),
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
        gallery_images=gallery_images or [],
        sponsors=sponsors or [],
        ticket_types=resolved_tickets,
        terms=terms,
        policies=policies or None,
        agenda=agenda or [],
        performers_title=(str(performers_title).strip() if performers_title else None),
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
    gallery_images, sponsors, performers_title = _host_design_for_event(db, event.id)
    if not gallery_images:
        gallery_images = _normalize_gallery_images(_parse_json_field(getattr(event, "gallery_images", None)))
    if not sponsors:
        sponsors = _normalize_sponsors(_parse_json_field(event.highlights))
    print(f"[EVENT DETAILS] gallery={len(gallery_images or [])} sponsors={len(sponsors or [])}", flush=True)
    if policies:
        formatted = _format_policies_text(policies)
        if formatted and event.terms != formatted:
            event.terms = formatted
            try:
                db.commit()
            except Exception:
                db.rollback()
    host_tickets = _host_tickets_for_event(db, event.id)
    # Prefer live host Manage tickets so offer-window Save is visible without republish.
    return _event_to_response(
        event,
        policies=policies,
        gallery_images=gallery_images,
        sponsors=sponsors,
        agenda=_host_agenda_for_event(db, event.id),
        performers_title=performers_title,
        ticket_types=host_tickets,
    )


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
    gallery_images, sponsors, performers_title = _host_design_for_event(db, event.id)
    if not gallery_images:
        gallery_images = _normalize_gallery_images(_parse_json_field(getattr(event, "gallery_images", None)))
    if not sponsors:
        sponsors = _normalize_sponsors(_parse_json_field(event.highlights))
    return _event_to_response(
        event,
        policies=policies,
        gallery_images=gallery_images,
        sponsors=sponsors,
        agenda=_host_agenda_for_event(db, event.id),
        performers_title=performers_title,
    )


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
    if getattr(event, "is_published", False):
        try:
            from Services.notifications import ensure_published_event_announcement
            ensure_published_event_announcement(
                db,
                event_id=event.id,
                title=event.title,
                venue=event.venue,
                address=None,
                location=event.location,
                publisher_customer_id=current_user.customer_id,
            )
        except Exception:
            pass
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
    if transitioning_to_publish:
        try:
            from Services.notifications import ensure_published_event_announcement
            ensure_published_event_announcement(
                db,
                event_id=updated.id,
                title=updated.title,
                venue=updated.venue,
                address=None,
                location=updated.location,
                publisher_customer_id=current_user.customer_id,
            )
        except Exception:
            pass
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
