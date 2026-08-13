"""
EventAttendanceCheckin SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class EventAttendanceCheckin(Base):
    __tablename__ = "event_attendance_checkins"

    id              = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id        = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id     = Column(String(50), nullable=True)
    host_id         = Column(String(50), nullable=True)
    created_by      = Column(String(255), nullable=True)
    registration_id = Column(GUID, ForeignKey("event_registrations.id"), nullable=True, index=True)
    attendee_name   = Column(String(255), nullable=True)
    attendee_email  = Column(String(255), nullable=True)
    scan_method     = Column(String(50), nullable=True)
    status          = Column(String(50), nullable=True)
    notes           = Column(Text, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at      = Column(DateTime, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="attendance_checkins")
    registration     = relationship("EventRegistration", back_populates="attendance_checkins")

    def __repr__(self):
        return f"<EventAttendanceCheckin(id={self.id}, registration_id={self.registration_id})>"
