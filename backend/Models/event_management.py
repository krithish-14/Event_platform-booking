"""
EventManagement SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Float
from sqlalchemy.orm import relationship

from Models.base import Base, GUID, JSONType


class EventManagement(Base):
    __tablename__ = "event_management"

    event_id         = Column(GUID, primary_key=True, default=uuid.uuid4)
    customer_id      = Column(String(50), ForeignKey("users.customer_id"), nullable=True, index=True)
    host_id          = Column(String(50), nullable=True)
    event_title      = Column(String(300), nullable=False)
    event_category   = Column(String(100), nullable=True)
    event_type       = Column(String(100), nullable=True)
    event_mode       = Column(String(100), nullable=True)
    event_start_date = Column(DateTime, nullable=True)
    event_end_date   = Column(DateTime, nullable=True)
    event_start_time = Column(String(50), nullable=True)
    event_end_time   = Column(String(50), nullable=True)
    duration         = Column(String(20), nullable=True)
    venue            = Column(String(300), nullable=True)
    address          = Column(Text, nullable=True)
    latitude         = Column(Float, nullable=True)
    longitude        = Column(Float, nullable=True)
    organizer_name   = Column(String(200), nullable=True)
    organizer_email  = Column(String(255), nullable=False)
    organizer_phone  = Column(String(50), nullable=True)
    event_status     = Column(String(50), default="draft", nullable=True)  # draft / published / cancelled; live/ended computed from dates
    published_at     = Column(DateTime, nullable=True)
    tickets_json     = Column(JSONType, nullable=True)
    agenda_json      = Column(JSONType, nullable=True)
    policies_json    = Column(JSONType, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    # Relationships
    user                      = relationship("User", back_populates="event_managements")
    event_design              = relationship("EventDesign", back_populates="event_management", uselist=False, cascade="all, delete-orphan")
    registration_form        = relationship("EventRegistrationForm", back_populates="event_management", uselist=False, cascade="all, delete-orphan")
    registration_settings    = relationship("EventRegistrationSetting", back_populates="event_management", cascade="all, delete-orphan")
    registration_tickets     = relationship("EventRegistrationTicket", back_populates="event_management", cascade="all, delete-orphan")
    registrations            = relationship("EventRegistration", back_populates="event_management", cascade="all, delete-orphan")
    communications           = relationship("EventCommunication", back_populates="event_management", cascade="all, delete-orphan")
    attendance_checkins      = relationship("EventAttendanceCheckin", back_populates="event_management", cascade="all, delete-orphan")
    exhibitors               = relationship("Exhibitor", back_populates="event_management", cascade="all, delete-orphan")
    entry_gates              = relationship("EventEntryGate", back_populates="event_management", cascade="all, delete-orphan")
    staff_scanners           = relationship("EventStaffScanner", back_populates="event_management", cascade="all, delete-orphan")
    volunteers               = relationship("EventVolunteer", back_populates="event_management", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<EventManagement(event_id={self.event_id}, title={self.event_title})>"
