"""Canonical event categories shared by host dashboard and public pages."""

# Stored exactly as event.category / event_management.event_category
CANONICAL_CATEGORIES = (
    "Sports",
    "Conferences",
    "Performances",
    "Experiences",
    "Expositions",
    "Parties",
)

_CANONICAL_LOOKUP = {name.lower(): name for name in CANONICAL_CATEGORIES}

INVALID_IMAGE_TYPE_MESSAGE = (
    "Your image is not in this standard file type. Please use JPG, JPEG, PNG, or WEBP."
)
INVALID_IMAGE_SIZE_MESSAGE = (
    "Your image is not in this standard size. Maximum file size is 5MB."
)
INVALID_IMAGE_MESSAGE = INVALID_IMAGE_TYPE_MESSAGE
ALLOWED_IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
ALLOWED_IMAGE_MIMES = {"image/jpeg", "image/jpg", "image/png", "image/webp"}
MAX_IMAGE_BYTES = 5 * 1024 * 1024


def normalize_category(value):
    """Return the canonical category name, or None if unknown/empty."""
    if not value or not str(value).strip():
        return None
    return _CANONICAL_LOOKUP.get(str(value).strip().lower())


def is_allowed_image_filename(filename: str) -> bool:
    import os
    ext = os.path.splitext(filename or "")[1].lower()
    return ext in ALLOWED_IMAGE_EXTS


def is_allowed_image_bytes(contents: bytes, content_type: str = "") -> bool:
    if not contents or len(contents) < 12:
        return False
    mime = (content_type or "").split(";")[0].strip().lower()
    if mime and mime not in ALLOWED_IMAGE_MIMES and mime != "application/octet-stream":
        return False
    if mime in ("image/svg+xml", "text/html", "application/xhtml+xml", "image/svg"):
        return False
    lowered = contents[:200].lstrip().lower()
    if lowered.startswith(b"<svg") or lowered.startswith(b"<?xml") or lowered.startswith(b"<!doctype") or lowered.startswith(b"<html"):
        return False
    if contents.startswith(b"\xff\xd8\xff"):
        return True
    if contents.startswith(b"\x89PNG\r\n\x1a\n"):
        return True
    if contents[:4] == b"RIFF" and contents[8:12] == b"WEBP":
        return True
    return False


def is_allowed_kyc_bytes(contents: bytes, filename: str = "", content_type: str = "") -> bool:
    """PAN/cheque uploads: JPEG/PNG/WEBP magic bytes, or a PDF starting with %PDF."""
    import os
    if not contents:
        return False
    ext = os.path.splitext(filename or "")[1].lower()
    mime = (content_type or "").split(";")[0].strip().lower()
    if ext == ".pdf" or mime == "application/pdf":
        return contents.startswith(b"%PDF")
    return is_allowed_image_bytes(contents, content_type)
