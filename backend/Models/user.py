"""
User SQLAlchemy model.
"""

from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, DECIMAL
from sqlalchemy.orm import relationship

from Models.base import Base


class User(Base):
    __tablename__ = "users"

    # ── Canonical Primary Key ──────────────────────────────────────────────────
    customer_id = Column(String(50), primary_key=True, index=True)

    # ── Identity ──────────────────────────────────────────────────────────────
    email       = Column(String(255), unique=True, nullable=False, index=True)
    username    = Column(String(100), unique=True, nullable=False, index=True)
    full_name   = Column(String(200), nullable=True)
    hashed_password = Column(String(255), nullable=False)

    # ── Profile ───────────────────────────────────────────────────────────────
    bio         = Column(Text, nullable=True)
    avatar_url  = Column(String(500), nullable=True)

    # ── Location ─────────────────────────────────────────────────────────────
    city         = Column(String(150), nullable=True)
    location_pin = Column(String(20), nullable=True)
    latitude     = Column(DECIMAL(10, 8), nullable=True)
    longitude    = Column(DECIMAL(11, 8), nullable=True)

    # ── Flags ─────────────────────────────────────────────────────────────────
    is_active   = Column(Boolean, default=True)
    is_admin    = Column(Boolean, default=False)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── Relationships ─────────────────────────────────────────────────────────
    # events (via events.customer_id -> users.customer_id)
    events = relationship("Event", back_populates="organizer", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(customer_id={self.customer_id}, email={self.email})>"
