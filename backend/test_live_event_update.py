"""Published events: section "Update" saves refresh the public event page without an OTP republish.

Throwaway SQLite file with the real host-events router.
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
from Models.event import Event
from Models.event_management import EventManagement
from Models.user import User

EMAIL = "host@demo.local"


class LiveEventUpdate(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "live.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        db = self.Session()
        self.user = User(customer_id="CUST-100001", email=EMAIL, username="demohost", full_name="Demo Host", hashed_password="x")
        db.add(self.user)
        self.event_id = uuid.uuid4()
        start = datetime.utcnow() + timedelta(days=6)
        db.add(EventManagement(event_id=self.event_id, customer_id="CUST-100001", organizer_email=EMAIL, event_title="Old Title",
                               event_category="Workshops", event_status="published", venue="Old Hall", published_at=datetime.utcnow(),
                               event_start_date=start, event_end_date=start + timedelta(hours=3)))
        db.add(Event(id=self.event_id, title="Old Title", venue="Old Hall", location="Old Hall", start_date=start,
                     end_date=start + timedelta(hours=3), is_published=True, is_cancelled=False, customer_id="CUST-100001"))
        db.commit()
        db.refresh(self.user)
        db.expunge(self.user)
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

        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = lambda: self.user
        app.dependency_overrides[get_current_user_optional] = lambda: self.user
        self.client = TestClient(app)

    def tearDown(self):
        self.engine.dispose()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def public_row(self):
        db = self.Session()
        try:
            return db.query(Event).filter(Event.id == self.event_id).one()
        finally:
            db.close()

    def save(self, **extra):
        body = {"event_id": str(self.event_id), "organizer_email": EMAIL, "event_title": "New Title", "venue": "New Hall"}
        body.update(extra)
        res = self.client.post("/api/host-events/manage", json=body)
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_autosave_does_not_touch_the_live_page(self):
        self.save()
        row = self.public_row()
        self.assertEqual((row.title, row.venue), ("Old Title", "Old Hall"))

    def test_update_button_refreshes_live_page_without_otp(self):
        data = self.save(sync_live=True)
        self.assertTrue(data["catalog_synced"], data.get("catalog_sync_error"))
        row = self.public_row()
        self.assertEqual((row.title, row.venue), ("New Title", "New Hall"))
        self.assertTrue(row.is_published)

    def test_design_update_refreshes_live_page(self):
        self.save()
        res = self.client.post("/api/host-events/design", json={
            "event_id": str(self.event_id), "organizer_email": EMAIL, "about_event": "<p>Fresh details</p>", "sync_live": True,
        })
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["catalog_synced"], res.json().get("catalog_sync_error"))
        row = self.public_row()
        self.assertEqual(row.title, "New Title")
        self.assertIn("Fresh details", row.description or "")


if __name__ == "__main__":
    unittest.main()
