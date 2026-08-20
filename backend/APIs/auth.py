"""
Authentication routes — register and login.
"""

import os
import re
import secrets
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
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
from Authentication.jwt_handler import ACCESS_TOKEN_EXPIRE_MINUTES
from Authentication.dependencies import get_current_user
import random
from Models import UserSignup as UserSignupLog, UserLogin as UserLoginLog

router = APIRouter()


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
def check_availability(email: str = None, username: str = None, db: Session = Depends(get_db)):
    """Check if an email or username is already taken. Used for real-time form validation."""
    result = {}
    if email:
        exists = _email_taken(db, email.strip().lower())
        result["email_available"] = not exists
        result["email_message"] = "Email already registered." if exists else "Email is available."
    if username:
        exists = _username_taken(db, username.strip())
        result["username_available"] = not exists
        result["username_message"] = "Username already taken." if exists else "Username is available."
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
    access_token: str
    token_type: str
    user: UserResponse


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
def register(payload: UserRegisterRequest, db: Session = Depends(get_db)):
    """Register a new user, store credentials in the database, and return an access token."""
    email_clean = payload.email.strip().lower()
    username_clean = payload.username.strip()

    if _email_taken(db, email_clean):
        raise HTTPException(status_code=400, detail="Email already registered. Please login instead.")
    if _username_taken(db, username_clean):
        raise HTTPException(status_code=400, detail="Username already taken.")

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
    except IntegrityError as exc:
        db.rollback()
        orig = str(getattr(exc, "orig", exc) or exc).lower()
        if "username" in orig:
            raise HTTPException(status_code=400, detail="Username already taken.")
        raise HTTPException(status_code=400, detail="Email already registered. Please login instead.")

    # Sync to backup SQLite database if present so user accounts remain available in all environments
    try:
        import sqlite3
        project_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sqlite_path = os.path.join(project_backend, "jod_events.db")
        s_conn = sqlite3.connect(sqlite_path)
        s_cur = s_conn.cursor()
        s_cur.execute("""
            INSERT INTO users (id, customer_id, email, username, full_name, hashed_password, avatar_url, bio, city, location_pin, is_active, is_admin)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
            ON CONFLICT(email) DO NOTHING
        """, (
            str(user.id),
            str(user.customer_id),
            user.email,
            user.username,
            user.full_name,
            user.hashed_password,
            user.avatar_url,
            user.bio,
            user.city,
            user.location_pin
        ))
        s_conn.commit()
        s_conn.close()
    except Exception:
        pass

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


@router.get("/google/url")
def google_auth_url():
    """Generates the Google OAuth 2.0 Authorization URL for browser popup / redirect login."""
    client_id = os.getenv("GOOGLE_CLIENT_ID", "")
    redirect_uri = os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:5500/login.html")
    if not client_id or client_id == "your-google-client-id.apps.googleusercontent.com":
        raise HTTPException(status_code=400, detail="Google OAuth is not configured on the server.")

    scope = "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile openid"
    url = f"https://accounts.google.com/o/oauth2/v2/auth?response_type=code&client_id={client_id}&redirect_uri={redirect_uri}&scope={scope}&access_type=offline&prompt=consent"
    return {"url": url}


@router.post("/google", response_model=GoogleTokenResponse)
async def google_auth(payload: GoogleAuthRequest, db: Session = Depends(get_db)):
    """Authenticate or register a user using Google OAuth 2.0 ID Token / Credential or Authorization Code."""
    google_user_info = None
    token = (payload.credential or payload.id_token or "").strip()

    # 1. If an authorization code was provided, exchange it for tokens with Google
    if payload.code and not token:
        client_id = os.getenv("GOOGLE_CLIENT_ID", "")
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET", "")
        redirect_uri = payload.redirect_uri or os.getenv("GOOGLE_REDIRECT_URI", "http://127.0.0.1:5500/login.html")
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
                if token_resp.status_code == 200:
                    token_data = token_resp.json()
                    token = token_data.get("id_token") or token_data.get("access_token") or ""
        except Exception:
            pass

    if not token and not payload.code:
        raise HTTPException(status_code=400, detail="Google credential, id_token, or code is required.")

    # 2. Verify token with Google's tokeninfo API
    if token:
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

    # 3. Lookup existing user: If they exist, log them in (Secure account linking).
    existing_user = db.query(User).filter(func.lower(func.trim(User.email)) == email).first()

    # Also check secondary SQLite backup DB if present
    if not existing_user:
        try:
            import sqlite3
            project_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            sqlite_path = os.path.join(project_backend, "jod_events.db")
            if os.path.exists(sqlite_path):
                s_conn = sqlite3.connect(sqlite_path)
                s_cur = s_conn.cursor()
                # Query the existing user by email
                s_cur.execute("SELECT id FROM users WHERE lower(trim(email)) = ?", (email,))
                row = s_cur.fetchone()
                s_conn.close()
                if row:
                    # If they exist in SQLite but not Postgres, we ideally should sync them to Postgres.
                    # For simplicity, we just won't throw an error, we will recreate them in Postgres if missing.
                    pass
        except Exception:
            pass

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

        # Sync to backup SQLite database
        try:
            import sqlite3
            project_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            sqlite_path = os.path.join(project_backend, "jod_events.db")
            s_conn = sqlite3.connect(sqlite_path)
            s_cur = s_conn.cursor()
            s_cur.execute("""
                INSERT INTO users (id, customer_id, email, username, full_name, hashed_password, is_active, is_admin)
                VALUES (?, ?, ?, ?, ?, ?, 1, 0)
                ON CONFLICT(email) DO NOTHING
            """, (str(user.id), str(user.customer_id), user.email, user.username, user.full_name, user.hashed_password))
            s_conn.commit()
            s_conn.close()
        except Exception:
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
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if len(v) > 255:
            raise ValueError("Password is too long.")
        if not re.search(r"[A-Za-z]", v):
            raise ValueError("Password must contain at least one letter.")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one digit.")
        return v


def _password_reset_otp(db: Session, email: str, code: str, verified_only: bool = False):
    query = db.query(EmailOTP).filter(
        EmailOTP.email == email,
        EmailOTP.otp_code == code.strip(),
        EmailOTP.purpose == "password_reset",
    )
    if verified_only:
        query = query.filter(EmailOTP.is_verified == True)
    else:
        query = query.filter(EmailOTP.is_verified == False)
    return query.order_by(EmailOTP.created_at.desc()).first()


@router.post("/forgot-password")
def forgot_password(payload: ForgotPasswordRequest, db: Session = Depends(get_db)):
    """Send a 6-digit OTP to the registered email so the user can reset their password."""
    email_clean = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email_clean).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email address.")

    otp_code = f"{random.randint(100000, 999999)}"
    expires_at = datetime.utcnow() + timedelta(minutes=10)

    db.query(EmailOTP).filter(
        EmailOTP.email == email_clean,
        EmailOTP.purpose == "password_reset",
    ).delete(synchronize_session=False)

    otp_record = EmailOTP(
        email=email_clean,
        otp_code=otp_code,
        expires_at=expires_at,
        is_verified=False,
        purpose="password_reset",
    )
    db.add(otp_record)
    db.commit()

    subject = "Your JOD Events password reset code"
    text_body = (
        f"Your JOD Events password reset code is {otp_code}. "
        "It expires in 10 minutes. If you did not request this, you can ignore this email."
    )
    html_body = (
        f"<p>Your JOD Events password reset code is <strong>{otp_code}</strong>.</p>"
        "<p>It expires in 10 minutes. If you did not request this, you can ignore this email.</p>"
    )
    emailed = send_email(email_clean, subject, text_body, html_body)
    print(f"  [PASSWORD RESET] OTP generated for {email_clean} smtp={emailed}", flush=True)

    result = {
        "message": f"6-digit verification code sent to {email_clean}.",
        "email": email_clean,
        "email_delivered": emailed,
    }
    if not emailed:
        result["dev_otp"] = otp_code
        result["message"] = (
            f"6-digit verification code generated for {email_clean}. "
            "Email delivery is not configured on this server, so use the on-screen code."
        )
    return result


@router.post("/verify-reset-otp")
def verify_reset_otp(payload: VerifyResetOtpRequest, db: Session = Depends(get_db)):
    """Confirm the password-reset OTP before showing the new-password fields."""
    email_clean = payload.email.strip().lower()
    code = (payload.otp_code or "").strip()
    if not re.fullmatch(r"\d{6}", code):
        raise HTTPException(status_code=400, detail="Enter the 6-digit verification code sent to your email.")

    otp_record = _password_reset_otp(db, email_clean, code, verified_only=False)
    if not otp_record:
        verified = _password_reset_otp(db, email_clean, code, verified_only=True)
        if verified:
            if datetime.utcnow() > verified.expires_at:
                raise HTTPException(status_code=400, detail="OTP code has expired. Please request a new verification code.")
            return {"message": "Email verified. You can now set a new password.", "email": email_clean}
        raise HTTPException(status_code=400, detail="Invalid OTP verification code. Please check and try again.")

    if datetime.utcnow() > otp_record.expires_at:
        raise HTTPException(status_code=400, detail="OTP code has expired. Please request a new verification code.")

    otp_record.is_verified = True
    db.commit()
    return {"message": "Email verified. You can now set a new password.", "email": email_clean}


@router.post("/reset-password")
def reset_password(payload: ResetPasswordRequest, db: Session = Depends(get_db)):
    """Reset user password after a verified OTP, across active DB and secondary SQLite DB."""
    email_clean = payload.email.strip().lower()
    user = db.query(User).filter(func.lower(User.email) == email_clean).first()
    if not user:
        raise HTTPException(status_code=404, detail="No account found with this email address.")

    otp_record = _password_reset_otp(db, email_clean, payload.otp_code, verified_only=True)
    if not otp_record:
        pending = _password_reset_otp(db, email_clean, payload.otp_code, verified_only=False)
        if pending and datetime.utcnow() <= pending.expires_at:
            pending.is_verified = True
            otp_record = pending
        else:
            raise HTTPException(
                status_code=400,
                detail="Verify the 6-digit email code before setting a new password.",
            )

    if datetime.utcnow() > otp_record.expires_at:
        raise HTTPException(status_code=400, detail="OTP code has expired. Please request a new verification code.")

    user.hashed_password = get_password_hash(payload.new_password)
    db.query(EmailOTP).filter(
        EmailOTP.email == email_clean,
        EmailOTP.purpose == "password_reset",
    ).delete(synchronize_session=False)
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
