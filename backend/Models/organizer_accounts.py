"""
OrganizerAccount SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class OrganizerAccount(Base):
    __tablename__ = "organizer_accounts"

    id                    = Column(GUID, primary_key=True, default=uuid.uuid4)
    email                 = Column(String(255), nullable=False, index=True)
    org_name              = Column(String(255), nullable=True)
    pan_number            = Column(String(20), nullable=True)
    org_address           = Column(Text, nullable=True)
    has_gstin             = Column(Boolean, nullable=True)
    accepted_undertaking  = Column(Boolean, nullable=True)
    itr_filed             = Column(Boolean, nullable=True)
    state                 = Column(String(100), nullable=True)
    contact_full_name     = Column(String(200), nullable=True)
    contact_email         = Column(String(255), nullable=True)
    contact_mobile        = Column(String(20), nullable=True)
    beneficiary_name      = Column(String(200), nullable=True)
    account_type          = Column(String(50), nullable=True)
    bank_name             = Column(String(150), nullable=True)
    account_number        = Column(String(50), nullable=True)
    bank_ifsc             = Column(String(20), nullable=True)
    status                = Column(String(50), nullable=True)
    created_at            = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at            = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)
    gstin_number          = Column(Text, nullable=True)
    pan_card_url          = Column(String(500), nullable=True)
    cancelled_cheque_url  = Column(String(500), nullable=True)
    customer_id           = Column(String(50), ForeignKey("users.customer_id"), nullable=True, index=True)
    host_id               = Column(String(50), nullable=True)

    # Relationships
    user = relationship("User", back_populates="organizer_accounts")

    def __repr__(self):
        return f"<OrganizerAccount(id={self.id}, email={self.email}, customer_id={self.customer_id})>"
