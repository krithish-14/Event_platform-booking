"""
Support tickets raised from Help & Support.
Public IDs use THP-#### so they never clash with booking / QR ticket codes.
"""

import random
import uuid

from sqlalchemy import Column, DateTime, String, Text, Uuid, text

from Models.base import Base
from Utils.datetimes import utc_now

_EXTRA_COLUMNS = (
	("resolution_note", "TEXT", "TEXT"),
	("resolved_at", "TIMESTAMP", "DATETIME"),
	("phone", "VARCHAR(50)", "VARCHAR(50)"),
	("event_id", "VARCHAR(64)", "VARCHAR(64)"),
	("event_title", "VARCHAR(300)", "VARCHAR(300)"),
	("decision", "VARCHAR(20)", "VARCHAR(20)"),
	("decided_at", "TIMESTAMP", "DATETIME"),
)


def ensure_support_ticket_columns(db) -> None:
	"""Add newer columns on databases created before they existed."""
	bind = db.get_bind()
	dialect = (bind.dialect.name if bind is not None else "") or ""
	for name, pg_type, sqlite_type in _EXTRA_COLUMNS:
		if dialect == "postgresql":
			sql = f"ALTER TABLE support_tickets ADD COLUMN IF NOT EXISTS {name} {pg_type}"
		else:
			sql = f"ALTER TABLE support_tickets ADD COLUMN {name} {sqlite_type}"
		try:
			db.execute(text(sql))
			db.commit()
		except Exception:
			db.rollback()


def generate_ticket_code():
	"""Help & Support ID, e.g. THP-1232 (not booking ticket IDs)."""
	return f"THP-{random.randint(1000, 9999)}"


class SupportTicket(Base):
	__tablename__ = "support_tickets"

	id = Column(Uuid(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
	ticket_code = Column(String(20), unique=True, nullable=False, index=True, default=generate_ticket_code)
	customer_id = Column(String(50), nullable=True, index=True)
	name = Column(String(200), nullable=False)
	email = Column(String(255), nullable=False, index=True)
	category = Column(String(80), nullable=False)
	priority = Column(String(20), default="normal", nullable=False)
	subject = Column(String(250), nullable=False)
	message = Column(Text, nullable=False)
	status = Column(String(30), default="open", nullable=False)
	phone = Column(String(50), nullable=True)
	resolution_note = Column(Text, nullable=True)
	resolved_at = Column(DateTime, nullable=True)
	# Host requests (e.g. event cancellation) that need an admin decision.
	event_id = Column(String(64), nullable=True, index=True)
	event_title = Column(String(300), nullable=True)
	decision = Column(String(20), nullable=True)
	decided_at = Column(DateTime, nullable=True)
	created_at = Column(DateTime, default=utc_now, nullable=True)
	updated_at = Column(DateTime, default=utc_now, onupdate=utc_now, nullable=True)

	def __repr__(self):
		return f"<SupportTicket(code={self.ticket_code}, email={self.email}, status={self.status})>"
