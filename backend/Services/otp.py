"""Cryptographically generated OTPs, hashed at rest, with attempt limits."""

from __future__ import annotations

import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from Models.email_otp import EmailOTP

OTP_DIGITS = 6
OTP_TTL_MINUTES = 10
OTP_MAX_ATTEMPTS = 5
GENERIC_OTP_FAIL = "Invalid or expired verification code. Please try again."


def generate_otp() -> str:
    return f"{secrets.randbelow(10 ** OTP_DIGITS):0{OTP_DIGITS}d}"


def hash_otp(email: str, code: str, purpose: str) -> str:
    material = f"{(email or '').strip().lower()}|{(purpose or '').strip()}|{(code or '').strip()}".encode("utf-8")
    key = (os.getenv("SECRET_KEY") or "jod-otp").encode("utf-8")
    return hmac.new(key, material, hashlib.sha256).hexdigest()


def otp_expiry() -> datetime:
    return datetime.utcnow() + timedelta(minutes=OTP_TTL_MINUTES)


def store_otp(db: Session, email: str, purpose: str, code: str) -> EmailOTP:
    email_clean = (email or "").strip().lower()
    db.query(EmailOTP).filter(
        EmailOTP.email == email_clean,
        EmailOTP.purpose == purpose,
        EmailOTP.is_verified == False,  # noqa: E712
    ).delete(synchronize_session=False)
    record = EmailOTP(
        email=email_clean,
        otp_code=hash_otp(email_clean, code, purpose),
        expires_at=otp_expiry(),
        is_verified=False,
        purpose=purpose,
        attempt_count=0,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def _latest(db: Session, email: str, purpose, verified: bool | None) -> EmailOTP | None:
    email_clean = (email or "").strip().lower()
    query = db.query(EmailOTP).filter(EmailOTP.email == email_clean)
    if isinstance(purpose, list):
        query = query.filter(EmailOTP.purpose.in_(purpose))
    else:
        query = query.filter(EmailOTP.purpose == purpose)
    if verified is True:
        query = query.filter(EmailOTP.is_verified == True)  # noqa: E712
    elif verified is False:
        query = query.filter(EmailOTP.is_verified == False)  # noqa: E712
    return query.order_by(EmailOTP.created_at.desc()).first()


def verify_otp(
    db: Session,
    email: str,
    code: str,
    purpose,
    *,
    consume: bool = False,
) -> EmailOTP:
    code = (code or "").strip()
    if not code.isdigit() or len(code) != OTP_DIGITS:
        raise HTTPException(status_code=400, detail=GENERIC_OTP_FAIL)

    record = _latest(db, email, purpose, verified=False)
    if record is None:
        record = _latest(db, email, purpose, verified=True)
    if record is None:
        raise HTTPException(status_code=400, detail=GENERIC_OTP_FAIL)

    if datetime.utcnow() > record.expires_at:
        raise HTTPException(status_code=400, detail=GENERIC_OTP_FAIL)

    attempts = int(getattr(record, "attempt_count", 0) or 0)
    if attempts >= OTP_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many verification attempts. Request a new code.",
        )

    purposes = purpose if isinstance(purpose, list) else [purpose]
    matched = any(
        hmac.compare_digest(record.otp_code or "", hash_otp(email, code, item or ""))
        for item in purposes
    )
    if not matched:
        record.attempt_count = attempts + 1
        db.commit()
        raise HTTPException(status_code=400, detail=GENERIC_OTP_FAIL)

    if consume or not record.is_verified:
        record.is_verified = True
        db.commit()
        db.refresh(record)
    return record
