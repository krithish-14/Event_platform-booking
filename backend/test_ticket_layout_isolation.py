"""Ticket canvas layouts must stay scoped to one host and one event."""
from types import SimpleNamespace

from APIs.host_events_api import _event_owned


def _event(**kwargs):
    return SimpleNamespace(
        organizer_email=kwargs.get("organizer_email"),
        customer_id=kwargs.get("customer_id"),
        host_id=kwargs.get("host_id"),
    )


def test_host_cannot_own_event_by_shared_host_id_alone():
    event = _event(
        organizer_email="host-a@example.com",
        customer_id="CUST-111111",
        host_id="HST-111111",
    )
    assert _event_owned(event, "host-a@example.com", "CUST-111111", "HST-111111") is True
    assert _event_owned(event, "host-b@example.com", "CUST-999999", "HST-111111") is False
    assert _event_owned(event, "host-b@example.com", "CUST-111111", "HST-999999") is False


def test_host_cannot_own_event_by_shared_customer_id_alone():
    event = _event(
        organizer_email="host-a@example.com",
        customer_id="CUST-111111",
        host_id="HST-111111",
    )
    user_b = SimpleNamespace(email="host-b@example.com", customer_id="CUST-111111")
    assert _event_owned(event, "host-b@example.com", "CUST-111111", None, user_b) is False


def test_dual_identity_fallback_when_email_blank():
    event = _event(organizer_email="", customer_id="CUST-222222", host_id="HST-222222")
    assert _event_owned(event, "host-a@example.com", "CUST-222222", "HST-222222") is True
    assert _event_owned(event, "host-b@example.com", "CUST-222222", "HST-000000") is False


if __name__ == "__main__":
    test_host_cannot_own_event_by_shared_host_id_alone()
    test_host_cannot_own_event_by_shared_customer_id_alone()
    test_dual_identity_fallback_when_email_blank()
    print("ticket layout isolation ok")
