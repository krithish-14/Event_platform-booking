"""
Attendee UPI payment proof submitted after the ticket bill Payment button.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Float, Sequence, ForeignKey

from Models.base import Base, GUID


class PaymentProof(Base):
    __tablename__ = "payment_proofs"

    id = Column(Integer, Sequence("payment_proofs_id_seq"), primary_key=True, autoincrement=True)
    customer_id = Column(String(50), ForeignKey("users.customer_id"), nullable=True, index=True)
    event_id = Column(String(255), nullable=True, index=True)
    ticket_type = Column(String(100), nullable=True)
    amount = Column(Float, nullable=True)
    quantity = Column(Integer, default=1)
    attendee_name = Column(String(200), nullable=False)
    attendee_email = Column(String(255), nullable=False, index=True)
    attendee_phone = Column(String(50), nullable=False)
    bank_name = Column(String(200), nullable=False)
    transaction_id = Column(String(120), nullable=False, index=True)
    screenshot_file_id = Column(GUID, ForeignKey("stored_files.id"), nullable=True)
    status = Column(String(50), default="payment_submitted", index=True)
    booking_id = Column(GUID, ForeignKey("bookings.booking_id"), nullable=True, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<PaymentProof(id={self.id}, email={self.attendee_email}, txn={self.transaction_id})>"
