"""
Event volunteer assignments, invitations, check-in records, and audit trail.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


INVITE_TTL_HOURS = 48


class EventVolunteer(Base):
    __tablename__ = "event_volunteers"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    invited_email = Column(String(255), nullable=False, index=True)
    volunteer_name = Column(String(200), nullable=False)
    gate_id = Column(GUID, ForeignKey("event_entry_gates.gate_id"), nullable=True, index=True)
    role = Column(String(50), default="SCANNER", nullable=False)
    status = Column(String(20), default="PENDING", nullable=False, index=True)
    invited_by_customer_id = Column(String(50), nullable=True)
    invited_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    accepted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    event_management = relationship("EventManagement", back_populates="volunteers")
    entry_gate = relationship("EventEntryGate", back_populates="volunteers")
    invitations = relationship("VolunteerInvitation", back_populates="volunteer", cascade="all, delete-orphan")
    checkins = relationship("VolunteerCheckin", back_populates="volunteer")

    __table_args__ = (
        Index("ix_event_volunteers_event_email", "event_id", "invited_email"),
    )

    def __repr__(self):
        return f"<EventVolunteer(event_id={self.event_id}, email={self.invited_email}, status={self.status})>"


class VolunteerInvitation(Base):
    __tablename__ = "volunteer_invitations"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    volunteer_id = Column(GUID, ForeignKey("event_volunteers.id"), nullable=False, index=True)
    event_id = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    invited_email = Column(String(255), nullable=False, index=True)
    token_hash = Column(String(64), unique=True, nullable=False, index=True)
    status = Column(String(20), default="PENDING", nullable=False, index=True)
    expires_at = Column(DateTime, nullable=False)
    accepted_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)

    volunteer = relationship("EventVolunteer", back_populates="invitations")

    def is_expired(self) -> bool:
        return datetime.utcnow() > (self.expires_at or datetime.utcnow())

    def __repr__(self):
        return f"<VolunteerInvitation(id={self.id}, status={self.status})>"


class VolunteerCheckin(Base):
    __tablename__ = "volunteer_ticket_checkins"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    ticket_id = Column(GUID, nullable=False, unique=True, index=True)
    event_id = Column(GUID, nullable=False, index=True)
    volunteer_id = Column(GUID, ForeignKey("event_volunteers.id"), nullable=True, index=True)
    volunteer_customer_id = Column(String(50), nullable=True, index=True)
    attendee_name = Column(String(255), nullable=True)
    ticket_code = Column(String(120), nullable=True)
    method = Column(String(20), nullable=True)
    status = Column(String(30), default="checked_in", nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True, index=True)

    volunteer = relationship("EventVolunteer", back_populates="checkins")

    __table_args__ = (
        UniqueConstraint("ticket_id", name="uq_volunteer_checkins_ticket_id"),
    )


class VolunteerAuditLog(Base):
    __tablename__ = "volunteer_audit_logs"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id = Column(GUID, nullable=True, index=True)
    volunteer_id = Column(GUID, nullable=True, index=True)
    actor_customer_id = Column(String(50), nullable=True, index=True)
    ticket_id = Column(GUID, nullable=True)
    action = Column(String(50), nullable=False, index=True)
    method = Column(String(20), nullable=True)
    detail = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True, index=True)


def default_invite_expiry() -> datetime:
    return datetime.utcnow() + timedelta(hours=INVITE_TTL_HOURS)
