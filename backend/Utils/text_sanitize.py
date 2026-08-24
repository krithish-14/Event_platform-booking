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
