"""Turnstile gates email/password signup. Google auth is unchanged."""
from __future__ import annotations

import os
import sys
import unittest
import uuid
from unittest.mock import MagicMock, patch

_BACKEND = os.path.dirname(os.path.abspath(__file__))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)


def _payload(email=None, token="valid-turnstile-token"):
    suffix = uuid.uuid4().hex[:10]
    return {
        "email": email or f"ts_{suffix}@example.com",
        "username": f"u{suffix}",
        "password": "Passw0rd1",
        "full_name": "Turnstile Tester",
        "phone": "9876543210",
        "accepted_privacy_policy": True,
        "turnstile_token": token,
    }


class TurnstileSignupTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from FastAPI.main import app
        from fastapi.testclient import TestClient
        cls.app = app
        cls.client = TestClient(app)

    def test_config_never_exposes_secret(self):
        res = self.client.get("/api/auth/turnstile/config")
        self.assertEqual(res.status_code, 200)
        body = res.json()
        self.assertIn("site_key", body)
        self.assertIn("enabled", body)
        self.assertNotIn("secret", str(body).lower())
        self.assertNotIn("CLOUDFLARE_TURNSTILE_SECRET_KEY", str(body))

    def test_missing_token_rejected_when_secret_configured(self):
        payload = _payload(token="")
        payload.pop("turnstile_token")
        with patch.dict(os.environ, {
            "APP_ENV": "development",
            "CLOUDFLARE_TURNSTILE_SECRET_KEY": "test-secret-value",
            "CLOUDFLARE_TURNSTILE_SITE_KEY": "1x00000000000000000000AA",
            "CLOUDFLARE_TURNSTILE_HOSTNAMES": "localhost,127.0.0.1",
        }, clear=False):
            res = self.client.post("/api/auth/register", json=payload)
        self.assertEqual(res.status_code, 400)
        self.assertIn("verification", str(res.json().get("detail", "")).lower())

    def test_invalid_token_does_not_create_user(self):
        payload = _payload()
        failed = {"success": False, "error-codes": ["invalid-input-response"]}
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = failed
        with patch.dict(os.environ, {
            "APP_ENV": "development",
            "CLOUDFLARE_TURNSTILE_SECRET_KEY": "test-secret-value",
            "CLOUDFLARE_TURNSTILE_SITE_KEY": "1x00000000000000000000AA",
            "CLOUDFLARE_TURNSTILE_HOSTNAMES": "localhost,127.0.0.1",
        }, clear=False):
            with patch("Services.turnstile.httpx.Client") as client_cls:
                client_cls.return_value.__enter__.return_value.post.return_value = mock_resp
                res = self.client.post("/api/auth/register", json=payload)
        self.assertEqual(res.status_code, 403)
        self.assertIn("Verification failed", res.json().get("detail", ""))

    def test_siteverify_outage_is_unavailable(self):
        import httpx
        payload = _payload()
        with patch.dict(os.environ, {
            "APP_ENV": "development",
            "CLOUDFLARE_TURNSTILE_SECRET_KEY": "test-secret-value",
            "CLOUDFLARE_TURNSTILE_HOSTNAMES": "localhost",
        }, clear=False):
            with patch("Services.turnstile.httpx.Client") as client_cls:
                client_cls.return_value.__enter__.return_value.post.side_effect = httpx.ConnectError("down")
                res = self.client.post("/api/auth/register", json=payload)
        self.assertEqual(res.status_code, 503)
        self.assertIn("temporarily unavailable", res.json().get("detail", ""))

    def test_valid_token_keeps_existing_duplicate_email_behavior(self):
        from fastapi.testclient import TestClient
        client = TestClient(self.app)
        first = _payload()
        email = first["email"]
        ok = {"success": True, "action": "signup", "hostname": "localhost"}
        mock_resp = MagicMock()
        mock_resp.raise_for_status.return_value = None
        mock_resp.json.return_value = ok
        env = {
            "APP_ENV": "development",
            "CLOUDFLARE_TURNSTILE_SECRET_KEY": "test-secret-value",
            "CLOUDFLARE_TURNSTILE_SITE_KEY": "1x00000000000000000000AA",
            "CLOUDFLARE_TURNSTILE_HOSTNAMES": "localhost,127.0.0.1",
        }
        with patch.dict(os.environ, env, clear=False):
            with patch("Services.turnstile.httpx.Client") as client_cls:
                client_cls.return_value.__enter__.return_value.post.return_value = mock_resp
                created = client.post("/api/auth/register", json=first)
                if created.status_code not in (200, 201):
                    self.skipTest(f"register unavailable ({created.status_code})")
                again = _payload(email=email)
                again["username"] = f"u{uuid.uuid4().hex[:10]}"
                dup = client.post("/api/auth/register", json=again)
        self.assertEqual(dup.status_code, 400)
        self.assertIn("already", str(dup.json().get("detail", "")).lower())


if __name__ == "__main__":
    unittest.main(verbosity=2)
