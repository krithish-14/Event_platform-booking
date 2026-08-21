"""
Generate and write production cryptographic secrets into a gitignored env file.

By default writes to .env.production at the repo root without printing secret values.
Use --print only for local operator paste into a password manager (never commit output).
"""

from __future__ import annotations

import argparse
import re
import secrets
import string
from pathlib import Path

_ROOT = Path(__file__).resolve().parents[2]
_DEFAULT_TARGET = _ROOT / ".env.production"
_EXAMPLE = _ROOT / ".env.production.example"


def _password(length: int = 32) -> str:
    # Exclude @ : / ? # % so values remain safe inside DATABASE_URL userinfo.
    alphabet = string.ascii_letters + string.digits + "!^*-_"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _token() -> str:
    return secrets.token_urlsafe(48)


def _set_env_value(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    line = f"{key}={value}"
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    if not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def generate_crypto_secrets() -> dict[str, str]:
    secret_key = _token()
    file_key = _token()
    while file_key == secret_key:
        file_key = _token()
    return {
        "SECRET_KEY": secret_key,
        "FILE_ENCRYPTION_KEY": file_key,
        "POSTGRES_PASSWORD": _password(),
    }


def write_secrets(target: Path, values: dict[str, str], *, sync_database_url: bool = True) -> None:
    if target.exists():
        text = target.read_text(encoding="utf-8")
    elif _EXAMPLE.exists():
        text = _EXAMPLE.read_text(encoding="utf-8")
    else:
        text = ""

    for key, value in values.items():
        text = _set_env_value(text, key, value)

    if sync_database_url and "POSTGRES_PASSWORD" in values:
        pw = values["POSTGRES_PASSWORD"]
        text = _set_env_value(text, "POSTGRES_PASSWORD", pw)
        user_m = re.search(r"^POSTGRES_USER=(.*)$", text, re.MULTILINE)
        db_m = re.search(r"^POSTGRES_DB=(.*)$", text, re.MULTILINE)
        user = (user_m.group(1).strip() if user_m else "jod") or "jod"
        dbname = (db_m.group(1).strip() if db_m else "jod_events") or "jod_events"
        # Password alphabet is URL-safe (no @ : / ? # %); keep it raw in DATABASE_URL.
        db_url = f"postgresql+psycopg://{user}:{pw}@postgres:5432/{dbname}"
        text = _set_env_value(text, "DATABASE_URL", db_url)

    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text, encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate production crypto secrets securely.")
    parser.add_argument(
        "--write",
        type=Path,
        default=_DEFAULT_TARGET,
        help="Env file to update (default: repo .env.production)",
    )
    parser.add_argument(
        "--print",
        action="store_true",
        help="UNSAFE: print secrets to stdout (for password-manager paste only).",
    )
    parser.add_argument(
        "--include-admin-password",
        action="store_true",
        help="Also generate ADMIN_PASSWORD into the env file (not printed unless --print).",
    )
    args = parser.parse_args()

    values = generate_crypto_secrets()
    if args.include_admin_password:
        values["ADMIN_PASSWORD"] = _password()

    if args.print:
        # Explicit opt-in only — never the default.
        print("# Do not commit these values. Prefer --write without --print.")
        for key, value in values.items():
            print(f"{key}={value}")
        return

    write_secrets(args.write, values)
    print(f"Wrote cryptographic secrets to {args.write.name} (values not displayed).")
    print("Keys updated: " + ", ".join(sorted(values.keys())))
    print("Ensure this file stays gitignored and is never baked into Docker images.")


if __name__ == "__main__":
    main()
