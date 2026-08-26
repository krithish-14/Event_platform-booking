"""
Critical security-fix tests (Google token verification, KYC authz, host-event IDOR).
Does not print or invent secret values.
"""
from __future__ import annotations

import base64
import json
import os
import sys
import unittest
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi import HTTPException

_BACKEND = os.path.dirname(os.path.abspath(__file__))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

os.chdir(_BACKEND)


def _unsigned_google_jwt(email: str) -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"none","typ":"JWT"}').decode().rstrip("=")
    body = base64.urlsafe_b64encode(json.dumps({
        "email": email,
        "email_verified": True,
        "aud": "wrong-client.apps.googleusercontent.com",
        "iss": "https://accounts.google.com",
        "name": "Forged User",
    }).encode()).decode().rstrip("=")
    return f"{header}.{body}."


def _rs256_shaped_jwt() -> str:
    header = base64.urlsafe_b64encode(b'{"alg":"RS256","typ":"JWT"}').decode().rstrip("=")
    body = base64.urlsafe_b64encode(b'{"sub":"x"}').decode().rstrip("=")
    return f"{header}.{body}.c2lnbmF0dXJl"


def _tokeninfo_ok(**overrides):
    payload = {
        "email": "User@Example.com",
        "email_verified": True,
        "aud": "jod-client.apps.googleusercontent.com",
        "iss": "https://accounts.google.com",
        "name": "User",
    }
    payload.update(overrides)
    fake_resp = MagicMock()
    fake_resp.status_code = 200
    fake_resp.json.return_value = payload
    mock_client = AsyncMock()
    mock_client.get.return_value = fake_resp
    mock_client.__aenter__.return_value = mock_client
    mock_client.__aexit__.return_value = False
    return mock_client


class GoogleTokenVerificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_unsigned_payload_is_rejected_locally(self):
        from APIs.auth import _verify_google_id_token

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient") as mock_http:
                with self.assertRaises(HTTPException) as ctx:
                    await _verify_google_id_token(_unsigned_google_jwt("victim@example.com"))
        self.assertEqual(ctx.exception.status_code, 400)
        mock_http.assert_not_called()

    async def test_google_verify_failure_is_rejected(self):
        from APIs.auth import _verify_google_id_token

        fake_resp = MagicMock()
        fake_resp.status_code = 400
        fake_resp.json.return_value = {"error": "invalid_token"}
        mock_client = AsyncMock()
        mock_client.get.return_value = fake_resp
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                with self.assertRaises(HTTPException) as ctx:
                    await _verify_google_id_token(_rs256_shaped_jwt())
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_wrong_audience_is_rejected(self):
        from APIs.auth import _verify_google_id_token

        mock_client = _tokeninfo_ok(aud="some-other-app.apps.googleusercontent.com")
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                with self.assertRaises(HTTPException) as ctx:
                    await _verify_google_id_token(_rs256_shaped_jwt())
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_wrong_issuer_is_rejected(self):
        from APIs.auth import _verify_google_id_token

        mock_client = _tokeninfo_ok(iss="https://evil.example")
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                with self.assertRaises(HTTPException) as ctx:
                    await _verify_google_id_token(_rs256_shaped_jwt())
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_unverified_email_is_rejected(self):
        from APIs.auth import _verify_google_id_token

        mock_client = _tokeninfo_ok(email_verified=False)
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                with self.assertRaises(HTTPException) as ctx:
                    await _verify_google_id_token(_rs256_shaped_jwt())
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_valid_tokeninfo_is_accepted(self):
        from APIs.auth import _verify_google_id_token

        mock_client = _tokeninfo_ok()
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                info = await _verify_google_id_token(_rs256_shaped_jwt())
        self.assertEqual(info["email"], "user@example.com")


def _sensitive_keys_present(obj) -> bool:
    text = json.dumps(obj or {}, default=str).lower()
    markers = (
        "account_number",
        "bank_ifsc",
        "pan_number",
        "pan_card_url",
        "cancelled_cheque_url",
        "contact_mobile",
    )
    if not any(m in text for m in markers):
        return False
    if '"account_number": false' in text or '"account_number":false' in text:
        return False
    return any(
        f'"{m}": "' in text or f'"{m}":"' in text
        for m in markers
    )


class CriticalEndpointAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from FastAPI.main import app
        from fastapi.testclient import TestClient
        cls.app = app
        cls.client = TestClient(app)

    def _register_client(self):
        from fastapi.testclient import TestClient
        email = f"sec_{uuid.uuid4().hex[:10]}@example.com"
        username = f"u{uuid.uuid4().hex[:12]}"
        client = TestClient(self.app)
        res = client.post(
            "/api/auth/register",
            json={
                "email": email,
                "username": username,
                "password": "Passw0rd1",
                "full_name": "Security Tester",
                "phone": "9876543210",
            },
        )
        return client, email, res

    def test_verification_status_requires_auth(self):
        res = self.client.get(
            "/api/organizers/verification-status",
            params={"email": "anyone@example.com"},
        )
        self.assertEqual(res.status_code, 401)
        body = res.json()
        self.assertFalse(_sensitive_keys_present(body))

    def test_resubmit_verification_requires_auth(self):
        res = self.client.post(
            "/api/organizers/resubmit-verification",
            json={"email": "anyone@example.com", "new_status": "verified"},
        )
        self.assertEqual(res.status_code, 401)

    def test_host_attendees_requires_auth(self):
        res = self.client.get(
            "/api/host-events/registrations/attendees",
            params={"email": "anyone@example.com"},
        )
        self.assertEqual(res.status_code, 401)

    def test_host_design_requires_auth(self):
        res = self.client.post(
            "/api/host-events/design",
            json={"organizer_email": "anyone@example.com", "theme_color": "#000"},
        )
        self.assertEqual(res.status_code, 401)

    def test_host_dashboard_requires_auth(self):
        res = self.client.get(
            "/api/host-events/dashboard",
            params={"email": "anyone@example.com"},
        )
        self.assertEqual(res.status_code, 401)

    def test_unsigned_google_jwt_fails_closed(self):
        res = self.client.post(
            "/api/auth/google",
            json={"id_token": _unsigned_google_jwt("attacker@example.com")},
        )
        self.assertEqual(res.status_code, 400)
        body = res.json() or {}
        self.assertNotIn("access_token", body)
        self.assertIn("verify", str(body.get("detail", "")).lower())

    def test_non_admin_cannot_verify_or_view_another_organizer(self):
        client, email, reg = self._register_client()
        if reg.status_code not in (200, 201):
            self.skipTest(f"register unavailable ({reg.status_code})")
        res_verify = client.post(
            "/api/organizers/resubmit-verification",
            json={"email": "other-organizer@example.com", "new_status": "verified"},
        )
        self.assertEqual(res_verify.status_code, 403)
        res_status = client.get(
            "/api/organizers/verification-status",
            params={"email": "other-organizer@example.com"},
        )
        self.assertEqual(res_status.status_code, 403)
        self.assertFalse(_sensitive_keys_present(res_status.json()))
        res_resubmit = client.post(
            "/api/organizers/resubmit-verification",
            json={"email": "other-organizer@example.com", "new_status": "submitted"},
        )
        self.assertEqual(res_resubmit.status_code, 403)
        res_own = client.get("/api/organizers/verification-status")
        self.assertEqual(res_own.status_code, 200)
        res_host = client.get(
            "/api/host-events/registrations/attendees",
            params={"email": "other-organizer@example.com"},
        )
        self.assertIn(res_host.status_code, (200, 404))
        if res_host.status_code == 200:
            self.assertNotIn("other-organizer@example.com", json.dumps(res_host.json(), default=str))

    def _kyc_payload(self, email: str) -> dict:
        return {
            "email": email,
            "org_name": "Security Org",
            "beneficiary_name": "Test Beneficiary",
            "account_type": "Savings",
            "bank_name": "HDFC Bank",
            "account_number": "111122223333",
            "bank_ifsc": "HDFC0001234",
            "pan_number": "ABCDE1234F",
            "pan_card_url": "/api/media/private/dummy-pan",
            "cancelled_cheque_url": "/api/media/private/dummy-cheque",
            "contact_full_name": "Test Beneficiary",
            "contact_mobile": "9876543210",
            "accepted_agreement": True,
            "is_final_submit": True,
        }

    def _promote_admin(self, email: str) -> None:
        from Models.base import get_session_factory
        from Models.user import User
        from sqlalchemy import func
        db = get_session_factory()()
        try:
            user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
            self.assertIsNotNone(user)
            user.is_admin = True
            db.commit()
        finally:
            db.close()

    def test_admin_verify_reject_and_owner_resubmit(self):
        owner_client, owner_email, owner_reg = self._register_client()
        admin_client, admin_email, admin_reg = self._register_client()
        other_client, other_email, other_reg = self._register_client()
        if any(r.status_code not in (200, 201) for r in (owner_reg, admin_reg, other_reg)):
            self.skipTest("register unavailable")
        self._promote_admin(admin_email)

        setup = owner_client.post("/api/organizers/account-setup", json=self._kyc_payload(owner_email))
        self.assertEqual(setup.status_code, 200, setup.text)
        pending = owner_client.get("/api/organizers/verification-status")
        self.assertEqual(pending.status_code, 200)
        self.assertEqual(pending.json().get("verification_status"), "PENDING")

        leaked = other_client.get(
            "/api/organizers/verification-status",
            params={"email": owner_email},
        )
        self.assertEqual(leaked.status_code, 403)
        self.assertFalse(_sensitive_keys_present(leaked.json()))

        self_verify = owner_client.post(
            "/api/organizers/resubmit-verification",
            json={"email": owner_email, "new_status": "verified"},
        )
        self.assertEqual(self_verify.status_code, 403)

        verified = admin_client.post(
            "/api/organizers/resubmit-verification",
            json={"email": owner_email, "new_status": "verified"},
        )
        self.assertEqual(verified.status_code, 200, verified.text)
        self.assertEqual(verified.json().get("verification_status"), "VERIFIED")

        rejected = admin_client.post(
            "/api/organizers/resubmit-verification",
            json={
                "email": owner_email,
                "new_status": "rejected",
                "rejection_reason": "Please re-upload clearer documents.",
            },
        )
        self.assertEqual(rejected.status_code, 200)
        self.assertEqual(rejected.json().get("verification_status"), "REJECTED")

        resubmit_own = owner_client.post("/api/organizers/resubmit-verification", json={})
        self.assertEqual(resubmit_own.status_code, 200, resubmit_own.text)
        self.assertEqual(resubmit_own.json().get("verification_status"), "PENDING")

        host_ok = owner_client.get("/api/host-events/dashboard", params={"email": owner_email})
        self.assertEqual(host_ok.status_code, 200)

    def test_cross_organizer_host_event_is_bound_to_jwt(self):
        client_a, email_a, reg_a = self._register_client()
        client_b, email_b, reg_b = self._register_client()
        if reg_a.status_code not in (200, 201) or reg_b.status_code not in (200, 201):
            self.skipTest("register unavailable")
        saved = client_a.post(
            "/api/host-events/manage",
            json={"organizer_email": email_b, "event_title": "Owner Event"},
        )
        self.assertEqual(saved.status_code, 200)
        current = client_a.get("/api/host-events/current", params={"email": email_b})
        self.assertEqual(current.status_code, 200)
        event = (current.json() or {}).get("event") or {}
        self.assertEqual((event.get("organizer_email") or "").lower(), email_a.lower())
        event_id = event.get("event_id")
        if not event_id:
            self.skipTest("host event was not created")
        other = client_b.get(
            "/api/host-events/registrations/attendees",
            params={"email": email_a, "event_id": str(event_id)},
        )
        self.assertEqual(other.status_code, 403)


if __name__ == "__main__":
    unittest.main(verbosity=2)
