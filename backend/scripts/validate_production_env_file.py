"""
Validate .env.production without printing secret values.
Exit 0 if structurally ready for production boot checks; exit 1 otherwise.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import urlparse

_ROOT = Path(__file__).resolve().parents[2]
TARGET = _ROOT / ".env.production"

PLACEHOLDERS = ("CHANGE_ME", "YOUR_DOMAIN", "your-google-client", "jod_password", "Admin@123")


def _load() -> dict[str, str]:
    env: dict[str, str] = {}
    if not TARGET.exists():
        return env
    for line in TARGET.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def _placeholder(value: str) -> bool:
    if not value:
        return True
    upper = value.upper()
    return any(p.upper() in upper or p in value for p in PLACEHOLDERS)


def _strong(value: str) -> bool:
    return len(value) >= 32 and len(set(value)) >= 12 and not _placeholder(value)


def main() -> int:
    env = _load()
    if not env:
        print("FAIL: .env.production missing")
        return 1

    failures: list[str] = []

    def need(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)

    need(env.get("APP_ENV", "").lower() == "production", "APP_ENV must be production")
    need(env.get("DEBUG", "").lower() in ("0", "false", "no"), "DEBUG must be false")
    need(env.get("AUTH_CSRF", "").lower() in ("1", "true", "yes"), "AUTH_CSRF must be enabled")
    need(env.get("AUTH_COOKIE_SECURE", "").lower() in ("1", "true", "yes"), "AUTH_COOKIE_SECURE must be true")
    need(env.get("AUTH_EXPOSE_TOKEN", "").lower() in ("0", "false", "no", ""), "AUTH_EXPOSE_TOKEN must be false")
    need(env.get("ADMIN_SYNC_PASSWORD", "").lower() in ("0", "false", "no", ""), "ADMIN_SYNC_PASSWORD must be false")
    need(env.get("ENABLE_DOCS", "").lower() in ("0", "false", "no", ""), "ENABLE_DOCS should be false")

    for key in ("FRONTEND_URL", "PUBLIC_APP_URL"):
        url = env.get(key, "")
        parsed = urlparse(url)
        need(parsed.scheme == "https" and bool(parsed.netloc), f"{key} must be https origin")
        need(not _placeholder(url), f"{key} must not be placeholder")

    origins = [o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    need(bool(origins), "ALLOWED_ORIGINS required")
    need("*" not in origins, "ALLOWED_ORIGINS must not contain *")
    for origin in origins:
        host = (urlparse(origin).hostname or "").lower()
        need(urlparse(origin).scheme == "https", "ALLOWED_ORIGINS must use https")
        need(host not in ("localhost", "127.0.0.1") and not host.startswith("192.168.") and not host.startswith("10."),
             "ALLOWED_ORIGINS must not include localhost/private hosts")
        need(not _placeholder(origin), "ALLOWED_ORIGINS must not be placeholder")

    need(_strong(env.get("SECRET_KEY", "")), "SECRET_KEY must be strong")
    need(_strong(env.get("FILE_ENCRYPTION_KEY", "")), "FILE_ENCRYPTION_KEY must be strong")
    need(env.get("SECRET_KEY") != env.get("FILE_ENCRYPTION_KEY"), "SECRET_KEY must differ from FILE_ENCRYPTION_KEY")

    db = env.get("DATABASE_URL", "")
    need(db.startswith("postgresql"), "DATABASE_URL must be PostgreSQL")
    need(not _placeholder(db), "DATABASE_URL must not contain placeholders")
    need(not _placeholder(env.get("POSTGRES_PASSWORD", "")), "POSTGRES_PASSWORD must not be placeholder")

    need(not _placeholder(env.get("ADMIN_EMAIL", "")), "ADMIN_EMAIL must be set")
    need(not _placeholder(env.get("ADMIN_PASSWORD", "")) and len(env.get("ADMIN_PASSWORD", "")) >= 12,
         "ADMIN_PASSWORD must be strong and non-placeholder")

    google_id = env.get("GOOGLE_CLIENT_ID", "").strip()
    if google_id and not _placeholder(google_id):
        need(not _placeholder(env.get("GOOGLE_CLIENT_SECRET", "")), "GOOGLE_CLIENT_SECRET required when Google enabled")
        redirect = env.get("GOOGLE_REDIRECT_URI", "")
        need(redirect.startswith("https://") and redirect.endswith("login.html"), "GOOGLE_REDIRECT_URI must match HTTPS login")

    if failures:
        print("FAIL: production configuration validation")
        for item in failures:
            print(f"  - {item}")
        return 1

    print("PASS: production configuration validation (no values shown)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
