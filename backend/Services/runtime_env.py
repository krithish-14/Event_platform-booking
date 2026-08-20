"""Runtime environment helpers for production vs local development."""

import os
from urllib.parse import urlparse


WEAK_SECRETS = {
    "",
    "change-this-to-a-strong-secret-key-in-production",
    "change-this-to-a-strong-random-secret-in-production",
    "jod-dev-file-encryption-key",
    "jod-events-super-secret-key-2026-change-in-production-please-use-64-char-random-string",
}

WEAK_PASSWORDS = {
    "Admin@123",
    "admin",
    "password",
    "jod_password",
}

DEFAULT_DEV_ORIGINS = (
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8001",
    "http://localhost:8001",
)


def is_production() -> bool:
    return os.getenv("APP_ENV", "development").strip().lower() in ("production", "prod")


def docs_enabled() -> bool:
    flag = os.getenv("ENABLE_DOCS", "").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    if flag in ("0", "false", "no"):
        return False
    return not is_production()


def cors_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip() and o.strip() != "*"]
    if is_production():
        if not origins:
            raise RuntimeError(
                "ALLOWED_ORIGINS must list your public HTTPS origin in production."
            )
        return origins
    return origins or list(DEFAULT_DEV_ORIGINS)


def public_app_url() -> str:
    return (
        os.getenv("PUBLIC_APP_URL")
        or os.getenv("FRONTEND_URL")
        or os.getenv("PUBLIC_SITE_URL")
        or ("http://127.0.0.1:5500" if not is_production() else "")
    ).rstrip("/")


def allowed_google_redirects() -> set[str]:
    allowed = set()
    configured = (os.getenv("GOOGLE_REDIRECT_URI") or "").strip()
    if configured:
        allowed.add(configured)
    public = public_app_url()
    if public:
        allowed.add(f"{public}/login.html")
    if not is_production():
        allowed.add("http://127.0.0.1:5500/login.html")
        allowed.add("http://localhost:5500/login.html")
    return {u for u in allowed if u}


def resolve_google_redirect(requested: str | None) -> str:
    allowed = allowed_google_redirects()
    candidate = (requested or os.getenv("GOOGLE_REDIRECT_URI") or "").strip()
    if candidate in allowed:
        return candidate
    if allowed:
        return sorted(allowed)[0]
    raise ValueError("Google OAuth redirect is not configured.")


def smtp_configured() -> bool:
    return bool((os.getenv("SMTP_HOST") or "").strip())


def require_strong_secret(value: str | None, name: str) -> str:
    secret = (value or "").strip()
    if secret in WEAK_SECRETS or len(secret) < 24:
        if is_production():
            raise RuntimeError(f"{name} must be a strong random value in production.")
        if not secret:
            raise RuntimeError(f"{name} is required.")
    return secret
