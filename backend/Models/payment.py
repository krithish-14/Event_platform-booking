"""
Razorpay payment records linked to users (ticket bookings) and events.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, DateTime, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class Payment(Base):
    __tablename__ = "payments"

    id = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    order_id = Column(String(100), unique=True, nullable=False, index=True)
    payment_id = Column(String(100), nullable=True, index=True)
    signature = Column(String(255), nullable=True)
    amount = Column(Integer, nullable=False, default=0)  # paise
    currency = Column(String(10), nullable=False, default="INR")
    status = Column(String(20), nullable=False, default="pending", index=True)  # pending/success/failed
    user_id = Column(String(50), ForeignKey("users.customer_id"), nullable=False, index=True)
    event_id = Column(GUID, ForeignKey("events.id"), nullable=False, index=True)
    booking_id = Column(GUID, ForeignKey("bookings.booking_id"), nullable=True, index=True)
    ticket_type = Column(String(100), nullable=True)
    quantity = Column(Integer, default=1)
    receipt = Column(String(100), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    verified_at = Column(DateTime, nullable=True)

    user = relationship("User")
    event = relationship("Event")
    booking = relationship("Booking")

    def __repr__(self):
        return f"<Payment(order_id={self.order_id}, status={self.status})>"
