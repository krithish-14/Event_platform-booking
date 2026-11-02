"""
Check-ins of a linked private event's tickets at the public event it is linked to.

The ticket's own status is never changed here, so the same QR still works at its own event.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, String, UniqueConstraint

from Models.base import Base, GUID


class EventLinkCheckin(Base):
    __tablename__ = "event_link_checkins"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    target_event_id = Column(GUID, nullable=False, index=True)
    source_event_id = Column(GUID, nullable=False, index=True)
    ticket_id = Column(GUID, nullable=False, index=True)
    # Empty string when the target event has no sessions; one entry per session otherwise.
    session_key = Column(String(64), nullable=False, default="")
    attendee_name = Column(String(255), nullable=True)
    attendee_email = Column(String(255), nullable=True)
    checked_in_by = Column(String(255), nullable=True)
    method = Column(String(20), nullable=True)
    checkin_time = Column(DateTime, default=datetime.utcnow, nullable=False)

    __table_args__ = (
        UniqueConstraint("target_event_id", "ticket_id", "session_key", name="uq_event_link_checkins_target_ticket_session"),
    )
