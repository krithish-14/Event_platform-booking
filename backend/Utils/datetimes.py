"""UTC storage, Asia/Kolkata display. Naive datetimes are treated as UTC."""
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

UTC = timezone.utc
IST = timezone(timedelta(hours=5, minutes=30))


def utc_now() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def as_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return None
        try:
            value = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    if not isinstance(value, datetime):
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def to_ist(value: Any) -> Optional[datetime]:
    utc_value = as_utc(value)
    if utc_value is None:
        return None
    return utc_value.astimezone(IST)


def json_datetime(value: Any) -> Optional[str]:
    """ISO-8601 in IST so browsers in India show the wall-clock submit time."""
    ist_value = to_ist(value)
    if ist_value is None:
        return None
    return ist_value.isoformat()


def ist_display(value: Any) -> str:
    ist_value = to_ist(value)
    if ist_value is None:
        return ""
    return ist_value.strftime("%b %d, %Y %I:%M %p")
