"""Event sessions, per-session eligibility, per-session check-ins, volunteer session scope.

The app also creates these tables at startup (Base.metadata.create_all) and adds
event_volunteers.session_ids in Models/base.py _migrate_tables, so this revision is for
environments that are managed with `alembic upgrade`. It only adds objects.
event_id / ticket_id have no FK to event_management / tickets (mixed UUID vs CHAR(36)
id types on live); the application validates them before every write.

Revision ID: 004_event_sessions
Revises: 003_ticket_offer_price_snapshots
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "004_event_sessions"
down_revision: Union[str, None] = "003_ticket_offer_price_snapshots"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _json_type():
    return sa.JSON().with_variant(postgresql.JSONB(), "postgresql")


def upgrade() -> None:
    op.create_table(
        "event_sessions",
        sa.Column("session_id", sa.CHAR(length=36), primary_key=True),
        sa.Column("event_id", sa.CHAR(length=36), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="1"),
        sa.Column("session_name", sa.String(length=200), nullable=False),
        sa.Column("session_description", sa.Text(), nullable=True),
        sa.Column("session_date", sa.Date(), nullable=False),
        sa.Column("start_time", sa.String(length=5), nullable=False),
        sa.Column("end_time", sa.String(length=5), nullable=False),
        sa.Column("ends_next_day", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("venue_name", sa.String(length=300), nullable=False),
        sa.Column("venue_address", sa.Text(), nullable=True),
        sa.Column("capacity", sa.Integer(), nullable=True),
        sa.Column("eligibility_mode", sa.String(length=30), nullable=False, server_default="registered"),
        sa.Column("eligible_ticket_types", _json_type(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="active"),
        sa.Column("created_by", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
    )
    op.create_index("ix_event_sessions_event_id", "event_sessions", ["event_id"])
    op.create_index("ix_event_sessions_status", "event_sessions", ["status"])
    op.create_index("ix_event_sessions_deleted_at", "event_sessions", ["deleted_at"])
    op.create_index("ix_event_sessions_event_position", "event_sessions", ["event_id", "position"])

    op.create_table(
        "event_session_registrations",
        sa.Column("session_registration_id", sa.CHAR(length=36), primary_key=True),
        sa.Column("session_id", sa.CHAR(length=36), sa.ForeignKey("event_sessions.session_id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", sa.CHAR(length=36), nullable=False),
        sa.Column("registration_status", sa.String(length=20), nullable=False, server_default="registered"),
        sa.Column("registered_by", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.UniqueConstraint("session_id", "ticket_id", name="uq_event_session_registrations_session_ticket"),
    )
    op.create_index("ix_event_session_registrations_session_id", "event_session_registrations", ["session_id"])
    op.create_index("ix_event_session_registrations_ticket_id", "event_session_registrations", ["ticket_id"])

    op.create_table(
        "event_session_checkins",
        sa.Column("checkin_id", sa.CHAR(length=36), primary_key=True),
        sa.Column("session_id", sa.CHAR(length=36), sa.ForeignKey("event_sessions.session_id", ondelete="CASCADE"), nullable=False),
        sa.Column("ticket_id", sa.CHAR(length=36), nullable=False),
        sa.Column("checkin_time", sa.DateTime(), nullable=False),
        sa.Column("checked_in_by", sa.String(length=255), nullable=True),
        sa.Column("volunteer_id", sa.CHAR(length=36), nullable=True),
        sa.Column("method", sa.String(length=20), nullable=True),
        sa.Column("checkin_status", sa.String(length=20), nullable=False, server_default="checked_in"),
        sa.UniqueConstraint("session_id", "ticket_id", name="uq_event_session_checkins_session_ticket"),
    )
    op.create_index("ix_event_session_checkins_session_id", "event_session_checkins", ["session_id"])
    op.create_index("ix_event_session_checkins_ticket_id", "event_session_checkins", ["ticket_id"])
    op.create_index("ix_event_session_checkins_checkin_time", "event_session_checkins", ["checkin_time"])
    op.create_index("ix_event_session_checkins_volunteer_id", "event_session_checkins", ["volunteer_id"])

    bind = op.get_bind()
    existing = {c["name"] for c in sa.inspect(bind).get_columns("event_volunteers")}
    if "session_ids" not in existing:
        op.add_column("event_volunteers", sa.Column("session_ids", _json_type(), nullable=True))


def downgrade() -> None:
    op.drop_column("event_volunteers", "session_ids")
    op.drop_table("event_session_checkins")
    op.drop_table("event_session_registrations")
    op.drop_table("event_sessions")
