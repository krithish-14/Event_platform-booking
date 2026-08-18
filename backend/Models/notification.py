"""
Broadcast notifications created when a host publishes an event.
Every signed-in user sees these in their inbox.
"""

import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, String, Text

from Models.base import Base, GUID


class EventAnnouncement(Base):
    __tablename__ = "event_announcements"

    id = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(GUID, unique=True, nullable=False, index=True)
    event_title = Column(String(300), nullable=False)
    location = Column(String(500), nullable=True)
    city = Column(String(150), nullable=True)
    venue = Column(String(300), nullable=True)
    publisher_customer_id = Column(String(50), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<EventAnnouncement(event_id={self.event_id}, title={self.event_title})>"
