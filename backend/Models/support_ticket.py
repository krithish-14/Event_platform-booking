"""
Support tickets raised from Help & Support.
"""

import random
import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, String, Text

from Models.base import Base, GUID


def generate_ticket_code():
    return f"HT-{random.randint(100000, 999999)}"


class SupportTicket(Base):
    __tablename__ = "support_tickets"

    id = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    ticket_code = Column(String(20), unique=True, nullable=False, index=True, default=generate_ticket_code)
    customer_id = Column(String(50), nullable=True, index=True)
    name = Column(String(200), nullable=False)
    email = Column(String(255), nullable=False, index=True)
    category = Column(String(80), nullable=False)
    priority = Column(String(20), default="normal", nullable=False)
    subject = Column(String(250), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(30), default="open", nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<SupportTicket(code={self.ticket_code}, email={self.email}, status={self.status})>"
