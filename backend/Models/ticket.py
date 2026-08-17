"""
Ticket SQLAlchemy model.
"""

import uuid
import secrets
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


def generate_qr_token():
    """Generate a cryptographically secure, unique, non-sequential QR token."""
    return f"JOD-TKT-{secrets.token_hex(16).upper()}"


class Ticket(Base):
    __tablename__ = "tickets"

    ticket_id   = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    booking_id  = Column(GUID, ForeignKey("bookings.booking_id"), nullable=False, index=True)
    event_id    = Column(GUID, ForeignKey("events.id"), nullable=False, index=True)
    customer_id = Column(String(100), ForeignKey("users.customer_id"), nullable=False, index=True)
    
    ticket_type = Column(String(100), default="Standard Access")
    seat_number = Column(String(100), nullable=True)
    qr_token    = Column(String(100), unique=True, nullable=False, index=True, default=generate_qr_token)
    ticket_status = Column(String(50), default="VALID", index=True)  # VALID, USED, CANCELLED
    
    created_at  = Column(DateTime, default=datetime.utcnow)
    used_at     = Column(DateTime, nullable=True)
    scanned_by  = Column(String(100), nullable=True)

    # Relationships
    booking  = relationship("Booking", back_populates="tickets")
    event    = relationship("Event", back_populates="tickets")
    customer = relationship("User", back_populates="tickets")

    def __repr__(self):
        return f"<Ticket(ticket_id={self.ticket_id}, qr_token={self.qr_token}, status={self.ticket_status})>"
