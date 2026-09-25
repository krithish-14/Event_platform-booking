"""Google Identity Services backend flow: create, login, and link."""
import os
import sys
import unittest
import uuid
from unittest.mock import patch

_BACKEND = os.path.dirname(os.path.abspath(__file__))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)

from test_critical_security_fixes import (
    GoogleAccountLinkingTests,
    GoogleTokenVerificationTests,
    _google_info_ok,
    _rs256_shaped_jwt,
)


class GoogleOAuthFlowTests(GoogleAccountLinkingTests):
    def test_google_config_shape(self):
        from APIs.auth import google_config

        config = google_config()
        self.assertIn("client_id", config)
        self.assertIn("enabled", config)

    def test_new_google_user_persists_profile_fields(self):
        from fastapi.testclient import TestClient
        from Models.base import SessionLocal
        from Models.user import User

        email = f"gflow_{uuid.uuid4().hex[:10]}@gmail.com"
        picture = "https://lh3.googleusercontent.com/a/jane-test-pic"
        client = TestClient(self.app)
        info = _google_info_ok(email=email, sub=f"sub-{uuid.uuid4().hex[:12]}", name="Jane Google User", picture=picture)
        with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
            with patch("google.oauth2.id_token.verify_oauth2_token", return_value=info):
                res = client.post(
                    "/api/auth/google",
                    json={"credential": _rs256_shaped_jwt(), "intent": "signup", "city": "Chennai", "location_pincode": "600001"},
                )
        self.assertEqual(res.status_code, 200)
        body = res.json() or {}
        user = body.get("user") or {}
        self.assertEqual(user.get("email"), email)
        self.assertEqual(user.get("avatar_url"), picture)
        self.assertEqual(user.get("city"), "Chennai")
        self.assertTrue(str(user.get("customer_id") or "").startswith("CUST-"))

        db = SessionLocal()
        try:
            row = db.query(User).filter(User.email == email).first()
            self.assertIsNotNone(row)
            self.assertTrue(row.hashed_password)
            self.assertEqual(row.google_user_id, info["sub"])
            self.assertEqual(row.auth_provider, "google")
            saved_name = row.full_name
            info["name"] = "Should Not Overwrite"
            with patch.dict(os.environ, {"GOOGLE_CLIENT_ID": "jod-client.apps.googleusercontent.com"}):
                with patch("google.oauth2.id_token.verify_oauth2_token", return_value=info):
                    again = client.post("/api/auth/google", json={"credential": _rs256_shaped_jwt(), "intent": "login"})
            self.assertEqual(again.status_code, 200)
            db.refresh(row)
            self.assertEqual(row.full_name, saved_name)
        finally:
            db.close()


if __name__ == "__main__":
    unittest.main(verbosity=2)
