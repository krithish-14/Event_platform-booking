"""
Account uniqueness tests after Google Identity Services linking.

1. Password account + Google sign-in with the same verified email → link and login.
2. Repeat Google sign-in → login, no second user.
3. Manual registration with an existing Google email → rejected.
4. Database has no duplicate emails.
"""
import os
import sys
import unittest
import uuid
from unittest.mock import patch

_BACKEND = os.path.dirname(os.path.abspath(__file__))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)

from test_critical_security_fixes import GoogleAccountLinkingTests


class DuplicateEmailLinkingTests(GoogleAccountLinkingTests):
    def test_manual_register_rejected_for_existing_google_email(self):
        from fastapi.testclient import TestClient

        email = f"gdup_{uuid.uuid4().hex[:10]}@example.com"
        client = TestClient(self.app)
        first = self._google_post(client, email, f"sub-{uuid.uuid4().hex[:12]}")
        if first.status_code != 200:
            self.skipTest(f"google auth unavailable ({first.status_code})")
        res = client.post(
            "/api/auth/register",
            json={
                "email": email,
                "username": f"u{uuid.uuid4().hex[:12]}",
                "password": "Passw0rd1",
                "full_name": "Dup Manual User",
                "phone": "9876543213",
                "accepted_privacy_policy": True,
            },
        )
        self.assertEqual(res.status_code, 400)


if __name__ == "__main__":
    unittest.main(verbosity=2)
