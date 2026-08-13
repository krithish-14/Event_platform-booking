"""
FastAPI dependencies — extract and validate the current user from JWT.
"""

from typing import Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from Authentication.jwt_handler import decode_access_token
from Models.base import get_db
from Models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    FastAPI dependency that decodes the Bearer token and returns the active user.

    Raises:
        401 if the token is missing, invalid, or the user does not exist.
        403 if the user account is inactive.
    """
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )

    payload = decode_access_token(token)
    if payload is None:
        raise credentials_exception

    customer_id: str = payload.get("customer_id") or payload.get("sub")
    if customer_id is None:
        raise credentials_exception

    user = db.query(User).filter(User.customer_id == customer_id).first()
    if user is None and payload.get("email"):
        user = db.query(User).filter(User.email == payload.get("email")).first()
    if user is None:
        # Fallback for legacy tokens using internal id UUID
        user = db.query(User).filter(User.id == customer_id).first()
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user.")

    return user




def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    """Dependency that additionally requires the user to be an admin."""
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return current_user


oauth2_scheme_optional = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)


def get_current_user_optional(
    token: Optional[str] = Depends(oauth2_scheme_optional),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Optional JWT dependency — returns User if valid token present, else None."""
    if not token:
        return None
    try:
        payload = decode_access_token(token)
        if not payload:
            return None
        user_id = payload.get("sub")
        if not user_id:
            return None
        return db.query(User).filter(User.customer_id == user_id, User.is_active == True).first()
    except Exception:
        return None
