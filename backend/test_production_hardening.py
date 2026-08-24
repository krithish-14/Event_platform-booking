"""Production-hardening tests. Does not print secret values."""
from __future__ import annotations

import os
import sys
import unittest
from unittest.mock import patch

_BACKEND = os.path.dirname(os.path.abspath(__file__))
_ROOT = os.path.dirname(_BACKEND)
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)
os.chdir(_BACKEND)


class ProductionEnvTests(unittest.TestCase):
    def test_placeholder_secret_rejected_in_production(self):
        from Services.runtime_env import validate_production_env

        env = {
            "APP_ENV": "production",
            "DEBUG": "False",
            "DATABASE_URL": "postgresql+psycopg://jod:CHANGE_ME_STRONG_DB_PASSWORD@postgres:5432/jod_events",
            "SECRET_KEY": "CHANGE_ME_64_CHAR_RANDOM_SECRET",
            "FILE_ENCRYPTION_KEY": "CHANGE_ME_LONG_RANDOM_FILE_ENCRYPTION_KEY",
            "PUBLIC_APP_URL": "https://YOUR_DOMAIN.com",
            "ALLOWED_ORIGINS": "https://YOUR_DOMAIN.com",
            "ADMIN_EMAIL": "CHANGE_ME_ADMIN_EMAIL",
            "ADMIN_PASSWORD": "CHANGE_ME_STRONG_PASSWORD",
        }
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaises(RuntimeError):
                validate_production_env()

    def test_cors_production_rejects_star(self):
        from Services.runtime_env import cors_origins

        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "ALLOWED_ORIGINS": "https://events.example.com,*",
        }, clear=False):
            origins = cors_origins()
            self.assertNotIn("*", origins)
            self.assertEqual(origins, ["https://events.example.com"])

    def test_debug_must_be_false_in_production(self):
        from Services.runtime_env import validate_production_env

        with patch.dict(os.environ, {"APP_ENV": "production", "DEBUG": "True"}, clear=False):
            with self.assertRaises(RuntimeError):
                validate_production_env()


class RateLimitTests(unittest.TestCase):
    def test_limit_blocks_after_threshold(self):
        from Services import rate_limit

        key = "unit-test-bucket"
        self.assertTrue(rate_limit.allow(key, 2, 60))
        self.assertTrue(rate_limit.allow(key, 2, 60))
        self.assertFalse(rate_limit.allow(key, 2, 60))


class SanitizeAndUploadTests(unittest.TestCase):
    def test_script_tags_stripped(self):
        from Utils.text_sanitize import sanitize_text

        cleaned = sanitize_text('<script>alert(1)</script>Comedy Night onerror=x')
        self.assertNotIn("<script", cleaned.lower())
        self.assertNotIn("onerror=", cleaned.lower())

    def test_payment_image_magic_bytes(self):
        from Utils.categories import is_allowed_image_bytes

        jpeg = b"\xff\xd8\xff" + b"\x00" * 20
        exe = b"MZ" + b"\x00" * 20
        self.assertTrue(is_allowed_image_bytes(jpeg, "image/jpeg"))
        self.assertFalse(is_allowed_image_bytes(exe, "image/jpeg"))
        self.assertFalse(is_allowed_image_bytes(b"not-an-image", "application/octet-stream"))


class FileKeyRotationTests(unittest.TestCase):
    def test_previous_key_can_decrypt(self):
        from cryptography.fernet import Fernet
        import base64
        import hashlib
        from Services import file_storage

        old = "old-file-encryption-key-value-32chars!!"
        new = "new-file-encryption-key-value-32chars!!"

        def fernet(raw: str) -> Fernet:
            digest = hashlib.sha256(raw.encode("utf-8")).digest()
            return Fernet(base64.urlsafe_b64encode(digest))

        token = fernet(old).encrypt(b"kyc-bytes")
        with patch.dict(os.environ, {
            "FILE_ENCRYPTION_KEY": new,
            "FILE_ENCRYPTION_KEY_PREVIOUS": old,
            "APP_ENV": "development",
        }, clear=False):
            with patch.object(file_storage, "_current_key_material", return_value=new):
                plain = file_storage.decrypt_bytes(token)
        self.assertEqual(plain, b"kyc-bytes")


class FrontendOriginTests(unittest.TestCase):
    def test_api_origin_only_hardcoded_for_local_split(self):
        frontend = os.path.join(_ROOT, "frontend")
        offenders = []
        for dirpath, _, files in os.walk(frontend):
            for name in files:
                if not name.endswith((".js", ".html")):
                    continue
                path = os.path.join(dirpath, name)
                rel = os.path.relpath(path, frontend).replace("\\", "/")
                with open(path, encoding="utf-8") as fh:
                    text = fh.read()
                if "127.0.0.1:8001" in text or "localhost:8001" in text:
                    if rel != "js/api-config.js":
                        offenders.append(rel)
        self.assertEqual(offenders, [], msg=f"hardcoded API hosts remain in {offenders}")

    def test_api_config_exists(self):
        path = os.path.join(_ROOT, "frontend", "js", "api-config.js")
        self.assertTrue(os.path.isfile(path))
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("getApiOrigin", text)
        self.assertIn("isLocalSplitFrontend", text)


class HealthPayloadTests(unittest.TestCase):
    def test_health_functions_exist(self):
        from FastAPI import main as appmod

        payload = appmod.health_check()
        self.assertEqual(payload.get("status"), "healthy")
        self.assertIn("version", payload)
        self.assertIsInstance(payload.get("r2_configured"), bool)
        self.assertNotIn("DATABASE_URL", payload)
        self.assertNotIn("SECRET_KEY", payload)


class SecretValidationTests(unittest.TestCase):
    def test_identical_keys_rejected_in_production(self):
        from Services.runtime_env import validate_production_env

        shared = "aB3$kL9mQ2nP7xR4sT8vW1yZ5uC0dE6fG"
        env = {
            "APP_ENV": "production",
            "DEBUG": "False",
            "DATABASE_URL": "postgresql+psycopg://jod:NotAPlaceholderPass9@postgres:5432/jod_events",
            "SECRET_KEY": shared,
            "FILE_ENCRYPTION_KEY": shared,
            "PUBLIC_APP_URL": "https://events.example.com",
            "ALLOWED_ORIGINS": "https://events.example.com",
            "ADMIN_EMAIL": "admin@example.com",
            "ADMIN_PASSWORD": "NotTheDefaultAdminPass9",
        }
        with patch.dict(os.environ, env, clear=False):
            with self.assertRaises(RuntimeError):
                validate_production_env()

    def test_change_me_rejected_even_when_long(self):
        from Services.runtime_env import require_strong_secret

        with patch.dict(os.environ, {"APP_ENV": "production"}, clear=False):
            with self.assertRaises(RuntimeError):
                require_strong_secret("CHANGE_ME_64_CHAR_RANDOM_SECRET_WITH_PADDING!!", "SECRET_KEY")


class PaymentMagicByteTests(unittest.TestCase):
    def test_svg_and_html_rejected(self):
        from Utils.categories import is_allowed_image_bytes, is_allowed_image_filename

        self.assertFalse(is_allowed_image_filename("proof.svg"))
        self.assertFalse(is_allowed_image_bytes(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>", "image/svg+xml"))
        self.assertFalse(is_allowed_image_bytes(b"<!DOCTYPE html><html></html>", "image/jpeg"))
        jpeg = b"\xff\xd8\xff" + b"\x00" * 20
        self.assertTrue(is_allowed_image_bytes(jpeg, "image/jpeg"))


class OtpSecurityTests(unittest.TestCase):
    def test_otp_is_hashed_and_not_plaintext(self):
        from Services.otp import generate_otp, hash_otp

        code = generate_otp()
        self.assertEqual(len(code), 6)
        self.assertTrue(code.isdigit())
        digest = hash_otp("user@example.com", code, "password_reset")
        self.assertNotEqual(digest, code)
        self.assertEqual(len(digest), 64)

    def test_plaintext_otp_row_is_rejected(self):
        from Services import otp as otp_service
        from Models.base import get_session_factory
        from Models.email_otp import EmailOTP
        from fastapi import HTTPException
        from datetime import datetime, timedelta

        db = get_session_factory()()
        email = f"otpplain_{os.urandom(3).hex()}@example.com"
        try:
            db.add(EmailOTP(
                email=email,
                otp_code="123456",
                expires_at=datetime.utcnow() + timedelta(minutes=10),
                is_verified=False,
                purpose="password_reset",
                attempt_count=0,
            ))
            db.commit()
            with self.assertRaises(HTTPException) as ctx:
                otp_service.verify_otp(db, email, "123456", "password_reset")
            self.assertEqual(ctx.exception.status_code, 400)
        finally:
            db.query(EmailOTP).filter(EmailOTP.email == email).delete(synchronize_session=False)
            db.commit()
            db.close()


class InviteUrlTests(unittest.TestCase):
    def test_invite_url_ignores_origin_header(self):
        from APIs.volunteers import _frontend_base

        class FakeRequest:
            headers = {"origin": "https://evil.example", "referer": "https://evil.example/steal"}

        with patch.dict(os.environ, {"APP_ENV": "development", "PUBLIC_APP_URL": "http://127.0.0.1:5500", "FRONTEND_URL": "http://127.0.0.1:5500"}, clear=False):
            self.assertEqual(_frontend_base(FakeRequest()), "http://127.0.0.1:5500")


class CookieAuthTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from FastAPI.main import app
        from fastapi.testclient import TestClient
        cls.client = TestClient(app)

    def test_login_json_omits_jwt(self):
        email = f"stage2_{os.urandom(4).hex()}@example.com"
        username = f"u{os.urandom(4).hex()}"
        res = self.client.post("/api/auth/register", json={
            "email": email,
            "username": username,
            "password": "Passw0rd1",
            "full_name": "Stage Two",
        })
        self.assertIn(res.status_code, (200, 201), res.text)
        body = res.json()
        self.assertEqual(body.get("access_token") or "", "")
        self.assertTrue(self.client.cookies.get("jod_access_token"))
        me = self.client.get("/api/auth/me")
        self.assertEqual(me.status_code, 200)
        check = self.client.get("/api/auth/check", params={"email": email})
        self.assertEqual(check.status_code, 200)
        self.assertTrue(check.json().get("email_available"))


class CsrfCookieTests(unittest.TestCase):
    def test_cookie_mutation_requires_csrf_when_enabled(self):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        with patch.dict(os.environ, {"AUTH_CSRF": "true"}, clear=False):
            client = TestClient(app)
            email = f"csrf_{os.urandom(4).hex()}@example.com"
            res = client.post("/api/auth/register", json={
                "email": email,
                "username": f"c{os.urandom(3).hex()}",
                "password": "Passw0rd1",
                "full_name": "Csrf User",
            })
            self.assertIn(res.status_code, (200, 201), res.text)
            blocked = client.post("/api/organizers/resubmit-verification", json={"action": "submitted"})
            self.assertEqual(blocked.status_code, 403)
            self.assertIn("CSRF", str(blocked.json().get("detail", "")))


class FrontendXssGuardTests(unittest.TestCase):
    def test_public_event_helpers_escape_and_reject_javascript_urls(self):
        path = os.path.join(_ROOT, "frontend", "js", "events-public.js")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn("function escapeHtml", text)
        self.assertIn("safeMediaUrl", text)
        cfg = os.path.join(_ROOT, "frontend", "js", "api-config.js")
        with open(cfg, encoding="utf-8") as fh:
            cfg_text = fh.read()
        self.assertIn("javascript:", cfg_text)
        self.assertNotIn('setItem("jod_access_token"', cfg_text)
        dash = os.path.join(_ROOT, "frontend", "js", "organizer-dashboard.js")
        with open(dash, encoding="utf-8") as fh:
            dash_text = fh.read()
        self.assertNotIn('setItem("jod_access_token"', dash_text)
        self.assertIn("function escapeVolunteerHtml", dash_text)

    def test_no_frontend_reads_jwt_from_web_storage(self):
        frontend = os.path.join(_ROOT, "frontend", "js")
        offenders = []
        for name in os.listdir(frontend):
            if not name.endswith(".js"):
                continue
            path = os.path.join(frontend, name)
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            if 'getItem("jod_access_token"' in text or "getItem('jod_access_token'" in text:
                offenders.append(name)
            if 'setItem("jod_access_token"' in text or "setItem('jod_access_token'" in text:
                offenders.append(name)
        self.assertEqual(offenders, [], msg=f"JWT still read/written in {offenders}")


class MediumSecurityStage3Tests(unittest.TestCase):
    def test_jwt_fixed_alg_and_claims(self):
        from Authentication.jwt_handler import (
            ALGORITHM,
            create_access_token,
            decode_access_token,
            JWT_AUDIENCE,
            JWT_ISSUER,
        )
        import jwt as pyjwt

        self.assertEqual(ALGORITHM, "HS256")
        token = create_access_token({"sub": "CUST-1", "email": "a@example.com"})
        payload = decode_access_token(token)
        self.assertIsNotNone(payload)
        self.assertEqual(payload["iss"], JWT_ISSUER)
        self.assertEqual(payload["aud"], JWT_AUDIENCE)
        self.assertIn("jti", payload)
        # Missing audience must fail closed
        bad = pyjwt.encode(
            {"sub": "CUST-1", "exp": payload["exp"], "iss": JWT_ISSUER},
            __import__("Authentication.jwt_handler", fromlist=["SECRET_KEY"]).SECRET_KEY,
            algorithm="HS256",
        )
        self.assertIsNone(decode_access_token(bad))

    def test_cors_production_rejects_localhost(self):
        from Services.runtime_env import cors_origins

        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "ALLOWED_ORIGINS": "https://events.example.com,http://127.0.0.1:5500",
        }, clear=False):
            with self.assertRaises(RuntimeError):
                cors_origins()

    def test_csp_header_in_staging(self):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        with patch.dict(os.environ, {"APP_ENV": "staging"}, clear=False):
            client = TestClient(app)
            res = client.get("/health")
            self.assertEqual(res.status_code, 200)
            self.assertIn("Content-Security-Policy", res.headers)
            self.assertIn("default-src 'self'", res.headers["Content-Security-Policy"])

    def test_unknown_event_template_returns_404(self):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        client = TestClient(app)
        res = client.get("/event/00000000-0000-4000-8000-000000000099")
        self.assertEqual(res.status_code, 404)

    def test_public_ticket_handler_strips_pii(self):
        path = os.path.join(_BACKEND, "APIs", "tickets.py")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        self.assertIn('allowed = {', text)
        for field in ("user_email", "receiver_email", "customer_id", "payment_id", "user_phone"):
            # Sensitive keys must not appear in the allow-list literal block
            start = text.index("allowed = {")
            end = text.index("}", start)
            block = text[start:end]
            self.assertNotIn(f'"{field}"', block)

    def test_utility_scripts_excluded_from_docker_image(self):
        dockerignore = os.path.join(_ROOT, ".dockerignore")
        with open(dockerignore, encoding="utf-8") as fh:
            text = fh.read()
        for name in ("inspect_db.py", "dump_schema.py", "check_cols.py", "migrate_db_v2.py"):
            self.assertIn(name, text)

    def test_invite_ttl_shortened(self):
        from Models.event_volunteer import INVITE_TTL_HOURS

        self.assertLessEqual(INVITE_TTL_HOURS, 48)

    def test_admin_sync_password_refused_in_production(self):
        from Services.admin_seed import seed_admin_user

        class _FakeQuery:
            def filter(self, *a, **k):
                return self

            def first(self):
                return None

        class _FakeDb:
            def query(self, *a, **k):
                return _FakeQuery()

            def add(self, *a, **k):
                return None

            def commit(self):
                return None

        with patch.dict(os.environ, {
            "APP_ENV": "production",
            "ADMIN_EMAIL": "admin@example.com",
            "ADMIN_PASSWORD": "StrongPassw0rd!NotWeak",
            "ADMIN_SYNC_PASSWORD": "true",
        }, clear=False):
            with self.assertRaises(RuntimeError):
                seed_admin_user(_FakeDb())

    def test_file_encryption_key_no_secret_fallback(self):
        path = os.path.join(_BACKEND, "Services", "file_storage.py")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        self.assertNotIn('os.getenv("FILE_ENCRYPTION_KEY") or os.getenv("SECRET_KEY")', text)

    def test_frontend_api_base_no_hardcoded_private_network(self):
        frontend = os.path.join(_ROOT, "frontend", "js")
        allowed = {"api-config.js"}
        offenders = []
        for name in os.listdir(frontend):
            if not name.endswith(".js") or name in allowed:
                continue
            path = os.path.join(frontend, name)
            with open(path, encoding="utf-8") as fh:
                text = fh.read()
            if "http://127.0.0.1:8001" in text or "http://localhost:8001" in text:
                offenders.append(name)
            if "http://192.168." in text or "http://10." in text:
                offenders.append(name)
        self.assertEqual(offenders, [], msg=f"Hardcoded private API hosts in {offenders}")


class LowSecurityFixesTests(unittest.TestCase):
    def test_password_over_72_bytes_rejected(self):
        from Services.auth_service import (
            PasswordTooLongError,
            assert_password_within_bcrypt_limit,
            get_password_hash,
            verify_password,
        )

        long_pw = "A1" + ("x" * 80)
        with self.assertRaises(PasswordTooLongError):
            assert_password_within_bcrypt_limit(long_pw)
        with self.assertRaises(PasswordTooLongError):
            get_password_hash(long_pw)
        self.assertFalse(verify_password(long_pw, get_password_hash("Passw0rd1")))

    def test_normal_password_still_hashes(self):
        from Services.auth_service import get_password_hash, verify_password

        hashed = get_password_hash("Passw0rd1")
        self.assertTrue(verify_password("Passw0rd1", hashed))
        self.assertFalse(verify_password("wrong-pass", hashed))

    def test_root_omits_docs_when_disabled(self):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        with patch.dict(os.environ, {"APP_ENV": "production", "ENABLE_DOCS": "false"}, clear=False):
            client = TestClient(app)
            res = client.get("/")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertNotIn("docs", body)

    def test_logout_delete_cookie_matches_set_attrs(self):
        path = os.path.join(_BACKEND, "APIs", "auth.py")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        logout_idx = text.index("def logout")
        block = text[logout_idx:logout_idx + 500]
        self.assertIn("httponly=True", block)
        self.assertIn('path="/"', block)
        self.assertIn('samesite="lax"', block)
        self.assertIn("secure=cookie_secure()", block)

    def test_support_ticket_rate_limited(self):
        from Services.rate_limit import SUPPORT_LIMIT, allow, client_ip, limit_support
        from fastapi import HTTPException

        class _Req:
            headers = {}
            client = type("C", (), {"host": "203.0.113.99"})()

        with patch("Services.rate_limit.rate_limiting_enabled", return_value=True):
            key = f"support:ip:{client_ip(_Req())}"
            for _ in range(SUPPORT_LIMIT[0]):
                self.assertTrue(allow(key, SUPPORT_LIMIT[0], SUPPORT_LIMIT[1]))
            with self.assertRaises(HTTPException) as ctx:
                limit_support(_Req(), "spam@example.com")
            self.assertEqual(ctx.exception.status_code, 429)

    def test_puppeteer_removed_from_package_json(self):
        path = os.path.join(_ROOT, "package.json")
        with open(path, encoding="utf-8") as fh:
            text = fh.read()
        self.assertNotIn("puppeteer", text)


class CloudflareR2UrlTests(unittest.TestCase):
    def test_public_url_matches_existing_logo_pattern(self):
        from Services import r2_storage

        with patch.dict(os.environ, {
            "R2_PUBLIC_BASE_URL": "https://assets.jodevents.com/images",
        }, clear=False):
            url = r2_storage.encode_key_url("JOD Logo.png")
        self.assertEqual(url, "https://assets.jodevents.com/images/JOD%20Logo.png")

    def test_upload_keys_sit_beside_static_images(self):
        from Services import r2_storage

        with patch.dict(os.environ, {"R2_OBJECT_PREFIX": "images"}, clear=False):
            rel = r2_storage.relative_object_key(
                purpose="banner",
                filename="hero.jpg",
                event_id="evt1",
                file_id="abc123",
            )
            self.assertEqual(rel, "uploads/banner/evt1/abc123.jpg")
            self.assertEqual(
                r2_storage.object_key_for(rel),
                "images/uploads/banner/evt1/abc123.jpg",
            )

    def test_not_configured_without_keys(self):
        from Services import r2_storage

        with patch.dict(os.environ, {
            "R2_ACCOUNT_ID": "",
            "R2_ACCESS_KEY_ID": "",
            "R2_SECRET_ACCESS_KEY": "",
            "R2_BUCKET_NAME": "",
            "R2_BUCKET": "",
        }, clear=False):
            self.assertFalse(r2_storage.is_configured())


if __name__ == "__main__":
    unittest.main()
