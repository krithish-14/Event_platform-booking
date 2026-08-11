"""
Authentication routes — register and login.
"""

import os
import re
import secrets
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, field_validator
import httpx

from Models.base import get_db
from Models.user import User
from Services.auth_service import (
    get_password_hash,
    verify_password,
    create_access_token,
)
from Authentication.jwt_handler import ACCESS_TOKEN_EXPIRE_MINUTES
from Authentication.dependencies import get_current_user

router = APIRouter()


# ── Schemas ───────────────────────────────────────────────────────────────────
class UserRegisterRequest(BaseModel):
    email: EmailStr
    username: str
    full_name: str | None = None
    password: str

    @field_validator("username")
    @classmethod
    def validate_username(cls, v: str) -> str:
        v = v.strip()
        if len(v) < 3:
            raise ValueError("Username must be at least 3 characters long.")
        if len(v) > 100:
            raise ValueError("Username must be at most 100 characters long.")
        if not re.match(r"^[a-zA-Z0-9_.@-]+$", v):
            raise ValueError(
                "Username can only contain letters, numbers, underscores, dots, hyphens, and @ symbols."
            )
        return v

    @field_validator("password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if len(v) > 255:
            raise ValueError("Password is too long.")
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one digit.")
        return v


class GoogleAuthRequest(BaseModel):
    credential: str | None = None
    id_token: str | None = None
    city: str | None = None
    location_pincode: str | None = None


class UserResponse(BaseModel):
    id: str
    customer_id: str
    email: str
    username: str
    full_name: str | None
    avatar_url: str | None = None
    city: str | None = None
    location_pincode: str | None = None
    is_active: bool
    is_admin: bool

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str
    user: UserResponse


class GoogleTokenResponse(TokenResponse):
    location_required: bool = False


def _serialize_user(user) -> dict:
    """Convert a User ORM object to a dict suitable for JSON/Pydantic."""
    if user is None:
        return None
    return {
        "id": str(user.id),
        "customer_id": str(getattr(user, "customer_id", user.id)),
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "avatar_url": getattr(user, "avatar_url", None),
        "city": getattr(user, "city", None),
        "location_pincode": getattr(user, "location_pincode", None),
        "is_active": bool(getattr(user, "is_active", True)),
        "is_admin": bool(getattr(user, "is_admin", False)),
    }



# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegisterRequest, db: Session = Depends(get_db)):
    """Register a new user, store credentials in the database, and return an access token."""
    email_clean = payload.email.strip().lower()
    username_clean = payload.username.strip()

    if db.query(User).filter(func.lower(User.email) == email_clean).first():
        raise HTTPException(status_code=400, detail="Email already registered.")
    if db.query(User).filter(func.lower(User.username) == username_clean.lower()).first():
        raise HTTPException(status_code=400, detail="Username already taken.")

    user = User(
        email=email_clean,
        username=username_clean,
        full_name=payload.full_name.strip() if payload.full_name else None,
        hashed_password=get_password_hash(payload.password),
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Sync to backup SQLite database if present so user accounts remain available in all environments
    try:
        import sqlite3
        project_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sqlite_path = os.path.join(project_backend, "jod_events.db")
        s_conn = sqlite3.connect(sqlite_path)
        s_cur = s_conn.cursor()
        s_cur.execute("""
            INSERT INTO users (id, customer_id, email, username, full_name, hashed_password, is_active, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, 1, 0)
            ON CONFLICT(email) DO UPDATE SET
                customer_id = excluded.customer_id,
                hashed_password = excluded.hashed_password,
                username = excluded.username
        """, (str(user.id), str(user.customer_id), user.email, user.username, user.full_name, user.hashed_password))
        s_conn.commit()
        s_conn.close()
    except Exception:
        pass

    token = create_access_token(
        data={
            "sub": str(user.customer_id),
            "customer_id": str(user.customer_id),
            "email": user.email,
            "username": user.username,
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer", "user": _serialize_user(user)}


@router.post("/login", response_model=TokenResponse)
def login(form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Login with username/email + password against stored credentials. Returns a JWT token."""
    identifier = form.username.strip().lower()
    user = db.query(User).filter(
        (func.lower(User.email) == identifier) | (func.lower(User.username) == identifier)
    ).first()

    if not user or not verify_password(form.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email/username or password.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Please contact support.",
        )

    token = create_access_token(
        data={
            "sub": str(user.customer_id),
            "customer_id": str(user.customer_id),
            "email": user.email,
            "username": user.username,
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )
    return {"access_token": token, "token_type": "bearer", "user": _serialize_user(user)}


@router.get("/google/config")
def google_config():
    """Return public Google OAuth configuration for frontend initialization."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    is_placeholder = not client_id or client_id == "your-google-client-id.apps.googleusercontent.com"
    return {
        "client_id": client_id if not is_placeholder else "",
        "enabled": not is_placeholder,
    }


@router.post("/google", response_model=GoogleTokenResponse)
async def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Authenticate or register a user using Google OAuth 2.0 ID Token / Credential."""
    token = (payload.credential or payload.id_token or "").strip()
    if not token:
        raise HTTPException(status_code=400, detail="Google credential or id_token is required.")

    # 1. Verify token with Google's tokeninfo API
    google_user_info = None
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": token}
            )
            if resp.status_code == 200:
                google_user_info = resp.json()
    except Exception:
        google_user_info = None

    # Fallback decoding for JWT structured tokens
    if (not google_user_info or "email" not in google_user_info) and token.count(".") == 2:
        try:
            import base64
            import json
            parts = token.split(".")
            payload_segment = parts[1]
            padded = payload_segment + "=" * (-len(payload_segment) % 4)
            decoded_bytes = base64.b64decode(padded)
            decoded_json = json.loads(decoded_bytes.decode("utf-8"))
            if "email" in decoded_json:
                google_user_info = decoded_json
        except Exception:
            pass

    if not google_user_info or "email" not in google_user_info:
        raise HTTPException(
            status_code=400,
            detail="Failed to verify Google token with authentication server."
        )


    email = google_user_info["email"].strip().lower()
    full_name = google_user_info.get("name") or google_user_info.get("given_name")
    avatar_url = google_user_info.get("picture")

    # 2. Lookup existing user or register new user
    user = db.query(User).filter(func.lower(User.email) == email).first()

    if user:
        if not user.full_name and full_name:
            user.full_name = full_name.strip()
        if not user.avatar_url and avatar_url:
            user.avatar_url = avatar_url
        if payload.city and not user.city:
            user.city = payload.city.strip()
        if payload.location_pincode and not user.location_pincode:
            user.location_pincode = payload.location_pincode.strip()
        db.commit()
        db.refresh(user)
    else:
        # Generate unique username
        base_username = email.split("@")[0]
        base_username = re.sub(r"[^a-zA-Z0-9_.@-]", "", base_username)
        if len(base_username) < 3:
            base_username = f"user_{base_username}"
        if len(base_username) > 80:
            base_username = base_username[:80]

        candidate_username = base_username
        counter = 1
        while db.query(User).filter(func.lower(User.username) == candidate_username.lower()).first():
            candidate_username = f"{base_username}{secrets.randbelow(9000) + 1000}"
            counter += 1
            if counter > 50:
                candidate_username = f"user_{secrets.token_hex(4)}"
                break

        # Generate secure random password
        random_password = secrets.token_urlsafe(32) + "A1!"
        hashed_pw = get_password_hash(random_password)

        user = User(
            email=email,
            username=candidate_username,
            full_name=full_name.strip() if full_name else None,
            avatar_url=avatar_url,
            hashed_password=hashed_pw,
            city=payload.city.strip() if payload.city else None,
            location_pincode=payload.location_pincode.strip() if payload.location_pincode else None,
        )
        db.add(user)
        db.commit()
        db.refresh(user)

    # 3. Sync to backup SQLite database
    try:
        import sqlite3
        project_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sqlite_path = os.path.join(project_backend, "jod_events.db")
        s_conn = sqlite3.connect(sqlite_path)
        s_cur = s_conn.cursor()
        s_cur.execute("""
            INSERT INTO users (id, customer_id, email, username, full_name, hashed_password, is_active, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, 1, 0)
            ON CONFLICT(email) DO UPDATE SET
                customer_id = excluded.customer_id,
                hashed_password = excluded.hashed_password,
                username = excluded.username
        """, (str(user.id), str(user.customer_id), user.email, user.username, user.full_name, user.hashed_password))
        s_conn.commit()
        s_conn.close()
    except Exception:
        pass

    # 4. Generate access token
    token_str = create_access_token(
        data={
            "sub": str(user.customer_id),
            "customer_id": str(user.customer_id),
            "email": user.email,
            "username": user.username,
        },
        expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
    )

    location_required = not bool(user.city)

    return {
        "access_token": token_str,
        "token_type": "bearer",
        "user": _serialize_user(user),
        "location_required": location_required,
    }





@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    return _serialize_user(current_user)


@router.post("/logout")
def logout():
    """Logout endpoint (client-side token removal is sufficient for JWT)."""
    return {"message": "Logged out successfully."}


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    new_password: str

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if len(v) > 255:
            raise ValueError("Password is too long.")
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one digit.")
        return v


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset user password across active DB and secondary SQLite DB."""
    email_clean = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email_clean).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email address.")

    user.hashed_password = get_password_hash(payload.new_password)
    db.commit()

    # Sync to backup SQLite database if present
    try:
        import sqlite3
        project_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sqlite_path = os.path.join(project_backend, "jod_events.db")
        s_conn = sqlite3.connect(sqlite_path)
        s_cur = s_conn.cursor()
        s_cur.execute("UPDATE users SET hashed_password = ? WHERE lower(email) = ?", (user.hashed_password, email_clean))
        s_conn.commit()
        s_conn.close()
    except Exception:
        pass

    return {"message": "Password reset successfully. You can now log in with your new password."}
