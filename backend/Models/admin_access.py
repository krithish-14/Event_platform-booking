"""
Admin access granted by the super admin, one row per invited email.
"""

import uuid
from datetime import datetime, timedelta

from sqlalchemy import Column, DateTime, String

from Models.base import Base, GUID

ADMIN_INVITE_TTL_HOURS = 48


def default_admin_invite_expiry() -> datetime:
    return datetime.utcnow() + timedelta(hours=ADMIN_INVITE_TTL_HOURS)


class AdminAccess(Base):
    __tablename__ = "admin_access"

    id = Column(GUID, primary_key=True, default=uuid.uuid4)
    invited_email = Column(String(255), nullable=False, unique=True, index=True)
    invited_name = Column(String(200), nullable=True)
    status = Column(String(20), nullable=False, default="PENDING")
    token_hash = Column(String(64), nullable=True, unique=True, index=True)
    expires_at = Column(DateTime, nullable=True)
    customer_id = Column(String(50), nullable=True, index=True)
    invited_by_email = Column(String(255), nullable=True)
    invited_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    accepted_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by_email = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    def is_expired(self) -> bool:
        return bool(self.expires_at and datetime.utcnow() > self.expires_at)

    def __repr__(self):
        return f"<AdminAccess(email={self.invited_email}, status={self.status})>"
