"""
Event SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Boolean, DateTime, Integer, Float, ForeignKey
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from Models.base import Base


class Event(Base):
    __tablename__ = "events"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    title        = Column(String(300), nullable=False)
    description  = Column(Text, nullable=True)
    location     = Column(String(500), nullable=True)
    venue        = Column(String(300), nullable=True)
    category     = Column(String(100), nullable=True)           # e.g. Music, Tech, Sports
    image_url    = Column(String(500), nullable=True)
    start_date   = Column(DateTime, nullable=False)
    end_date     = Column(DateTime, nullable=True)
    price        = Column(Float, default=0.0)
    capacity     = Column(Integer, nullable=True)               # None = unlimited
    is_published = Column(Boolean, default=False)
    is_cancelled = Column(Boolean, default=False)
    customer_id  = Column(String(50), ForeignKey("users.customer_id", onupdate="CASCADE", ondelete="CASCADE"), nullable=False, index=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    organizer = relationship("User", back_populates="events")

    def __repr__(self):
        return f"<Event(id={self.id}, title={self.title}, customer_id={self.customer_id})>"
