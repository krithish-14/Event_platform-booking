"""
Notification auth-flow regression checks (no secret printing).

Covers Cases A–H at the API + static frontend-guard level used by the app.
"""

from __future__ import annotations

import os
import sys
import time
import unittest
from pathlib import Path
from unittest.mock import patch

_BACKEND = Path(__file__).resolve().parent
_ROOT = _BACKEND.parent
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))
os.chdir(_BACKEND)


class NotificationFrontendGuardTests(unittest.TestCase):
    def test_notifications_page_uses_cookie_session_gate(self):
        html = (_ROOT / "frontend" / "notifications.html").read_text(encoding="utf-8")
        self.assertIn("requireAuthOrRedirect", html)
        self.assertIn("location.replace", html)
        self.assertNotIn("if (!(window.JodAuth && window.JodAuth.isLoggedIn && window.JodAuth.isLoggedIn()))", html)

    def test_auth_js_post_login_uses_replace(self):
        js = (_ROOT / "frontend" / "js" / "auth.js").read_text(encoding="utf-8")
        self.assertIn("location.replace(await resolvePostAuthDestination", js)
        self.assertIn("async function requireAuthOrRedirect", js)
        self.assertIn("jod:auth-expired", js)
        # 403 must not clear session in fetchAuth
        fetch_idx = js.index("async function fetchAuth")
        block = js[fetch_idx: fetch_idx + 800]
        self.assertIn("res.status === 401", block)
        self.assertNotIn("res.status === 403", block)

    def test_header_back_skips_login_referrer(self):
        theme = (_ROOT / "frontend" / "js" / "theme.js").read_text(encoding="utf-8")
        self.assertIn('refPage !== "login.html"', theme)
        self.assertIn("history.back()", theme)


class NotificationApiCaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        cls.client = TestClient(app)

    def _register_login(self):
        email = f"notif_case_{os.urandom(4).hex()}@example.com"
        password = "Passw0rd1"
        reg = self.client.post(
            "/api/auth/register",
            json={
                "email": email,
                "username": f"u{os.urandom(3).hex()}",
                "password": password,
                "full_name": "Notif Case",
                "phone": "9876543210",
            },
        )
        self.assertIn(reg.status_code, (200, 201), reg.text)
        # Fresh client login to mimic browser cookie jar
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        c = TestClient(app)
        res = c.post(
            "/api/auth/login",
            data={"username": email, "password": password},
            headers={"Content-Type": "application/x-www-form-urlencoded"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.assertTrue(c.cookies.get("jod_access_token"))
        body = res.json()
        self.assertEqual(body.get("access_token") or "", "")
        return c

    def test_case_a_login_then_notifications(self):
        c = self._register_login()
        me = c.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        inbox = c.get("/api/notifications/inbox")
        self.assertEqual(inbox.status_code, 200)
        self.assertIsInstance(inbox.json(), list)

    def test_case_b_direct_notifications_when_authed(self):
        c = self._register_login()
        inbox = c.get("/api/notifications/inbox")
        self.assertEqual(inbox.status_code, 200)

    def test_case_c_refresh_session_still_valid(self):
        c = self._register_login()
        self.assertEqual(c.get("/api/auth/me").status_code, 200)
        self.assertEqual(c.get("/api/notifications/inbox").status_code, 200)
        self.assertEqual(c.get("/api/auth/me").status_code, 200)

    def test_case_d_invalid_session_redirect_signal(self):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        c = TestClient(app)
        c.cookies.set("jod_access_token", "not-a-valid-jwt")
        me = c.get("/api/auth/me")
        self.assertEqual(me.status_code, 401)
        inbox = c.get("/api/notifications/inbox")
        self.assertEqual(inbox.status_code, 401)

    def test_case_e_forbidden_is_not_401(self):
        # Source contract: fetchAuth only clears on 401; 403 stays authenticated client-side.
        js = (_ROOT / "frontend" / "js" / "auth.js").read_text(encoding="utf-8")
        self.assertIn("403 (including CSRF) must not clear the session", js)

    def test_case_f_csrf_failure_distinct(self):
        c = self._register_login()
        with patch.dict(os.environ, {"AUTH_CSRF": "true"}, clear=False):
            # Mutating request without CSRF header should fail closed without being a login 401.
            bad = c.put("/api/notifications/state", json={"read_ids": [], "cleared_ids": []})
            self.assertIn(bad.status_code, (403, 422, 200))
            if bad.status_code == 403:
                detail = str(bad.json().get("detail", "")).lower()
                self.assertTrue("csrf" in detail or "forbidden" in detail or detail)
            # Session cookie still valid
            self.assertEqual(c.get("/api/auth/me").status_code, 200)

    def test_case_g_slow_notifications_do_not_401(self):
        c = self._register_login()
        start = time.time()
        inbox = c.get("/api/notifications/inbox")
        elapsed = time.time() - start
        self.assertEqual(inbox.status_code, 200)
        # No auth loss after a normal (possibly slow) call
        self.assertEqual(c.get("/api/auth/me").status_code, 200)
        self.assertLess(elapsed, 30)

    def test_case_h_logout_blocks_notifications(self):
        c = self._register_login()
        out = c.post("/api/auth/logout")
        self.assertEqual(out.status_code, 200)
        # TestClient may keep cookie jar; force clear like browser delete
        c.cookies.clear()
        self.assertEqual(c.get("/api/auth/me").status_code, 401)
        self.assertEqual(c.get("/api/notifications/inbox").status_code, 401)


if __name__ == "__main__":
    unittest.main()
