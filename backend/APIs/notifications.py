"""
Inbox notifications for the authenticated user.
Broadcasts new published events to every signed-in account.
"""

from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.event import Event
from Models.event_management import EventManagement
from Models.notification import EventAnnouncement
from Models.user import User
from Services.notifications import ensure_published_event_announcement, pretty_event_location

router = APIRouter()


class InboxNotification(BaseModel):
    id: str
    kind: str
    event_id: Optional[str] = None
    title: str
    message: str
    location: Optional[str] = None
    href: Optional[str] = None
    created_at: Optional[datetime] = None


class InboxStateResponse(BaseModel):
    read_ids: List[str] = []
    cleared_ids: List[str] = []


class InboxStateRequest(BaseModel):
    read_ids: Optional[List[str]] = None
    cleared_ids: Optional[List[str]] = None


def _as_id_list(value) -> List[str]:
    if not value:
        return []
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return []


def _backfill_published_announcements(db: Session) -> None:
    published = (
        db.query(Event, EventManagement)
        .outerjoin(EventManagement, EventManagement.event_id == Event.id)
        .filter(Event.is_published.is_(True))
        .filter((Event.is_cancelled.is_(False)) | (Event.is_cancelled.is_(None)))
        .all()
    )
    for event, mgt in published:
        ensure_published_event_announcement(
            db,
            event_id=event.id,
            title=event.title,
            venue=(mgt.venue if mgt else event.venue),
            address=(mgt.address if mgt else None),
            location=event.location,
            publisher_customer_id=event.customer_id,
        )


@router.get("/inbox", response_model=List[InboxNotification])
def list_my_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Published-event announcements for the logged-in user."""
    _ = current_user
    try:
        _backfill_published_announcements(db)
    except Exception:
        db.rollback()
    rows = (
        db.query(EventAnnouncement, Event)
        .join(Event, Event.id == EventAnnouncement.event_id)
        .filter(Event.is_published.is_(True))
        .filter((Event.is_cancelled.is_(False)) | (Event.is_cancelled.is_(None)))
        .order_by(EventAnnouncement.created_at.desc())
        .limit(50)
        .all()
    )
    items = []
    for announcement, event in rows:
        place = announcement.city or pretty_event_location(
            venue=announcement.venue or event.venue,
            address=announcement.location,
            location=event.location,
        )
        event_id = str(announcement.event_id)
        title = announcement.event_title or event.title or "a new event"
        items.append(
            InboxNotification(
                id=f"event-published-{event_id}",
                kind="event_published",
                event_id=event_id,
                title="New upcoming event",
                message=f"A new event is upcoming in {place}: {title}",
                location=place,
                href=f"event-details.html?id={event_id}",
                created_at=announcement.created_at or event.updated_at,
            )
        )
    return items


@router.get("/state", response_model=InboxStateResponse)
def get_inbox_state(current_user: User = Depends(get_current_user)):
    """Read/cleared notification IDs for the logged-in user only."""
    return InboxStateResponse(
        read_ids=_as_id_list(getattr(current_user, "notification_read_ids", None)),
        cleared_ids=_as_id_list(getattr(current_user, "notification_cleared_ids", None)),
    )


@router.put("/state", response_model=InboxStateResponse)
def save_inbox_state(
    payload: InboxStateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Persist this user's seen/cleared notifications without affecting other accounts."""
    if payload.read_ids is not None:
        current_user.notification_read_ids = list(dict.fromkeys(_as_id_list(payload.read_ids)))
    if payload.cleared_ids is not None:
        current_user.notification_cleared_ids = list(dict.fromkeys(_as_id_list(payload.cleared_ids)))
    db.commit()
    db.refresh(current_user)
    return InboxStateResponse(
        read_ids=_as_id_list(current_user.notification_read_ids),
        cleared_ids=_as_id_list(current_user.notification_cleared_ids),
    )
