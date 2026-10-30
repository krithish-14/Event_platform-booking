"""State and district for public events (from the venue pin).

Also applied at startup by Models/base.py _migrate_tables.

Revision ID: 006_event_state_district
Revises: 005_event_session_venue_location
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "006_event_state_district"
down_revision: Union[str, None] = "005_event_session_venue_location"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("events")}
    if "state" not in existing:
        op.add_column("events", sa.Column("state", sa.String(length=120), nullable=True))
    if "district" not in existing:
        op.add_column("events", sa.Column("district", sa.String(length=120), nullable=True))
    if "region_key" not in existing:
        op.add_column("events", sa.Column("region_key", sa.String(length=40), nullable=True))


def downgrade() -> None:
    op.drop_column("events", "region_key")
    op.drop_column("events", "district")
    op.drop_column("events", "state")
