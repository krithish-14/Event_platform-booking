"""
Create inbox announcements when a host publishes a public event.
"""

from datetime import datetime
from typing import Optional
from uuid import UUID

from sqlalchemy.orm import Session

from Models.notification import EventAnnouncement


def pretty_event_location(venue: Optional[str] = None, address: Optional[str] = None, location: Optional[str] = None) -> str:
    """Human-readable place for 'new event in {location}'."""
    address = str(address or "").strip()
    venue = str(venue or "").strip()
    location = str(location or "").strip()

    def city_from_address(text: str) -> str:
        parts = [p.strip() for p in text.split(",") if p.strip()]
        skip = {
            "india", "tamil nadu", "karnataka", "maharashtra", "delhi",
            "nct of delhi", "west bengal", "telangana", "kerala", "andhra pradesh",
        }
        useful = []
        for part in parts:
            digits = "".join(ch for ch in part if ch.isdigit())
            if digits == part.replace(" ", "") and len(digits) == 6:
                continue
            if part.lower() in skip:
                continue
            useful.append(part)
        if not useful:
            return text
        return useful[-1]

    if address:
        city = city_from_address(address)
        if city:
            return city
        return address
    if location:
        city = city_from_address(location)
        return city or location
    if venue:
        city = city_from_address(venue)
        return city or venue
    return "your city"


def ensure_published_event_announcement(
    db: Session,
    event_id,
    title: str,
    venue: Optional[str] = None,
    address: Optional[str] = None,
    location: Optional[str] = None,
    publisher_customer_id: Optional[str] = None,
) -> Optional[EventAnnouncement]:
    """Insert one announcement per event. Republishing the same event does not spam again."""
    if not event_id:
        return None
    try:
        event_uuid = event_id if isinstance(event_id, UUID) else UUID(str(event_id))
    except (ValueError, TypeError):
        return None

    existing = db.query(EventAnnouncement).filter(EventAnnouncement.event_id == event_uuid).first()
    if existing:
        return existing

    place = pretty_event_location(venue=venue, address=address, location=location)
    row = EventAnnouncement(
        event_id=event_uuid,
        event_title=(title or "Untitled Event").strip() or "Untitled Event",
        location=(address or location or venue or "").strip() or None,
        city=place,
        venue=(venue or "").strip() or None,
        publisher_customer_id=str(publisher_customer_id).strip() if publisher_customer_id else None,
        created_at=datetime.utcnow(),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
