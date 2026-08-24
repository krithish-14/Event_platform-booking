"""Double-submit CSRF cookie for cookie-authenticated mutating requests."""

from __future__ import annotations

import hmac
import os
import secrets

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from Authentication.jwt_handler import AUTH_COOKIE_NAME
from Services.runtime_env import cookie_secure, csrf_protection_enabled

CSRF_COOKIE_NAME = "jod_csrf"
CSRF_HEADER_NAME = "x-csrf-token"
SAFE_METHODS = {"GET", "HEAD", "OPTIONS", "TRACE"}
EXEMPT_PATHS = {
    "/health",
    "/health/ready",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/api/auth/login",
    "/api/auth/register",
    "/api/auth/google",
    "/api/auth/google/url",
    "/api/auth/google/config",
    "/api/auth/forgot-password",
    "/api/auth/check",
    "/api/auth/verify-reset-otp",
    "/api/auth/reset-password",
    "/api/auth/logout",
    "/api/forms/submissions",
    "/api/payments/proof",
}


def new_csrf_token() -> str:
    return secrets.token_urlsafe(32)


def set_csrf_cookie(response: Response, token: str | None = None) -> str:
    value = token or new_csrf_token()
    response.set_cookie(
        key=CSRF_COOKIE_NAME,
        value=value,
        httponly=False,
        samesite="lax",
        secure=cookie_secure(),
        max_age=int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60")) * 60,
        path="/",
    )
    return value


def clear_csrf_cookie(response: Response) -> None:
    response.delete_cookie(
        key=CSRF_COOKIE_NAME,
        path="/",
        samesite="lax",
        secure=cookie_secure(),
        httponly=False,
    )


def _exempt(path: str) -> bool:
    if path in EXEMPT_PATHS:
        return True
    if path.startswith("/api/auth/google"):
        return True
    return False


class CookieCsrfMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not csrf_protection_enabled():
            return await call_next(request)
        if request.method.upper() in SAFE_METHODS or _exempt(request.url.path):
            return await call_next(request)
        if not request.cookies.get(AUTH_COOKIE_NAME):
            return await call_next(request)
        auth = (request.headers.get("authorization") or "").strip()
        if auth.lower().startswith("bearer ") and len(auth) > 12:
            bearer = auth.split(" ", 1)[1].strip()
            if bearer and bearer != request.cookies.get(AUTH_COOKIE_NAME):
                return await call_next(request)
        cookie_token = request.cookies.get(CSRF_COOKIE_NAME) or ""
        header_token = request.headers.get(CSRF_HEADER_NAME) or ""
        if not cookie_token or not header_token or not hmac.compare_digest(cookie_token, header_token):
            return JSONResponse(status_code=403, content={"detail": "CSRF validation failed."})
        return await call_next(request)
