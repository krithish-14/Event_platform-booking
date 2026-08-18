"""
EventDesign SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID, JSONType


class EventDesign(Base):
    __tablename__ = "event_design"

    design_id       = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id        = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id     = Column(String(50), nullable=True)
    host_id         = Column(String(50), nullable=True)
    banner_image    = Column(String(500), nullable=True)
    card_image      = Column(String(500), nullable=True)
    logo            = Column(String(500), nullable=True)
    theme_color     = Column(String(50), nullable=True)
    font            = Column(String(100), nullable=True)
    gallery_images  = Column(JSONType, nullable=True)
    about_event     = Column(Text, nullable=True)
    highlights      = Column(Text, nullable=True)
    speaker_details = Column(JSONType, nullable=True)
    sponsor_details = Column(JSONType, nullable=True)
    social_links    = Column(JSONType, nullable=True)
    custom_sections = Column(JSONType, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="event_design")

    def __repr__(self):
        return f"<EventDesign(design_id={self.design_id}, event_id={self.event_id})>"
