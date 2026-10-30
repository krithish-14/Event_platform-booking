"""Cast, crew and YouTube trailers for theatre movies.

Also applied at startup by Models/base.py _migrate_tables.

Revision ID: 009_cinema_movie_details
Revises: 008_cinema_booking
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "009_cinema_movie_details"
down_revision: Union[str, None] = "008_cinema_booking"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

COLUMNS = ("cast_json", "crew_json", "trailers_json")


def upgrade() -> None:
    existing = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("cinema_movies")}
    for name in COLUMNS:
        if name not in existing:
            op.add_column("cinema_movies", sa.Column(name, sa.Text(), nullable=True))


def downgrade() -> None:
    for name in reversed(COLUMNS):
        op.drop_column("cinema_movies", name)
