"""
OrganizerAccount and EmailOTP SQLAlchemy models.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey
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

    id                   = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id              = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    customer_id          = Column(String(50), nullable=True, index=True)
    host_id              = Column(String(50), nullable=True, index=True)
    email                = Column(String(255), unique=True, nullable=False, index=True)
    org_name             = Column(String(255), nullable=True)
    pan_number           = Column(String(20), nullable=True)
    org_address          = Column(Text, nullable=True)
    has_gstin            = Column(Boolean, default=False)
    gstin_number         = Column(Text, nullable=True)
    accepted_undertaking = Column(Boolean, default=False)
    itr_filed            = Column(Boolean, default=False)
    state                = Column(String(100), nullable=True)
    
    # Contact Person Details
    contact_full_name    = Column(String(200), nullable=True)
    contact_email        = Column(String(255), nullable=True)
    contact_mobile       = Column(String(20), nullable=True)
    
    # Bank details
    beneficiary_name     = Column(String(200), nullable=True)
    account_type         = Column(String(50), nullable=True)
    bank_name            = Column(String(150), nullable=True)
    account_number       = Column(String(50), nullable=True)
    bank_ifsc            = Column(String(20), nullable=True)
    
    # Uploaded Documents
    pan_card_url         = Column(String(500), nullable=True)
    cancelled_cheque_url = Column(String(500), nullable=True)
    
    status               = Column(String(50), default="draft")  # draft / submitted
    created_at           = Column(DateTime, default=datetime.utcnow)
    updated_at           = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationship
    user                 = relationship("User", backref="organizer_account")

    def __repr__(self):
        return f"<OrganizerAccount(email={self.email}, org={self.org_name})>"

