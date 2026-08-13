"""
EventCommunication SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Date, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class EventCommunication(Base):
    __tablename__ = "event_communications"

    id             = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id       = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id    = Column(String(50), nullable=True)
    host_id        = Column(String(50), nullable=True)
    created_by     = Column(String(255), nullable=True)
    audience       = Column(String(100), nullable=True)
    channel        = Column(String(100), nullable=True)
    subject        = Column(String(255), nullable=True)
    message        = Column(Text, nullable=True)
    attachment_url = Column(String(500), nullable=True)
    schedule_date  = Column(Date, nullable=True)
    schedule_time  = Column(String(50), nullable=True)
    status         = Column(String(50), nullable=True)
    delivery_status= Column(String(100), nullable=True)
    failed_reason  = Column(Text, nullable=True)
    created_at     = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at     = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at     = Column(DateTime, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="communications")

    def __repr__(self):
        return f"<EventCommunication(id={self.id}, subject={self.subject})>"
