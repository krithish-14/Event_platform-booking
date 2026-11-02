"""Members-only ticket offers: hidden on the public page, bookable only with the host's members link key.

Throwaway SQLite file with the real events router.
"""
import os
import shutil
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import Models  # noqa: F401  (registers every table)
from Models.base import Base, get_db
from Models.event import Event
from Models.event_management import EventManagement
from Services.ticket_pricing import calculate_order_price, normalize_ticket_list

KEY = "members-key-123"


class MembersTickets(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "members.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.db = self.Session()
        self.event_id = uuid.uuid4()
        tickets = normalize_ticket_list([
            {"name": "General", "ticket_kind": "main", "pricing_type": "per_person", "unit_price": 0, "qty": 150},
            {"name": "Members", "ticket_kind": "main", "pricing_type": "per_person", "unit_price": 0, "qty": 100, "members_only": True},
        ])
        self.general, self.members = tickets
        start = datetime.utcnow() + timedelta(days=4)
        self.db.add(EventManagement(event_id=self.event_id, organizer_email="host@demo.local", event_title="Annual Meet",
                                    event_status="published", tickets_json=tickets, members_key=KEY,
                                    event_start_date=start, event_end_date=start + timedelta(hours=4)))
        self.db.add(Event(id=self.event_id, title="Annual Meet", start_date=start, end_date=start + timedelta(hours=4),
                          is_published=True, is_cancelled=False, ticket_types=None))
        self.db.commit()

        from APIs.events import router as events_router

        app = FastAPI()
        app.include_router(events_router, prefix="/api/events")

        def _db():
            session = self.Session()
            try:
                yield session
            finally:
                session.close()

        app.dependency_overrides[get_db] = _db
        self.client = TestClient(app)

    def tearDown(self):
        self.db.close()
        self.engine.dispose()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def names(self, params=None):
        res = self.client.get(f"/api/events/public/{self.event_id}", params=params or {})
        self.assertEqual(res.status_code, 200, res.text)
        return [t["name"] for t in res.json()["ticket_types"]]

    def test_flag_is_normalised(self):
        self.assertTrue(self.members["members_only"])
        self.assertNotIn("members_only", self.general)
        again = normalize_ticket_list([dict(self.members, members_only="false")], [self.members])
        self.assertNotIn("members_only", again[0])

    def test_public_page_hides_members_offer(self):
        self.assertEqual(self.names(), ["General"])
        self.assertEqual(self.names({"access": "wrong"}), ["General"])
        self.assertEqual(self.names({"access": KEY}), ["General", "Members"])

    def test_checkout_needs_members_key(self):
        quote = calculate_order_price(self.db, str(self.event_id), offer_id=self.general["offer_id"])
        self.assertEqual(quote.offer_name, "General")
        for bad in ("", "wrong"):
            with self.assertRaises(HTTPException) as ctx:
                calculate_order_price(self.db, str(self.event_id), offer_id=self.members["offer_id"], access_key=bad)
            self.assertEqual(ctx.exception.status_code, 403)
        with self.assertRaises(HTTPException):
            calculate_order_price(self.db, str(self.event_id), ticket_name="Members")
        ok = calculate_order_price(self.db, str(self.event_id), offer_id=self.members["offer_id"], access_key=KEY)
        self.assertEqual(ok.offer_name, "Members")

    def test_private_event_link_unlocks_members_offers(self):
        host = self.db.query(EventManagement).filter(EventManagement.event_id == self.event_id).one()
        host.is_private = True
        self.db.commit()
        self.assertEqual(self.names(), ["General", "Members"])
        ok = calculate_order_price(self.db, str(self.event_id), offer_id=self.members["offer_id"], access_key="")
        self.assertEqual(ok.offer_name, "Members")

    def test_no_key_means_no_access(self):
        host = self.db.query(EventManagement).filter(EventManagement.event_id == self.event_id).one()
        host.members_key = None
        self.db.commit()
        self.assertEqual(self.names({"access": ""}), ["General"])
        with self.assertRaises(HTTPException):
            calculate_order_price(self.db, str(self.event_id), offer_id=self.members["offer_id"], access_key="")


if __name__ == "__main__":
    unittest.main()
