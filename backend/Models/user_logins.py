"""
UserLogin SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class UserLogin(Base):
    __tablename__ = "user_logins"

    id          = Column(GUID, primary_key=True, default=uuid.uuid4)
    customer_id = Column(String(50), ForeignKey("users.customer_id"), nullable=True, index=True)
    email       = Column(String(255), nullable=False, index=True)
    status      = Column(String(50), nullable=True)
    ip_address  = Column(String(50), nullable=True)
    user_agent  = Column(Text, nullable=True)
    login_at    = Column(DateTime, default=datetime.utcnow, nullable=True)

    # Relationships
    user = relationship("User", back_populates="user_logins")

    def __repr__(self):
        return f"<UserLogin(id={self.id}, customer_id={self.customer_id}, email={self.email})>"
