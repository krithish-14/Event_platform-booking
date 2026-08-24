"""In-process rate limiter for sensitive auth, OTP, payment, and admin routes."""

from __future__ import annotations

import time
from collections import defaultdict, deque
from threading import Lock
from typing import Deque, Dict

from fastapi import HTTPException, Request, status

from Services.runtime_env import rate_limiting_enabled


_HITS: Dict[str, Deque[float]] = defaultdict(deque)
_LOCK = Lock()

LOGIN_LIMIT = (10, 15 * 60)
OTP_LIMIT = (5, 15 * 60)
PASSWORD_RESET_LIMIT = (5, 60 * 60)
PAYMENT_LIMIT = (20, 15 * 60)
ADMIN_LIMIT = (60, 15 * 60)
SUPPORT_LIMIT = (8, 15 * 60)


def limit_support(request: Request, email: str | None = None) -> None:
    """Throttle anonymous and authenticated support-ticket creation."""
    if not rate_limiting_enabled():
        return
    ip = client_ip(request)
    if not allow(f"support:ip:{ip}", SUPPORT_LIMIT[0], SUPPORT_LIMIT[1]):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many support requests. Please try again later.",
        )
    clean = (email or "").strip().lower()
    if clean and not allow(f"support:email:{clean}", SUPPORT_LIMIT[0], SUPPORT_LIMIT[1]):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many support requests for this email. Please try again later.",
        )


def client_ip(request: Request) -> str:
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        return forwarded
    if request.client and request.client.host:
        return request.client.host
    return "unknown"


def allow(key: str, limit: int, window_seconds: int) -> bool:
    now = time.monotonic()
    cutoff = now - window_seconds
    with _LOCK:
        bucket = _HITS[key]
        while bucket and bucket[0] < cutoff:
            bucket.popleft()
        if len(bucket) >= limit:
            return False
        bucket.append(now)
        return True


def enforce(request: Request, bucket: str, limit: int, window_seconds: int) -> None:
    if not rate_limiting_enabled():
        return
    key = f"{bucket}:{client_ip(request)}"
    if not allow(key, limit, window_seconds):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many requests. Please try again later.",
        )


def limit_login(request: Request) -> None:
    enforce(request, "login", *LOGIN_LIMIT)


def limit_register(request: Request) -> None:
    enforce(request, "register", *LOGIN_LIMIT)


def limit_otp(request: Request, email: str | None = None) -> None:
    enforce(request, "otp", *OTP_LIMIT)
    if email:
        key = f"otp-email:{(email or '').strip().lower()}"
        if rate_limiting_enabled() and not allow(key, OTP_LIMIT[0], OTP_LIMIT[1]):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
            )


def limit_password_reset(request: Request, email: str | None = None) -> None:
    enforce(request, "password_reset", *PASSWORD_RESET_LIMIT)
    if email:
        key = f"password-reset-email:{(email or '').strip().lower()}"
        if rate_limiting_enabled() and not allow(key, PASSWORD_RESET_LIMIT[0], PASSWORD_RESET_LIMIT[1]):
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Too many requests. Please try again later.",
            )


def limit_payment(request: Request) -> None:
    enforce(request, "payment", *PAYMENT_LIMIT)


def limit_admin(request: Request) -> None:
    enforce(request, "admin", *ADMIN_LIMIT)
