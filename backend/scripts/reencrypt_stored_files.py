"""Re-encrypt stored_files rows after a FILE_ENCRYPTION_KEY rotation.

Set FILE_ENCRYPTION_KEY_PREVIOUS to the old key and FILE_ENCRYPTION_KEY to the new key
before running. Does not print secret values.
"""

from __future__ import annotations

import os
import sys

_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)

from dotenv import load_dotenv

load_dotenv(os.path.join(_BACKEND, ".env"))
load_dotenv(os.path.join(os.path.dirname(_BACKEND), ".env.production"))


def main() -> None:
    previous = (os.getenv("FILE_ENCRYPTION_KEY_PREVIOUS") or "").strip()
    current = (os.getenv("FILE_ENCRYPTION_KEY") or "").strip()
    if not previous or not current:
        raise SystemExit("FILE_ENCRYPTION_KEY and FILE_ENCRYPTION_KEY_PREVIOUS are required.")
    if previous == current:
        raise SystemExit("Previous and current FILE_ENCRYPTION_KEY values are the same.")

    from Models.base import get_session_factory
    from Models.stored_file import StoredFile
    from Services.file_storage import decrypt_bytes, encrypt_bytes

    db = get_session_factory()()
    updated = 0
    failed = 0
    try:
        rows = db.query(StoredFile).all()
        for row in rows:
            try:
                plain = decrypt_bytes(row.encrypted_data)
                row.encrypted_data = encrypt_bytes(plain)
                row.encryption_version = int(row.encryption_version or 1) + 1
                updated += 1
            except Exception:
                failed += 1
        db.commit()
    finally:
        db.close()
    print(f"reencrypted={updated} failed={failed}")
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
