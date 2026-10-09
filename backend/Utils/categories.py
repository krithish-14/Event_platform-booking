"""Canonical event categories shared by host dashboard and public pages."""

# Stored exactly as event.category / event_management.event_category
CANONICAL_CATEGORIES = (
    "Sports",
    "Conferences",
    "Performances",
    "Parties",
    "Workshops",
)

# Keep reading older events that still store these labels.
_LEGACY_CATEGORIES = (
    "Experiences",
    "Expositions",
)

_CANONICAL_LOOKUP = {
    name.lower(): name for name in CANONICAL_CATEGORIES + _LEGACY_CATEGORIES
}

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
_KB = 1024
_MB = 1024 * 1024
# min bytes, max bytes, message. The window is the recommended start through the maximum upload.
ASSET_FILE_LIMITS = {
    "banner": (500 * _KB, 5 * _MB, "Event banner must be 500 KB to 5 MB. Recommended 500 KB-1 MB."),
    "card_image": (200 * _KB, 2 * _MB, "Event card image must be 200 KB to 2 MB. Recommended 200-500 KB."),
    "sponsor_logo": (50 * _KB, 1 * _MB, "Sponsor logo must be 50 KB to 1 MB. Recommended 50-200 KB."),
    "artist_photo": (200 * _KB, 2 * _MB, "Artist photo must be 200 KB to 2 MB. Recommended 200-500 KB."),
    "gallery": (500 * _KB, 5 * _MB, "Gallery photo must be 500 KB to 5 MB. Recommended 500 KB-1.5 MB."),
    "ticket": (200 * _KB, 3 * _MB, "Ticket image must be 200 KB to 3 MB. Recommended 200-800 KB."),
    "logo": (50 * _KB, 1 * _MB, "Logo must be 50 KB to 1 MB. Recommended 50-200 KB."),
    "payment_qr": (50 * _KB, 1 * _MB, "Payment QR must be 50 KB to 1 MB. Recommended 50-200 KB."),
    "document": (500 * _KB, 5 * _MB, "Verification document must be 500 KB to 5 MB. Recommended 500 KB-2 MB."),
}


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
