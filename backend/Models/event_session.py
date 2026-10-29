"""
Event sessions, per-session attendee eligibility, and per-session check-ins.

A session belongs to a host event (event_management). The attendee identity is the
existing per-person Ticket row (one QR per person), so one ticket can be eligible for
and checked in to several sessions without duplicating attendees.

event_id / ticket_id reference event_management and tickets without database FK
constraints: some live tables were created with native UUID ids and others with
CHAR(36), and a mismatched FK would stop startup table creation. Services/event_sessions.py
validates both ids against their parent rows before every write.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, Date, DateTime, ForeignKey, Index, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from Models.base import Base, GUID, JSONType


SESSION_STATUSES = ("active", "inactive", "cancelled")
ELIGIBILITY_MODES = ("all_attendees", "registered", "ticket_types")


class EventSession(Base):
    __tablename__ = "event_sessions"

    session_id = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id = Column(GUID, nullable=False, index=True)
    position = Column(Integer, nullable=False, default=1)
    session_name = Column(String(200), nullable=False)
    session_description = Column(Text, nullable=True)
    session_date = Column(Date, nullable=False)
    start_time = Column(String(5), nullable=False)  # "HH:MM", event local time (IST)
    end_time = Column(String(5), nullable=False)
    ends_next_day = Column(Boolean, nullable=False, default=False)
    venue_name = Column(String(300), nullable=False)
    venue_address = Column(Text, nullable=True)
    capacity = Column(Integer, nullable=True)
    # all_attendees | registered | ticket_types
    eligibility_mode = Column(String(30), nullable=False, default="registered")
    eligible_ticket_types = Column(JSONType, nullable=True)
    # active | inactive | cancelled
    status = Column(String(20), nullable=False, default="active", index=True)
    created_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    # Soft delete keeps registrations and attendance history.
    deleted_at = Column(DateTime, nullable=True, index=True)

    registrations = relationship("EventSessionRegistration", back_populates="session")
    checkins = relationship("EventSessionCheckin", back_populates="session")

    __table_args__ = (
        Index("ix_event_sessions_event_position", "event_id", "position"),
    )

    def __repr__(self):
        return f"<EventSession(session_id={self.session_id}, event_id={self.event_id}, name={self.session_name})>"


class EventSessionRegistration(Base):
    __tablename__ = "event_session_registrations"

    session_registration_id = Column(GUID, primary_key=True, default=uuid.uuid4)
    session_id = Column(GUID, ForeignKey("event_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    ticket_id = Column(GUID, nullable=False, index=True)
    # registered (eligible) | revoked (explicitly not eligible)
    registration_status = Column(String(20), nullable=False, default="registered")
    registered_by = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    session = relationship("EventSession", back_populates="registrations")

    __table_args__ = (
        UniqueConstraint("session_id", "ticket_id", name="uq_event_session_registrations_session_ticket"),
    )


class EventSessionCheckin(Base):
    __tablename__ = "event_session_checkins"

    checkin_id = Column(GUID, primary_key=True, default=uuid.uuid4)
    session_id = Column(GUID, ForeignKey("event_sessions.session_id", ondelete="CASCADE"), nullable=False, index=True)
    ticket_id = Column(GUID, nullable=False, index=True)
    checkin_time = Column(DateTime, default=datetime.utcnow, nullable=False, index=True)
    checked_in_by = Column(String(255), nullable=True)
    volunteer_id = Column(GUID, nullable=True, index=True)
    method = Column(String(20), nullable=True)
    checkin_status = Column(String(20), nullable=False, default="checked_in")

    session = relationship("EventSession", back_populates="checkins")

    __table_args__ = (
        UniqueConstraint("session_id", "ticket_id", name="uq_event_session_checkins_session_ticket"),
    )
