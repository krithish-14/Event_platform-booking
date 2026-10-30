"""
Event cancellation needs an admin decision.

A host raises an "event_cancellation" Help & Support request for one event.
Only after an admin approves that request can the host cancel the event.
"""

from typing import Iterable, Optional

from sqlalchemy import func

from Models.support_ticket import SupportTicket, ensure_support_ticket_columns

CANCEL_CATEGORY = "event_cancellation"
DECISION_PENDING = "pending"
DECISION_APPROVED = "approved"
DECISION_REJECTED = "rejected"


def _event_key(event_id) -> str:
	return str(event_id or "").strip().lower().replace("-", "")


def _matches_event(row: SupportTicket, event_id) -> bool:
	return bool(row.event_id) and _event_key(row.event_id) == _event_key(event_id)


def cancellation_requests(db, event_id) -> list:
	"""All cancellation requests for one event, newest first."""
	key = _event_key(event_id)
	if not key:
		return []
	ensure_support_ticket_columns(db)
	rows = (
		db.query(SupportTicket)
		.filter(SupportTicket.category == CANCEL_CATEGORY)
		.filter(func.lower(func.replace(SupportTicket.event_id, "-", "")) == key)
		.order_by(SupportTicket.created_at.desc())
		.all()
	)
	return [row for row in rows if _matches_event(row, event_id)]


def latest_cancellation_request(db, event_id) -> Optional[SupportTicket]:
	rows = cancellation_requests(db, event_id)
	return rows[0] if rows else None


def cancellation_state(db, event_id) -> dict:
	"""none | pending | approved | rejected for the newest request on this event."""
	row = latest_cancellation_request(db, event_id)
	if not row:
		return {"state": "none", "ticket_code": None, "note": None, "decided_at": None}
	decision = (row.decision or DECISION_PENDING).lower()
	if decision not in (DECISION_PENDING, DECISION_APPROVED, DECISION_REJECTED):
		decision = DECISION_PENDING
	return {
		"state": decision,
		"ticket_code": row.ticket_code,
		"note": row.resolution_note,
		"decided_at": row.decided_at.isoformat() if row.decided_at else None,
	}


def is_cancellation_approved(db, event_id) -> bool:
	return cancellation_state(db, event_id)["state"] == DECISION_APPROVED


def unapproved_event_ids(db, event_ids: Iterable) -> list:
	return [eid for eid in event_ids if not is_cancellation_approved(db, eid)]
