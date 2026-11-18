"""Smart Data Mapping tables for Excel-backed dependent dropdowns.

Revision ID: 013_registration_data_mapping
Revises: 012_event_links
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "013_registration_data_mapping"
down_revision: Union[str, None] = "012_event_links"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ID = sa.CHAR(length=36)


def upgrade() -> None:
	inspector = sa.inspect(op.get_bind())
	tables = set(inspector.get_table_names())

	if "registration_data_sources" not in tables:
		op.create_table(
			"registration_data_sources",
			sa.Column("id", ID, primary_key=True),
			sa.Column("event_id", ID, sa.ForeignKey("event_management.event_id"), nullable=False),
			sa.Column("host_id", sa.String(length=50), nullable=True),
			sa.Column("customer_id", sa.String(length=50), nullable=True),
			sa.Column("source_name", sa.String(length=255), nullable=False),
			sa.Column("file_name", sa.String(length=255), nullable=False),
			sa.Column("stored_file_id", ID, sa.ForeignKey("stored_files.id"), nullable=True),
			sa.Column("s3_key", sa.Text(), nullable=True),
			sa.Column("file_hash", sa.String(length=128), nullable=False, server_default=""),
			sa.Column("sheet_name", sa.String(length=255), nullable=True),
			sa.Column("status", sa.String(length=40), nullable=False, server_default="draft"),
			sa.Column("created_at", sa.DateTime(), nullable=False),
			sa.Column("updated_at", sa.DateTime(), nullable=False),
		)
		op.create_index("ix_registration_data_sources_event_id", "registration_data_sources", ["event_id"])
		op.create_index("ix_registration_data_sources_host_id", "registration_data_sources", ["host_id"])
		op.create_index("ix_registration_data_sources_customer_id", "registration_data_sources", ["customer_id"])

	if "registration_data_columns" not in tables:
		op.create_table(
			"registration_data_columns",
			sa.Column("id", ID, primary_key=True),
			sa.Column("source_id", ID, sa.ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False),
			sa.Column("column_name", sa.String(length=255), nullable=False),
			sa.Column("column_index", sa.Integer(), nullable=False),
			sa.Column("data_type", sa.String(length=40), nullable=False, server_default="string"),
			sa.Column("unique_count", sa.Integer(), nullable=True),
			sa.Column("is_available", sa.Boolean(), nullable=False, server_default=sa.text("true")),
			sa.UniqueConstraint("source_id", "column_index", name="uq_reg_data_col_source_index"),
		)
		op.create_index("ix_registration_data_columns_source_id", "registration_data_columns", ["source_id"])

	if "registration_data_mappings" not in tables:
		op.create_table(
			"registration_data_mappings",
			sa.Column("id", ID, primary_key=True),
			sa.Column("source_id", ID, sa.ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False),
			sa.Column("form_definition_id", sa.Integer(), nullable=True),
			sa.Column("host_form_id", sa.String(length=36), nullable=True),
			sa.Column("question_id", sa.String(length=100), nullable=False),
			sa.Column("column_id", ID, sa.ForeignKey("registration_data_columns.id", ondelete="CASCADE"), nullable=False),
			sa.Column("field_type", sa.String(length=40), nullable=False, server_default="dropdown"),
			sa.Column("sort_order", sa.String(length=40), nullable=False, server_default="alpha_asc"),
			sa.Column("is_searchable", sa.Boolean(), nullable=False, server_default=sa.text("true")),
			sa.Column("placeholder", sa.String(length=255), nullable=True),
			sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
			sa.UniqueConstraint("source_id", "question_id", name="uq_reg_data_map_source_question"),
			sa.UniqueConstraint("source_id", "column_id", name="uq_reg_data_map_source_column"),
		)
		op.create_index("ix_registration_data_mappings_source_id", "registration_data_mappings", ["source_id"])
		op.create_index("ix_reg_data_map_form_def", "registration_data_mappings", ["form_definition_id"])

	if "registration_data_relationships" not in tables:
		op.create_table(
			"registration_data_relationships",
			sa.Column("id", ID, primary_key=True),
			sa.Column("source_id", ID, sa.ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False),
			sa.Column("parent_mapping_id", ID, sa.ForeignKey("registration_data_mappings.id", ondelete="CASCADE"), nullable=False),
			sa.Column("child_mapping_id", ID, sa.ForeignKey("registration_data_mappings.id", ondelete="CASCADE"), nullable=False),
			sa.Column("relationship_type", sa.String(length=40), nullable=False, server_default="one_to_many"),
			sa.Column("sort_order", sa.String(length=40), nullable=False, server_default="alpha_asc"),
			sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
			sa.UniqueConstraint("source_id", "parent_mapping_id", "child_mapping_id", name="uq_reg_data_rel_parent_child"),
		)
		op.create_index("ix_registration_data_relationships_source_id", "registration_data_relationships", ["source_id"])

	if "registration_data_source_versions" not in tables:
		op.create_table(
			"registration_data_source_versions",
			sa.Column("id", ID, primary_key=True),
			sa.Column("source_id", ID, sa.ForeignKey("registration_data_sources.id", ondelete="CASCADE"), nullable=False),
			sa.Column("version_number", sa.Integer(), nullable=False, server_default="1"),
			sa.Column("file_hash", sa.String(length=128), nullable=False, server_default=""),
			sa.Column("stored_file_id", ID, sa.ForeignKey("stored_files.id"), nullable=True),
			sa.Column("uploaded_at", sa.DateTime(), nullable=False),
			sa.Column("uploaded_by", sa.String(length=50), nullable=True),
			sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
		)
		op.create_index("ix_registration_data_source_versions_source_id", "registration_data_source_versions", ["source_id"])


def downgrade() -> None:
	op.drop_table("registration_data_source_versions")
	op.drop_table("registration_data_relationships")
	op.drop_table("registration_data_mappings")
	op.drop_table("registration_data_columns")
	op.drop_table("registration_data_sources")
