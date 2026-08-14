"""
EventRegistrationTicket SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class EventRegistrationTicket(Base):
    __tablename__ = "event_registration_tickets"

    id              = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id        = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id     = Column(String(50), nullable=True)
    host_id         = Column(String(50), nullable=True)
    created_by      = Column(String(255), nullable=True)
    settings_id     = Column(GUID, ForeignKey("event_registration_settings.id"), nullable=True, index=True)
    ticket_name     = Column(String(255), nullable=False)
    ticket_type     = Column(String(100), nullable=True)
    price           = Column(Float, nullable=True)
    quantity        = Column(Integer, nullable=True)
    sales_start     = Column(Date, nullable=True)
    sales_end       = Column(Date, nullable=True)
    description     = Column(Text, nullable=True)
    available_seats = Column(Integer, nullable=True)
    status          = Column(String(50), nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at      = Column(DateTime, nullable=True)

    # Relationships
    event_management      = relationship("EventManagement", back_populates="registration_tickets")
    registration_settings = relationship("EventRegistrationSetting", back_populates="registration_tickets")
    registrations         = relationship("EventRegistration", back_populates="registration_ticket", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<EventRegistrationTicket(id={self.id}, ticket_name={self.ticket_name})>"
