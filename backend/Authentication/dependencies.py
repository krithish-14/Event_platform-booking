"""
FastAPI dependencies — extract and validate the current user from JWT.
Accepts Authorization: Bearer or the httpOnly jod_access_token cookie.
"""

from typing import Optional
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from Authentication.jwt_handler import AUTH_COOKIE_NAME, decode_access_token
from Models.base import get_db
from Models.user import User

bearer_scheme = HTTPBearer(auto_error=False)


def _token_from_request(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials],
) -> Optional[str]:
    if creds and creds.credentials:
        return creds.credentials.strip()
    cookie = request.cookies.get(AUTH_COOKIE_NAME)
    if cookie:
        return cookie.strip()
    return None


def _user_from_token(token: Optional[str], db: Session) -> Optional[User]:
    if not token:
        return None
    payload = decode_access_token(token)
    if payload is None:
        return None
    customer_id = payload.get("customer_id") or payload.get("sub")
    if customer_id is None:
        return None
    user = db.query(User).filter(User.customer_id == customer_id).first()
    if user is None and payload.get("email"):
        user = db.query(User).filter(User.email == payload.get("email")).first()
    if user is None:
        user = db.query(User).filter(User.id == customer_id).first()
    return user


def get_current_user(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials.",
        headers={"WWW-Authenticate": "Bearer"},
    )
    user = _user_from_token(_token_from_request(request, creds), db)
    if user is None:
        raise credentials_exception
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Inactive user.")
    return user


def get_current_admin(current_user: User = Depends(get_current_user)) -> User:
    if not current_user.is_admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return current_user


def get_current_organizer(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> User:
    from Models.organizer_accounts import OrganizerAccount
    org_acc = db.query(OrganizerAccount).filter(
        (OrganizerAccount.customer_id == current_user.customer_id) |
        (OrganizerAccount.email == current_user.email.lower().strip())
    ).first()
    if not org_acc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Organizer access required. Please complete Host account setup first."
        )
    return current_user


def get_current_user_optional(
    request: Request,
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    try:
        user = _user_from_token(_token_from_request(request, creds), db)
        if user and not user.is_active:
            return None
        return user
    except Exception:
        return None
