"""
Event SQLAlchemy model.
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
    category     = Column(String(100), nullable=True)           # e.g. Music, Tech, Sports
    image_url    = Column(String(500), nullable=True)
    start_date   = Column(DateTime, nullable=False)
    end_date     = Column(DateTime, nullable=True)
    price        = Column(Float, default=0.0)
    capacity     = Column(Integer, nullable=True)               # None = unlimited
    event_format = Column(String(100), default="In-person")      # e.g. In-person, Hybrid, Virtual
    duration     = Column(String(100), nullable=True)          # e.g. "1 hour 30 mins"
    age_limit    = Column(String(50), nullable=True)           # e.g. "10yrs +"
    language     = Column(String(100), nullable=True)          # e.g. "English", "Tamil"
    performers   = Column(Text, nullable=True)                 # JSON string of artist/performer objects
    highlights   = Column(Text, nullable=True)                 # JSON string of past achievement objects/photos
    ticket_types = Column(Text, nullable=True)                 # JSON string of ticket categories
    terms        = Column(Text, nullable=True)                 # Terms & conditions text
    is_published = Column(Boolean, default=False)
    is_cancelled = Column(Boolean, default=False)
    organizer_id = Column(GUID, ForeignKey("users.id"), nullable=True)
    customer_id  = Column(String(100), ForeignKey("users.customer_id", onupdate="CASCADE", ondelete="CASCADE"), nullable=True, index=True)
    host_id      = Column(String(50), nullable=True, index=True)
    created_at   = Column(DateTime, default=datetime.utcnow)
    updated_at   = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    organizer = relationship("User", back_populates="events", foreign_keys=[organizer_id], primaryjoin="Event.organizer_id == User.id")
    bookings  = relationship("Booking", back_populates="event", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<Event(id={self.id}, title={self.title}, customer_id={self.customer_id})>"

