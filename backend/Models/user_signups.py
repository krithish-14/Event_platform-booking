"""
UserSignup SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class UserSignup(Base):
    __tablename__ = "user_signups"

    id           = Column(GUID, primary_key=True, default=uuid.uuid4)
    customer_id  = Column(String(50), ForeignKey("users.customer_id"), nullable=False, index=True)
    email        = Column(String(255), nullable=False, index=True)
    username     = Column(String(100), nullable=False)
    full_name    = Column(String(200), nullable=True)
    signup_at    = Column(DateTime, default=datetime.utcnow, nullable=True)
    city         = Column(String(150), nullable=True)
    location_pin = Column(String(20), nullable=True)
    latitude     = Column(Float, nullable=True)
    longitude    = Column(Float, nullable=True)

    # Relationships
    user = relationship("User", back_populates="user_signups")

    def __repr__(self):
        return f"<UserSignup(id={self.id}, customer_id={self.customer_id}, email={self.email})>"
