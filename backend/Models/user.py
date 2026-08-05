"""
User SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, Float
from sqlalchemy.orm import relationship

from Models.base import Base, GUID 


import random


def generate_customer_id():
    return f"CUST-{random.randint(100000, 999999)}"



class User(Base):
    __tablename__ = "users"

    id          = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    customer_id = Column(String(100), unique=True, nullable=False, index=True, default=generate_customer_id)
    email       = Column(String(255), unique=True, nullable=False, index=True)
    username    = Column(String(100), unique=True, nullable=False, index=True)
    full_name   = Column(String(200), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    bio         = Column(Text, nullable=True)
    avatar_url  = Column(String(500), nullable=True)
    is_active   = Column(Boolean, default=True)
    is_admin    = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)
    updated_at  = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── Location ─────────────────────────────────────────────
    city              = Column(String(200), nullable=True)   # resolved city name
    location_pincode  = Column(String(20),  nullable=True)   # pincode (manual entry)
    location_lat      = Column(Float,       nullable=True)   # last known latitude
    location_lon      = Column(Float,       nullable=True)   # last known longitude

    # Relationships
    events   = relationship("Event", back_populates="organizer", cascade="all, delete-orphan")
    bookings = relationship("Booking", back_populates="customer", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(customer_id={self.customer_id}, email={self.email})>"

