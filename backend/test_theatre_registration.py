"""Theatre partner (movie host) registration and admin review.

Runs against a throwaway SQLite file with the real routers mounted; email and file storage are stubbed.
"""
import os
import shutil
import tempfile
import unittest
from datetime import date, timedelta
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

import Models  # noqa: F401  (registers every table)
from Authentication.dependencies import get_current_admin, get_current_user
from Models.base import Base, get_db
from Models.organizer_accounts import OrganizerAccount
from Models.theatre_partner import TheatrePartner
from Models.user import User

FUTURE = (date.today() + timedelta(days=365)).isoformat()
PAST = (date.today() - timedelta(days=1)).isoformat()


def full_payload(**overrides):
    body = {
        "theatre_name": "Example Cinemas",
        "chain_name": "Example Chain",
        "theatre_address": "12 Mount Road, Anna Salai",
        "district": "Chennai",
        "state": "Tamil Nadu",
        "pincode": "600002",
        "screens": [{"name": "Screen 1", "seats": 180, "format": "2D"}, {"name": "Screen 2", "seats": 120, "format": "IMAX"}],
        "licence_number": "ccl/2026/123",
        "licence_valid_till": FUTURE,
        "legal_name": "Example Cinemas Pvt Ltd",
        "pan_number": "abcde1234f",
        "org_address": "12 Mount Road, Chennai",
        "has_gstin": True,
        "gstin_number": "33abcde1234f1z5",
        "contact_full_name": "Theatre Manager",
        "contact_mobile": "9876543210",
        "beneficiary_name": "Example Cinemas Pvt Ltd",
        "account_type": "Current",
        "bank_name": "HDFC Bank",
        "account_number": "1234567890",
        "bank_ifsc": "hdfc0001234",
        "accepted_undertaking": True,
        "accepted_agreement": True,
        "agreement_version": "JOD-HTA-1.0",
    }
    body.update(overrides)
    return body


class TheatreRegistrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        url = "sqlite:///" + os.path.join(self.tmp, "theatre.db").replace("\\", "/")
        self.engine = create_engine(url, connect_args={"check_same_thread": False})
        Base.metadata.create_all(self.engine)
        self.Session = sessionmaker(bind=self.engine, autocommit=False, autoflush=False)

        from APIs.theatres import admin_router, router

        app = FastAPI()
        app.include_router(router, prefix="/api/theatres")
        app.include_router(admin_router, prefix="/api/admin/theatres")

        def _db():
            db = self.Session()
            try:
                yield db
            finally:
                db.close()

        self.current = {"user": None}
        app.dependency_overrides[get_db] = _db
        app.dependency_overrides[get_current_user] = lambda: self.current["user"]
        app.dependency_overrides[get_current_admin] = lambda: self.admin
        self.client = TestClient(app)

        self.uploads = 0

        def fake_store(db, **kwargs):
            self.uploads += 1
            return SimpleNamespace(id=f"file-{self.uploads}")

        self.patches = [
            mock.patch("Services.file_storage.store_bytes", side_effect=fake_store),
            mock.patch("Services.file_storage.public_url", side_effect=lambda stored: f"/api/media/{stored.id}"),
            mock.patch("APIs.theatres.is_allowed_kyc_bytes", return_value=True),
            mock.patch("Services.email.send_email", return_value=True),
        ]
        for p in self.patches:
            p.start()

        db = self.Session()
        self.theatre_user = self._user(db, "CUST-100001", "cinema@example.com", "Cinema Owner")
        self.host_user = self._user(db, "CUST-100002", "host@example.com", "Event Host")
        self.admin = self._user(db, "CUST-100003", "admin@example.com", "Admin")
        db.add(OrganizerAccount(
            email="host@example.com", customer_id="CUST-100002", org_name="Host Org", pan_number="PQRST6789K",
            org_address="5 Anna Nagar, Chennai", beneficiary_name="Host Org", account_type="Savings", bank_name="HDFC Bank",
            account_number="9988776655", bank_ifsc="HDFC0009999", pan_card_url="/api/media/host-pan",
            cancelled_cheque_url="/api/media/host-cheque", contact_full_name="Event Host", contact_mobile="+919000000001",
            status="verified",
        ))
        db.commit()
        db.close()
        self.current["user"] = self.theatre_user

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

    def upload(self, doc_type):
        res = self.client.post("/api/theatres/upload-document", data={"doc_type": doc_type},
                               files={"file": (f"{doc_type}.pdf", b"%PDF-" + b"0" * (600 * 1024), "application/pdf")})
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()["file_url"]

    def save(self, body):
        return self.client.post("/api/theatres/registration", json=body)

    def submit_complete(self):
        docs = {
            "pan_card_url": self.upload("pan_card"),
            "cancelled_cheque_url": self.upload("cancelled_cheque"),
            "licence_url": self.upload("cinema_licence"),
        }
        res = self.save(full_payload(is_final_submit=True, **docs))
        self.assertEqual(res.status_code, 200, res.text)
        return res.json()

    def test_new_user_starts_empty(self):
        body = self.client.get("/api/theatres/registration").json()
        self.assertFalse(body["exists"])
        self.assertEqual(body["verification_status"], "NOT_SUBMITTED")
        self.assertTrue(body["editable"])
        self.assertEqual(body["prefill"], {})
        self.assertFalse(body["is_event_host"])

    def test_event_host_gets_business_bank_and_kyc_prefill(self):
        self.current["user"] = self.host_user
        body = self.client.get("/api/theatres/registration").json()
        self.assertTrue(body["is_event_host"])
        self.assertEqual(body["prefill"]["legal_name"], "Host Org")
        self.assertEqual(body["prefill"]["bank_ifsc"], "HDFC0009999")
        self.assertEqual(body["prefill"]["pan_card_url"], "/api/media/host-pan")
        res = self.save(full_payload(pan_card_url="/api/media/host-pan", cancelled_cheque_url="/api/media/host-cheque"))
        partner = res.json()["partner"]
        self.assertEqual(partner["pan_card_url"], "/api/media/host-pan")
        db = self.Session()
        self.assertEqual(db.query(OrganizerAccount).first().status, "verified", "event host account untouched")
        db.close()

    def test_draft_save_and_normalisation(self):
        res = self.save(full_payload())
        self.assertEqual(res.status_code, 200, res.text)
        p = res.json()["partner"]
        self.assertEqual(p["status"], "draft")
        self.assertEqual(p["pan_number"], "ABCDE1234F")
        self.assertEqual(p["bank_ifsc"], "HDFC0001234")
        self.assertEqual(p["contact_mobile"], "+919876543210")
        self.assertEqual(p["total_seats"], 300)
        self.assertEqual(p["partner_code"], "THR-100001")

    def test_validation_errors(self):
        self.assertEqual(self.save(full_payload(pincode="12345")).status_code, 422)
        self.assertEqual(self.save(full_payload(screens=[{"name": "A", "seats": 0}])).status_code, 422)
        self.assertEqual(self.save(full_payload(screens=[{"name": "A", "seats": 10}, {"name": "a", "seats": 20}])).status_code, 422)
        self.assertEqual(self.save(full_payload(contact_mobile="12345")).status_code, 422)
        self.assertEqual(self.save(full_payload(licence_valid_till="31/12/2030")).status_code, 422)

    def test_final_submit_lists_missing_items(self):
        res = self.save(full_payload(is_final_submit=True, licence_valid_till=PAST))
        self.assertEqual(res.status_code, 400)
        detail = res.json()["detail"]
        for item in ("PAN card image", "cinema licence document", "a cinema licence that has not expired"):
            self.assertIn(item, detail)

    def test_documents_cannot_point_at_foreign_urls(self):
        res = self.save(full_payload(licence_url="https://evil.example/fake.pdf", pan_card_url="/api/media/host-pan"))
        p = res.json()["partner"]
        self.assertIsNone(p["licence_url"])
        self.assertIsNone(p["pan_card_url"], "another host's KYC file is not accepted")

    def test_submit_locks_then_admin_reviews(self):
        body = self.submit_complete()
        self.assertEqual(body["verification_status"], "PENDING")
        self.assertFalse(body["editable"])
        self.assertTrue(body["partner"]["agreement_acceptance_ref"].startswith("ACC-"))
        self.assertEqual(self.save(full_payload()).status_code, 409)
        locked = self.client.post("/api/theatres/upload-document", data={"doc_type": "pan_card"},
                                  files={"file": ("p.pdf", b"%PDF-" + b"0" * (600 * 1024), "application/pdf")})
        self.assertEqual(locked.status_code, 409)

        rows = self.client.get("/api/admin/theatres").json()
        self.assertEqual(rows["pending"], 1)
        row = rows["theatres"][0]
        self.assertEqual((row["kind"], row["status"], row["org_name"]), ("theatre", "pending", "Example Cinemas"))
        self.assertTrue(row["can_approve"])

        self.assertEqual(self.client.patch(f"/api/admin/theatres/{row['application_id']}", json={"action": "reject"}).status_code, 400)
        rejected = self.client.patch(f"/api/admin/theatres/{row['application_id']}", json={"action": "reject", "rejection_reason": "Licence scan is blurry"})
        self.assertEqual(rejected.status_code, 200, rejected.text)
        status = self.client.get("/api/theatres/registration").json()
        self.assertEqual(status["verification_status"], "REJECTED")
        self.assertEqual(status["review_reason"], "Licence scan is blurry")
        self.assertTrue(status["editable"])

        self.submit_complete()
        approved = self.client.patch(f"/api/admin/theatres/{row['id']}", json={"action": "approve"})
        self.assertEqual(approved.status_code, 200, approved.text)
        self.assertEqual(self.client.get("/api/theatres/registration").json()["verification_status"], "VERIFIED")
        self.assertEqual(self.client.patch(f"/api/admin/theatres/{row['id']}", json={"action": "approve"}).status_code, 409)

        restricted = self.client.patch(f"/api/admin/theatres/{row['id']}", json={"action": "restrict", "rejection_reason": "Complaint under review"})
        self.assertEqual(restricted.json()["theatre"]["status"], "restricted")
        back = self.client.patch(f"/api/admin/theatres/{row['id']}", json={"action": "unrestrict"})
        self.assertEqual(back.json()["theatre"]["status"], "approved")

    def test_drafts_hidden_from_admin(self):
        self.save(full_payload())
        self.assertEqual(self.client.get("/api/admin/theatres").json()["total"], 0)

    def test_unknown_partner_404(self):
        self.assertEqual(self.client.patch("/api/admin/theatres/not-a-uuid", json={"action": "approve"}).status_code, 404)


if __name__ == "__main__":
    unittest.main()
