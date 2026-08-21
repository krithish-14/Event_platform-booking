"""
Authentication routes — register and login.
"""

import os
import re
import secrets
import json
import base64
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr, field_validator
import httpx

from Models.base import get_db
from Models.user import User
from Models.email_otp import EmailOTP
from Services.auth_service import (
    get_password_hash,
    verify_password,
    create_access_token,
)
from Services.email import send_email
from Authentication.jwt_handler import ACCESS_TOKEN_EXPIRE_MINUTES, AUTH_COOKIE_NAME
from Authentication.dependencies import get_current_user
from Services.runtime_env import cookie_secure, expose_access_token_in_json, resolve_google_redirect, smtp_configured
from Services.rate_limit import limit_login, limit_otp, limit_password_reset, limit_register
from Services.csrf import clear_csrf_cookie, set_csrf_cookie
from Services import otp as otp_service
import random
from Models import UserSignup as UserSignupLog, UserLogin as UserLoginLog

router = APIRouter()

_GOOGLE_VERIFY_FAIL = "Failed to verify Google token with authentication server."
_GOOGLE_PLACEHOLDER_CLIENT_ID = "your-google-client-id.apps.googleusercontent.com"
_GOOGLE_ISSUERS = {"https://accounts.google.com", "accounts.google.com"}


def _google_client_id() -> str:
    return (os.getenv("GOOGLE_CLIENT_ID") or "").strip()


def _google_email_verified(value) -> bool:
    if value is True:
        return True
    if isinstance(value, str) and value.strip().lower() in ("true", "1", "yes"):
        return True
    return False


def _require_signed_google_jwt(token: str) -> None:
    """Reject unsigned/malformed JWTs locally. Identity is never taken from this decode."""
    parts = (token or "").split(".")
    if len(parts) != 3 or not parts[0] or not parts[1] or not parts[2]:
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    try:
        padded = parts[0] + "=" * ((4 - len(parts[0]) % 4) % 4)
        header = json.loads(base64.urlsafe_b64decode(padded))
    except Exception:
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    if not isinstance(header, dict):
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    alg = str(header.get("alg") or "").strip().upper()
    if alg != "RS256":
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)


async def _verify_google_id_token(token: str) -> dict:
    """Verify an ID token with Google. Fail closed on signature, aud, iss, or email_verified."""
    token = (token or "").strip()
    client_id = _google_client_id()
    if not token or not client_id or client_id == _GOOGLE_PLACEHOLDER_CLIENT_ID:
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    _require_signed_google_jwt(token)
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                "https://oauth2.googleapis.com/tokeninfo",
                params={"id_token": token},
            )
    except Exception:
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    if resp.status_code != 200:
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    try:
        info = resp.json()
    except Exception:
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    if not isinstance(info, dict):
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    aud = str(info.get("aud") or info.get("audience") or "").strip()
    iss = str(info.get("iss") or info.get("issuer") or "").strip()
    email = str(info.get("email") or "").strip().lower()
    if (
        aud != client_id
        or iss not in _GOOGLE_ISSUERS
        or not email
        or not _google_email_verified(info.get("email_verified"))
    ):
        raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
    info["email"] = email
    return info


def _set_auth_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        httponly=True,
        samesite="lax",
        secure=cookie_secure(),
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,
        path="/",
    )
    set_csrf_cookie(response)


def _auth_payload(token: str, user, extra: dict | None = None) -> dict:
    body = {
        "token_type": "bearer",
        "user": _serialize_user(user),
        "access_token": token if expose_access_token_in_json() else "",
    }
    if extra:
        body.update(extra)
    return body


def _email_taken(db: Session, email_clean: str) -> bool:
    if not email_clean:
        return False
    return db.query(User).filter(func.lower(func.trim(User.email)) == email_clean).first() is not None


def _username_taken(db: Session, username_clean: str) -> bool:
    if not username_clean:
        return False
    return (
        db.query(User).filter(func.lower(func.trim(User.username)) == username_clean.lower()).first()
        is not None
    )


# ── Availability Check (live validation) ─────────────────────────────────────
@router.get("/check")
def check_availability(request: Request, email: str = None, username: str = None, db: Session = Depends(get_db)):
    """Live form hint only. Does not disclose whether an account already exists."""
    limit_register(request)
    generic = "You can continue."
    result = {}
    if email:
        result["email_available"] = True
        result["email_message"] = generic
    if username:
        result["username_available"] = True
        result["username_message"] = generic
    return result


def generate_customer_id(db: Session) -> str:
    """Generate a unique customer ID (e.g. CUST-849201)."""
    while True:
        num = random.randint(100000, 999999)
        cid = f"CUST-{num}"
        existing = db.query(User).filter(User.customer_id == cid).first()
        if not existing:
            return cid


# ── Schemas ───────────────────────────────────────────────────────────────────
class UserRegisterRequest(BaseModel):
    email: EmailStr
    username: str
    full_name: str | None = None
    password: str
    avatar_url: str | None = None
    bio: str | None = None
    city: str | None = None
    location_pincode: str | None = None

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
        from Services.auth_service import PasswordTooLongError, assert_password_within_bcrypt_limit

        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if len(v) > 255:
            raise ValueError("Password is too long.")
        try:
            assert_password_within_bcrypt_limit(v)
        except PasswordTooLongError as exc:
            raise ValueError(str(exc)) from exc
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one digit.")
        return v


class GoogleAuthRequest(BaseModel):
    credential: str | None = None
    id_token: str | None = None
    code: str | None = None
    redirect_uri: str | None = None
    city: str | None = None
    location_pincode: str | None = None


class UserResponse(BaseModel):
    id: str
    customer_id: str | None = None
    email: str
    username: str
    full_name: str | None
    avatar_url: str | None = None
    city: str | None = None
    location_pincode: str | None = None
    location_lat: float | None = None
    location_lon: float | None = None
    is_active: bool
    is_admin: bool
    role: str = "attendee"

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    token_type: str
    user: UserResponse
    access_token: str = ""


class GoogleTokenResponse(TokenResponse):
    location_required: bool = False


def _serialize_user(user) -> dict:
    """Convert a User ORM object to a dict suitable for JSON/Pydantic."""
    if user is None:
        return None
    role = "admin" if bool(getattr(user, "is_admin", False)) else "attendee"
    return {
        "id": str(getattr(user, "id", user.customer_id)),
        "customer_id": str(user.customer_id) if user.customer_id else None,
        "email": user.email,
        "username": user.username,
        "full_name": user.full_name,
        "avatar_url": getattr(user, "avatar_url", None),
        "city": getattr(user, "city", None),
        "location_pincode": getattr(user, "location_pincode", None),
        "location_lat": getattr(user, "location_lat", None) or getattr(user, "latitude", None),
        "location_lon": getattr(user, "location_lon", None) or getattr(user, "longitude", None),
        "is_active": bool(getattr(user, "is_active", True)),
        "is_admin": bool(getattr(user, "is_admin", False)),
        "role": role,
    }


# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("/register", response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(payload: UserRegisterRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    """Register a new user, store credentials in the database, and return an access token."""
    limit_register(request)
    email_clean = payload.email.strip().lower()
    username_clean = payload.username.strip()

    if _email_taken(db, email_clean) or _username_taken(db, username_clean):
        raise HTTPException(
            status_code=400,
            detail="Unable to create this account. If you already registered, log in.",
        )

    user = User(
        email=email_clean,
        username=username_clean,
        full_name=payload.full_name.strip() if payload.full_name else None,
        hashed_password=get_password_hash(payload.password),
        avatar_url=payload.avatar_url,
        bio=payload.bio,
        city=payload.city,
        location_pin=payload.location_pincode,
    )
    try:
        db.add(user)
        db.commit()
        db.refresh(user)
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=400,
            detail="Unable to create this account. If you already registered, log in.",
        )

    # Record User Signup Audit Log in user_signups table
    try:
        signup_log = UserSignupLog(
            customer_id=user.customer_id,
            email=user.email,
            username=user.username,
            full_name=user.full_name,
            city=user.city,
            location_pin=user.location_pin,
        )
        db.add(signup_log)
        db.commit()
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
    _set_auth_cookie(response, token)
    return _auth_payload(token, user)


@router.post("/login", response_model=TokenResponse)
def login(response: Response, request: Request, form: OAuth2PasswordRequestForm = Depends(), db: Session = Depends(get_db)):
    """Login with username/email + password against stored credentials. Returns a JWT token."""
    limit_login(request)
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

    # Ensure legacy users get a customer_id if missing
    if not user.customer_id:
        user.customer_id = generate_customer_id(db)
        db.commit()
        db.refresh(user)

    # Record User Login Audit Log in user_logins table
    try:
        login_log = UserLoginLog(
            customer_id=user.customer_id,
            email=user.email,
            status="SUCCESS",
        )
        db.add(login_log)
        db.commit()
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
    _set_auth_cookie(response, token)
    return _auth_payload(token, user)


@router.get("/google/config")
def google_config():
    """Return public Google OAuth configuration for frontend initialization."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    is_placeholder = not client_id or client_id == "your-google-client-id.apps.googleusercontent.com"
    return {
        "client_id": client_id if not is_placeholder else "",
        "enabled": not is_placeholder,
    }


@router.get("/google/url")
def google_auth_url():
    """Generates the Google OAuth 2.0 Authorization URL for browser popup / redirect login."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:5500/login.html")
    try:
        redirect_uri = resolve_google_redirect(redirect_uri)
    except ValueError:
        raise HTTPException(status_code=400, detail="Google OAuth is not configured on the server.")
    if not client_id or client_id == "your-google-client-id.apps.googleusercontent.com":
        raise HTTPException(status_code=400, detail="Google OAuth is not configured on the server.")

    scope = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid"
    url = f"https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}&access_type=offline&prompt=consent"
    return {"url": url}


@router.post("/google", response_model=GoogleTokenResponse)
async def google_auth(payload: GoogleAuthRequest, response: Response, request: Request, db: Session = Depends(get_db)):
    """Authenticate or register a user using Google OAuth 2.0 ID Token / Credential or Authorization Code."""
    limit_login(request)
    token = (payload.credential or payload.id_token or "").strip()

    # 1. If an authorization code was provided, exchange it for an ID token with Google
    if payload.code and not token:
        client_id = _google_client_id()
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
        try:
            redirect_uri = resolve_google_redirect(payload.redirect_uri)
        except ValueError:
            raise HTTPException(status_code=400, detail="Google OAuth redirect is not allowed.")
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                token_resp = await client.post(
                    "https://oauth2.googleapis.com/token",
                    data={
                        "code": payload.code,
                        "client_id": client_id,
                        "client_secret": client_secret,
                        "redirect_uri": redirect_uri,
                        "grant_type": "authorization_code",
                    },
                )
        except Exception:
            raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
        if token_resp.status_code != 200:
            raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
        try:
            token_data = token_resp.json()
        except Exception:
            raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)
        token = (token_data.get("id_token") or "").strip()
        if not token:
            raise HTTPException(status_code=400, detail=_GOOGLE_VERIFY_FAIL)

    if not token:
        raise HTTPException(status_code=400, detail="Google credential, id_token, or code is required.")

    google_user_info = await _verify_google_id_token(token)

    email = google_user_info["email"].strip().lower()
    full_name = google_user_info.get("name") or google_user_info.get("given_name")
    avatar_url = google_user_info.get("picture")

    # 3. Lookup existing user: If they exist, log them in (Secure account linking).
    existing_user = db.query(User).filter(func.lower(func.trim(User.email)) == email).first()

    if existing_user:
        user = existing_user
        # Update avatar if missing
        if avatar_url and not user.avatar_url:
            user.avatar_url = avatar_url
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

        # Generate secure random password for database compliance
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
        try:
            db.add(user)
            db.commit()
            db.refresh(user)
        except IntegrityError:
            db.rollback()
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="User already exists",
            )
            
        # Record User Signup Audit Log for Google Auth
        try:
            signup_log = UserSignupLog(
                customer_id=user.customer_id,
                email=user.email,
                registration_method="GOOGLE",
                status="COMPLETED"
            )
            db.add(signup_log)
            db.commit()
        except Exception as e:
            print(f"Failed to record UserSignupLog: {e}")
            pass

    # Record User Login Audit Log
    try:
        login_log = UserLoginLog(
            customer_id=user.customer_id,
            email=user.email,
            status="SUCCESS",
        )
        db.add(login_log)
        db.commit()
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

    _set_auth_cookie(response, token_str)
    return _auth_payload(token_str, user, extra={"location_required": location_required})





@router.get("/me", response_model=UserResponse)
def get_me(response: Response, current_user: User = Depends(get_current_user)):
    """Return the currently authenticated user's profile."""
    set_csrf_cookie(response)
    return _serialize_user(current_user)


@router.post("/logout")
def logout(response: Response):
    """Clear the httpOnly auth cookie using the same attributes used at set time."""
    response.delete_cookie(
        key=AUTH_COOKIE_NAME,
        path="/",
        samesite="lax",
        secure=cookie_secure(),
        httponly=True,
    )
    clear_csrf_cookie(response)
    return {"message": "Logged out successfully."}


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class VerifyResetOtpRequest(BaseModel):
    email: EmailStr
    otp_code: str


class ResetPasswordRequest(BaseModel):
    email: EmailStr
    otp_code: str
    new_password: str

    @field_validator("otp_code")
    @classmethod
    def validate_otp(cls, v: str) -> str:
        code = (v or "").strip()
        if not re.fullmatch(r"\d{6}", code):
            raise ValueError("Enter the 6-digit verification code sent to your email.")
        return code

    @field_validator("new_password")
    @classmethod
    def validate_password(cls, v: str) -> str:
        from Services.auth_service import PasswordTooLongError, assert_password_within_bcrypt_limit

        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if len(v) > 255:
            raise ValueError("Password is too long.")
        try:
            assert_password_within_bcrypt_limit(v)
        except PasswordTooLongError as exc:
            raise ValueError(str(exc)) from exc
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one digit.")
        return v


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """Send a 6-digit OTP to the registered email so the user can reset their password."""
    email_clean = payload.email.strip().lower()
    limit_password_reset(request, email_clean)
    generic = "If an account exists for that email, a 6-digit verification code has been sent."
    user = db.query(User).filter(func.lower(User.email) == email_clean).first()
    if user and smtp_configured():
        otp_code = otp_service.generate_otp()
        otp_service.store_otp(db, email_clean, "password_reset", otp_code)
        subject = "Your JOD Events password reset code"
        text_body = (
            f"Your JOD Events password reset code is {otp_code}. "
            "It expires in 10 minutes. If you did not request this, you can ignore this email."
        )
        html_body = (
            f"<p>Your JOD Events password reset code is <strong>{otp_code}</strong>.</p>"
            "<p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>"
        )
        send_email(email_clean, subject, text_body, html_body)
    return {"message": generic}


@router.post("/verify-reset-otp")
def verify_reset_otp(payload: VerifyResetOtpRequest, request: Request, db: Session = Depends(get_db)):
    """Confirm the password-reset OTP before showing the new-password fields."""
    email_clean = payload.email.strip().lower()
    limit_otp(request, email_clean)
    otp_service.verify_otp(db, email_clean, payload.otp_code, "password_reset")
    return {"message": "Email verified. You can now set a new password.", "email": email_clean}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, request: Request, db: Session = Depends(get_db)):
    """Reset user password after a verified OTP."""
    email_clean = payload.email.strip().lower()
    limit_password_reset(request, email_clean)
    generic_fail = "Unable to reset the password. Request a new code and try again."
    try:
        otp_service.verify_otp(db, email_clean, payload.otp_code, "password_reset")
    except HTTPException:
        raise HTTPException(status_code=400, detail=generic_fail)
    user = db.query(User).filter(func.lower(User.email) == email_clean).first()
    if not user:
        raise HTTPException(status_code=400, detail=generic_fail)
    user.hashed_password = get_password_hash(payload.new_password)
    db.query(EmailOTP).filter(
        EmailOTP.email == email_clean,
        EmailOTP.purpose == "password_reset",
    ).delete(synchronize_session=False)
    db.commit()
    return {"message": "Password reset successfully. You can now log in with your new password."}
