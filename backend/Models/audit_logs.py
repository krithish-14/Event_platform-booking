"""
Separate audit log models for Signup, Login, and Host Registration actions.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, Text, ForeignKey
from sqlalchemy.dialects.postgresql import UUID

from Models.base import Base


class UserSignupLog(Base):
    __tablename__ = "user_signups"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    customer_id  = Column(String(50), nullable=False, index=True)
    email        = Column(String(255), nullable=False, index=True)
    username     = Column(String(100), nullable=False)
    full_name    = Column(String(200), nullable=True)
    signup_at    = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<UserSignupLog(customer_id={self.customer_id}, email={self.email})>"


class UserLoginLog(Base):
    __tablename__ = "user_logins"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    customer_id  = Column(String(50), nullable=True, index=True)
    email        = Column(String(255), nullable=False, index=True)
    status       = Column(String(50), default="SUCCESS")
    ip_address   = Column(String(50), nullable=True)
    user_agent   = Column(Text, nullable=True)
    login_at     = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<UserLoginLog(customer_id={self.customer_id}, email={self.email})>"


class HostRegistrationLog(Base):
    __tablename__ = "host_registration_logs"

    id           = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    user_id      = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True, index=True)
    customer_id  = Column(String(50), nullable=True, index=True)
    email        = Column(String(255), nullable=False, index=True)
    org_name     = Column(String(255), nullable=True)
    action       = Column(String(50), nullable=False)  # e.g. 'LIST_YOUR_EVENT', 'DRAFT_SAVED', 'FINAL_SUBMIT'
    status       = Column(String(50), nullable=True)
    timestamp    = Column(DateTime, default=datetime.utcnow)

    def __repr__(self):
        return f"<HostRegistrationLog(customer_id={self.customer_id}, action={self.action})>"
