"""
Wishlist routes — save and remove published events for the signed-in customer.
"""

from datetime import datetime
from typing import List, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, joinedload

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.event import Event
from Models.user import User
from Models.wishlist import WishlistItem

router = APIRouter()


class WishlistToggleRequest(BaseModel):
    event_id: str


class WishlistEventResponse(BaseModel):
    id: str
    title: str
    description: Optional[str] = None
    venue: Optional[str] = None
    location: Optional[str] = None
    category: Optional[str] = None
    image_url: Optional[str] = None
    start_date: Optional[datetime] = None
    price: float = 0.0


class WishlistItemResponse(BaseModel):
    event_id: str
    wishlisted: bool = True
    event: Optional[WishlistEventResponse] = None


class WishlistToggleResponse(BaseModel):
    event_id: str
    wishlisted: bool


class WishlistIdsResponse(BaseModel):
    event_ids: List[str]


def _parse_event_id(raw: str) -> UUID:
    try:
        return UUID(str(raw).strip())
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid event id.")


def _serialize_event(event: Event) -> WishlistEventResponse:
    return WishlistEventResponse(
        id=str(event.id),
        title=event.title or "Untitled Event",
        description=event.description,
        venue=event.venue,
        location=event.location,
        category=event.category,
        image_url=event.image_url,
        start_date=event.start_date,
        price=float(event.price or 0),
    )


@router.get("/items", response_model=List[WishlistItemResponse])
def list_wishlist(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(WishlistItem)
        .options(joinedload(WishlistItem.event))
        .filter(WishlistItem.customer_id == current_user.customer_id)
        .order_by(WishlistItem.created_at.desc())
        .all()
    )
    items = []
    for row in rows:
        event = row.event
        if event and (event.is_cancelled or not event.is_published):
            continue
        items.append(
            WishlistItemResponse(
                event_id=str(row.event_id),
                wishlisted=True,
                event=_serialize_event(event) if event else None,
            )
        )
    return items


@router.get("/ids", response_model=WishlistIdsResponse)
def list_wishlist_ids(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(WishlistItem.event_id)
        .filter(WishlistItem.customer_id == current_user.customer_id)
        .all()
    )
    return WishlistIdsResponse(event_ids=[str(row[0]) for row in rows])


@router.post("/toggle", response_model=WishlistToggleResponse)
def toggle_wishlist(
    payload: WishlistToggleRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    event_id = _parse_event_id(payload.event_id)
    event = db.query(Event).filter(Event.id == event_id).first()
    if not event or not event.is_published or event.is_cancelled:
        raise HTTPException(status_code=404, detail="This event is currently unavailable.")

    existing = (
        db.query(WishlistItem)
        .filter(
            WishlistItem.customer_id == current_user.customer_id,
            WishlistItem.event_id == event_id,
        )
        .first()
    )
    if existing:
        db.delete(existing)
        db.commit()
        return WishlistToggleResponse(event_id=str(event_id), wishlisted=False)

    item = WishlistItem(customer_id=current_user.customer_id, event_id=event_id)
    db.add(item)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        return WishlistToggleResponse(event_id=str(event_id), wishlisted=True)
    return WishlistToggleResponse(event_id=str(event_id), wishlisted=True)


@router.delete("/{event_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_wishlist_item(
    event_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    eid = _parse_event_id(event_id)
    row = (
        db.query(WishlistItem)
        .filter(
            WishlistItem.customer_id == current_user.customer_id,
            WishlistItem.event_id == eid,
        )
        .first()
    )
    if row:
        db.delete(row)
        db.commit()
    return None
