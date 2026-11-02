"""Linked events: a private event linked to another host's public event shares its check-in once approved.

Throwaway SQLite file with the real host-events router and two hosts.
"""
import os
import shutil
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import Models  # noqa: F401  (registers every table)
from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.base import Base, get_db
from Models.booking import Booking
from Models.event import Event
from Models.event_link import EventLinkCheckin
from Models.event_management import EventManagement
from Models.ticket import Ticket
from Models.user import User

PUBLIC_EMAIL = "stadium@demo.local"
CLUB_EMAIL = "club@demo.local"


class EventLinks(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "links.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        db = self.Session()
        self.public_host = User(customer_id="CUST-200001", email=PUBLIC_EMAIL, username="stadium", full_name="Stadium Host", hashed_password="x")
        self.club_host = User(customer_id="CUST-200002", email=CLUB_EMAIL, username="club", full_name="Club Host", hashed_password="x")
        buyer = User(customer_id="CUST-200003", email="fan@demo.local", username="fan", full_name="Fan", hashed_password="x")
        db.add_all([self.public_host, self.club_host, buyer])

        start = datetime.utcnow() + timedelta(days=3)
        self.public_id, self.private_id, self.other_id = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        self.ended_id = uuid.uuid4()
        rows = [
            (self.public_id, "CUST-200001", PUBLIC_EMAIL, "Big Concert", False, start),
            (self.private_id, "CUST-200002", CLUB_EMAIL, "Club Members Night", True, start),
            (self.other_id, "CUST-200002", "other@demo.local", "Other Expo", False, start),
            (self.ended_id, "CUST-200002", "old@demo.local", "Old Show", False, datetime.utcnow() - timedelta(days=5)),
        ]
        for eid, cust, email, title, private, when in rows:
            db.add(EventManagement(event_id=eid, customer_id=cust, organizer_email=email, event_title=title,
                                   event_category="Music", venue="Hall", event_status="published", is_private=private,
                                   published_at=datetime.utcnow(), event_start_date=when, event_end_date=when + timedelta(hours=4)))
            db.add(Event(id=eid, title=title, venue="Hall", location="Hall", start_date=when, end_date=when + timedelta(hours=4),
                         is_published=True, is_cancelled=False, customer_id=cust, is_private=private))

        def ticket_for(event_id, token):
            booking = Booking(booking_id=uuid.uuid4(), customer_id="CUST-200003", event_id=event_id,
                              receiver_name="Fan One", receiver_email="fan@demo.local")
            db.add(booking)
            db.add(Ticket(ticket_id=uuid.uuid4(), booking_id=booking.booking_id, event_id=event_id,
                          customer_id="CUST-200003", qr_token=token, ticket_status="VALID"))

        ticket_for(self.private_id, "PRIVATE-QR-0001")
        ticket_for(self.other_id, "OTHER-QR-0001")
        db.commit()
        for user in (self.public_host, self.club_host):
            db.refresh(user)
            db.expunge(user)
        db.close()

        from APIs.host_events_api import router as host_router

        app = FastAPI()
        app.include_router(host_router, prefix="/api/host-events")

        def _db():
            session = self.Session()
            try:
                yield session
            finally:
                session.close()

        self.current = self.club_host
        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = lambda: self.current
        app.dependency_overrides[get_current_user_optional] = lambda: self.current
        self.client = TestClient(app)

    def tearDown(self):
        self.engine.dispose()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # helpers
    def as_club(self):
        self.current = self.club_host
        return CLUB_EMAIL

    def as_public(self):
        self.current = self.public_host
        return PUBLIC_EMAIL

    def request_link(self, target=None):
        email = self.as_club()
        res = self.client.post("/api/host-events/manage", json={
            "event_id": str(self.private_id), "organizer_email": email,
            "is_private": True, "linked_event_id": str(target or self.public_id),
        })
        return res

    def decide(self, approve=True):
        email = self.as_public()
        return self.client.post(f"/api/host-events/link-requests/{self.private_id}/decision",
                                json={"organizer_email": email, "approve": approve})

    def scan(self, event_id, code):
        email = self.as_public() if event_id == self.public_id else self.as_club()
        return self.client.post("/api/host-events/registrations/checkin", json={
            "event_id": str(event_id), "organizer_email": email, "qr_token": code, "scan_method": "qr",
        })

    def private_ticket(self):
        db = self.Session()
        try:
            return db.query(Ticket).filter(Ticket.qr_token == "PRIVATE-QR-0001").one()
        finally:
            db.close()

    # tests
    def test_linkable_list_shows_other_hosts_live_public_events(self):
        email = self.as_club()
        res = self.client.get("/api/host-events/linkable-events", params={"email": email})
        self.assertEqual(res.status_code, 200, res.text)
        titles = {row["event_title"] for row in res.json()["events"]}
        self.assertIn("Big Concert", titles)
        self.assertIn("Other Expo", titles)
        self.assertNotIn("Club Members Night", titles)  # private and own
        self.assertNotIn("Old Show", titles)  # ended

    def test_link_request_starts_pending_and_does_not_open_the_gate(self):
        res = self.request_link()
        self.assertEqual(res.status_code, 200, res.text)
        event = res.json()["event"]
        self.assertEqual(event["link_status"], "pending")
        self.assertEqual(event["linked_event"]["event_title"], "Big Concert")
        self.assertEqual(self.scan(self.public_id, "PRIVATE-QR-0001").status_code, 404)

    def test_only_public_host_can_decide(self):
        self.request_link()
        email = self.as_club()
        res = self.client.post(f"/api/host-events/link-requests/{self.private_id}/decision",
                               json={"organizer_email": email, "approve": True})
        self.assertEqual(res.status_code, 403, res.text)
        email = self.as_public()
        listed = self.client.get("/api/host-events/link-requests", params={"email": email}).json()["requests"]
        self.assertEqual([r["private_event_title"] for r in listed], ["Club Members Night"])
        self.assertEqual(self.decide(True).json()["link_status"], "approved")

    def test_approved_link_one_qr_checks_in_at_both_events(self):
        self.request_link()
        self.decide(True)
        first = self.scan(self.public_id, "PRIVATE-QR-0001")
        self.assertEqual(first.status_code, 200, first.text)
        body = first.json()
        self.assertTrue(body["valid"], body)
        self.assertTrue(body["linked_event"])
        self.assertEqual(body["linked_event_title"], "Club Members Night")
        again = self.scan(self.public_id, "PRIVATE-QR-0001").json()
        self.assertFalse(again["valid"])
        self.assertTrue(again["already_checked_in"])
        self.assertEqual(again["status"], "already_used")
        # The ticket itself is untouched, so it still works at its own event.
        self.assertEqual(self.private_ticket().ticket_status, "VALID")
        own = self.scan(self.private_id, "PRIVATE-QR-0001").json()
        self.assertTrue(own["valid"], own)
        self.assertEqual(self.private_ticket().ticket_status, "USED")
        db = self.Session()
        try:
            self.assertEqual(db.query(EventLinkCheckin).count(), 1)
        finally:
            db.close()

    def test_rejected_or_revoked_link_closes_the_gate(self):
        self.request_link()
        self.decide(True)
        self.decide(False)
        self.assertEqual(self.scan(self.public_id, "PRIVATE-QR-0001").status_code, 404)

    def test_unrelated_event_ticket_is_rejected(self):
        self.assertEqual(self.scan(self.public_id, "OTHER-QR-0001").status_code, 404)

    def test_switching_to_public_clears_the_link(self):
        self.request_link()
        self.decide(True)
        email = self.as_club()
        res = self.client.post("/api/host-events/manage", json={
            "event_id": str(self.private_id), "organizer_email": email, "is_private": False,
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertIsNone(res.json()["event"]["link_status"])
        self.assertEqual(self.scan(self.public_id, "PRIVATE-QR-0001").status_code, 404)

    def test_cannot_link_to_own_or_ended_event(self):
        db = self.Session()
        try:
            other = db.query(EventManagement).filter(EventManagement.event_id == self.other_id).one()
            other.organizer_email = CLUB_EMAIL
            db.commit()
        finally:
            db.close()
        self.assertEqual(self.request_link(self.other_id).status_code, 400)
        self.assertEqual(self.request_link(self.ended_id).status_code, 400)


if __name__ == "__main__":
    unittest.main()
