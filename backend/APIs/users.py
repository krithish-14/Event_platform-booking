"""
User profile routes.
"""

from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.user import User

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────
class UserProfileResponse(BaseModel):
    id: str
    customer_id: str
    email: str
    username: str
    full_name: Optional[str]
    city: Optional[str] = None
    location_pincode: Optional[str] = None
    location_lat: Optional[float] = None
    location_lon: Optional[float] = None
    bio: Optional[str]
    avatar_url: Optional[str]
    is_active: bool
    is_admin: bool

    class Config:
        from_attributes = True


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    city: Optional[str] = None
    bio: Optional[str] = None
    avatar_url: Optional[str] = None


# ── Routes ────────────────────────────────────────────────────────────────────
@router.get("/me", response_model=UserProfileResponse)
def get_my_profile(current_user: User = Depends(get_current_user)):
    """Get the currently authenticated user's profile."""
    return current_user


@router.put("/me", response_model=UserProfileResponse)
def update_my_profile(
    payload: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Update the currently authenticated user's profile."""
    for field, value in payload.model_dump(exclude_unset=True).items():
        setattr(current_user, field, value)
    db.commit()
    db.refresh(current_user)
    return current_user


@router.get("/{identifier}", response_model=UserProfileResponse)
def get_user_by_id_or_username(
    identifier: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a profile only when it belongs to the authenticated user."""
    ident = (identifier or "").strip()
    mine = {
        str(current_user.username or "").lower(),
        str(current_user.customer_id or "").lower(),
        str(current_user.id or "").lower(),
        str(current_user.email or "").lower(),
    }
    if ident.lower() not in mine:
        raise HTTPException(status_code=403, detail="You can only view your own profile.")
    return current_user

