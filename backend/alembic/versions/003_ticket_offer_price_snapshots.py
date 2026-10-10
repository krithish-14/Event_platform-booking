"""Store the server price snapshot on payment proofs.

Revision ID: 003_ticket_offer_price_snapshots
Revises: 002_google_auth_fields
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "003_ticket_offer_price_snapshots"
down_revision: Union[str, None] = "002_google_auth_fields"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("payment_proofs", sa.Column("offer_id", sa.String(length=64), nullable=True))
    op.add_column("payment_proofs", sa.Column("pricing_type", sa.String(length=20), nullable=True))
    op.add_column("payment_proofs", sa.Column("purchase_quantity", sa.Integer(), nullable=True))
    op.add_column("payment_proofs", sa.Column("attendee_count", sa.Integer(), nullable=True))
    op.add_column("payment_proofs", sa.Column("total_amount_paise", sa.Integer(), nullable=True))
    op.add_column("payment_proofs", sa.Column("currency", sa.String(length=8), nullable=True))
    op.create_index("ix_payment_proofs_offer_id", "payment_proofs", ["offer_id"])


def downgrade() -> None:
    op.drop_index("ix_payment_proofs_offer_id", table_name="payment_proofs")
    op.drop_column("payment_proofs", "currency")
    op.drop_column("payment_proofs", "total_amount_paise")
    op.drop_column("payment_proofs", "attendee_count")
    op.drop_column("payment_proofs", "purchase_quantity")
    op.drop_column("payment_proofs", "pricing_type")
    op.drop_column("payment_proofs", "offer_id")
