"""
TheatrePartner — a cinema / theatre registered to list movie shows.

Separate from OrganizerAccount so one JOD account can be both an event host and
a theatre partner. Registration follows the same three steps as event hosts
(details + bank, documents, agreement) and needs admin approval.
"""

import uuid
from datetime import datetime

from sqlalchemy import Boolean, Column, DateTime, String, Text

from Models.base import Base, GUID


class TheatrePartner(Base):
    __tablename__ = "theatre_partners"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    customer_id = Column(String(50), nullable=True, index=True)
    email = Column(String(255), nullable=False, index=True)
    partner_code = Column(String(40), nullable=True, index=True)

    theatre_name = Column(String(255), nullable=True)
    chain_name = Column(String(255), nullable=True)
    theatre_address = Column(Text, nullable=True)
    district = Column(String(120), nullable=True)
    state = Column(String(120), nullable=True)
    pincode = Column(String(10), nullable=True)
    # JSON list: [{"name": "Screen 1", "seats": 180, "format": "2D"}]
    screens_json = Column(Text, nullable=True)
    licence_number = Column(String(80), nullable=True)
    licence_valid_till = Column(String(10), nullable=True)
    licence_url = Column(String(500), nullable=True)

    legal_name = Column(String(255), nullable=True)
    pan_number = Column(String(20), nullable=True)
    org_address = Column(Text, nullable=True)
    has_gstin = Column(Boolean, nullable=True)
    gstin_number = Column(Text, nullable=True)

    contact_full_name = Column(String(200), nullable=True)
    contact_email = Column(String(255), nullable=True)
    contact_mobile = Column(String(20), nullable=True)

    beneficiary_name = Column(String(200), nullable=True)
    account_type = Column(String(50), nullable=True)
    bank_name = Column(String(150), nullable=True)
    account_number = Column(String(50), nullable=True)
    bank_ifsc = Column(String(20), nullable=True)
    pan_card_url = Column(String(500), nullable=True)
    cancelled_cheque_url = Column(String(500), nullable=True)

    accepted_undertaking = Column(Boolean, nullable=True)
    accepted_agreement = Column(Boolean, nullable=True)
    agreement_version = Column(String(40), nullable=True)
    agreement_accepted_at = Column(DateTime, nullable=True)
    agreement_accept_ip = Column(String(64), nullable=True)
    agreement_acceptance_ref = Column(String(40), nullable=True)

    # draft | submitted | verified | rejected | restricted
    status = Column(String(30), default="draft", nullable=False, index=True)
    review_reason = Column(Text, nullable=True)
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    submitted_at = Column(DateTime, nullable=True)
    verified_at = Column(DateTime, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<TheatrePartner(email={self.email}, theatre={self.theatre_name}, status={self.status})>"
