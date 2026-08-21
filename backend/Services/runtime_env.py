"""Runtime environment helpers for production vs local development."""

import os
from urllib.parse import urlparse


WEAK_SECRETS = {
    "",
    "change-this-to-a-strong-secret-key-in-production",
    "change-this-to-a-strong-random-secret-in-production",
    "jod-dev-file-encryption-key",
    "jod-events-super-secret-key-2026-change-in-production-please-use-64-char-random-string",
    "CHANGE_ME_64_CHAR_RANDOM_SECRET",
    "CHANGE_ME_LONG_RANDOM_FILE_ENCRYPTION_KEY",
    "CHANGE_ME_STAGING_SECRET_KEY",
    "CHANGE_ME_STAGING_FILE_ENCRYPTION_KEY",
}

WEAK_PASSWORDS = {
    "Admin@123",
    "admin",
    "password",
    "jod_password",
    "CHANGE_ME_STRONG_PASSWORD",
    "CHANGE_ME_STAGING_ADMIN_PASSWORD",
    "CHANGE_ME_STRONG_DB_PASSWORD",
    "CHANGE_ME_STAGING_DB_PASSWORD",
}

DEFAULT_DEV_ORIGINS = (
    "http://127.0.0.1:5500",
    "http://localhost:5500",
    "http://127.0.0.1:8001",
    "http://localhost:8001",
    "http://127.0.0.1",
    "http://localhost",
)

PLACEHOLDER_MARKERS = (
    "CHANGE_ME",
    "YOUR_DOMAIN",
    "your-google-client-id",
)


def is_production() -> bool:
    return os.getenv("APP_ENV", "development").strip().lower() in ("production", "prod")


def is_staging() -> bool:
    return os.getenv("APP_ENV", "").strip().lower() in ("staging", "stage")


def debug_enabled() -> bool:
    raw = (os.getenv("DEBUG") or "").strip().lower()
    if raw in ("1", "true", "yes"):
        return True
    if raw in ("0", "false", "no"):
        return False
    return not is_production()


def docs_enabled() -> bool:
    flag = os.getenv("ENABLE_DOCS", "").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    if flag in ("0", "false", "no"):
        return False
    return not is_production()


def rate_limiting_enabled() -> bool:
    flag = os.getenv("RATE_LIMIT_ENABLED", "").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    if flag in ("0", "false", "no"):
        return False
    # On for production/staging; local development stays off so automated tests can register freely.
    return is_production() or is_staging()


def cookie_secure() -> bool:
    flag = os.getenv("AUTH_COOKIE_SECURE", "").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    if flag in ("0", "false", "no"):
        return False
    return is_production()


def csrf_protection_enabled() -> bool:
    flag = os.getenv("AUTH_CSRF", "").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    if flag in ("0", "false", "no"):
        return False
    return is_production() or is_staging()


def expose_access_token_in_json() -> bool:
    """JWTs stay in the httpOnly cookie. JSON bodies omit them unless explicitly enabled."""
    flag = os.getenv("AUTH_EXPOSE_TOKEN", "").strip().lower()
    if flag in ("1", "true", "yes"):
        return True
    return False


def cors_origins() -> list[str]:
    raw = os.getenv("ALLOWED_ORIGINS", "")
    origins = [o.strip() for o in raw.split(",") if o.strip() and o.strip() != "*"]
    if is_production():
        if not origins:
            raise RuntimeError(
                "ALLOWED_ORIGINS must list your public HTTPS origin in production."
            )
        cleaned = []
        for origin in origins:
            host = (urlparse(origin).hostname or "").lower()
            if host in ("localhost", "127.0.0.1", "0.0.0.0") or host.startswith("192.168.") or host.startswith("10."):
                raise RuntimeError(
                    "ALLOWED_ORIGINS must not include localhost or private-network origins in production."
                )
            if urlparse(origin).scheme != "https":
                raise RuntimeError("ALLOWED_ORIGINS must use https:// in production.")
            cleaned.append(origin)
        return cleaned
    return origins or list(DEFAULT_DEV_ORIGINS)


def allowed_hosts() -> list[str]:
    raw = os.getenv("ALLOWED_HOSTS", "")
    hosts = [h.strip() for h in raw.split(",") if h.strip()]
    if not hosts:
        origins = cors_origins()
        parsed = []
        for origin in origins:
            try:
                host = urlparse(origin).hostname
            except Exception:
                host = None
            if host:
                parsed.append(host)
        if is_production() and parsed:
            hosts = parsed
        else:
            hosts = parsed or ["*"]
    # Loopback Host headers are required for container healthchecks (TrustedHost).
    # CORS origins remain separately restricted; this does not open browser CORS.
    if hosts != ["*"]:
        for loopback in ("127.0.0.1", "localhost"):
            if loopback not in hosts:
                hosts.append(loopback)
    return hosts


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


def smtp_user() -> str:
    return (os.getenv("SMTP_USERNAME") or os.getenv("SMTP_USER") or "").strip()


def _looks_placeholder(value: str) -> bool:
    upper = (value or "").upper()
    return any(marker in (value or "") or marker in upper for marker in PLACEHOLDER_MARKERS)


def _is_low_entropy(secret: str) -> bool:
    if len(secret) < 32:
        return True
    if len(set(secret)) < 12:
        return True
    if secret == secret[0] * len(secret):
        return True
    return False


def require_strong_secret(value: str | None, name: str) -> str:
    secret = (value or "").strip()
    weak = (
        secret in WEAK_SECRETS
        or _looks_placeholder(secret)
        or secret.lower() in {item.lower() for item in WEAK_SECRETS}
    )
    if is_production() or is_staging():
        if weak or _is_low_entropy(secret):
            raise RuntimeError(f"{name} must be a unique cryptographically random value.")
    elif not secret:
        raise RuntimeError(f"{name} is required.")
    return secret


def _require_https_url(value: str, name: str) -> str:
    url = (value or "").strip().rstrip("/")
    if not url:
        raise RuntimeError(f"{name} is required in production.")
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise RuntimeError(f"{name} must be an https:// origin in production.")
    if _looks_placeholder(url):
        raise RuntimeError(f"{name} still contains a placeholder value.")
    return url


def validate_production_env() -> None:
    """Fail fast when production is missing required, non-placeholder configuration."""
    if not is_production():
        return
    if debug_enabled():
        raise RuntimeError("DEBUG must be False in production.")

    db_url = (os.getenv("DATABASE_URL") or "").strip()
    if not db_url or "sqlite" in db_url.lower():
        raise RuntimeError("DATABASE_URL must be a PostgreSQL URL in production.")
    if _looks_placeholder(db_url) or any(p in db_url for p in WEAK_PASSWORDS):
        raise RuntimeError("DATABASE_URL still contains a placeholder or weak password.")

    secret_key = require_strong_secret(os.getenv("SECRET_KEY"), "SECRET_KEY")
    file_key = require_strong_secret(os.getenv("FILE_ENCRYPTION_KEY"), "FILE_ENCRYPTION_KEY")
    if secret_key == file_key:
        raise RuntimeError("SECRET_KEY and FILE_ENCRYPTION_KEY must be different.")

    frontend = _require_https_url(public_app_url(), "PUBLIC_APP_URL/FRONTEND_URL")
    origins = cors_origins()
    if not any(frontend.startswith(origin.rstrip("/")) or origin.rstrip("/") == frontend for origin in origins):
        raise RuntimeError("ALLOWED_ORIGINS must include PUBLIC_APP_URL in production.")

    admin_email = (os.getenv("ADMIN_EMAIL") or "").strip()
    if not admin_email or _looks_placeholder(admin_email):
        raise RuntimeError("ADMIN_EMAIL is required in production.")
    admin_password = os.getenv("ADMIN_PASSWORD") or ""
    if admin_password in WEAK_PASSWORDS or _looks_placeholder(admin_password):
        raise RuntimeError("ADMIN_PASSWORD is too weak or still a placeholder.")

    google_id = (os.getenv("GOOGLE_CLIENT_ID") or "").strip()
    if google_id and not _looks_placeholder(google_id):
        secret = (os.getenv("GOOGLE_CLIENT_SECRET") or "").strip()
        if not secret or _looks_placeholder(secret):
            raise RuntimeError("GOOGLE_CLIENT_SECRET is required when Google login is enabled.")
        try:
            resolve_google_redirect(os.getenv("GOOGLE_REDIRECT_URI"))
        except ValueError as exc:
            raise RuntimeError(str(exc)) from exc
