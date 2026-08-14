"""
EventStaffScanner SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class EventStaffScanner(Base):
    __tablename__ = "event_staff_scanners"

    scanner_id      = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id        = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id     = Column(String(50), nullable=True)
    host_id         = Column(String(50), nullable=True)
    created_by      = Column(String(255), nullable=True)
    name            = Column(String(255), nullable=False)
    gate_id         = Column(GUID, ForeignKey("event_entry_gates.gate_id"), nullable=False, index=True)
    passcode        = Column(String(100), nullable=False)
    status          = Column(String(50), nullable=True)
    scans_processed = Column(Integer, default=0, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at      = Column(DateTime, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="staff_scanners")
    entry_gate       = relationship("EventEntryGate", back_populates="staff_scanners")

    def __repr__(self):
        return f"<EventStaffScanner(scanner_id={self.scanner_id}, name={self.name})>"
