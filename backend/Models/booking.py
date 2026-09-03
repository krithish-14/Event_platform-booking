"""
Booking SQLAlchemy model.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Integer, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship, foreign

from Models.base import Base, GUID


class Booking(Base):
    __tablename__ = "bookings"

    # Must stay GUID/CHAR — not native PG UUID — to match live tickets.booking_id CHAR joins.
    booking_id  = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    customer_id = Column(String(100), ForeignKey("users.customer_id"), nullable=False, index=True)
    event_id    = Column(GUID, ForeignKey("events.id"), nullable=False, index=True)
    ticket_type = Column(String(100), default="Standard Access")
    quantity    = Column(Integer, default=1)
    total_price = Column(Float, default=0.0)
    status      = Column(String(50), default="CONFIRMED")
    payment_id  = Column(String(100), nullable=True)
    payment_mode = Column(String(100), default="UPI / Card")
    gst_amount  = Column(Float, default=0.0)
    seat_number = Column(String(100), default="General Admission")
    receiver_name = Column(String(200), nullable=True)
    receiver_email = Column(String(200), nullable=True)
    receiver_phone = Column(String(50), nullable=True)
    booked_at   = Column(DateTime, default=datetime.utcnow)

    # Relationships
    customer = relationship("User", back_populates="bookings")
    event = relationship(
        "Event",
        back_populates="bookings",
        primaryjoin="cast(foreign(Booking.event_id), String) == cast(Event.id, String)",
    )
    tickets = relationship(
        "Ticket",
        back_populates="booking",
        cascade="all, delete-orphan",
        primaryjoin="cast(foreign(Ticket.booking_id), String) == cast(Booking.booking_id, String)",
    )
    form_submissions = relationship("FormSubmission", back_populates="booking")

    def __repr__(self):
        return f"<Booking(booking_id={self.booking_id}, customer_id={self.customer_id}, event_id={self.event_id})>"
