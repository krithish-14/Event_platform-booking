"""
EventRegistrationSetting SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, Integer, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class EventRegistrationSetting(Base):
    __tablename__ = "event_registration_settings"

    id                      = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id                = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id             = Column(String(50), nullable=True)
    host_id                 = Column(String(50), nullable=True)
    created_by              = Column(String(255), nullable=True)
    registration_status     = Column(String(50), nullable=True)
    registration_start_date = Column(Date, nullable=True)
    registration_end_date   = Column(Date, nullable=True)
    max_capacity            = Column(Integer, nullable=True)
    allow_waitlist          = Column(Boolean, nullable=True)
    approval_required       = Column(Boolean, nullable=True)
    registration_type       = Column(String(50), nullable=True)
    auto_confirmation       = Column(Boolean, nullable=True)
    confirmation_email      = Column(Boolean, nullable=True)
    cancellation_policy     = Column(Text, nullable=True)
    status                  = Column(String(50), nullable=True)
    created_at              = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at              = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at              = Column(DateTime, nullable=True)

    # Relationships
    event_management    = relationship("EventManagement", back_populates="registration_settings")
    registration_tickets = relationship("EventRegistrationTicket", back_populates="registration_settings", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<EventRegistrationSetting(id={self.id}, event_id={self.event_id})>"
