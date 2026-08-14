"""
SQLAlchemy models for Host Event Creation Workflow:
1. EventManagement (Manage Event page)
2. EventDesign (Design Event page)
3. EventRegistrationForm (Registration Form Builder)
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Text, Boolean, DateTime, JSON, ForeignKey, Integer, Date, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from Models.base import Base


class EventManagement(Base):
    """Stores data from the Manage Event setup step."""
    __tablename__ = "event_management"

    event_id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    customer_id      = Column(String(50), nullable=True, index=True)
    host_id          = Column(String(50), nullable=True, index=True)
    event_title      = Column(String(300), nullable=False)
    event_category   = Column(String(100), nullable=True)
    event_type       = Column(String(100), nullable=True)
    event_mode       = Column(String(100), nullable=True)  # Hybrid, In-Person, Online
    event_start_date = Column(DateTime, nullable=True)
    event_end_date   = Column(DateTime, nullable=True)
    event_start_time = Column(String(50), nullable=True)
    event_end_time   = Column(String(50), nullable=True)
    venue            = Column(String(300), nullable=True)
    address          = Column(Text, nullable=True)
    organizer_name   = Column(String(200), nullable=True)
    organizer_email  = Column(String(255), nullable=False, index=True)
    organizer_phone  = Column(String(50), nullable=True)
    event_status     = Column(String(50), default="draft")  # draft, ready_to_publish, published, cancelled
    published_at     = Column(DateTime, nullable=True)
    tickets_json     = Column(JSON, nullable=True)
    agenda_json      = Column(JSON, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    design           = relationship("EventDesign", back_populates="event_management", uselist=False, cascade="all, delete-orphan")
    registration_form = relationship("EventRegistrationForm", back_populates="event_management", uselist=False, cascade="all, delete-orphan")
    exhibitors       = relationship("Exhibitor", back_populates="event_management", cascade="all, delete-orphan")
    gates            = relationship("EventEntryGate", back_populates="event_management", cascade="all, delete-orphan")
    scanners         = relationship("EventStaffScanner", back_populates="event_management", cascade="all, delete-orphan")

    def __repr__(self):
        return f"<EventManagement(event_id={self.event_id}, title={self.event_title})>"


class EventDesign(Base):
    """Stores data from the Design Event setup step."""
    __tablename__ = "event_design"

    design_id       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id        = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id     = Column(String(50), nullable=True, index=True)
    host_id         = Column(String(50), nullable=True, index=True)
    banner_image    = Column(String(500), nullable=True)
    logo            = Column(String(500), nullable=True)
    theme_color     = Column(String(50), nullable=True)
    font            = Column(String(100), nullable=True)
    gallery_images  = Column(JSON, nullable=True)
    about_event     = Column(Text, nullable=True)
    highlights      = Column(Text, nullable=True)
    speaker_details = Column(JSON, nullable=True)
    sponsor_details = Column(JSON, nullable=True)
    social_links    = Column(JSON, nullable=True)
    custom_sections = Column(JSON, nullable=True)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    event_management = relationship("EventManagement", back_populates="design")

    def __repr__(self):
        return f"<EventDesign(design_id={self.design_id}, event_id={self.event_id})>"


class EventRegistrationForm(Base):
    """Stores dynamic registration form configurations for an event."""
    __tablename__ = "event_registration_forms"

    form_id         = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id        = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id     = Column(String(50), nullable=True, index=True)
    host_id         = Column(String(50), nullable=True, index=True)
    form_json       = Column(JSON, nullable=True)
    questions_json  = Column(JSON, nullable=True)
    required_fields = Column(JSON, nullable=True)
    field_order     = Column(JSON, nullable=True)
    settings_json   = Column(JSON, nullable=True)
    published       = Column(Boolean, default=False)
    created_at      = Column(DateTime, default=datetime.utcnow)
    updated_at      = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    event_management = relationship("EventManagement", back_populates="registration_form")

    def __repr__(self):
        return f"<EventRegistrationForm(form_id={self.form_id}, event_id={self.event_id})>"


class EventRegistrationSettings(Base):
    """Stores registration access and ticketing settings for an event."""
    __tablename__ = "event_registration_settings"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    host_id = Column(String(50), nullable=True, index=True)
    created_by = Column(String(255), nullable=True)
    registration_status = Column(String(50), default="open")
    registration_start_date = Column(Date, nullable=True)
    registration_end_date = Column(Date, nullable=True)
    max_capacity = Column(Integer, default=0)
    allow_waitlist = Column(Boolean, default=False)
    approval_required = Column(Boolean, default=False)
    registration_type = Column(String(50), default="free")
    auto_confirmation = Column(Boolean, default=True)
    confirmation_email = Column(Boolean, default=True)
    cancellation_policy = Column(Text, nullable=True)
    status = Column(String(50), default="active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)


class EventRegistrationTicket(Base):
    """Stores ticket definitions for an event."""
    __tablename__ = "event_registration_tickets"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    host_id = Column(String(50), nullable=True, index=True)
    created_by = Column(String(255), nullable=True)
    settings_id = Column(UUID(as_uuid=True), ForeignKey("event_registration_settings.id"), nullable=True, index=True)
    ticket_name = Column(String(255), nullable=False)
    ticket_type = Column(String(100), nullable=True)
    price = Column(Float, default=0.0)
    quantity = Column(Integer, default=0)
    sales_start = Column(Date, nullable=True)
    sales_end = Column(Date, nullable=True)
    description = Column(Text, nullable=True)
    available_seats = Column(Integer, default=0)
    status = Column(String(50), default="active")
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)


class EventRegistration(Base):
    """Stores attendee registration records."""
    __tablename__ = "event_registrations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    host_id = Column(String(50), nullable=True, index=True)
    created_by = Column(String(255), nullable=True)
    ticket_id = Column(UUID(as_uuid=True), ForeignKey("event_registration_tickets.id"), nullable=True, index=True)
    attendee_name = Column(String(255), nullable=False)
    attendee_email = Column(String(255), nullable=False, index=True)
    attendee_phone = Column(String(50), nullable=True)
    registration_number = Column(String(100), nullable=True, index=True)
    status = Column(String(50), default="pending")
    payment_status = Column(String(50), default="pending")
    checkin_status = Column(String(50), default="pending")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)


class EventCommunication(Base):
    """Stores broadcast communications for the event."""
    __tablename__ = "event_communications"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    host_id = Column(String(50), nullable=True, index=True)
    created_by = Column(String(255), nullable=True)
    audience = Column(String(100), nullable=True)
    channel = Column(String(100), nullable=True)
    subject = Column(String(255), nullable=True)
    message = Column(Text, nullable=True)
    attachment_url = Column(String(500), nullable=True)
    schedule_date = Column(Date, nullable=True)
    schedule_time = Column(String(50), nullable=True)
    status = Column(String(50), default="draft")
    delivery_status = Column(String(100), default="pending")
    failed_reason = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)


class EventAttendanceCheckin(Base):
    """Stores QR/manual check-in activity for event-day operations."""
    __tablename__ = "event_attendance_checkins"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    host_id = Column(String(50), nullable=True, index=True)
    created_by = Column(String(255), nullable=True)
    registration_id = Column(UUID(as_uuid=True), ForeignKey("event_registrations.id"), nullable=True, index=True)
    attendee_name = Column(String(255), nullable=True)
    attendee_email = Column(String(255), nullable=True)
    scan_method = Column(String(50), default="manual")
    status = Column(String(50), default="checked_in")
    notes = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at = Column(DateTime, nullable=True)


class Exhibitor(Base):
    """Stores exhibitor/booth records for an event."""
    __tablename__ = "exhibitors"

    exhibitor_id  = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id      = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id   = Column(String(50), nullable=True, index=True)
    host_id       = Column(String(50), nullable=True, index=True)
    created_by    = Column(String(255), nullable=True)
    company_name  = Column(String(300), nullable=False)
    contact_name  = Column(String(200), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_phone = Column(String(50), nullable=True)
    website = Column(String(500), nullable=True)
    logo_url = Column(String(500), nullable=True)
    booth_number = Column(String(100), nullable=True)
    booth_type = Column(String(100), nullable=True)
    industry = Column(String(150), nullable=True)
    company_description = Column(Text, nullable=True)
    address = Column(Text, nullable=True)
    social_links = Column(JSON, nullable=True)
    category      = Column(String(150), nullable=True)  # e.g. "Tech", "Startup"
    package       = Column(String(100), nullable=True)  # e.g. "Premium", "Standard"
    notes         = Column(Text, nullable=True)
    status        = Column(String(50), default="pending")  # pending, confirmed, rejected
    created_at    = Column(DateTime, default=datetime.utcnow)
    updated_at    = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at    = Column(DateTime, nullable=True)

    # Relationship
    event_management = relationship("EventManagement", back_populates="exhibitors")

    def __repr__(self):
        return f"<Exhibitor(exhibitor_id={self.exhibitor_id}, company={self.company_name}, status={self.status})>"


class EventEntryGate(Base):
    """Stores custom entry gates configured for a specific event."""
    __tablename__ = "event_entry_gates"

    gate_id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id         = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id      = Column(String(50), nullable=True, index=True)
    host_id          = Column(String(50), nullable=True, index=True)
    created_by       = Column(String(255), nullable=True)
    gate_name        = Column(String(150), nullable=False)
    gate_code        = Column(String(50), nullable=True)
    gate_description = Column(String(300), nullable=True)
    status           = Column(String(50), default="Active")  # Active, Inactive
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at       = Column(DateTime, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="gates")
    scanners         = relationship("EventStaffScanner", back_populates="gate")

    def __repr__(self):
        return f"<EventEntryGate(gate_id={self.gate_id}, name={self.gate_name}, status={self.status})>"


class EventStaffScanner(Base):
    """Stores connected volunteer/staff scanners for an event with assigned gate."""
    __tablename__ = "event_staff_scanners"

    scanner_id       = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    event_id         = Column(UUID(as_uuid=True), ForeignKey("event_management.event_id"), nullable=False, index=True)
    customer_id      = Column(String(50), nullable=True, index=True)
    host_id          = Column(String(50), nullable=True, index=True)
    created_by       = Column(String(255), nullable=True)
    name             = Column(String(255), nullable=False)
    gate_id          = Column(UUID(as_uuid=True), ForeignKey("event_entry_gates.gate_id"), nullable=False, index=True)
    passcode         = Column(String(100), nullable=False)
    status           = Column(String(50), default="Live Scanning")
    scans_processed  = Column(Integer, default=0)
    created_at       = Column(DateTime, default=datetime.utcnow)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    deleted_at       = Column(DateTime, nullable=True)

    # Relationships
    event_management = relationship("EventManagement", back_populates="scanners")
    gate             = relationship("EventEntryGate", back_populates="scanners")

    def __repr__(self):
        return f"<EventStaffScanner(scanner_id={self.scanner_id}, name={self.name}, passcode={self.passcode})>"

