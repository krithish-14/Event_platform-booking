"""
Event SQLAlchemy model aligned with JOD Events database specification.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Boolean, DateTime, Integer, Float, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class Event(Base):
    __tablename__ = "events"

    id           = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    title        = Column(String(300), nullable=False)
    description  = Column(Text, nullable=True)
    location     = Column(String(500), nullable=True)
    venue        = Column(String(300), nullable=True)
    latitude     = Column(Float, nullable=True)
    longitude    = Column(Float, nullable=True)
    category     = Column(String(100), nullable=True)
    image_url    = Column(String(500), nullable=True)
    start_date   = Column(DateTime, nullable=False)
    end_date     = Column(DateTime, nullable=True)
    price        = Column(Float, default=0.0, nullable=True)
    capacity     = Column(Integer, nullable=True)
    event_format = Column(String(100), default="In-person", nullable=True)
    duration     = Column(String(100), nullable=True)
    age_limit    = Column(String(50), nullable=True)
    language     = Column(String(100), nullable=True)
    performers   = Column(Text, nullable=True)
    highlights   = Column(Text, nullable=True)
    gallery_images = Column(Text, nullable=True)
    ticket_types = Column(Text, nullable=True)
    terms        = Column(Text, nullable=True)
    is_published = Column(Boolean, default=False, nullable=True)
    is_cancelled = Column(Boolean, default=False, nullable=True)
    organizer_id = Column(GUID, ForeignKey("users.id"), nullable=True)
    customer_id  = Column(String(50), ForeignKey("users.customer_id", onupdate="CASCADE", ondelete="CASCADE"), nullable=True, index=True)
    host_id      = Column(String(50), nullable=True, index=True)
    created_at   = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    # Relationships
    organizer     = relationship("User", foreign_keys=[organizer_id], back_populates="events")
    customer_user = relationship("User", foreign_keys=[customer_id], back_populates="customer_events")
    bookings      = relationship("Booking", back_populates="event", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Event(id={self.id}, title={self.title}, customer_id={self.customer_id})>"
