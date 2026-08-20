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
        "name": "Forged User",
    }).encode()).decode().rstrip("=")
    return f"{header}.{body}."


class GoogleTokenVerificationTests(unittest.IsolatedAsyncioTestCase):
    async def test_unsigned_payload_is_rejected_when_google_verify_fails(self):
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
                    await _verify_google_id_token(_unsigned_google_jwt("victim@example.com"))
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_wrong_audience_is_rejected(self):
        from APIs.auth import _verify_google_id_token

        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "email": "user@example.com",
            "email_verified": "true",
            "aud": "some-other-app.apps.googleusercontent.com",
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = fake_resp
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                with self.assertRaises(HTTPException) as ctx:
                    await _verify_google_id_token("header.payload.sig")
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_unverified_email_is_rejected(self):
        from APIs.auth import _verify_google_id_token

        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "email": "user@example.com",
            "email_verified": False,
            "aud": "jod-client.apps.googleusercontent.com",
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = fake_resp
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                with self.assertRaises(HTTPException) as ctx:
                    await _verify_google_id_token("header.payload.sig")
        self.assertEqual(ctx.exception.status_code, 400)

    async def test_valid_tokeninfo_is_accepted(self):
        from APIs.auth import _verify_google_id_token

        fake_resp = MagicMock()
        fake_resp.status_code = 200
        fake_resp.json.return_value = {
            "email": "User@Example.com",
            "email_verified": True,
            "aud": "jod-client.apps.googleusercontent.com",
            "name": "User",
        }

        mock_client = AsyncMock()
        mock_client.get.return_value = fake_resp
        mock_client.__aenter__.return_value = mock_client
        mock_client.__aexit__.return_value = False

        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("APIs.auth.httpx.AsyncClient", return_value=mock_client):
                info = await _verify_google_id_token("header.payload.sig")
        self.assertEqual(info["email"], "user@example.com")


class CriticalEndpointAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from FastAPI.main import app
        from fastapi.testclient import TestClient
        cls.client = TestClient(app)

    def test_verification_status_requires_auth(self):
        res = self.client.get(
            "/api/organizers/verification-status",
            params={"email": "anyone@example.com"},
        )
        self.assertEqual(res.status_code, 401)
        body = res.json()
        account = body.get("account") if isinstance(body, dict) else None
        if isinstance(account, dict):
            self.assertFalse(account.get("account_number"))
            self.assertFalse(account.get("pan_number"))

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

    def test_unsigned_google_jwt_fails_closed(self):
        res = self.client.post(
            "/api/auth/google",
            json={"id_token": _unsigned_google_jwt("attacker@example.com")},
        )
        self.assertEqual(res.status_code, 400)
        detail = (res.json() or {}).get("detail", "")
        self.assertNotIn("access_token", res.json() or {})
        self.assertIn("verify", str(detail).lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
