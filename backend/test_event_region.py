"""State/district for public events: address parsing, background fill, API fields.

Uses a throwaway SQLite file; the Nominatim lookup is replaced with a fake.
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
from Models.base import Base, get_db
from Models.event import Event
from Services import event_region as region


class RegionFromAddressTests(unittest.TestCase):
    def test_state_district_preferred(self):
        self.assertEqual(
            region.region_from_address({"state": "Tamil Nadu", "state_district": "Chengalpattu District", "county": "Tambaram taluk"}),
            ("Tamil Nadu", "Chengalpattu"),
        )

    def test_county_used_unless_it_is_a_taluk(self):
        self.assertEqual(region.region_from_address({"state": "Kerala", "county": "Ernakulam"}), ("Kerala", "Ernakulam"))
        self.assertEqual(region.region_from_address({"state": "Kerala", "county": "Kochi taluk"}), ("Kerala", None))

    def test_single_district_territory(self):
        self.assertEqual(region.region_from_address({"state": "Chandigarh"}), ("Chandigarh", "Chandigarh"))

    def test_empty(self):
        self.assertEqual(region.region_from_address(None), (None, None))

    def test_region_key(self):
        self.assertEqual(region.region_key(13.08271, 80.27071), "13.0827,80.2707")
        self.assertIsNone(region.region_key(0, 0))
        self.assertIsNone(region.region_key(None, 80))
        self.assertIsNone(region.region_key(200, 80))


class FillAndApiTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "region.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)
        self.factory_patch = mock.patch.object(region, "get_session_factory", return_value=self.Session)
        self.factory_patch.start()
        region._cache.clear()

        start = datetime.utcnow() + timedelta(days=7)
        db = self.Session()
        self.pinned = uuid.uuid4()
        self.unpinned = uuid.uuid4()
        db.add(Event(id=self.pinned, title="Pinned Fest", venue="Tambaram", latitude=12.9249, longitude=80.1, start_date=start, end_date=start + timedelta(hours=3), is_published=True, is_cancelled=False))
        db.add(Event(id=self.unpinned, title="Text Only", venue="Anna Nagar, Chennai", start_date=start, end_date=start + timedelta(hours=3), is_published=True, is_cancelled=False))
        db.commit()
        db.close()
        self.calls = []

    def tearDown(self):
        self.factory_patch.stop()
        self.engine.dispose()
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fake_lookup(self, lat, lon):
        self.calls.append((lat, lon))
        return ("Tamil Nadu", "Chengalpattu")

    def row(self, event_id):
        db = self.Session()
        try:
            return db.query(Event).filter(Event.id == event_id).first()
        finally:
            db.close()

    def test_fill_once_then_again_when_pin_moves(self):
        self.assertEqual(region.fill_missing_regions(lookup=self.fake_lookup, pause=0), 1)
        ev = self.row(self.pinned)
        self.assertEqual((ev.state, ev.district, ev.region_key), ("Tamil Nadu", "Chengalpattu", "12.9249,80.1000"))
        self.assertEqual(region.fill_missing_regions(lookup=self.fake_lookup, pause=0), 0)
        self.assertEqual(len(self.calls), 1)

        db = self.Session()
        db.query(Event).filter(Event.id == self.pinned).update({"latitude": 13.0827, "longitude": 80.2707})
        db.commit()
        db.close()
        region.fill_missing_regions(lookup=lambda lat, lon: ("Tamil Nadu", "Chennai"), pause=0)
        self.assertEqual(self.row(self.pinned).district, "Chennai")

    def test_failed_lookup_retries_later(self):
        self.assertEqual(region.fill_missing_regions(lookup=lambda lat, lon: None, pause=0), 0)
        self.assertIsNone(self.row(self.pinned).region_key)
        self.assertEqual(region.fill_missing_regions(lookup=self.fake_lookup, pause=0), 1)

    def test_public_api_returns_region_and_schedules_fill(self):
        from APIs.events import router as events_router

        app = FastAPI()
        app.include_router(events_router, prefix="/api/events")

        def _db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        app.dependency_overrides[get_db] = _db
        with mock.patch.object(region, "lookup_region", side_effect=self.fake_lookup):
            with TestClient(app) as client:
                first = client.get("/api/events/public")
                self.assertEqual(first.status_code, 200, first.text)
                body = {row["title"]: row for row in first.json()}
                self.assertIn("state", body["Pinned Fest"])
                second = client.get("/api/events/public").json()
        rows = {row["title"]: row for row in second}
        self.assertEqual(rows["Pinned Fest"]["district"], "Chengalpattu")
        self.assertEqual(rows["Pinned Fest"]["state"], "Tamil Nadu")
        self.assertIsNone(rows["Text Only"]["district"])
        self.assertEqual(len(self.calls), 1)


if __name__ == "__main__":
    unittest.main()
