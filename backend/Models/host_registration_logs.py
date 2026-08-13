"""
HostRegistrationLog SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class HostRegistrationLog(Base):
    __tablename__ = "host_registration_logs"

    id          = Column(GUID, primary_key=True, default=uuid.uuid4)
    customer_id = Column(String(50), ForeignKey("users.customer_id"), nullable=True, index=True)
    email       = Column(String(255), nullable=False, index=True)
    org_name    = Column(String(255), nullable=True)
    action      = Column(String(50), nullable=False)
    status      = Column(String(50), nullable=True)
    timestamp   = Column(DateTime, default=datetime.utcnow, nullable=True)

    # Relationships
    user = relationship("User", back_populates="host_registration_logs")

    def __repr__(self):
        return f"<HostRegistrationLog(id={self.id}, action={self.action}, email={self.email})>"
