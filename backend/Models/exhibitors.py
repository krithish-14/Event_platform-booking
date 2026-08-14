"""
Exhibitor SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID, JSONType


class Exhibitor(Base):
    __tablename__ = "exhibitors"

    exhibitor_id        = Column(GUID, primary_key=True, default=uuid.uuid4)
    event_id            = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id         = Column(String(50), nullable=True)
    host_id             = Column(String(50), nullable=True)
    created_by          = Column(String(255), nullable=True)
    company_name        = Column(String(300), nullable=False)
    contact_name        = Column(String(200), nullable=True)
    contact_email       = Column(String(255), nullable=True)
    contact_phone       = Column(String(50), nullable=True)
    website             = Column(String(500), nullable=True)
    logo_url            = Column(String(500), nullable=True)
    booth_number        = Column(String(100), nullable=True)
    booth_type          = Column(String(100), nullable=True)
    industry            = Column(String(150), nullable=True)
    company_description = Column(Text, nullable=True)
    address             = Column(Text, nullable=True)
    social_links        = Column(JSONType, nullable=True)
    category            = Column(String(150), nullable=True)
    package             = Column(String(100), nullable=True)
    notes               = Column(Text, nullable=True)
    status              = Column(String(50), nullable=True)
    created_at          = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at          = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    deleted_at          = Column(DateTime, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="exhibitors")

    def __repr__(self):
        return f"<Exhibitor(exhibitor_id={self.exhibitor_id}, company_name={self.company_name})>"
