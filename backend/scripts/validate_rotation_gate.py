"""Validate .env.production presence/structure. Never prints secret values."""
from __future__ import annotations

from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / ".env.production"
HARD = ("CHANGE_ME", "YOUR_DOMAIN", "your-google-client", "jod_password", "Admin@123")
TEMP = "staging.jod-events.local"


def load() -> dict[str, str]:
    env: dict[str, str] = {}
    for line in TARGET.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        env[key.strip()] = value.strip()
    return env


def bad(value: str) -> bool:
    if not value:
        return True
    upper = value.upper()
    return any(h in value or h in upper for h in HARD) or TEMP in value.lower()


def main() -> int:
    env = load()
    failures: list[str] = []

    def need(cond: bool, msg: str) -> None:
        if not cond:
            failures.append(msg)

    need(env.get("APP_ENV", "").lower() == "production", "APP_ENV")
    need(env.get("DEBUG", "").lower() in ("0", "false", "no"), "DEBUG")
    need(env.get("AUTH_CSRF", "").lower() in ("1", "true", "yes"), "AUTH_CSRF")
    need(env.get("AUTH_COOKIE_SECURE", "").lower() in ("1", "true", "yes"), "AUTH_COOKIE_SECURE")
    need(env.get("ADMIN_SYNC_PASSWORD", "").lower() in ("0", "false", "no", ""), "ADMIN_SYNC_PASSWORD")
    need(not bad(env.get("SECRET_KEY", "")) and len(env.get("SECRET_KEY", "")) >= 32, "SECRET_KEY")
    need(not bad(env.get("FILE_ENCRYPTION_KEY", "")) and len(env.get("FILE_ENCRYPTION_KEY", "")) >= 32, "FILE_ENCRYPTION_KEY")
    need(env.get("SECRET_KEY") != env.get("FILE_ENCRYPTION_KEY"), "keys_distinct")
    need(not bad(env.get("POSTGRES_PASSWORD", "")), "POSTGRES_PASSWORD")
    need(env.get("DATABASE_URL", "").startswith("postgresql") and not bad(env.get("DATABASE_URL", "")), "DATABASE_URL")
    need(not bad(env.get("ADMIN_EMAIL", "")) and "@" in env.get("ADMIN_EMAIL", ""), "ADMIN_EMAIL")
    need(not bad(env.get("ADMIN_PASSWORD", "")), "ADMIN_PASSWORD")

    for key in ("FRONTEND_URL", "PUBLIC_APP_URL"):
        parsed = urlparse(env.get(key, ""))
        need(parsed.scheme == "https" and bool(parsed.netloc) and not bad(env.get(key, "")), key)

    origins = [o.strip() for o in env.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
    need(bool(origins), "ALLOWED_ORIGINS_present")
    need("*" not in origins, "ALLOWED_ORIGINS_no_star")
    need(all(urlparse(o).scheme == "https" for o in origins), "ALLOWED_ORIGINS_https")
    need(
        not any((urlparse(o).hostname or "").lower() in ("localhost", "127.0.0.1") for o in origins),
        "ALLOWED_ORIGINS_no_localhost",
    )
    need(not any(TEMP in o.lower() for o in origins), "ALLOWED_ORIGINS_no_temp")

    need(not bad(env.get("GOOGLE_CLIENT_ID", "")), "GOOGLE_CLIENT_ID")
    need(not bad(env.get("GOOGLE_CLIENT_SECRET", "")), "GOOGLE_CLIENT_SECRET")
    pub = env.get("PUBLIC_APP_URL", "").rstrip("/")
    redir = env.get("GOOGLE_REDIRECT_URI", "")
    need(redir.startswith(pub + "/") and redir.endswith("login.html"), "GOOGLE_REDIRECT_URI")

    need(not bad(env.get("SMTP_HOST", "")), "SMTP_HOST")
    need(bool((env.get("SMTP_USER") or env.get("SMTP_USERNAME") or "").strip()), "SMTP_USER")
    need(not bad(env.get("SMTP_PASSWORD", "")), "SMTP_PASSWORD")
    need(not bad(env.get("SMTP_FROM", "")), "SMTP_FROM")

    payment_keys = [k for k in env if any(x in k.upper() for x in ("STRIPE", "RAZOR", "PAYPAL", "PAYMENT_SECRET"))]
    print("payment_keys_present", bool(payment_keys))

    print("CONFIGURATION", "FAIL" if failures else "PASS")
    for item in failures:
        print("FAIL", item)
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
