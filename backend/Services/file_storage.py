"""
Encrypt uploaded files and persist them in the database.

KYC documents (PAN, cancelled cheque) are private.
Event banners/gallery/logos are public but still stored encrypted at rest.
"""

from __future__ import annotations

import base64
import hashlib
import mimetypes
import os
import re
import uuid
from typing import Optional, Tuple

from cryptography.fernet import Fernet, InvalidToken
from sqlalchemy.orm import Session

from Models.stored_file import StoredFile


PRIVATE_PURPOSES = {"pan_card", "cancelled_cheque", "payment_screenshot"}
MAX_STORE_BYTES = 5 * 1024 * 1024


def _fernet() -> Fernet:
    raw = (
        os.getenv("FILE_ENCRYPTION_KEY")
        or os.getenv("SECRET_KEY")
        or "jod-dev-file-encryption-key"
    )
    digest = hashlib.sha256(raw.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_bytes(data: bytes) -> bytes:
    return _fernet().encrypt(data)


def decrypt_bytes(token: bytes) -> bytes:
    try:
        return _fernet().decrypt(token)
    except InvalidToken as exc:
        raise ValueError("Unable to decrypt stored file.") from exc


def public_url(stored: StoredFile) -> str:
    if stored.is_private:
        return f"/api/media/private/{stored.id}"
    return f"/api/media/{stored.id}"


def guess_content_type(filename: str, fallback: str = "application/octet-stream") -> str:
    ctype, _ = mimetypes.guess_type(filename or "")
    return ctype or fallback


def store_bytes(
    db: Session,
    *,
    data: bytes,
    filename: str,
    content_type: Optional[str] = None,
    kind: str = "event_media",
    purpose: Optional[str] = None,
    owner_customer_id: Optional[str] = None,
    owner_email: Optional[str] = None,
    legacy_path: Optional[str] = None,
) -> StoredFile:
    if not data:
        raise ValueError("Empty file.")
    if len(data) > MAX_STORE_BYTES:
        raise ValueError("File is too large to store.")

    is_private = kind in {"kyc", "payment_proof"} or (purpose or "") in PRIVATE_PURPOSES
    stored = StoredFile(
        owner_customer_id=owner_customer_id,
        owner_email=(owner_email or "").strip().lower() or None,
        kind="kyc" if is_private else kind,
        purpose=purpose,
        original_filename=os.path.basename(filename or "upload"),
        content_type=content_type or guess_content_type(filename or ""),
        byte_size=len(data),
        is_private=is_private,
        encrypted_data=encrypt_bytes(data),
        encryption_version=1,
        legacy_path=legacy_path,
    )
    db.add(stored)
    db.flush()
    return stored


def get_by_id(db: Session, file_id) -> Optional[StoredFile]:
    try:
        parsed = uuid.UUID(str(file_id))
    except Exception:
        return None
    return db.query(StoredFile).filter(StoredFile.id == parsed).first()


def get_by_legacy_path(db: Session, filename: str) -> Optional[StoredFile]:
    name = os.path.basename(filename or "")
    if not name:
        return None
    path = f"/uploads/{name}"
    return db.query(StoredFile).filter(StoredFile.legacy_path == path).first()


def can_access(stored: StoredFile, user) -> bool:
    if not stored.is_private:
        return True
    if user is None:
        return False
    if bool(getattr(user, "is_admin", False)):
        return True
    if stored.owner_customer_id and stored.owner_customer_id == getattr(user, "customer_id", None):
        return True
    owner_email = (stored.owner_email or "").lower()
    user_email = (getattr(user, "email", None) or "").lower()
    return bool(owner_email and user_email and owner_email == user_email)


def _classify_filename(name: str) -> Tuple[str, str]:
    lower = (name or "").lower()
    if "pan_card" in lower or "pancard" in lower:
        return "kyc", "pan_card"
    if "cancelled_cheque" in lower or "cheque" in lower:
        return "kyc", "cancelled_cheque"
    if lower.startswith("event_banner") or "_banner_" in lower:
        return "event_media", "banner"
    if "sponsor_logo" in lower:
        return "event_media", "sponsor_logo"
    if "artist_photo" in lower:
        return "event_media", "artist_photo"
    if "gallery" in lower:
        return "event_media", "gallery"
    if lower.startswith("event_logo") or "_logo_" in lower:
        return "event_media", "logo"
    return "event_media", "file"


def _email_from_filename(name: str) -> Optional[str]:
    match = re.search(r"([a-zA-Z0-9._%+-]+)_at_([a-zA-Z0-9.-]+)", name or "")
    if not match:
        return None
    return f"{match.group(1)}@{match.group(2).replace('_', '.')}"


def _rewrite_value(value, mapping: dict):
    if isinstance(value, str):
        key = value.split("?", 1)[0]
        return mapping.get(key, mapping.get("/" + key.lstrip("/"), value))
    if isinstance(value, list):
        return [_rewrite_value(v, mapping) for v in value]
    if isinstance(value, dict):
        return {k: _rewrite_value(v, mapping) for k, v in value.items()}
    return value


def migrate_disk_uploads() -> int:
    """Move existing backend/uploads files into encrypted DB rows, then delete KYC files from disk."""
    from Models.base import get_session_factory
    from Models.organizer_accounts import OrganizerAccount
    from Models.event import Event
    from Models.event_design import EventDesign

    here = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    uploads_dir = os.path.join(here, "uploads")
    if not os.path.isdir(uploads_dir):
        return 0

    SessionLocal = get_session_factory()
    db: Session = SessionLocal()
    imported = 0
    mapping = {}
    to_delete = []
    try:
        for filename in os.listdir(uploads_dir):
            path = os.path.join(uploads_dir, filename)
            if not os.path.isfile(path):
                continue
            legacy = f"/uploads/{filename}"
            existing = db.query(StoredFile).filter(StoredFile.legacy_path == legacy).first()
            if existing:
                mapping[legacy] = public_url(existing)
                to_delete.append(path)
                continue
            try:
                with open(path, "rb") as fh:
                    data = fh.read()
            except OSError:
                continue
            if not data:
                continue
            kind, purpose = _classify_filename(filename)
            stored = store_bytes(
                db,
                data=data,
                filename=filename,
                content_type=guess_content_type(filename),
                kind=kind,
                purpose=purpose,
                owner_email=_email_from_filename(filename),
                legacy_path=legacy,
            )
            mapping[legacy] = public_url(stored)
            imported += 1
            to_delete.append(path)

        if mapping:
            for acc in db.query(OrganizerAccount).all():
                for attr in ("pan_card_url", "cancelled_cheque_url"):
                    old = getattr(acc, attr, None)
                    if not old:
                        continue
                    if old in mapping:
                        stored = get_by_legacy_path(db, old)
                        if stored:
                            stored.owner_email = (acc.email or "").lower() or stored.owner_email
                            stored.owner_customer_id = acc.customer_id or stored.owner_customer_id
                            stored.is_private = True
                            stored.kind = "kyc"
                        setattr(acc, attr, mapping[old])
            for event in db.query(Event).all():
                if event.image_url in mapping:
                    event.image_url = mapping[event.image_url]
                if getattr(event, "card_image", None) in mapping:
                    event.card_image = mapping[event.card_image]
            for design in db.query(EventDesign).all():
                if design.banner_image in mapping:
                    design.banner_image = mapping[design.banner_image]
                if getattr(design, "card_image", None) in mapping:
                    design.card_image = mapping[design.card_image]
                if design.logo in mapping:
                    design.logo = mapping[design.logo]
                if design.gallery_images is not None:
                    design.gallery_images = _rewrite_value(design.gallery_images, mapping)
                if design.speaker_details is not None:
                    design.speaker_details = _rewrite_value(design.speaker_details, mapping)
                if design.sponsor_details is not None:
                    design.sponsor_details = _rewrite_value(design.sponsor_details, mapping)

        db.commit()
        for path in to_delete:
            try:
                os.remove(path)
            except OSError:
                pass
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
    return imported
