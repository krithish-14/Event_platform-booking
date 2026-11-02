"""Private (link-only) events: hidden from every public list, still bookable from their own page.

Throwaway SQLite file with the real events router.
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
from AI.recommendations import get_recommended_events
from Models.base import Base, get_db
from Models.event import Event
from Models.event_management import EventManagement
from Models.notification import EventAnnouncement
from Services.event_service import get_public_event_by_id, list_events, list_nearby_events, search_events
from Services.notifications import ensure_published_event_announcement


class PrivateEvents(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "events.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.db = self.Session()
        start = datetime.utcnow() + timedelta(days=3)
        common = dict(start_date=start, end_date=start + timedelta(hours=3), is_published=True, is_cancelled=False,
                      category="Workshops", venue="Anna Salai, Chennai", location="Chennai", latitude=13.06, longitude=80.26)
        self.public = Event(id=uuid.uuid4(), title="Pottery Demo Open Day", is_private=False, **common)
        self.private = Event(id=uuid.uuid4(), title="Pottery Demo Family Session", is_private=True, **common)
        self.legacy = Event(id=uuid.uuid4(), title="Pottery Demo Legacy", is_private=None, **common)
        self.db.add_all([self.public, self.private, self.legacy])
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

    def titles(self, rows):
        return sorted(r.title for r in rows)

    def test_lists_and_search_skip_private(self):
        listed = ["Pottery Demo Legacy", "Pottery Demo Open Day"]
        self.assertEqual(self.titles(list_events(self.db)), listed)
        self.assertEqual(self.titles(list_events(self.db, category="Workshops")), listed)
        self.assertEqual(self.titles(search_events(self.db, "pottery")), listed)
        self.assertEqual(self.titles(e for e, _ in list_nearby_events(self.db, 13.06, 80.26)), listed)
        self.assertEqual(self.titles(get_recommended_events(self.db)), listed)

    def test_private_page_still_opens(self):
        found = get_public_event_by_id(self.db, self.private.id)
        self.assertIsNotNone(found)
        res = self.client.get(f"/api/events/public/{self.private.id}")
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(res.json()["is_private"])
        self.assertFalse(self.client.get(f"/api/events/public/{self.public.id}").json()["is_private"])

    def test_public_api_list_and_search(self):
        listed = {e["title"] for e in self.client.get("/api/events/public").json()}
        self.assertNotIn("Pottery Demo Family Session", listed)
        self.assertIn("Pottery Demo Open Day", listed)
        searched = {e["title"] for e in self.client.get("/api/events/search", params={"q": "family"}).json()}
        self.assertEqual(searched, set())

    def test_no_broadcast_announcement_for_private(self):
        self.assertIsNone(ensure_published_event_announcement(self.db, self.private.id, self.private.title, event=self.private))
        self.assertIsNotNone(ensure_published_event_announcement(self.db, self.public.id, self.public.title, event=self.public))
        self.assertEqual(self.db.query(EventAnnouncement).count(), 1)

    def test_host_publish_and_toggle(self):
        from APIs.host_events_api import sync_event_visibility_to_catalog, sync_published_event_to_public_catalog

        mgt = EventManagement(event_id=uuid.uuid4(), organizer_email="host@demo.local", event_title="Pottery Demo Members Night",
                              event_category="Workshops", event_status="published", is_private=True, venue="Chennai",
                              event_start_date=datetime.utcnow() + timedelta(days=5),
                              event_end_date=datetime.utcnow() + timedelta(days=5, hours=2))
        self.db.add(mgt)
        self.db.commit()
        sync_published_event_to_public_catalog(self.db, mgt)
        row = self.db.query(Event).filter(Event.id == mgt.event_id).one()
        self.assertTrue(row.is_published)
        self.assertTrue(row.is_private)
        self.assertNotIn("Pottery Demo Members Night", self.titles(list_events(self.db)))
        self.assertEqual(self.db.query(EventAnnouncement).filter(EventAnnouncement.event_id == mgt.event_id).count(), 0)

        mgt.is_private = False
        self.db.commit()
        sync_event_visibility_to_catalog(self.db, mgt)
        self.db.expire_all()
        self.assertFalse(self.db.query(Event).filter(Event.id == mgt.event_id).one().is_private)
        self.assertIn("Pottery Demo Members Night", self.titles(list_events(self.db)))


if __name__ == "__main__":
    unittest.main()
