"""Movie booking: layouts, shows, live seat holds, payment confirmation, check-in.

Throwaway SQLite file with the real routers; Razorpay and email are faked.
"""
import json
import os
import shutil
import tempfile
import threading
import unittest
import uuid
from datetime import datetime, timedelta
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import Models  # noqa: F401  (registers every table)
from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.base import Base, get_db
from Models.cinema import CinemaBooking, CinemaShow, CinemaShowSeat
from Models.theatre_partner import TheatrePartner
from Models.user import User
from Services import cinema_booking as cb
from Utils.datetimes import utc_now


def small_layout():
    return {
        "rows": 3, "cols": 5, "screen": "top", "numbering": "ltr",
        "categories": [{"id": "classic", "name": "Classic", "color": "#64748b"}, {"id": "prime", "name": "Prime", "color": "#2563eb"}],
        "cells": [
            ["classic", "classic", None, "classic", "classic"],
            [None, None, None, None, None],
            ["prime", "prime", None, "prime", "prime"],
        ],
    }


class LayoutRules(unittest.TestCase):
    def test_row_labels(self):
        self.assertEqual([cb.row_label(i) for i in (0, 25, 26, 27)], ["A", "Z", "AA", "AB"])

    def test_numbering_skips_gaps_and_empty_rows(self):
        layout, seats = cb.normalize_layout(small_layout())
        self.assertEqual([s["id"] for s in seats], ["A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4"])
        self.assertEqual(seats[4]["category"], "prime")

    def test_screen_at_bottom_and_right_to_left(self):
        raw = small_layout()
        raw.update(screen="bottom", numbering="rtl")
        _, seats = cb.normalize_layout(raw)
        ids = {(s["r"], s["c"]): s["id"] for s in seats}
        self.assertEqual(ids[(2, 4)], "A1", "row nearest a bottom screen is A, numbered from the right")
        self.assertEqual(ids[(0, 0)], "B4")

    def test_bad_layouts(self):
        raw = small_layout()
        raw["cells"][0][0] = "vip"
        with self.assertRaises(cb.BookingError):
            cb.normalize_layout(raw)
        raw = small_layout()
        raw["cells"] = raw["cells"][:2]
        with self.assertRaises(cb.BookingError):
            cb.normalize_layout(raw)
        raw = small_layout()
        raw["cells"] = [[None] * 5 for _ in range(3)]
        with self.assertRaises(cb.BookingError):
            cb.normalize_layout(raw)

    def test_template_and_fees(self):
        layout, seats = cb.normalize_layout(cb.template_layout(12, 20))
        self.assertEqual(len(seats), 11 * 19, "one walkway row and a centre aisle column")
        self.assertEqual({c["id"] for c in layout["categories"]}, {"classic", "prime", "recliner"})
        self.assertEqual(cb.money_split(100000), {"amount_paise": 100000, "platform_fee_paise": 5000, "gst_paise": 900, "payout_paise": 94100})


class FakeRazorpay:
    def __init__(self):
        self.orders = 0
        self.order = SimpleNamespace(create=self._create)
        self.utility = SimpleNamespace(verify_payment_signature=self._verify)

    def _create(self, data):
        self.orders += 1
        return {"id": f"order_{self.orders}", "amount": data["amount"]}

    def _verify(self, data):
        if data["razorpay_signature"] != "good":
            raise ValueError("bad signature")


class CinemaFlowTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "cinema.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False, "timeout": 30})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)

        from APIs.cinema_owner import router as owner_router
        from APIs.movies import router as movies_router

        app = FastAPI()
        app.include_router(owner_router, prefix="/api/cinema")
        app.include_router(movies_router, prefix="/api/movies")

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
        self.client = TestClient(app)
        self.razorpay = FakeRazorpay()
        self.patches = [
            mock.patch("APIs.payments._razorpay_client", return_value=(self.razorpay, "rzp_test_key")),
            mock.patch("Services.email.send_email", return_value=True),
            mock.patch("APIs.movies.limit_payment", lambda *a, **k: None),
        ]
        for p in self.patches:
            p.start()

        db = self.Session()
        self.owner = self._user(db, "CUST-200001", "owner@example.com", "Theatre Owner")
        self.buyer = self._user(db, "CUST-200002", "buyer@example.com", "Buyer One")
        self.buyer2 = self._user(db, "CUST-200003", "buyer2@example.com", "Buyer Two")
        self.pending_owner = self._user(db, "CUST-200004", "pending@example.com", "Pending Owner")
        db.add(TheatrePartner(email="owner@example.com", customer_id="CUST-200001", partner_code="THR-200001", status="verified",
                              theatre_name="Example Cinemas", district="Chennai", state="Tamil Nadu", pincode="600002",
                              screens_json=json.dumps([{"name": "Screen 1", "seats": 120, "format": "2D"}, {"name": "Screen 2", "seats": 60, "format": "IMAX"}])))
        db.add(TheatrePartner(email="pending@example.com", customer_id="CUST-200004", status="submitted", theatre_name="Pending Cinemas"))
        db.commit()
        db.close()
        self.as_user(self.owner)

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

    def as_user(self, user):
        self.current["user"] = user

    def ist(self, delta):
        return ((utc_now() + cb.IST_OFFSET) + delta).strftime("%Y-%m-%dT%H:%M")

    def setup_show(self, when=timedelta(days=1)):
        self.as_user(self.owner)
        screens = self.client.get("/api/cinema/screens").json()["screens"]
        screen = screens[0]
        res = self.client.put(f"/api/cinema/screens/{screen['id']}", json={"layout": small_layout()})
        self.assertEqual(res.status_code, 200, res.text)
        self.assertEqual(res.json()["seat_count"], 8)
        movie = self.client.post("/api/cinema/movies", json={"title": "Example Movie", "language": "Tamil", "certificate": "UA",
                                                             "duration_min": 150, "genres": "Drama"}).json()
        show = self.client.post("/api/cinema/shows", json={"screen_id": screen["id"], "movie_id": movie["id"], "starts_at": self.ist(when),
                                                          "prices": {"classic": 150, "prime": 250}})
        self.assertEqual(show.status_code, 200, show.text)
        return screen, movie, show.json()

    def pay(self, code, signature="good"):
        order = self.client.post(f"/api/movies/bookings/{code}/order").json()
        return self.client.post(f"/api/movies/bookings/{code}/verify", json={
            "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_123", "razorpay_signature": signature})

    def test_dashboard_requires_approval_and_seeds_screens(self):
        self.as_user(self.pending_owner)
        self.assertEqual(self.client.get("/api/cinema/me").status_code, 403)
        self.as_user(self.owner)
        me = self.client.get("/api/cinema/me").json()
        self.assertEqual(me["stats"]["screens"], 2)
        screens = self.client.get("/api/cinema/screens").json()["screens"]
        self.assertEqual([s["name"] for s in screens], ["Screen 1", "Screen 2"])
        self.assertGreaterEqual(screens[0]["seat_count"], 100)
        self.assertEqual(screens[1]["format"], "IMAX")

    def test_show_rules(self):
        screen, movie, show = self.setup_show()
        clash = self.client.post("/api/cinema/shows", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                           "starts_at": self.ist(timedelta(days=1, hours=2)), "prices": {"classic": 150, "prime": 250}})
        self.assertEqual(clash.status_code, 409)
        self.assertIn("busy", clash.json()["detail"])
        later = self.client.post("/api/cinema/shows", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                           "starts_at": self.ist(timedelta(days=1, hours=2, minutes=50)), "prices": {"classic": 150, "prime": 250}})
        self.assertEqual(later.status_code, 200, later.text)
        missing_price = self.client.post("/api/cinema/shows", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                                   "starts_at": self.ist(timedelta(days=3)), "prices": {"classic": 150}})
        self.assertEqual(missing_price.status_code, 422)
        past = self.client.post("/api/cinema/shows", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                          "starts_at": self.ist(timedelta(minutes=-30)), "prices": {"classic": 150, "prime": 250}})
        self.assertEqual(past.status_code, 422)

    def test_now_showing_by_district(self):
        self.setup_show()
        self.as_user(None)
        rows = self.client.get("/api/movies/now-showing", params={"state": "Tamil Nadu", "district": "Chennai"}).json()["movies"]
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["title"], "Example Movie")
        show = rows[0]["theatres"][0]["shows"][0]
        self.assertEqual((show["seats_left"], show["min_price"]), (8, 150))
        self.assertEqual(self.client.get("/api/movies/now-showing", params={"district": "Madurai"}).json()["movies"], [])

    def test_hold_conflict_expiry_and_release(self):
        _, _, show = self.setup_show()
        sid = show["id"]
        self.as_user(self.buyer)
        held = self.client.post(f"/api/movies/shows/{sid}/hold", json={"seats": ["a1", "A2"]})
        self.assertEqual(held.status_code, 200, held.text)
        self.assertEqual(held.json()["amount"], 300)
        self.assertEqual(self.client.get(f"/api/movies/shows/{sid}").json()["seats"], {"A1": "mine", "A2": "mine"})

        self.as_user(self.buyer2)
        clash = self.client.post(f"/api/movies/shows/{sid}/hold", json={"seats": ["A2", "A3"]})
        self.assertEqual(clash.status_code, 409)
        self.assertEqual(clash.json()["detail"]["taken"], ["A2"])
        self.assertEqual(self.client.get(f"/api/movies/shows/{sid}").json()["seats"], {"A1": "held", "A2": "held"})
        self.assertEqual(self.client.post(f"/api/movies/shows/{sid}/hold", json={"seats": ["Z9"]}).status_code, 422)

        later = utc_now() + timedelta(minutes=cb.HOLD_MINUTES, seconds=cb.HOLD_GRACE_SECONDS + 5)
        with mock.patch("APIs.movies.utc_now", return_value=later):
            retry = self.client.post(f"/api/movies/shows/{sid}/hold", json={"seats": ["A2"]})
            self.assertEqual(retry.status_code, 200, retry.text)
        db = self.Session()
        self.assertEqual(db.query(CinemaBooking).filter(CinemaBooking.email == "buyer@example.com").first().status, "expired")
        db.close()

        code = retry.json()["booking_code"]
        self.assertEqual(self.client.delete(f"/api/movies/bookings/{code}").json()["status"], "released")
        self.assertEqual(self.client.get(f"/api/movies/shows/{sid}").json()["seats"], {})

    def test_second_hold_by_same_buyer_replaces_first(self):
        _, _, show = self.setup_show()
        self.as_user(self.buyer)
        self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["A1"]})
        self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["B1", "B2"]})
        self.assertEqual(self.client.get(f"/api/movies/shows/{show['id']}").json()["seats"], {"B1": "mine", "B2": "mine"})

    def test_payment_confirms_and_owner_checks_in(self):
        _, _, show = self.setup_show()
        self.as_user(self.buyer)
        code = self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["B1", "B2"]}).json()["booking_code"]
        self.assertEqual(self.pay(code, signature="forged").status_code, 400)
        paid = self.pay(code)
        self.assertEqual(paid.status_code, 200, paid.text)
        body = paid.json()
        self.assertEqual(body["status"], "confirmed")
        self.assertTrue(body["qr_token"].startswith("MOVQR-"))
        self.assertEqual(self.client.get(f"/api/movies/shows/{show['id']}").json()["seats"], {"B1": "booked", "B2": "booked"})
        self.assertEqual(self.client.post(f"/api/movies/bookings/{code}/order").status_code, 409)
        self.assertEqual(len(self.client.get("/api/movies/bookings/mine").json()["bookings"]), 1)

        self.as_user(self.buyer2)
        self.assertEqual(self.client.get(f"/api/movies/bookings/{code}").status_code, 404, "other users can't read the ticket")

        self.as_user(self.owner)
        me = self.client.get("/api/cinema/me").json()["stats"]
        self.assertEqual((me["tickets_total"], me["gross_total"], me["payout_total"]), (2, 500.0, 470.5))
        first = self.client.post("/api/cinema/bookings/checkin", json={"code": body["qr_token"]}).json()
        self.assertFalse(first["already_checked_in"])
        self.assertTrue(self.client.post("/api/cinema/bookings/checkin", json={"code": code}).json()["already_checked_in"])
        self.assertEqual(self.client.post(f"/api/cinema/shows/{show['id']}/cancel").status_code, 409)

    def test_late_payment_after_seats_retaken_is_flagged(self):
        _, _, show = self.setup_show()
        self.as_user(self.buyer)
        code = self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["A1"]}).json()["booking_code"]
        order = self.client.post(f"/api/movies/bookings/{code}/order").json()
        later = utc_now() + timedelta(minutes=cb.HOLD_MINUTES, seconds=cb.HOLD_GRACE_SECONDS + 5)
        self.as_user(self.buyer2)
        with mock.patch("APIs.movies.utc_now", return_value=later):
            self.assertEqual(self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["A1"]}).status_code, 200)
        self.as_user(self.buyer)
        res = self.client.post(f"/api/movies/bookings/{code}/verify", json={
            "razorpay_order_id": order["order_id"], "razorpay_payment_id": "pay_late", "razorpay_signature": "good"})
        self.assertEqual(res.status_code, 409)
        self.assertIn("refund", res.json()["detail"])
        db = self.Session()
        self.assertEqual(db.query(CinemaBooking).filter(CinemaBooking.booking_code == code).first().status, "payment_conflict")
        db.close()

    def test_concurrent_holds_never_double_book(self):
        _, _, show = self.setup_show()
        show_id = uuid.UUID(show["id"])
        results = []
        barrier = threading.Barrier(6)

        def attempt(i):
            db = self.Session()
            try:
                row = db.query(CinemaShow).filter(CinemaShow.id == show_id).first()
                user = SimpleNamespace(email=f"racer{i}@example.com", customer_id=f"CUST-3{i:05d}", full_name=f"Racer {i}", phone=None)
                barrier.wait()
                cb.hold_seats(db, row, user, ["A1", "A2"], utc_now())
                results.append("ok")
            except cb.SeatsTaken:
                results.append("taken")
            except Exception as exc:
                results.append(f"error:{type(exc).__name__}")
            finally:
                db.close()

        threads = [threading.Thread(target=attempt, args=(i,)) for i in range(6)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(results.count("ok"), 1, results)
        db = self.Session()
        self.assertEqual(db.query(CinemaShowSeat).filter(CinemaShowSeat.show_id == show_id).count(), 2)
        db.close()

    def test_cancel_unsold_show_releases_holds(self):
        _, _, show = self.setup_show()
        self.as_user(self.buyer)
        self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["A1"]})
        self.as_user(self.owner)
        self.assertEqual(self.client.post(f"/api/cinema/shows/{show['id']}/cancel").status_code, 200)
        self.as_user(self.buyer)
        self.assertEqual(self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["A2"]}).status_code, 422)

    def test_edit_show(self):
        screen, movie, show = self.setup_show()
        prices = {"classic": 150, "prime": 250}
        other = self.client.post("/api/cinema/shows", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                           "starts_at": self.ist(timedelta(days=2)), "prices": prices}).json()

        moved = self.client.put(f"/api/cinema/shows/{show['id']}", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                                           "starts_at": self.ist(timedelta(days=1, hours=4)), "prices": prices})
        self.assertEqual(moved.status_code, 200, moved.text)
        self.assertEqual(moved.json()["starts_at_local"], self.ist(timedelta(days=1, hours=4)))

        clash = self.client.put(f"/api/cinema/shows/{show['id']}", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                                           "starts_at": self.ist(timedelta(days=2, hours=1)), "prices": prices})
        self.assertEqual(clash.status_code, 409)
        self.assertIn("busy", clash.json()["detail"])

        screen2 = self.client.get("/api/cinema/screens").json()["screens"][1]
        cats = {c["id"]: 200 for c in screen2["layout"]["categories"]}
        other_screen = self.client.put(f"/api/cinema/shows/{other['id']}", json={"screen_id": screen2["id"], "movie_id": movie["id"],
                                                                                 "starts_at": self.ist(timedelta(days=2)), "prices": cats})
        self.assertEqual(other_screen.status_code, 200, other_screen.text)
        self.assertEqual((other_screen.json()["screen_id"], other_screen.json()["seat_count"]), (screen2["id"], screen2["seat_count"]))

        self.as_user(self.buyer)
        self.assertEqual(self.client.post(f"/api/movies/shows/{show['id']}/hold", json={"seats": ["A1"]}).status_code, 200)
        self.as_user(self.owner)
        locked = self.client.put(f"/api/cinema/shows/{show['id']}", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                                            "starts_at": self.ist(timedelta(days=3)), "prices": prices})
        self.assertEqual(locked.status_code, 409)
        self.assertIn("only its prices", locked.json()["detail"])
        repriced = self.client.put(f"/api/cinema/shows/{show['id']}", json={"screen_id": screen["id"], "movie_id": movie["id"],
                                                                              "starts_at": self.ist(timedelta(days=1, hours=4)),
                                                                              "prices": {"classic": 180, "prime": 260}})
        self.assertEqual(repriced.status_code, 200, repriced.text)
        self.assertEqual(repriced.json()["prices"], {"classic": 180, "prime": 260})

    def test_cast_crew_and_trailers_saved_and_shown(self):
        _, movie, _ = self.setup_show()
        checks = []

        def fake_check(vid):
            checks.append(vid)
            return {"AAAAAAAAAAA": ("ok", "Official Trailer"), "BBBBBBBBBBB": ("no_embed", None)}.get(vid, ("missing", None))

        base = {"title": "Example Movie", "language": "Tamil", "certificate": "UA", "duration_min": 150, "genres": "Drama"}
        details = {
            "cast": [{"name": " Lead  Actor ", "role": "Hero", "photo_url": "/api/media/abc"}, {"name": "", "role": "blank row"}],
            "crew": [{"name": "Some Director", "role": "Director"}],
            "trailers": [{"url": "https://youtu.be/AAAAAAAAAAA?si=x", "label": "Teaser"}, {"url": "https://www.youtube.com/watch?v=AAAAAAAAAAA"}],
        }
        with mock.patch("Services.movie_details.check_youtube", side_effect=fake_check):
            res = self.client.put(f"/api/cinema/movies/{movie['id']}", json={**base, **details})
            self.assertEqual(res.status_code, 200, res.text)
            saved = res.json()
            self.assertEqual(saved["cast"], [{"name": "Lead Actor", "role": "Hero", "photo_url": "/api/media/abc"}])
            self.assertEqual(saved["crew"][0]["role"], "Director")
            self.assertEqual(saved["trailers"], [{"youtube_id": "AAAAAAAAAAA", "label": "Teaser"}], "duplicate link dropped")

            self.assertEqual(self.client.put(f"/api/cinema/movies/{movie['id']}", json={**base, **details}).status_code, 200)
            self.assertEqual(checks, ["AAAAAAAAAAA"], "already saved trailers are not re-checked")

            blocked = self.client.put(f"/api/cinema/movies/{movie['id']}", json={**base, "trailers": [{"url": "youtu.be/BBBBBBBBBBB"}]})
            self.assertEqual(blocked.status_code, 422)
            self.assertIn("other websites", blocked.json()["detail"])
            missing = self.client.put(f"/api/cinema/movies/{movie['id']}", json={**base, "trailers": [{"url": "https://youtu.be/CCCCCCCCCCC"}]})
            self.assertEqual(missing.status_code, 422)
            not_youtube = self.client.put(f"/api/cinema/movies/{movie['id']}", json={**base, "trailers": [{"url": "https://vimeo.com/12345"}]})
            self.assertEqual(not_youtube.status_code, 422)
            outside_photo = self.client.put(f"/api/cinema/movies/{movie['id']}", json={**base, "cast": [{"name": "X", "photo_url": "https://evil.example/x.jpg"}]})
            self.assertEqual(outside_photo.status_code, 422)

        kept = self.client.put(f"/api/cinema/movies/{movie['id']}", json=base).json()
        self.assertEqual(len(kept["trailers"]), 1, "older clients that omit the lists keep them")
        self.as_user(None)
        card = self.client.get("/api/movies/now-showing", params={"district": "Chennai"}).json()["movies"][0]
        self.assertEqual((card["cast"][0]["name"], card["crew"][0]["name"], card["trailers"][0]["youtube_id"]),
                         ("Lead Actor", "Some Director", "AAAAAAAAAAA"))


class YouTubeLinks(unittest.TestCase):
    def test_link_formats(self):
        from Services.movie_details import youtube_id

        vid = "dQw4w9WgXcQ"
        for link in (vid, f"https://www.youtube.com/watch?v={vid}&t=10s", f"https://m.youtube.com/watch?feature=share&v={vid}",
                     f"youtu.be/{vid}?si=abc", f"https://www.youtube.com/shorts/{vid}", f"https://www.youtube.com/embed/{vid}",
                     f"https://www.youtube.com/live/{vid}?feature=share", f"https://www.youtube-nocookie.com/embed/{vid}",
                     f"https://music.youtube.com/watch?v={vid}"):
            self.assertEqual(youtube_id(link), vid, link)
        for link in ("", "https://vimeo.com/123", "https://youtube.com/watch?v=short", "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
                     "javascript:alert(1)", "https://www.youtube.com/@channel", f"ftp://youtube.com/watch?v={vid}"):
            self.assertIsNone(youtube_id(link), link)

    def test_unreachable_youtube_does_not_block_saving(self):
        from Services.movie_details import clean_trailers

        rows = clean_trailers([{"url": "https://youtu.be/dQw4w9WgXcQ", "label": "Weird"}], checker=lambda vid: ("unknown", None))
        self.assertEqual(rows, [{"youtube_id": "dQw4w9WgXcQ", "label": "Trailer"}])


if __name__ == "__main__":
    unittest.main()
