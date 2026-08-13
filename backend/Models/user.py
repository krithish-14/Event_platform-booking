"""
User SQLAlchemy model.
"""

import uuid
import random
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, Float
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


def generate_customer_id():
    return f"CUST-{random.randint(100000, 999999)}"


class User(Base):
    __tablename__ = "users"

    # ── Identifiers ─────────────────────────────────────────────────────────────
    id          = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    customer_id = Column(String(100), unique=True, nullable=False, index=True, default=generate_customer_id)

    # ── Identity ──────────────────────────────────────────────────────────────
    email           = Column(String(255), unique=True, nullable=False, index=True)
    username        = Column(String(100), unique=True, nullable=False, index=True)
    full_name       = Column(String(200), nullable=True)
    hashed_password = Column(String(255), nullable=False)

    # ── Profile ───────────────────────────────────────────────────────────────
    bio         = Column(Text, nullable=True)
    avatar_url  = Column(String(500), nullable=True)

    # ── Flags ─────────────────────────────────────────────────────────────────
    is_active   = Column(Boolean, default=True)
    is_admin    = Column(Boolean, default=False)

    # ── Timestamps ────────────────────────────────────────────────────────────
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── Location ─────────────────────────────────────────────────────────────
    city              = Column(String(200), nullable=True)   # resolved city name
    location_pincode  = Column(String(20),  nullable=True)   # pincode
    location_pin      = Column(String(20),  nullable=True)   # alias for pincode
    location_lat      = Column(Float,       nullable=True)   # latitude
    location_lon      = Column(Float,       nullable=True)   # longitude
    latitude          = Column(Float,       nullable=True)   # alias for latitude
    longitude         = Column(Float,       nullable=True)   # alias for longitude

    # ── Relationships ─────────────────────────────────────────────────────────
    events   = relationship("Event", back_populates="organizer", cascade="all, delete-orphan")
    bookings = relationship("Booking", back_populates="customer", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(customer_id={self.customer_id}, email={self.email})>"

