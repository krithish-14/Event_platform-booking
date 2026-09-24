"""Add Google identity fields on users.

Revision ID: 002_google_auth_fields
Revises: 001_initial_integrated_schema
Create Date: 2026-09-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "002_google_auth_fields"
down_revision: Union[str, None] = "001_initial_integrated_schema"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("google_user_id", sa.String(length=64), nullable=True))
    op.add_column("users", sa.Column("auth_provider", sa.String(length=20), nullable=True))
    op.create_index("ix_users_google_user_id", "users", ["google_user_id"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_google_user_id", table_name="users")
    op.drop_column("users", "auth_provider")
    op.drop_column("users", "google_user_id")
