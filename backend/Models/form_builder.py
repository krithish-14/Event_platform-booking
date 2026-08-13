"""
Database models for Dynamic Registration Form Builder and Attendee Submissions.
"""
from sqlalchemy import Column, Integer, String, Boolean, DateTime, Text, JSON
from datetime import datetime
from .base import Base


class FormDefinition(Base):
	__tablename__ = "form_definitions"

	id = Column(Integer, primary_key=True, index=True)
	organizer_email = Column(String(255), index=True, nullable=False)
	event_id = Column(String(255), index=True, nullable=True)
	form_title = Column(String(255), nullable=False, default="Event Registration Form")
	form_description = Column(Text, nullable=True)
	version = Column(Integer, default=1, nullable=False)
	is_published = Column(Boolean, default=False)
	schema_json = Column(JSON, nullable=False)
	theme_json = Column(JSON, nullable=True)
	created_at = Column(DateTime, default=datetime.utcnow)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class FormSubmission(Base):
	__tablename__ = "form_submissions"

	id = Column(Integer, primary_key=True, index=True)
	form_id = Column(Integer, index=True, nullable=False)
	event_id = Column(String(255), index=True, nullable=True)
	user_email = Column(String(255), index=True, nullable=False)
	form_version = Column(Integer, default=1, nullable=False)
	answers_json = Column(JSON, nullable=False)
	status = Column(String(50), default="completed")  # completed, abandoned, pending
	submission_time = Column(DateTime, default=datetime.utcnow)
