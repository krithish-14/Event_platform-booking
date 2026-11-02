"""Private (link-only) events: hidden from public lists, still bookable from the event page.

Also applied at startup by Models/base.py _migrate_tables.

Revision ID: 010_event_private
Revises: 009_cinema_movie_details
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "010_event_private"
down_revision: Union[str, None] = "009_cinema_movie_details"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    for table in ("events", "event_management"):
        if "is_private" not in {c["name"] for c in inspector.get_columns(table)}:
            op.add_column(table, sa.Column("is_private", sa.Boolean(), nullable=True, server_default=sa.false()))


def downgrade() -> None:
    op.drop_column("event_management", "is_private")
    op.drop_column("events", "is_private")
