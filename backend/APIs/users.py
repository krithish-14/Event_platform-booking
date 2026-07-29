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
    email: str
    username: str
    full_name: Optional[str]
    bio: Optional[str]
    avatar_url: Optional[str]
    is_active: bool
    is_admin: bool

    class Config:
        from_attributes = True


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = None
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


@router.get("/{username}", response_model=UserProfileResponse)
def get_user_by_username(username: str, db: Session = Depends(get_db)):
    """Get a public user profile by username."""
    user = db.query(User).filter(User.username == username).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found.")
    return user
