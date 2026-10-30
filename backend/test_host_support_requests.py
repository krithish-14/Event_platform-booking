"""Host Help & Support: event cancellation needs admin approval before the host can cancel.

Runs against a throwaway SQLite file with the real routers mounted; email and rate limits are stubbed.
"""
import os
import shutil
import tempfile
import unittest
import uuid
from datetime import datetime, timedelta
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import Models  # noqa: F401  (registers every table)
from Authentication.dependencies import get_current_admin, get_current_user, get_current_user_optional
from Models.base import Base, get_db
from Models.event import Event
from Models.event_management import EventManagement
from Models.user import User

CANCEL_BODY = {
    "category": "event_cancellation",
    "subject": "Cancel my event please",
    "message": "The venue is no longer available on the event date, so we need to cancel.",
}


class HostSupportTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "support.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)

        from APIs.admin import router as admin_router
        from APIs.events import router as events_router
        from APIs.host_events_api import router as host_router
        from APIs.support import router as support_router

        app = FastAPI()
        app.include_router(support_router, prefix="/api/support")
        app.include_router(admin_router, prefix="/api/admin")
        app.include_router(host_router, prefix="/api/host-events")
        app.include_router(events_router, prefix="/api/events")

        def _db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        self.current = {"user": None}
        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = lambda: self.current["user"]
        app.dependency_overrides[get_current_user_optional] = lambda: self.current["user"]
        app.dependency_overrides[get_current_admin] = lambda: self.admin
        self.client = TestClient(app)

        self.patches = [
            mock.patch("APIs.support.limit_support", lambda *a, **k: None),
            mock.patch("Services.email.send_email", return_value=True),
            mock.patch("APIs.admin.send_email", return_value=True),
        ]
        for p in self.patches:
            p.start()

        db = self.Session()
        self.host = self._user(db, "CUST-HOST01", "host@example.com", "Host One")
        self.other = self._user(db, "CUST-HOST02", "other@example.com", "Host Two")
        self.admin = self._user(db, "CUST-ADMIN1", "admin@example.com", "Admin")
        self.event_id = uuid.uuid4()
        start = datetime.utcnow() + timedelta(days=10)
        db.add(EventManagement(
            event_id=self.event_id, event_title="Example Fest", organizer_email="host@example.com",
            customer_id="CUST-HOST01", host_id="HST-HOST01", event_status="published",
            event_start_date=start, event_end_date=start + timedelta(hours=4),
        ))
        db.add(Event(id=self.event_id, title="Example Fest", start_date=start, customer_id="CUST-HOST01"))
        self.draft_id = uuid.uuid4()
        db.add(EventManagement(
            event_id=self.draft_id, event_title="Draft Idea", organizer_email="host@example.com",
            customer_id="CUST-HOST01", host_id="HST-HOST01", event_status="draft",
        ))
        db.commit()
        db.close()
        self.current["user"] = self.host

    def tearDown(self):
        for p in self.patches:
            p.stop()
        self.client.close()
        self.engine.dispose()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def _user(self, db, cid, email, name):
        user = User(customer_id=cid, email=email, username=email.split("@")[0], full_name=name, hashed_password="x")
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user

    def status(self, event_id=None):
        return self.client.get("/api/support/host/cancellation-status", params={"event_id": str(event_id or self.event_id)})

    def cancel(self, event_id=None):
        return self.client.delete("/api/host-events/clear", params={"email": "host@example.com", "event_id": str(event_id or self.event_id)})

    def request_cancel(self):
        return self.client.post("/api/support/host/requests", json={**CANCEL_BODY, "event_id": str(self.event_id)})

    def decide(self, code, action, note=None):
        return self.client.post(f"/api/admin/support-tickets/{code}/decision", json={"action": action, "note": note})

    def event_status(self):
        db = self.Session()
        try:
            return db.query(EventManagement).filter(EventManagement.event_id == self.event_id).first().event_status
        finally:
            db.close()

    def test_cancel_blocked_until_admin_approves(self):
        self.assertEqual(self.status().json()["state"], "none")
        blocked = self.cancel()
        self.assertEqual(blocked.status_code, 403, blocked.text)
        self.assertIn("admin must approve", blocked.json()["detail"])
        self.assertEqual(self.event_status(), "published")

        created = self.request_cancel()
        self.assertEqual(created.status_code, 201, created.text)
        ticket = created.json()
        self.assertEqual(ticket["decision"], "pending")
        self.assertEqual(ticket["event_title"], "Example Fest")
        self.assertTrue(ticket["ticket_code"].startswith("THP-"))
        self.assertEqual(self.status().json()["state"], "pending")
        self.assertEqual(self.cancel().status_code, 403)

        duplicate = self.request_cancel()
        self.assertEqual(duplicate.status_code, 409)
        self.assertIn(ticket["ticket_code"], duplicate.json()["detail"])

        approved = self.decide(ticket["ticket_code"], "approve")
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(approved.json()["ticket"]["decision"], "approved")
        self.assertEqual(self.status().json()["state"], "approved")

        done = self.cancel()
        self.assertEqual(done.status_code, 200, done.text)
        self.assertEqual(self.event_status(), "cancelled")

    def test_rejection_needs_note_and_keeps_event(self):
        code = self.request_cancel().json()["ticket_code"]
        self.assertEqual(self.decide(code, "reject").status_code, 400)
        rejected = self.decide(code, "reject", "Tickets already sold; please reschedule instead.")
        self.assertEqual(rejected.status_code, 200, rejected.text)
        state = self.status().json()
        self.assertEqual(state["state"], "rejected")
        self.assertIn("reschedule", state["note"])
        self.assertEqual(self.cancel().status_code, 403)
        self.assertEqual(self.event_status(), "published")
        self.assertEqual(self.decide(code, "approve").status_code, 409)
        again = self.request_cancel()
        self.assertEqual(again.status_code, 201, again.text)
        self.assertEqual(self.status().json()["state"], "pending")

    def test_pending_cancellation_cannot_be_marked_solved(self):
        code = self.request_cancel().json()["ticket_code"]
        res = self.client.patch(f"/api/admin/support-tickets/{code}", json={"resolution_note": "done"})
        self.assertEqual(res.status_code, 400)

    def test_other_host_cannot_request_or_view(self):
        self.current["user"] = self.other
        res = self.request_cancel()
        self.assertEqual(res.status_code, 403, res.text)
        self.assertEqual(self.status().status_code, 403)

    def test_cancel_category_requires_event(self):
        res = self.client.post("/api/support/host/requests", json=CANCEL_BODY)
        self.assertEqual(res.status_code, 400)

    def test_general_host_request_and_list(self):
        res = self.client.post("/api/support/host/requests", json={
            "category": "payouts",
            "subject": "Payout timing question",
            "message": "When will the payout for last week's tickets reach my bank account?",
        })
        self.assertEqual(res.status_code, 201, res.text)
        self.assertIsNone(res.json()["decision"])
        self.request_cancel()
        rows = self.client.get("/api/support/host/requests").json()
        self.assertEqual({r["category"] for r in rows}, {"payouts", "event_cancellation"})
        bad = self.client.post("/api/support/host/requests", json={**CANCEL_BODY, "category": "bookings"})
        self.assertEqual(bad.status_code, 400)

    def test_draft_event_can_be_discarded_without_approval(self):
        res = self.cancel(self.draft_id)
        self.assertEqual(res.status_code, 200, res.text)

    def test_public_delete_route_also_needs_approval(self):
        res = self.client.delete(f"/api/events/{self.event_id}")
        self.assertEqual(res.status_code, 403, res.text)


if __name__ == "__main__":
    unittest.main()
