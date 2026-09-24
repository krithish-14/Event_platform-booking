"""Ended events leave the public site immediately and stay on the host dashboard 48h."""
from datetime import datetime, timedelta
from types import SimpleNamespace

from Services.event_service import _event_has_ended, event_currently_visible
from APIs.host_events_api import (
    ENDED_DASHBOARD_GRACE,
    compute_event_lifecycle,
    is_cleared_host_event,
    is_ended_dashboard_expired,
    is_overview_lifecycle,
)


def _public_event(start_hours, end_hours):
    now = datetime.utcnow()
    return SimpleNamespace(
        start_date=now + timedelta(hours=start_hours),
        end_date=None if end_hours is None else now + timedelta(hours=end_hours),
        is_published=True,
        is_cancelled=False,
        ticket_types=None,
    )


def _host_event(start_hours, end_hours, status="published"):
    now = datetime.utcnow()
    start = now + timedelta(hours=start_hours)
    end = None if end_hours is None else now + timedelta(hours=end_hours)
    return SimpleNamespace(
        event_status=status,
        event_start_date=start,
        event_end_date=end,
        event_start_time=None,
        event_end_time=None,
        event_title="Test Event",
        event_category="Sports",
        venue="Chennai",
    )


def test_ended_event_leaves_public_immediately():
    event = _public_event(-5, -1)
    assert _event_has_ended(event) is True
    assert event_currently_visible(event) is False


def test_upcoming_event_stays_public():
    event = _public_event(4, 8)
    assert event_currently_visible(event) is True


def test_ended_event_stays_on_host_dashboard_for_48_hours():
    event = _host_event(-10, -2)
    assert compute_event_lifecycle(event) == "ended"
    assert is_ended_dashboard_expired(event) is False
    assert is_cleared_host_event(event) is False


def test_ended_event_leaves_host_dashboard_after_48_hours():
    event = _host_event(-80, -49)
    assert compute_event_lifecycle(event) == "ended"
    assert is_ended_dashboard_expired(event) is True
    assert is_cleared_host_event(event) is True


def test_history_lifecycle_is_ended_immediately():
    event = _host_event(-3, -1)
    assert compute_event_lifecycle(event) == "ended"


def test_grace_window_is_48_hours():
    assert ENDED_DASHBOARD_GRACE == timedelta(hours=48)


def test_overview_hidden_until_otp_publish():
    draft = _host_event(4, 8, status="draft")
    assert compute_event_lifecycle(draft) == "ready_to_publish"
    assert is_overview_lifecycle(draft) is False

    untitled = SimpleNamespace(
        event_status="draft",
        event_start_date=None,
        event_end_date=None,
        event_start_time=None,
        event_end_time=None,
        event_title="My New Event",
        event_category=None,
        venue="Some venue only",
    )
    assert compute_event_lifecycle(untitled) == "draft"
    assert is_overview_lifecycle(untitled) is False

    published = _host_event(4, 8, status="published")
    assert compute_event_lifecycle(published) in ("published", "live")
    assert is_overview_lifecycle(published) is True


if __name__ == "__main__":
    test_ended_event_leaves_public_immediately()
    test_upcoming_event_stays_public()
    test_ended_event_stays_on_host_dashboard_for_48_hours()
    test_ended_event_leaves_host_dashboard_after_48_hours()
    test_history_lifecycle_is_ended_immediately()
    test_grace_window_is_48_hours()
    test_overview_hidden_until_otp_publish()
    print("host dashboard grace ok")
