"""
EventRegistrationForm SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID, JSONType


class EventRegistrationForm(Base):
    __tablename__ = "event_registration_forms"

    form_id         = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id        = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id     = Column(String(50), nullable=True)
    host_id         = Column(String(50), nullable=True)
    form_json       = Column(JSONType, nullable=True)
    questions_json  = Column(JSONType, nullable=True)
    required_fields = Column(JSONType, nullable=True)
    field_order     = Column(JSONType, nullable=True)
    settings_json   = Column(JSONType, nullable=True)
    published       = Column(Boolean, default=False, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="registration_form")

    def __repr__(self):
        return f"<EventRegistrationForm(form_id={self.form_id}, event_id={self.event_id})>"
