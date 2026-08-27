"""Strip dangerous markup from user-supplied text before persistence."""

from __future__ import annotations

import re

_SCRIPT_RE = re.compile(r"<\s*/?\s*script[^>]*>", re.IGNORECASE)
_EVENT_RE = re.compile(r"\son[a-z]+\s*=", re.IGNORECASE)
_JS_URL_RE = re.compile(r"javascript\s*:", re.IGNORECASE)
_CTRL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f]")


def sanitize_text(value: str | None, *, max_length: int = 4000) -> str:
    text = _CTRL_RE.sub("", str(value or "")).strip()
    text = _SCRIPT_RE.sub("", text)
    text = _EVENT_RE.sub(" ", text)
    text = _JS_URL_RE.sub("", text)
    if len(text) > max_length:
        text = text[:max_length]
    return text


def sanitize_url(value: str | None) -> str:
    text = sanitize_text(value, max_length=2000)
    if not text:
        return ""
    lowered = text.lower()
    if lowered.startswith(("http://", "https://", "/", "data:image/")):
        if lowered.startswith("data:") and "base64" in lowered:
            return ""
        return text
    return ""


_GARBAGE_SYMBOLS_RE = re.compile(r"[%$&#*!?=^+]{2,}")
_LONG_DIGIT_RUN_RE = re.compile(r"\d{5,}")


def looks_like_person_name(value: str | None) -> bool:
    """True for a readable name, false for form junk like 'fjweu…^%$%%'."""
    text = str(value or "").strip()
    if len(text) < 2 or len(text) > 80 or "@" in text:
        return False
    letters = sum(ch.isalpha() for ch in text)
    digits = sum(ch.isdigit() for ch in text)
    if letters < 2 or digits > letters:
        return False
    if _GARBAGE_SYMBOLS_RE.search(text) or _LONG_DIGIT_RUN_RE.search(text):
        return False
    return True


def looks_like_phone(value: str | None) -> bool:
    digits = re.sub(r"\D", "", str(value or ""))
    return 8 <= len(digits) <= 15


def looks_like_email(value: str | None) -> bool:
    text = str(value or "").strip()
    if "@" not in text or " " in text:
        return False
    local, _, domain = text.partition("@")
    return bool(local) and "." in domain


def name_from_email(email: str | None) -> str:
    local = str(email or "").split("@")[0].strip()
    cleaned = re.sub(r"[._+-]+", " ", local).strip()
    return cleaned.title() if cleaned else "Guest"


def pick_attendee_identity(*, names=(), emails=(), phones=()) -> tuple[str, str, str]:
    """Prefer account/booking identity over raw host-form answers."""
    email = next((str(v).strip() for v in emails if looks_like_email(v)), "")
    name = next((str(v).strip() for v in names if looks_like_person_name(v)), "")
    if not name:
        name = name_from_email(email)
    phone = next((str(v).strip() for v in phones if looks_like_phone(v)), "")
    return name, email, phone
