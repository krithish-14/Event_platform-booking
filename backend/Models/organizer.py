"""
OrganizerAccount and EmailOTP SQLAlchemy models.

Relationship hierarchy:
    users.customer_id (UNIQUE NOT NULL)
          │
          │ FK (ON UPDATE CASCADE)
          ▼
    organizer_accounts.customer_id (UNIQUE NOT NULL)
          │
          │ host_id (UNIQUE — canonical organizer identity)
          ▼
    event_management.host_id (VARCHAR denormalized reference)
"""

import uuid
from datetime import datetime
from sqlalchemy import (
    Column, String, Boolean, DateTime, Text, ForeignKey, UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from Models.base import Base


class EmailOTP(Base):
    __tablename__ = "email_otps"

    id          = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    email       = Column(String(255), nullable=False, index=True)
    otp_code    = Column(String(6), nullable=False)
    expires_at  = Column(DateTime, nullable=False)
    is_verified = Column(Boolean, default=False)
    created_at  = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<EmailOTP(email={self.email}, verified={self.is_verified})>"


class OrganizerAccount(Base):
    __tablename__ = "organizer_accounts"

    # ── Internal primary key ───────────────────────────────────────────────────
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # ── Canonical identifiers ─────────────────────────────────────────────────
    # customer_id: FK → users.customer_id. UNIQUE enforced at DB level.
    customer_id = Column(
        String(50),
        ForeignKey("users.customer_id", onupdate="CASCADE", ondelete="SET NULL"),
        nullable=True,   # nullable in ORM; NOT NULL + UNIQUE enforced via migration
        index=True,
    )
    # host_id: Canonical organizer identity (HST-XXXXXX). UNIQUE at DB level.
    host_id     = Column(String(50), nullable=True, index=True)

    # ── Organizer details ─────────────────────────────────────────────────────
    email                = Column(String(255), unique=True, nullable=False, index=True)
    org_name             = Column(String(255), nullable=True)
    pan_number           = Column(String(20), nullable=True)
    org_address          = Column(Text, nullable=True)
    has_gstin            = Column(Boolean, default=False)
    gstin_number         = Column(Text, nullable=True)
    accepted_undertaking = Column(Boolean, default=False)
    itr_filed            = Column(Boolean, default=False)
    state                = Column(String(100), nullable=True)

    # ── Contact person ────────────────────────────────────────────────────────
    contact_full_name    = Column(String(200), nullable=True)
    contact_email        = Column(String(255), nullable=True)
    contact_mobile       = Column(String(20), nullable=True)

    # ── Bank details ──────────────────────────────────────────────────────────
    beneficiary_name     = Column(String(200), nullable=True)
    account_type         = Column(String(50), nullable=True)
    bank_name            = Column(String(150), nullable=True)
    account_number       = Column(String(50), nullable=True)
    bank_ifsc            = Column(String(20), nullable=True)

    # ── Documents ─────────────────────────────────────────────────────────────
    pan_card_url         = Column(String(500), nullable=True)
    cancelled_cheque_url = Column(String(500), nullable=True)

    # ── Status ────────────────────────────────────────────────────────────────
    status     = Column(String(50), default="draft")  # draft / submitted / verified
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # ── Relationship: organizer -> user (via customer_id) ─────────────────────
    user = relationship(
        "User",
        foreign_keys=[customer_id],
        primaryjoin="OrganizerAccount.customer_id == User.customer_id",
        backref="organizer_account",
    )

    # ── Table-level unique constraints (mirrors DB constraints) ───────────────
    __table_args__ = (
        UniqueConstraint("customer_id", name="uq_organizer_accounts_customer_id"),
        UniqueConstraint("host_id",      name="uq_organizer_accounts_host_id"),
    )

    def __repr__(self):
        return f"<OrganizerAccount(customer_id={self.customer_id}, host_id={self.host_id}, org={self.org_name})>"
