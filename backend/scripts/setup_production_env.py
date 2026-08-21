"""
Interactive production env setup.

- Copies .env.production.example → .env.production if missing
- Generates SECRET_KEY / FILE_ENCRYPTION_KEY / POSTGRES_PASSWORD without printing them
- Prompts for external secrets with getpass (no echo)
- Never prints secret values

Run from repo root:
  python backend/scripts/setup_production_env.py
"""

from __future__ import annotations

import getpass
import re
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_ROOT = _BACKEND.parent
_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from generate_secrets import generate_crypto_secrets, write_secrets  # noqa: E402

TARGET = _ROOT / ".env.production"
EXAMPLE = _ROOT / ".env.production.example"

PLACEHOLDER_HINTS = (
    "CHANGE_ME",
    "YOUR_DOMAIN",
    "your-google-client",
    "jod_password",
    "Admin@123",
)


def _read() -> str:
    return TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""


def _write(text: str) -> None:
    TARGET.write_text(text, encoding="utf-8")


def _get(text: str, key: str) -> str:
    m = re.search(rf"^{re.escape(key)}=(.*)$", text, re.MULTILINE)
    return (m.group(1).strip() if m else "")


def _set(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    line = f"{key}={value}"
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    if not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def _is_placeholder(value: str) -> bool:
    if not (value or "").strip():
        return True
    upper = value.upper()
    return any(h.upper() in upper or h in value for h in PLACEHOLDER_HINTS)


def _prompt_text(label: str, current: str, *, required: bool) -> str | None:
    hint = " (keep current)" if current and not _is_placeholder(current) else ""
    raw = input(f"{label}{hint}: ").strip()
    if not raw:
        if current and not _is_placeholder(current):
            return None  # keep
        if required:
            print("  Required — leaving placeholder for later manual fill.")
        return None
    return raw


def _prompt_secret(label: str, current: str, *, required: bool) -> str | None:
    status = "set" if current and not _is_placeholder(current) else "missing/placeholder"
    print(f"{label} [{status}] — leave blank to keep current / skip")
    value = getpass.getpass("  Enter value (hidden): ")
    confirm = getpass.getpass("  Confirm value (hidden): ")
    if not value:
        return None
    if value != confirm:
        print("  Mismatch — not updated.")
        return None
    if _is_placeholder(value) or len(value) < 8:
        print("  Rejected: too short or looks like a placeholder.")
        return None
    return value


def _present(key: str, text: str) -> str:
    value = _get(text, key)
    if not value:
        return "MISSING"
    if _is_placeholder(value):
        return "PLACEHOLDER"
    return "SET"


def main() -> int:
    if not EXAMPLE.exists():
        print("Missing .env.production.example", file=sys.stderr)
        return 1

    if not TARGET.exists():
        TARGET.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
        print("Created .env.production from example (gitignored).")

    # Crypto secrets — never printed
    crypto = generate_crypto_secrets()
    write_secrets(TARGET, crypto, sync_database_url=True)
    print("Generated: SECRET_KEY, FILE_ENCRYPTION_KEY, POSTGRES_PASSWORD (not displayed).")

    text = _read()

    print()
    print("Non-secret public configuration")
    domain = _prompt_text(
        "Public domain (e.g. events.example.com, no scheme)",
        _get(text, "ALLOWED_HOSTS").split(",")[0].strip(),
        required=True,
    )
    if domain:
        domain = domain.removeprefix("https://").removeprefix("http://").strip().strip("/")
        origin = f"https://{domain}"
        www = f"https://www.{domain}" if not domain.startswith("www.") else origin
        hosts = domain if domain.startswith("www.") else f"{domain},www.{domain}"
        text = _set(text, "FRONTEND_URL", origin)
        text = _set(text, "PUBLIC_APP_URL", origin)
        text = _set(text, "ALLOWED_ORIGINS", f"{origin},{www}" if www != origin else origin)
        text = _set(text, "ALLOWED_HOSTS", hosts)
        text = _set(text, "GOOGLE_REDIRECT_URI", f"{origin}/login.html")
        text = _set(text, "SMTP_FROM", f"JOD Events <noreply@{domain.split(':', 1)[0]}>")
        _write(text)
        print("  Updated FRONTEND_URL / PUBLIC_APP_URL / ALLOWED_ORIGINS / ALLOWED_HOSTS / Google redirect.")

    text = _read()
    admin_email = _prompt_text("ADMIN_EMAIL", _get(text, "ADMIN_EMAIL"), required=True)
    if admin_email:
        text = _set(text, "ADMIN_EMAIL", admin_email.lower())
        _write(text)

    print()
    print("External / operator secrets (hidden input)")
    for key, required in (
        ("ADMIN_PASSWORD", True),
        ("GOOGLE_CLIENT_ID", False),
        ("GOOGLE_CLIENT_SECRET", False),
        ("SMTP_HOST", False),
        ("SMTP_USER", False),
        ("SMTP_PASSWORD", False),
    ):
        text = _read()
        if key in ("GOOGLE_CLIENT_ID", "SMTP_HOST", "SMTP_USER"):
            value = _prompt_text(key, _get(text, key), required=required)
        else:
            value = _prompt_secret(key, _get(text, key), required=required)
        if value is not None:
            text = _set(text, key, value)
            if key == "SMTP_USER":
                text = _set(text, "SMTP_USERNAME", value)
            _write(text)
            print(f"  {key}: updated (value not displayed)")

    # Fixed production flags
    text = _read()
    for key, value in (
        ("APP_ENV", "production"),
        ("DEBUG", "False"),
        ("AUTH_COOKIE_SECURE", "true"),
        ("AUTH_CSRF", "true"),
        ("AUTH_EXPOSE_TOKEN", "false"),
        ("ADMIN_SYNC_PASSWORD", "false"),
        ("RATE_LIMIT_ENABLED", "true"),
        ("ENABLE_DOCS", "false"),
        ("JWT_ALGORITHM", "HS256"),
    ):
        text = _set(text, key, value)
    _write(text)

    text = _read()
    print()
    print("Presence check (no values shown):")
    for key in (
        "APP_ENV",
        "DEBUG",
        "SECRET_KEY",
        "FILE_ENCRYPTION_KEY",
        "POSTGRES_PASSWORD",
        "DATABASE_URL",
        "ADMIN_EMAIL",
        "ADMIN_PASSWORD",
        "FRONTEND_URL",
        "PUBLIC_APP_URL",
        "ALLOWED_ORIGINS",
        "GOOGLE_CLIENT_SECRET",
        "SMTP_PASSWORD",
    ):
        print(f"  {key}: {_present(key, text)}")

    sk = _get(text, "SECRET_KEY")
    fk = _get(text, "FILE_ENCRYPTION_KEY")
    if sk and fk and sk == fk:
        print("ERROR: SECRET_KEY and FILE_ENCRYPTION_KEY must differ.", file=sys.stderr)
        return 2
    print("SECRET_KEY != FILE_ENCRYPTION_KEY: OK")
    print("Done. Do not commit .env.production.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
