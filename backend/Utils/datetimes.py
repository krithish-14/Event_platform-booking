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


_WEEKDAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


def parse_host_time(time_str: Any):
    """Parse HH:MM, HH:MM:SS, or h:mm AM/PM into (hour, minute)."""
    import re
    if not time_str:
        return None
    t = str(time_str).strip().upper()
    match = re.match(r"^(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?$", t)
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    meridiem = match.group(3)
    if meridiem == "PM" and hour < 12:
        hour += 12
    elif meridiem == "AM" and hour == 12:
        hour = 0
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def format_clock_12h(hour: int, minute: int) -> str:
    suffix = "AM" if hour < 12 else "PM"
    hour12 = hour % 12
    if hour12 == 0:
        hour12 = 12
    return f"{hour12:02d}:{minute:02d} {suffix}"


def _english_date(dt: datetime) -> str:
    return f"{_WEEKDAYS[dt.weekday()]}, {_MONTHS[dt.month - 1]} {dt.day}, {dt.year}"


def _as_wallclock_datetime(value: Any) -> Optional[datetime]:
    """Keep the host's saved calendar clock. Naive values are not treated as UTC."""
    if value is None:
        return None
    if isinstance(value, datetime):
        dt = value
    else:
        text = str(value).strip()
        if not text:
            return None
        try:
            dt = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return None
    if dt.tzinfo is not None:
        return dt.astimezone(IST).replace(tzinfo=None, microsecond=0)
    return dt.replace(tzinfo=None, microsecond=0)


def format_host_event_when(event_date: Any, event_time: Any = None) -> str:
    """Print the host's saved date and start time with no UTC conversion."""
    dt = _as_wallclock_datetime(event_date)
    time_parts = parse_host_time(event_time)
    if dt is None and not time_parts:
        return ""
    if dt is None:
        return format_clock_12h(time_parts[0], time_parts[1])
    date_label = _english_date(dt)
    if time_parts:
        time_label = format_clock_12h(time_parts[0], time_parts[1])
    else:
        time_label = format_clock_12h(dt.hour, dt.minute)
    return f"{date_label}, {time_label}"


def format_utc_naive_as_ist_when(value: Any) -> str:
    """Fallback when only the public catalog UTC timestamp exists."""
    ist_value = to_ist(value)
    if ist_value is None:
        return ""
    return f"{_english_date(ist_value)}, {format_clock_12h(ist_value.hour, ist_value.minute)}"
