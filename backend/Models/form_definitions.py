"""
FormDefinition SQLAlchemy model.
"""

from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, Sequence

from Models.base import Base, JSONType


class FormDefinition(Base):
    __tablename__ = "form_definitions"

    id               = Column(Integer, Sequence("form_definitions_id_seq"), primary_key=True, autoincrement=True)
    organizer_email  = Column(String(255), nullable=False, index=True)
    event_id         = Column(String(255), nullable=True)
    form_title       = Column(String(255), nullable=False)
    form_description = Column(Text, nullable=True)
    version          = Column(Integer, nullable=False, default=1)
    is_published     = Column(Boolean, default=False, nullable=True)
    schema_json      = Column(JSONType, nullable=False)
    theme_json       = Column(JSONType, nullable=True)
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=True)
    updated_at       = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<FormDefinition(id={self.id}, title={self.form_title})>"
