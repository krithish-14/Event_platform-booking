"""
EventRegistration SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class EventRegistration(Base):
    __tablename__ = "event_registrations"

    id                  = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id            = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id         = Column(String(50), nullable=True)
    host_id             = Column(String(50), nullable=True)
    created_by          = Column(String(255), nullable=True)
    ticket_id           = Column(GUID, ForeignKey("event_registration_tickets.id"), nullable=True, index=True)
    attendee_name       = Column(String(255), nullable=False)
    attendee_email      = Column(String(255), nullable=False)
    attendee_phone      = Column(String(50), nullable=True)
    registration_number = Column(String(100), nullable=True)
    status              = Column(String(50), nullable=True)
    payment_status      = Column(String(50), nullable=True)
    checkin_status      = Column(String(50), nullable=True)
    notes               = Column(Text, nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at          = Column(DateTime, nullable=True)

    # Relationships
    event_management    = relationship("EventManagement", back_populates="registrations")
    registration_ticket = relationship("EventRegistrationTicket", back_populates="registrations")
    attendance_checkins = relationship("EventAttendanceCheckin", back_populates="registration", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<EventRegistration(id={self.id}, attendee_email={self.attendee_email})>"
