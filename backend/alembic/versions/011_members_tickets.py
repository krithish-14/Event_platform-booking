"""Members booking link key for members-only ticket offers.

Also applied at startup by Models/base.py _migrate_tables.

Revision ID: 011_members_tickets
Revises: 010_event_private
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "011_members_tickets"
down_revision: Union[str, None] = "010_event_private"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "members_key" not in {c["name"] for c in sa.inspect(op.get_bind()).get_columns("event_management")}:
        op.add_column("event_management", sa.Column("members_key", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("event_management", "members_key")
