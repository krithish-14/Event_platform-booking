"""Movie booking: screens, movies, shows, seat locks, bookings.

New tables; Models/base.py create_all also creates them at startup.

Revision ID: 008_cinema_booking
Revises: 007_theatre_partners
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "008_cinema_booking"
down_revision: Union[str, None] = "007_theatre_partners"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

ID = sa.CHAR(length=36)


def upgrade() -> None:
    existing = set(sa.inspect(op.get_bind()).get_table_names())
    if "cinema_screens" not in existing:
        op.create_table(
            "cinema_screens",
            sa.Column("id", ID, primary_key=True),
            sa.Column("partner_id", ID, nullable=False, index=True),
            sa.Column("name", sa.String(60), nullable=False),
            sa.Column("screen_format", sa.String(20)),
            sa.Column("layout_json", sa.Text()),
            sa.Column("seat_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime()),
            sa.Column("updated_at", sa.DateTime()),
        )
    if "cinema_movies" not in existing:
        op.create_table(
            "cinema_movies",
            sa.Column("id", ID, primary_key=True),
            sa.Column("partner_id", ID, nullable=False, index=True),
            sa.Column("title", sa.String(200), nullable=False),
            sa.Column("language", sa.String(40), nullable=False),
            sa.Column("certificate", sa.String(10)),
            sa.Column("duration_min", sa.Integer(), nullable=False),
            sa.Column("genres", sa.String(200)),
            sa.Column("description", sa.Text()),
            sa.Column("poster_url", sa.String(500)),
            sa.Column("release_date", sa.String(10)),
            sa.Column("status", sa.String(20), nullable=False, server_default="active"),
            sa.Column("created_at", sa.DateTime()),
            sa.Column("updated_at", sa.DateTime()),
        )
    if "cinema_shows" not in existing:
        op.create_table(
            "cinema_shows",
            sa.Column("id", ID, primary_key=True),
            sa.Column("partner_id", ID, nullable=False, index=True),
            sa.Column("screen_id", ID, nullable=False, index=True),
            sa.Column("movie_id", ID, nullable=False, index=True),
            sa.Column("starts_at", sa.DateTime(), nullable=False, index=True),
            sa.Column("ends_at", sa.DateTime(), nullable=False),
            sa.Column("prices_json", sa.Text(), nullable=False),
            sa.Column("layout_json", sa.Text(), nullable=False),
            sa.Column("seat_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="scheduled", index=True),
            sa.Column("created_at", sa.DateTime()),
        )
    if "cinema_show_seats" not in existing:
        op.create_table(
            "cinema_show_seats",
            sa.Column("id", ID, primary_key=True),
            sa.Column("show_id", ID, nullable=False, index=True),
            sa.Column("seat_id", sa.String(12), nullable=False),
            sa.Column("booking_id", ID, nullable=False, index=True),
            sa.Column("status", sa.String(10), nullable=False, server_default="held"),
            sa.Column("expires_at", sa.DateTime()),
            sa.Column("created_at", sa.DateTime()),
            sa.UniqueConstraint("show_id", "seat_id", name="uq_cinema_show_seat"),
        )
    if "cinema_bookings" not in existing:
        op.create_table(
            "cinema_bookings",
            sa.Column("id", ID, primary_key=True),
            sa.Column("booking_code", sa.String(20), nullable=False, unique=True, index=True),
            sa.Column("show_id", ID, nullable=False, index=True),
            sa.Column("partner_id", ID, nullable=False, index=True),
            sa.Column("customer_id", sa.String(50), index=True),
            sa.Column("email", sa.String(255), nullable=False, index=True),
            sa.Column("name", sa.String(200)),
            sa.Column("phone", sa.String(20)),
            sa.Column("seats_json", sa.Text(), nullable=False),
            sa.Column("seat_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("amount_paise", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("platform_fee_paise", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("gst_paise", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("payout_paise", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("status", sa.String(20), nullable=False, server_default="held", index=True),
            sa.Column("hold_expires_at", sa.DateTime()),
            sa.Column("razorpay_order_id", sa.String(120), index=True),
            sa.Column("razorpay_payment_id", sa.String(120)),
            sa.Column("qr_token", sa.String(64), unique=True, index=True),
            sa.Column("confirmed_at", sa.DateTime()),
            sa.Column("checked_in_at", sa.DateTime()),
            sa.Column("created_at", sa.DateTime()),
            sa.Column("updated_at", sa.DateTime()),
        )


def downgrade() -> None:
    for name in ("cinema_bookings", "cinema_show_seats", "cinema_shows", "cinema_movies", "cinema_screens"):
        op.drop_table(name)
