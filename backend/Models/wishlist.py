"""
Wishlist items — events a customer has saved for later.
"""

import uuid
from datetime import datetime
from sqlalchemy import Column, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship

from Models.base import Base, GUID


class WishlistItem(Base):
    __tablename__ = "wishlist_items"
    __table_args__ = (
        UniqueConstraint("customer_id", "event_id", name="uq_wishlist_customer_event"),
    )

    id = Column(GUID, primary_key=True, default=uuid.uuid4, index=True)
    customer_id = Column(String(50), ForeignKey("users.customer_id", onupdate="CASCADE", ondelete="CASCADE"), nullable=False, index=True)
    event_id = Column(GUID, ForeignKey("events.id", ondelete="CASCADE"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=True)

    event = relationship("Event")

    def __repr__(self):
        return f"<WishlistItem(customer_id={self.customer_id}, event_id={self.event_id})>"
