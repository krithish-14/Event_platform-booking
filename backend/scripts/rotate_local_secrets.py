"""
Rotate locally generated production secrets into .env.production.
Never prints secret values.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

_SCRIPTS = Path(__file__).resolve().parent
_ROOT = _SCRIPTS.parents[1]  # backend/scripts → repo root
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))

from generate_secrets import (  # noqa: E402
    _password,
    generate_crypto_secrets,
    write_secrets,
)

TARGET = _ROOT / ".env.production"
PLACEHOLDERS = ("CHANGE_ME", "YOUR_DOMAIN", "jod_password", "Admin@123")


def _get(text: str, key: str) -> str:
    match = re.search(rf"^{re.escape(key)}=(.*)$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def _set(text: str, key: str, value: str) -> str:
    pattern = re.compile(rf"^{re.escape(key)}=.*$", re.MULTILINE)
    line = f"{key}={value}"
    if pattern.search(text):
        return pattern.sub(line, text, count=1)
    commented = re.compile(rf"^#\s*{re.escape(key)}=.*$", re.MULTILINE)
    if commented.search(text):
        return commented.sub(line, text, count=1)
    if not text.endswith("\n"):
        text += "\n"
    return text + line + "\n"


def _strong(value: str) -> bool:
    return (
        bool(value)
        and len(value) >= 32
        and len(set(value)) >= 12
        and not any(p in value or p in value.upper() for p in PLACEHOLDERS)
    )


def main() -> int:
    if not TARGET.exists():
        print("FAIL: .env.production missing")
        return 1

    text = TARGET.read_text(encoding="utf-8")
    old_file_key = _get(text, "FILE_ENCRYPTION_KEY")

    # Preserve previous file key for decrypting existing ciphertext during rotation.
    if old_file_key and _strong(old_file_key):
        text = _set(text, "FILE_ENCRYPTION_KEY_PREVIOUS", old_file_key)
        TARGET.write_text(text, encoding="utf-8")

    crypto = generate_crypto_secrets()
    # Also rotate chat-exposed local operator secrets into the env file.
    crypto["ADMIN_PASSWORD"] = _password()
    write_secrets(TARGET, crypto, sync_database_url=True)

    text = TARGET.read_text(encoding="utf-8")
    sk = _get(text, "SECRET_KEY")
    fk = _get(text, "FILE_ENCRYPTION_KEY")
    prev = _get(text, "FILE_ENCRYPTION_KEY_PREVIOUS")
    admin = _get(text, "ADMIN_PASSWORD")
    dbpw = _get(text, "POSTGRES_PASSWORD")

    checks = {
        "SECRET_KEY_strong": _strong(sk),
        "FILE_ENCRYPTION_KEY_strong": _strong(fk),
        "keys_distinct": sk != fk,
        "previous_set": bool(prev) and prev != fk,
        "ADMIN_PASSWORD_strong": _strong(admin) or (len(admin) >= 16 and not any(p in admin for p in PLACEHOLDERS)),
        "POSTGRES_PASSWORD_strong": len(dbpw) >= 16 and not any(p in dbpw for p in PLACEHOLDERS),
        "no_placeholders": all(
            not any(p in _get(text, k) or p in _get(text, k).upper() for p in PLACEHOLDERS)
            for k in ("SECRET_KEY", "FILE_ENCRYPTION_KEY", "ADMIN_PASSWORD", "POSTGRES_PASSWORD", "DATABASE_URL")
        ),
    }
    print("LOCAL_ROTATION_WRITTEN: SECRET_KEY,FILE_ENCRYPTION_KEY,FILE_ENCRYPTION_KEY_PREVIOUS,ADMIN_PASSWORD,POSTGRES_PASSWORD,DATABASE_URL")
    for name, ok in checks.items():
        print(f"{name}: {'PASS' if ok else 'FAIL'}")
    return 0 if all(checks.values()) else 2


if __name__ == "__main__":
    raise SystemExit(main())
