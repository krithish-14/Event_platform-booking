"""Theatre partner registration (movie hosts).

New table; Models/base.py create_all also creates it at startup.

Revision ID: 007_theatre_partners
Revises: 006_event_state_district
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "007_theatre_partners"
down_revision: Union[str, None] = "006_event_state_district"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if "theatre_partners" in sa.inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "theatre_partners",
        sa.Column("id", sa.CHAR(length=36), primary_key=True),
        sa.Column("customer_id", sa.String(length=50), nullable=True, index=True),
        sa.Column("email", sa.String(length=255), nullable=False, index=True),
        sa.Column("partner_code", sa.String(length=40), nullable=True, index=True),
        sa.Column("theatre_name", sa.String(length=255)),
        sa.Column("chain_name", sa.String(length=255)),
        sa.Column("theatre_address", sa.Text()),
        sa.Column("district", sa.String(length=120)),
        sa.Column("state", sa.String(length=120)),
        sa.Column("pincode", sa.String(length=10)),
        sa.Column("screens_json", sa.Text()),
        sa.Column("licence_number", sa.String(length=80)),
        sa.Column("licence_valid_till", sa.String(length=10)),
        sa.Column("licence_url", sa.String(length=500)),
        sa.Column("legal_name", sa.String(length=255)),
        sa.Column("pan_number", sa.String(length=20)),
        sa.Column("org_address", sa.Text()),
        sa.Column("has_gstin", sa.Boolean()),
        sa.Column("gstin_number", sa.Text()),
        sa.Column("contact_full_name", sa.String(length=200)),
        sa.Column("contact_email", sa.String(length=255)),
        sa.Column("contact_mobile", sa.String(length=20)),
        sa.Column("beneficiary_name", sa.String(length=200)),
        sa.Column("account_type", sa.String(length=50)),
        sa.Column("bank_name", sa.String(length=150)),
        sa.Column("account_number", sa.String(length=50)),
        sa.Column("bank_ifsc", sa.String(length=20)),
        sa.Column("pan_card_url", sa.String(length=500)),
        sa.Column("cancelled_cheque_url", sa.String(length=500)),
        sa.Column("accepted_undertaking", sa.Boolean()),
        sa.Column("accepted_agreement", sa.Boolean()),
        sa.Column("agreement_version", sa.String(length=40)),
        sa.Column("agreement_accepted_at", sa.DateTime()),
        sa.Column("agreement_accept_ip", sa.String(length=64)),
        sa.Column("agreement_acceptance_ref", sa.String(length=40)),
        sa.Column("status", sa.String(length=30), nullable=False, index=True),
        sa.Column("review_reason", sa.Text()),
        sa.Column("reviewed_by", sa.String(length=255)),
        sa.Column("reviewed_at", sa.DateTime()),
        sa.Column("submitted_at", sa.DateTime()),
        sa.Column("verified_at", sa.DateTime()),
        sa.Column("created_at", sa.DateTime()),
        sa.Column("updated_at", sa.DateTime()),
    )


def downgrade() -> None:
    op.drop_table("theatre_partners")
