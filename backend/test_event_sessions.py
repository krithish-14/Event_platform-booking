"""Multi-session events: API, eligibility, per-session check-in, concurrency, and legacy flows.

Runs against a throwaway SQLite file with the real routers mounted; no production DB,
email, or payment calls.
"""
import os
import shutil
import tempfile
import threading
import unittest
import uuid
from datetime import datetime
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import Models  # noqa: F401  (registers every table)
from Authentication.dependencies import get_current_user
from Models.base import Base, get_db
from Models.booking import Booking
from Models.event import Event
from Models.event_management import EventManagement
from Models.event_session import EventSession, EventSessionCheckin
from Models.event_volunteer import EventVolunteer, VolunteerCheckin
from Models.ticket import Ticket
from Models.user import User
from Services import event_sessions as svc


DAY = "2026-11-15"
MORNING = datetime(2026, 11, 15, 8, 30)
AFTERNOON = datetime(2026, 11, 15, 11, 30)


class SessionTestBase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "sessions.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)

        from APIs.event_sessions import router as sessions_router
        from APIs.tickets import router as tickets_router
        from APIs.volunteers import router as volunteers_router

        app = FastAPI()
        app.include_router(sessions_router, prefix="/api/events")
        app.include_router(tickets_router, prefix="/api/tickets")
        app.include_router(volunteers_router, prefix="/api/volunteers")

        def _db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        self.current = {"user": None}
        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = lambda: self.current["user"]
        self.client = TestClient(app)

        db = self.Session()
        self.host = self._user(db, "CUST-HOST01", "host@example.com", "Host One")
        self.other_host = self._user(db, "CUST-HOST02", "other@example.com", "Host Two")
        self.volunteer_user = self._user(db, "CUST-VOL001", "vol@example.com", "Gate Volunteer")
        self.attendee_user = self._user(db, "CUST-ATT001", "buyer@example.com", "Ticket Buyer")
        self.event_id = uuid.uuid4()
        db.add(EventManagement(
            event_id=self.event_id, event_title="Example Conference", organizer_email="host@example.com",
            customer_id="CUST-HOST01", host_id="HST-HOST01", event_status="published",
            tickets_json=[{"name": "Full Pass"}, {"name": "Afternoon Pass"}],
        ))
        db.add(Event(id=self.event_id, title="Example Conference", start_date=datetime(2026, 11, 15, 8, 0), customer_id="CUST-HOST01"))
        db.commit()
        db.close()
        self.as_user(self.host)

    def tearDown(self):
        self.client.close()
        self.engine.dispose()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # helpers
    def _user(self, db, cid, email, name):
        user = User(customer_id=cid, email=email, username=email.split("@")[0], full_name=name, hashed_password="x")
        db.add(user)
        db.commit()
        db.refresh(user)
        db.expunge(user)
        return user

    def as_user(self, user):
        self.current["user"] = user

    def make_tickets(self, count, ticket_type, event_id=None):
        db = self.Session()
        tokens = []
        for i in range(count):
            booking = Booking(
                customer_id="CUST-ATT001", event_id=event_id or self.event_id, ticket_type=ticket_type,
                quantity=1, total_price=0, status="CONFIRMED", receiver_name=f"{ticket_type} Attendee {i + 1}",
                receiver_email=f"{ticket_type.replace(' ', '').lower()}{i + 1}@example.com",
            )
            db.add(booking)
            db.flush()
            token = f"JOD-TKT-{uuid.uuid4().hex.upper()}"
            db.add(Ticket(booking_id=booking.booking_id, event_id=booking.event_id, customer_id="CUST-ATT001",
                          ticket_type=ticket_type, qr_token=token, ticket_status="VALID"))
            tokens.append(token)
        db.commit()
        db.close()
        return tokens

    def session_body(self, name, start, end, venue, **extra):
        body = {"session_name": name, "session_date": DAY, "start_time": start, "end_time": end,
                "venue_name": venue, "venue_address": f"{venue} address", "status": "active"}
        body.update(extra)
        return body

    def save(self, structure, sessions, event_id=None):
        return self.client.put(f"/api/events/{event_id or self.event_id}/sessions", json={"structure": structure, "sessions": sessions})

    def checkin(self, session_id, token, at):
        with mock.patch.object(svc, "now_ist", return_value=at):
            return self.client.post(f"/api/events/{self.event_id}/sessions/{session_id}/check-in", json={"qr_token": token}).json()

    def conference(self):
        res = self.save("multiple", [
            self.session_body("Morning Session", "08:15 AM", "10:45 AM", "Venue A",
                              eligibility_mode="ticket_types", eligible_ticket_types=["Full Pass"]),
            self.session_body("Afternoon Session", "11:15", "13:00", "Venue B",
                              eligibility_mode="ticket_types", eligible_ticket_types=["Full Pass", "Afternoon Pass"]),
        ])
        self.assertEqual(res.status_code, 200, res.text)
        s1, s2 = res.json()["sessions"]
        return s1["session_id"], s2["session_id"]


class SingleSessionTests(SessionTestBase):
    def test_single_session_checkin_and_duplicate(self):
        res = self.save("single", [self.session_body("Main Session", "08:15", "10:45", "Hall 1")])
        self.assertEqual(res.status_code, 200, res.text)
        body = res.json()
        self.assertEqual(body["structure"], "single")
        session = body["sessions"][0]
        self.assertEqual(session["eligibility_mode"], "all_attendees")
        token = self.make_tickets(1, "Full Pass")[0]

        ok = self.checkin(session["session_id"], token, MORNING)
        self.assertTrue(ok["success"], ok)
        self.assertEqual(ok["checkin_status"], "checked_in")
        self.assertEqual(ok["session_name"], "Main Session")
        dup = self.checkin(session["session_id"], token, MORNING)
        self.assertFalse(dup["success"])
        self.assertEqual(dup["error_code"], "ALREADY_CHECKED_IN")

    def test_single_session_rejects_second_session(self):
        self.save("single", [self.session_body("Main", "08:00", "09:00", "Hall")])
        res = self.save("single", [self.session_body("A", "08:00", "09:00", "Hall"), self.session_body("B", "10:00", "11:00", "Hall")])
        self.assertEqual(res.status_code, 422)


class MultiSessionConfigTests(SessionTestBase):
    def test_two_then_three_sessions_saved_in_order(self):
        res = self.save("multiple", [
            self.session_body("Session 1", "08:00", "09:00", "Venue A"),
            self.session_body("Session 2", "10:00", "11:00", "Venue B"),
        ])
        self.assertEqual(res.status_code, 200, res.text)
        saved = res.json()["sessions"]
        self.assertEqual([s["session_name"] for s in saved], ["Session 1", "Session 2"])

        payload = [
            dict(self.session_body("Session 1", "08:00", "09:00", "Venue A"), session_id=saved[0]["session_id"]),
            dict(self.session_body("Session 2", "10:00", "11:00", "Venue B"), session_id=saved[1]["session_id"]),
            self.session_body("Session 3", "14:00", "15:30", "Venue C", capacity=40),
        ]
        res = self.save("multiple", payload)
        self.assertEqual(res.status_code, 200, res.text)
        listed = self.client.get(f"/api/events/{self.event_id}/sessions").json()["sessions"]
        self.assertEqual([s["session_name"] for s in listed], ["Session 1", "Session 2", "Session 3"])
        self.assertEqual(listed[2]["capacity"], 40)
        self.assertEqual(listed[2]["venue_name"], "Venue C")
        self.assertEqual(listed[0]["session_id"], saved[0]["session_id"])

    def test_session_venue_map_location_persists(self):
        res = self.save("multiple", [
            self.session_body("Morning", "08:00", "09:00", "Venue A", venue_lat=13.0827, venue_lng=80.2707, venue_place_id="place-a"),
            self.session_body("Afternoon", "11:00", "12:00", "Venue B", venue_lat=12.9716, venue_lng=77.5946),
        ])
        self.assertEqual(res.status_code, 200, res.text)
        listed = self.client.get(f"/api/events/{self.event_id}/sessions").json()["sessions"]
        self.assertAlmostEqual(listed[0]["venue_lat"], 13.0827)
        self.assertEqual(listed[0]["venue_place_id"], "place-a")
        self.assertAlmostEqual(listed[1]["venue_lng"], 77.5946)
        bad = self.save("multiple", [self.session_body("X", "08:00", "09:00", "V", venue_lat=200, venue_lng=10)])
        self.assertEqual(bad.status_code, 422)

    def test_validation_messages(self):
        res = self.save("multiple", [self.session_body("Late", "10:00", "09:00", "Venue A")])
        self.assertEqual(res.status_code, 422)
        self.assertIn("end_time", res.json()["detail"]["errors"])
        res = self.save("multiple", [self.session_body("", "09:00", "10:00", "")])
        errors = res.json()["detail"]["errors"]
        self.assertIn("session_name", errors)
        self.assertIn("venue_name", errors)
        overnight = self.save("multiple", [self.session_body("Night", "22:00", "01:00", "Club", ends_next_day=True)])
        self.assertEqual(overnight.status_code, 200, overnight.text)
        night = overnight.json()["sessions"][0]
        self.assertTrue(night["ends_at"].startswith("2026-11-16T01:00"))


class ConferenceScenarioTests(SessionTestBase):
    def test_shared_and_afternoon_only_attendees(self):
        s1, s2 = self.conference()
        full = self.make_tickets(100, "Full Pass")
        afternoon = self.make_tickets(150, "Afternoon Pass")

        overview = self.client.get(f"/api/events/{self.event_id}/sessions").json()
        counts = {s["session_name"]: s["eligible_count"] for s in overview["sessions"]}
        self.assertEqual(counts, {"Morning Session": 100, "Afternoon Session": 250})
        self.assertEqual(overview["unique_attendees"], 250)
        self.assertEqual(overview["total_session_registrations"], 350)

        # Test 3: shared attendees check in to both sessions.
        for token in full:
            self.assertTrue(self.checkin(s1, token, MORNING)["success"])
        for token in full:
            self.assertTrue(self.checkin(s2, token, AFTERNOON)["success"])

        # Test 4: afternoon-only attendees.
        for token in afternoon[:10]:
            res = self.checkin(s1, token, MORNING)
            self.assertEqual(res["error_code"], "SESSION_NOT_ELIGIBLE", res)
        for token in afternoon:
            self.assertTrue(self.checkin(s2, token, AFTERNOON)["success"])

        overview = self.client.get(f"/api/events/{self.event_id}/sessions").json()
        by_name = {s["session_name"]: s for s in overview["sessions"]}
        self.assertEqual(by_name["Morning Session"]["checked_in_count"], 100)
        self.assertEqual(by_name["Morning Session"]["pending_count"], 0)
        self.assertEqual(by_name["Afternoon Session"]["checked_in_count"], 250)
        self.assertEqual(overview["unique_checked_in"], 250)
        self.assertEqual(overview["total_session_checkins"], 350)

        db = self.Session()
        self.assertEqual(db.query(EventSessionCheckin).count(), 350)
        self.assertEqual(db.query(Ticket).filter(Ticket.ticket_status == "USED").count(), 250)
        db.close()

    def test_duplicate_scan_only_counts_once_per_session(self):
        s1, s2 = self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        self.assertTrue(self.checkin(s1, token, MORNING)["success"])
        dup = self.checkin(s1, token, MORNING)
        self.assertEqual(dup["error_code"], "ALREADY_CHECKED_IN")
        self.assertTrue(self.checkin(s2, token, AFTERNOON)["success"])
        db = self.Session()
        self.assertEqual(db.query(EventSessionCheckin).count(), 2)
        db.close()

    def test_explicit_registration_mode(self):
        res = self.save("multiple", [
            self.session_body("Workshop", "09:00", "10:00", "Room 1", eligibility_mode="registered", capacity=2),
            self.session_body("Keynote", "11:00", "12:00", "Hall", eligibility_mode="all_attendees"),
        ])
        workshop = res.json()["sessions"][0]["session_id"]
        tokens = self.make_tickets(3, "Full Pass")
        rows = self.client.get(f"/api/events/{self.event_id}/sessions/{workshop}/registrations").json()["attendees"]
        self.assertEqual(sum(1 for r in rows if r["eligible"]), 0)
        ids = [r["ticket_id"] for r in rows]
        self.assertEqual(self.client.post(f"/api/events/{self.event_id}/sessions/{workshop}/registrations",
                                          json={"ticket_ids": ids[:2], "action": "register"}).status_code, 200)
        over = self.client.post(f"/api/events/{self.event_id}/sessions/{workshop}/registrations",
                                json={"ticket_ids": ids[2:], "action": "register"})
        self.assertEqual(over.status_code, 422)
        at = datetime(2026, 11, 15, 9, 15)
        registered = {r["ticket_id"] for r in self.client.get(f"/api/events/{self.event_id}/sessions/{workshop}/registrations").json()["attendees"] if r["eligible"]}
        by_id = self._token_by_ticket(tokens)
        for tid, token in by_id.items():
            res = self.checkin(workshop, token, at)
            if tid in registered:
                self.assertTrue(res["success"], res)
            else:
                self.assertEqual(res["error_code"], "SESSION_NOT_ELIGIBLE")

    def _token_by_ticket(self, tokens):
        db = self.Session()
        out = {str(t.ticket_id): t.qr_token for t in db.query(Ticket).filter(Ticket.qr_token.in_(tokens)).all()}
        db.close()
        return out

    def test_checkin_window_and_status(self):
        s1, _ = self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        early = self.checkin(s1, token, datetime(2026, 11, 15, 6, 0))
        self.assertEqual(early["error_code"], "SESSION_NOT_OPEN")
        self.client.put(f"/api/events/{self.event_id}/sessions/{s1}", json={"status": "inactive"})
        paused = self.checkin(s1, token, MORNING)
        self.assertEqual(paused["error_code"], "SESSION_NOT_ACTIVE")

    def test_attendee_attendance_across_sessions(self):
        s1, s2 = self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        self.checkin(s1, token, MORNING)
        res = self.client.get(f"/api/events/{self.event_id}/attendees/{token}/attendance").json()
        self.assertEqual(res["sessions_eligible"], 2)
        self.assertEqual(res["sessions_attended"], 1)

    def test_csv_export_and_filters(self):
        s1, _ = self.conference()
        tokens = self.make_tickets(3, "Full Pass")
        self.checkin(s1, tokens[0], MORNING)
        pending = self.client.get(f"/api/events/{self.event_id}/sessions/{s1}/attendance?filter=pending").json()
        self.assertEqual(pending["count"], 2)
        csv_res = self.client.get(f"/api/events/{self.event_id}/sessions/{s1}/attendance?format=csv")
        self.assertEqual(csv_res.status_code, 200)
        self.assertIn("text/csv", csv_res.headers["content-type"])
        self.assertEqual(len(csv_res.text.strip().splitlines()), 4)


class AuthorizationTests(SessionTestBase):
    def test_other_host_cannot_change_sessions(self):
        s1, _ = self.conference()
        self.as_user(self.other_host)
        self.assertEqual(self.save("multiple", [self.session_body("Hijack", "08:00", "09:00", "X")]).status_code, 403)
        self.assertEqual(self.client.put(f"/api/events/{self.event_id}/sessions/{s1}", json={"session_name": "X"}).status_code, 403)
        self.assertEqual(self.client.delete(f"/api/events/{self.event_id}/sessions/{s1}?confirm=true").status_code, 403)

    def test_attendee_cannot_change_eligibility(self):
        s1, _ = self.conference()
        self.make_tickets(1, "Afternoon Pass")
        self.as_user(self.attendee_user)
        res = self.client.post(f"/api/events/{self.event_id}/sessions/{s1}/registrations", json={"ticket_ids": ["x"], "action": "register"})
        self.assertEqual(res.status_code, 403)

    def test_volunteer_scoped_to_one_session(self):
        s1, s2 = self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        db = self.Session()
        db.add(EventVolunteer(event_id=self.event_id, customer_id=self.volunteer_user.customer_id,
                              invited_email="vol@example.com", volunteer_name="Gate Volunteer",
                              status="ACTIVE", session_ids=[s2]))
        db.commit()
        db.close()
        self.as_user(self.volunteer_user)
        denied = self.checkin(s1, token, MORNING)
        self.assertEqual(denied["error_code"], "SESSION_NOT_AUTHORIZED")
        listed = self.client.get(f"/api/events/{self.event_id}/sessions").json()
        self.assertEqual([s["session_id"] for s in listed["sessions"]], [s2])
        self.assertNotIn("unique_attendees", listed)
        with mock.patch.object(svc, "now_ist", return_value=AFTERNOON):
            res = self.client.post("/api/volunteers/verify-ticket", json={
                "event_id": str(self.event_id), "session_id": s2, "qr_token": token, "method": "QR"}).json()
        self.assertTrue(res["success"], res)
        self.assertEqual(res["session_name"], "Afternoon Session")
        self.assertNotIn("customer_email", res)

    def test_unassigned_user_cannot_check_in(self):
        s1, _ = self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        self.as_user(self.other_host)
        with mock.patch.object(svc, "now_ist", return_value=MORNING):
            res = self.client.post(f"/api/events/{self.event_id}/sessions/{s1}/check-in", json={"qr_token": token})
        self.assertEqual(res.status_code, 403)

    def test_session_from_another_event_is_rejected(self):
        s1, _ = self.conference()
        other_event = uuid.uuid4()
        db = self.Session()
        db.add(EventManagement(event_id=other_event, event_title="Other", organizer_email="host@example.com", customer_id="CUST-HOST01"))
        db.add(Event(id=other_event, title="Other", start_date=datetime(2026, 11, 15)))
        db.commit()
        db.close()
        token = self.make_tickets(1, "Full Pass", event_id=other_event)[0]
        res = self.checkin(s1, token, MORNING)
        self.assertEqual(res["error_code"], "WRONG_EVENT")
        res = self.client.get(f"/api/events/{other_event}/sessions/{s1}")
        self.assertEqual(res.status_code, 404)


class ConcurrencyTests(SessionTestBase):
    def test_simultaneous_scans_record_one_checkin(self):
        s1, _ = self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        barrier = threading.Barrier(4)
        results = []

        def scan():
            db = self.Session()
            try:
                event = db.query(EventManagement).filter(EventManagement.event_id == self.event_id).first()
                session = svc.get_event_session(db, event.event_id, s1)
                tickets = db.query(Ticket).filter(Ticket.qr_token == token).all()
                barrier.wait()
                results.append(svc.perform_session_checkin(db, event, session, tickets, checked_in_by="gate", now=MORNING))
            finally:
                db.close()

        threads = [threading.Thread(target=scan) for _ in range(4)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(sum(1 for r in results if r.get("success")), 1, results)
        self.assertTrue(all(r.get("error_code") == "ALREADY_CHECKED_IN" for r in results if not r.get("success")))
        db = self.Session()
        self.assertEqual(db.query(EventSessionCheckin).count(), 1)
        db.close()


class LegacyCompatibilityTests(SessionTestBase):
    def test_event_without_sessions_uses_existing_volunteer_flow(self):
        token = self.make_tickets(1, "Full Pass")[0]
        db = self.Session()
        db.add(EventVolunteer(event_id=self.event_id, customer_id=self.volunteer_user.customer_id,
                              invited_email="vol@example.com", volunteer_name="Gate Volunteer", status="ACTIVE"))
        db.commit()
        db.close()
        self.as_user(self.volunteer_user)
        first = self.client.post("/api/volunteers/verify-ticket", json={"event_id": str(self.event_id), "qr_token": token}).json()
        self.assertTrue(first.get("valid"), first)
        self.assertEqual(first.get("check_in_type"), "new")
        again = self.client.post("/api/volunteers/verify-ticket", json={"event_id": str(self.event_id), "qr_token": token}).json()
        self.assertEqual(again.get("status"), "ALREADY_USED")
        db = self.Session()
        self.assertEqual(db.query(VolunteerCheckin).count(), 1)
        self.assertEqual(db.query(EventSessionCheckin).count(), 0)
        db.close()

    def test_legacy_gate_scanner_unchanged_without_sessions(self):
        token = self.make_tickets(1, "Full Pass")[0]
        res = self.client.post("/api/tickets/checkin", json={"qr_token": token}).json()
        self.assertTrue(res["valid"], res)

    def test_legacy_gate_scanner_requires_session_for_multi_session_event(self):
        self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        res = self.client.post("/api/tickets/checkin", json={"qr_token": token}).json()
        self.assertEqual(res["status"], "SESSION_REQUIRED")
        db = self.Session()
        self.assertEqual(db.query(Ticket).filter(Ticket.ticket_status == "VALID").count(), 1)
        db.close()

    def test_volunteer_must_pick_session_for_multi_session_event(self):
        self.conference()
        token = self.make_tickets(1, "Full Pass")[0]
        db = self.Session()
        db.add(EventVolunteer(event_id=self.event_id, customer_id=self.volunteer_user.customer_id,
                              invited_email="vol@example.com", volunteer_name="Gate Volunteer", status="ACTIVE"))
        db.commit()
        db.close()
        self.as_user(self.volunteer_user)
        res = self.client.post("/api/volunteers/verify-ticket", json={"event_id": str(self.event_id), "qr_token": token}).json()
        self.assertEqual(res["error_code"], "SESSION_REQUIRED")

    def test_existing_ticket_stats_not_inflated(self):
        from APIs.host_events_api import compute_live_event_stats

        s1, s2 = self.conference()
        full = self.make_tickets(5, "Full Pass")
        for token in full:
            self.checkin(s1, token, MORNING)
            self.checkin(s2, token, AFTERNOON)
        db = self.Session()
        event = db.query(EventManagement).filter(EventManagement.event_id == self.event_id).first()
        stats = compute_live_event_stats(db, event)
        db.close()
        self.assertEqual(stats["tickets_sold"], 5)
        self.assertEqual(stats["checked_in"], 5)


class SessionUpdateTests(SessionTestBase):
    def test_edit_persists_and_removal_keeps_history(self):
        s1, s2 = self.conference()
        res = self.client.put(f"/api/events/{self.event_id}/sessions/{s1}", json={"venue_name": "Venue A (Hall 2)", "start_time": "08:30"})
        self.assertEqual(res.status_code, 200, res.text)
        reloaded = self.client.get(f"/api/events/{self.event_id}/sessions/{s1}").json()
        self.assertEqual(reloaded["venue_name"], "Venue A (Hall 2)")
        self.assertEqual(reloaded["start_time"], "08:30")

        token = self.make_tickets(1, "Full Pass")[0]
        self.assertTrue(self.checkin(s1, token, MORNING)["success"])
        blocked = self.client.delete(f"/api/events/{self.event_id}/sessions/{s1}")
        self.assertEqual(blocked.status_code, 409)
        self.assertTrue(blocked.json()["detail"]["requires_confirmation"])
        removed = self.client.delete(f"/api/events/{self.event_id}/sessions/{s1}?confirm=true")
        self.assertEqual(removed.status_code, 200)
        self.assertTrue(removed.json()["history_kept"])
        listed = self.client.get(f"/api/events/{self.event_id}/sessions").json()["sessions"]
        self.assertEqual([s["session_id"] for s in listed], [s2])
        db = self.Session()
        self.assertEqual(db.query(EventSessionCheckin).count(), 1)
        self.assertIsNotNone(db.query(EventSession).filter(EventSession.session_id == s1).first().deleted_at)
        db.close()

    def test_bulk_save_never_deletes_missing_sessions(self):
        s1, s2 = self.conference()
        res = self.save("multiple", [dict(self.session_body("Morning Session", "08:15", "10:45", "Venue A",
                                                            eligibility_mode="ticket_types", eligible_ticket_types=["Full Pass"]),
                                          session_id=s1)])
        self.assertEqual(res.status_code, 200, res.text)
        listed = self.client.get(f"/api/events/{self.event_id}/sessions").json()["sessions"]
        self.assertEqual(len(listed), 2)


class SessionBuilderUiTests(unittest.TestCase):
    def test_builder_forms_follow_session_count(self):
        import subprocess

        script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "js_tests", "event_sessions_ui.test.js")
        try:
            result = subprocess.run(["node", script], capture_output=True, text=True, timeout=60)
        except FileNotFoundError:
            self.skipTest("node is not installed")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
