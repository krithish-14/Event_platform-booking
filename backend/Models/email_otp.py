"""
EmailOTP SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Integer

from Models.base import Base, GUID


class EmailOTP(Base):
    __tablename__ = "email_otps"

    id          = Column(GUID, primary_key=True, default=uuid.uuid4)
    email       = Column(String(255), nullable=False, index=True)
    otp_code    = Column(String(128), nullable=False)
    expires_at  = Column(DateTime, nullable=False)
    is_verified = Column(Boolean, default=False, nullable=True)
    purpose     = Column(String(50), default="organizer", nullable=True)
    attempt_count = Column(Integer, default=0, nullable=False)
    created_at  = Column(DateTime, default=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<EmailOTP(id={self.id}, email={self.email}, purpose={self.purpose})>"
