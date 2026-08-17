"""
User SQLAlchemy model aligned with JOD Events complete database specification.
"""

import uuid
import random
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, Float
from sqlalchemy.orm import relationship, synonym

from Models.base import Base, GUID


def generate_customer_id():
    return f"CUST-{random.randint(100000, 999999)}"


class User(Base):
    __tablename__ = "users"

    # Primary key from colleague schema: customer_id (varchar 50)
    customer_id     = Column(String(50), primary_key=True, default=generate_customer_id, index=True)
    
    # Internal GUID identifier retained for workspace API compatibility
    id              = Column(GUID, unique=True, default=uuid.uuid4, index=True, nullable=False)
    
    email           = Column(String(255), unique=True, nullable=False, index=True)
    username        = Column(String(100), unique=True, nullable=False, index=True)
    full_name       = Column(String(200), nullable=True)
    phone           = Column(String(50), nullable=True)
    hashed_password = Column(String(255), nullable=False)
    bio             = Column(Text, nullable=True)
    avatar_url      = Column(String(500), nullable=True)
    is_active       = Column(Boolean, default=True, nullable=True)
    is_admin        = Column(Boolean, default=False, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    # Location fields from colleague schema
    city            = Column(String(150), nullable=True)
    location_pin    = Column(String(20), nullable=True)
    latitude        = Column(Float, nullable=True)
    longitude       = Column(Float, nullable=True)

    # Synonyms for backwards compatibility with existing workspace APIs
    location_pincode = synonym("location_pin")
    location_lat     = synonym("latitude")
    location_lon     = synonym("longitude")

    # Relationships
    events                  = relationship("Event", foreign_keys="[Event.organizer_id]", back_populates="organizer", cascade="all, delete-orphan")
    customer_events         = relationship("Event", foreign_keys="[Event.customer_id]", back_populates="customer_user")
    bookings                = relationship("Booking", back_populates="customer", cascade="all, delete-orphan")
    organizer_accounts      = relationship("OrganizerAccount", back_populates="user", cascade="all, delete-orphan")
    event_managements       = relationship("EventManagement", back_populates="user", cascade="all, delete-orphan")
    host_registration_logs  = relationship("HostRegistrationLog", back_populates="user", cascade="all, delete-orphan")
    user_signups            = relationship("UserSignup", back_populates="user", cascade="all, delete-orphan")
    user_logins             = relationship("UserLogin", back_populates="user", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<User(customer_id={self.customer_id}, email={self.email})>"
