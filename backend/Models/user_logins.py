"""
UserLogin SQLAlchemy model.
"""

import uuid
from datetime import datetime
from zoneinfo import ZoneInfo
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID

_IST = ZoneInfo("Asia/Kolkata")


def _default_login_at() -> datetime:
    return datetime.now(_IST).replace(tzinfo=None, microsecond=0)


class UserLogin(Base):
    __tablename__ = "user_logins"

    id          = Column(GUID, primary_key=True, default=uuid.uuid4)
    customer_id = Column(String(50), ForeignKey("users.customer_id"), nullable=True, index=True)
    email       = Column(String(255), nullable=False, index=True)
    status      = Column(String(50), nullable=True)
    ip_address  = Column(String(50), nullable=True)
    user_agent  = Column(Text, nullable=True)
    region      = Column(String(160), nullable=True)
    login_at    = Column(DateTime, default=_default_login_at, nullable=True)

    # Relationships
    user = relationship("User", back_populates="user_logins")

    def __repr__(self):
        return f"<UserLogin(id={self.id}, customer_id={self.customer_id}, email={self.email})>"
