"""
FormSubmission SQLAlchemy model.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, DateTime, Sequence

from Models.base import Base, JSONType


class FormSubmission(Base):
    __tablename__ = "form_submissions"

    id              = Column(Integer, Sequence("form_submissions_id_seq"), primary_key=True, autoincrement=True)
    form_id         = Column(Integer, nullable=False, index=True)
    event_id        = Column(String(255), nullable=True)
    user_email      = Column(String(255), nullable=False, index=True)
    form_version    = Column(Integer, nullable=False, default=1)
    answers_json    = Column(JSONType, nullable=False)
    status          = Column(String(50), nullable=True)
    submission_time = Column(DateTime, default=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<FormSubmission(id={self.id}, form_id={self.form_id}, user_email={self.user_email})>"
