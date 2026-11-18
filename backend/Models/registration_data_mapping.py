"""
Smart Data Mapping — Excel metadata, column maps, and parent/child links.

Excel rows stay in the uploaded file (private storage). Only configuration
metadata is stored in PostgreSQL.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import (
	Boolean,
	Column,
	DateTime,
	ForeignKey,
	Integer,
	String,
	Text,
	UniqueConstraint,
	Index,
)
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class RegistrationDataSource(Base):
	__tablename__ = "registration_data_sources"

	id = Column(GUID, primary_key=True, default=uuid.uuid4)
	event_id = Column(GUID, ForeignKey("event_management.event_id"), nullable=False, index=True)
	host_id = Column(String(50), nullable=True, index=True)
	customer_id = Column(String(50), nullable=True, index=True)
	source_name = Column(String(255), nullable=False, default="Excel source")
	file_name = Column(String(255), nullable=False)
	# Private StoredFile id (preferred) or opaque storage key
	stored_file_id = Column(GUID, ForeignKey("stored_files.id"), nullable=True)
	s3_key = Column(Text, nullable=True)
	file_hash = Column(String(128), nullable=False, default="")
	sheet_name = Column(String(255), nullable=True)
	status = Column(String(40), nullable=False, default="draft")  # draft|configured|active|inactive
	created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)

	columns = relationship(
		"RegistrationDataColumn",
		back_populates="source",
		cascade="all, delete-orphan",
	)
	mappings = relationship(
		"RegistrationDataMapping",
		back_populates="source",
		cascade="all, delete-orphan",
	)
	relationships_cfg = relationship(
		"RegistrationDataRelationship",
		back_populates="source",
		cascade="all, delete-orphan",
	)
	versions = relationship(
		"RegistrationDataSourceVersion",
		back_populates="source",
		cascade="all, delete-orphan",
	)


class RegistrationDataColumn(Base):
	__tablename__ = "registration_data_columns"
	__table_args__ = (
		UniqueConstraint("source_id", "column_index", name="uq_reg_data_col_source_index"),
	)

	id = Column(GUID, primary_key=True, default=uuid.uuid4)
	source_id = Column(GUID, ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False, index=True)
	column_name = Column(String(255), nullable=False)
	column_index = Column(Integer, nullable=False)
	data_type = Column(String(40), nullable=False, default="string")
	unique_count = Column(Integer, nullable=True)
	is_available = Column(Boolean, nullable=False, default=True)

	source = relationship("RegistrationDataSource", back_populates="columns")
	mappings = relationship("RegistrationDataMapping", back_populates="column")


class RegistrationDataMapping(Base):
	"""Maps an Excel column to a registration form question (JSON question id)."""

	__tablename__ = "registration_data_mappings"
	__table_args__ = (
		UniqueConstraint("source_id", "question_id", name="uq_reg_data_map_source_question"),
		UniqueConstraint("source_id", "column_id", name="uq_reg_data_map_source_column"),
		Index("ix_reg_data_map_form_def", "form_definition_id"),
	)

	id = Column(GUID, primary_key=True, default=uuid.uuid4)
	source_id = Column(GUID, ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False, index=True)
	# form_definitions.id (int) when available — optional because host UUID forms exist
	form_definition_id = Column(Integer, nullable=True)
	host_form_id = Column(String(36), nullable=True)
	# Question id inside schema_json / questions_json (not a DB FK)
	question_id = Column(String(100), nullable=False)
	column_id = Column(GUID, ForeignKey("registration_data_columns.id", ondelete="CASCADE"), nullable=False)
	field_type = Column(String(40), nullable=False, default="dropdown")
	sort_order = Column(String(40), nullable=False, default="alpha_asc")
	is_searchable = Column(Boolean, nullable=False, default=True)
	placeholder = Column(String(255), nullable=True)
	is_active = Column(Boolean, nullable=False, default=True)

	source = relationship("RegistrationDataSource", back_populates="mappings")
	column = relationship("RegistrationDataColumn", back_populates="mappings")


class RegistrationDataRelationship(Base):
	__tablename__ = "registration_data_relationships"
	__table_args__ = (
		UniqueConstraint(
			"source_id",
			"parent_mapping_id",
			"child_mapping_id",
			name="uq_reg_data_rel_parent_child",
		),
	)

	id = Column(GUID, primary_key=True, default=uuid.uuid4)
	source_id = Column(GUID, ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False, index=True)
	parent_mapping_id = Column(
		GUID, ForeignKey("registration_data_mappings.id", ondelete="CASCADE"), nullable=False
	)
	child_mapping_id = Column(
		GUID, ForeignKey("registration_data_mappings.id", ondelete="CASCADE"), nullable=False
	)
	relationship_type = Column(String(40), nullable=False, default="one_to_many")
	sort_order = Column(String(40), nullable=False, default="alpha_asc")
	is_active = Column(Boolean, nullable=False, default=True)

	source = relationship("RegistrationDataSource", back_populates="relationships_cfg")
	parent_mapping = relationship("RegistrationDataMapping", foreign_keys=[parent_mapping_id])
	child_mapping = relationship("RegistrationDataMapping", foreign_keys=[child_mapping_id])


class RegistrationDataSourceVersion(Base):
	__tablename__ = "registration_data_source_versions"

	id = Column(GUID, primary_key=True, default=uuid.uuid4)
	source_id = Column(GUID, ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False, index=True)
	version_number = Column(Integer, nullable=False, default=1)
	file_hash = Column(String(128), nullable=False, default="")
	stored_file_id = Column(GUID, ForeignKey("stored_files.id"), nullable=True)
	uploaded_at = Column(DateTime, default=datetime.utcnow, nullable=False)
	uploaded_by = Column(String(50), nullable=True)  # users.customer_id
	is_active = Column(Boolean, nullable=False, default=True)

	source = relationship("RegistrationDataSource", back_populates="versions")
