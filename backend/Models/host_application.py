"""
HostApplication — immutable snapshot of each host setup submission/review action.
Resubmits create a new row so admin keeps a full accepted/rejected/restricted history.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text

from Models.base import Base, GUID


class HostApplication(Base):
    __tablename__ = "host_applications"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    organizer_account_id = Column(GUID, nullable=True, index=True)
    customer_id = Column(String(50), nullable=True, index=True)
    host_id = Column(String(50), nullable=True, index=True)
    email = Column(String(255), nullable=False, index=True)

    org_name = Column(String(255), nullable=True)
    pan_number = Column(String(20), nullable=True)
    org_address = Column(Text, nullable=True)
    has_gstin = Column(Boolean, nullable=True)
    gstin_number = Column(Text, nullable=True)
    accepted_undertaking = Column(Boolean, nullable=True)
    itr_filed = Column(Boolean, nullable=True)
    state = Column(String(100), nullable=True)

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
    accepted_agreement = Column(Boolean, nullable=True)

    # pending | approved | rejected | restricted
    status = Column(String(50), default="pending", nullable=False, index=True)
    # submit | approve | reject | restrict
    action = Column(String(50), default="submit", nullable=True)
    review_reason = Column(Text, nullable=True)
    reviewed_by = Column(String(255), nullable=True)
    reviewed_at = Column(DateTime, nullable=True)
    submitted_at = Column(DateTime, default=datetime.utcnow, nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<HostApplication(id={self.id}, email={self.email}, status={self.status})>"
