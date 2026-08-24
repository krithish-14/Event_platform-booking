"""
FormSubmission SQLAlchemy model — attendee registration answers linked to user, event, and booking.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Float, Sequence, ForeignKey
from sqlalchemy.orm import relationship

from Models.base import Base, JSONType, GUID


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id              = Column(Integer, Sequence("form_submissions_id_seq"), primary_key=True, autoincrement=True)
    form_id         = Column(Integer, nullable=False, index=True)
    event_id        = Column(String(255), nullable=True, index=True)
    customer_id     = Column(String(50), ForeignKey("users.customer_id"), nullable=True, index=True)
    booking_id      = Column(GUID, ForeignKey("bookings.booking_id"), nullable=True, index=True)
    user_email      = Column(String(255), nullable=False, index=True)
    ticket_type     = Column(String(100), nullable=True)
    ticket_price    = Column(Float, nullable=True)
    form_version    = Column(Integer, nullable=False, default=1)
    answers_json    = Column(JSONType, nullable=False)
    status          = Column(String(50), nullable=True)
    submission_time = Column(DateTime, default=datetime.utcnow, nullable=True)

    customer = relationship("User", back_populates="form_submissions")
    booking  = relationship("Booking", back_populates="form_submissions")

    def __repr__(self):
        return f"<FormSubmission(id={self.id}, customer_id={self.customer_id}, event_id={self.event_id})>"
