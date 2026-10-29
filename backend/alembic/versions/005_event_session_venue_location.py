"""Map location for each event session venue.

Also applied at startup by Models/base.py _migrate_tables.

Revision ID: 005_event_session_venue_location
Revises: 004_event_sessions
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "005_event_session_venue_location"
down_revision: Union[str, None] = "004_event_sessions"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("event_sessions")}
    if "venue_lat" not in existing:
        op.add_column("event_sessions", sa.Column("venue_lat", sa.Float(), nullable=True))
    if "venue_lng" not in existing:
        op.add_column("event_sessions", sa.Column("venue_lng", sa.Float(), nullable=True))
    if "venue_place_id" not in existing:
        op.add_column("event_sessions", sa.Column("venue_place_id", sa.String(length=255), nullable=True))


def downgrade() -> None:
    op.drop_column("event_sessions", "venue_place_id")
    op.drop_column("event_sessions", "venue_lng")
    op.drop_column("event_sessions", "venue_lat")
