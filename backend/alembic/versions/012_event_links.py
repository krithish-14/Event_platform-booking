"""Link a private event to another host's public event for shared check-in.

Also applied at startup by Models/base.py _migrate_tables (columns) and create_all (table).

Revision ID: 012_event_links
Revises: 011_members_tickets
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "012_event_links"
down_revision: Union[str, None] = "011_members_tickets"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ID = sa.CHAR(length=36)

_COLUMNS = (
    ("linked_event_id", sa.String(length=64)),
    ("link_status", sa.String(length=20)),
    ("link_requested_at", sa.DateTime()),
    ("link_decided_at", sa.DateTime()),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    existing = {c["name"] for c in inspector.get_columns("event_management")}
    for name, col_type in _COLUMNS:
        if name not in existing:
            op.add_column("event_management", sa.Column(name, col_type, nullable=True))
    if "event_link_checkins" not in inspector.get_table_names():
        op.create_table(
            "event_link_checkins",
            sa.Column("id", ID, primary_key=True),
            sa.Column("target_event_id", ID, nullable=False, index=True),
            sa.Column("source_event_id", ID, nullable=False, index=True),
            sa.Column("ticket_id", ID, nullable=False, index=True),
            sa.Column("session_key", sa.String(length=64), nullable=False, server_default=""),
            sa.Column("attendee_name", sa.String(length=255), nullable=True),
            sa.Column("attendee_email", sa.String(length=255), nullable=True),
            sa.Column("checked_in_by", sa.String(length=255), nullable=True),
            sa.Column("method", sa.String(length=20), nullable=True),
            sa.Column("checkin_time", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("target_event_id", "ticket_id", "session_key", name="uq_event_link_checkins_target_ticket_session"),
        )


def downgrade() -> None:
    op.drop_table("event_link_checkins")
    for name, _ in reversed(_COLUMNS):
        op.drop_column("event_management", name)
