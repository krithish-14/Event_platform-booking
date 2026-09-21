"""Ticket sales close the moment an event goes live."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from Services.event_service import _event_has_ended, _event_is_live


def _event(start_offset_hours, end_offset_hours=None):
    now = datetime.utcnow()
    start = now + timedelta(hours=start_offset_hours)
    end = None if end_offset_hours is None else now + timedelta(hours=end_offset_hours)
    return SimpleNamespace(start_date=start, end_date=end)


def test_upcoming_event_is_not_live():
    event = _event(start_offset_hours=2, end_offset_hours=5)
    assert _event_is_live(event) is False
    assert _event_has_ended(event) is False


def test_started_event_is_live():
    event = _event(start_offset_hours=-1, end_offset_hours=3)
    assert _event_is_live(event) is True
    assert _event_has_ended(event) is False


def test_started_event_without_end_is_live():
    event = _event(start_offset_hours=-1, end_offset_hours=None)
    assert _event_is_live(event) is True
    assert _event_has_ended(event) is False


def test_ended_event_is_not_live():
    event = _event(start_offset_hours=-5, end_offset_hours=-1)
    assert _event_is_live(event) is False
    assert _event_has_ended(event) is True


if __name__ == "__main__":
    test_upcoming_event_is_not_live()
    test_started_event_is_live()
    test_started_event_without_end_is_live()
    test_ended_event_is_not_live()
    print("ticket sales closed ok")
