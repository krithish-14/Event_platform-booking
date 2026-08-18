"""
EventEntryGate SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class EventEntryGate(Base):
    __tablename__ = "event_entry_gates"

    gate_id          = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id         = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id      = Column(String(50), nullable=True)
    host_id          = Column(String(50), nullable=True)
    created_by       = Column(String(255), nullable=True)
    gate_name        = Column(String(150), nullable=False)
    gate_code        = Column(String(50), nullable=True)
    gate_description = Column(String(300), nullable=True)
    status           = Column(String(50), nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at       = Column(DateTime, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="entry_gates")
    staff_scanners   = relationship("EventStaffScanner", back_populates="entry_gate", cascade="all, delete-orphan")
    volunteers       = relationship("EventVolunteer", back_populates="entry_gate")

    def __repr__(self):
        return f"<EventEntryGate(gate_id={self.gate_id}, gate_name={self.gate_name})>"
