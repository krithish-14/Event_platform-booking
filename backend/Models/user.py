"""
User SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class User(Base):
    __tablename__ = "users"

    id         = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    email      = Column(String(255), unique=True, nullable=False, index=True)
    username   = Column(String(100), unique=True, nullable=False, index=True)
    full_name  = Column(String(200), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    bio        = Column(Text, nullable=True)
    avatar_url = Column(String(500), nullable=True)
    is_active  = Column(Boolean, default=True)
    is_admin   = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    events = relationship("Event", back_populates="organizer", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(id={self.id}, email={self.email})>"
