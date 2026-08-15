"""
Encrypted file blobs stored in the database (event media + KYC documents).
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, Boolean, DateTime, Integer, LargeBinary, Index

from Models.base import Base, GUID


class StoredFile(Base):
    __tablename__ = "stored_files"
    __table_args__ = (
        Index("ix_stored_files_legacy_path", "legacy_path", unique=True),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    owner_customer_id = Column(String(50), nullable=True, index=True)
    owner_email = Column(String(255), nullable=True, index=True)
    kind = Column(String(40), nullable=False, index=True)  # kyc | event_media
    purpose = Column(String(80), nullable=True)  # pan_card, cancelled_cheque, banner, ...
    original_filename = Column(String(255), nullable=True)
    content_type = Column(String(120), nullable=True)
    byte_size = Column(Integer, nullable=True)
    is_private = Column(Boolean, default=False, nullable=False)
    encrypted_data = Column(LargeBinary, nullable=False)
    encryption_version = Column(Integer, default=1, nullable=False)
    legacy_path = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)

    def __repr__(self):
        return f"<StoredFile(id={self.id}, kind={self.kind}, private={self.is_private})>"
