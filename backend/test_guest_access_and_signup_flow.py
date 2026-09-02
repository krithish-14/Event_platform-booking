"""
Comprehensive Automated Test Suite for Guest User Access Control & Signup Data Persistence.
"""

import os
import sys
import re
import secrets
from pathlib import Path
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException

from Models.base import SessionLocal, get_engine, create_tables
from Models.user import User
from Models.user_signups import UserSignup
from Models.user_logins import UserLogin
from APIs.auth import UserRegisterRequest, register, login
from fastapi.security import OAuth2PasswordRequestForm


def test_guest_access_and_signup_persistence():
    print("==========================================================================")
    print("   STARTING GUEST ACCESS CONTROL & SIGNUP DATA PERSISTENCE VERIFICATION")
    print("==========================================================================")
    create_tables()
    db: Session = SessionLocal()

    # --------------------------------------------------------------------------
    # TEST 1: Register new user with full required & profile fields
    # --------------------------------------------------------------------------
    print("\n[TEST 1] User Registration & Complete PostgreSQL/DB Persistence")
    unique_suffix = secrets.token_hex(4)
    test_email = f"signup_persist_{unique_suffix}@jodevents.com"
    test_username = f"user_{unique_suffix}"
    test_fullname = f"Satheesh Tester {unique_suffix.upper()}"
    test_password = "SecurePassword123!"
    test_avatar = f"https://images.unsplash.com/avatar-{unique_suffix}"
    test_city = "Chennai"
    test_pin = "600001"

    req = UserRegisterRequest(
        email=test_email,
        username=test_username,
        full_name=test_fullname,
        phone="9876543210",
        password=test_password,
        avatar_url=test_avatar,
        city=test_city,
        location_pincode=test_pin,
        accepted_privacy_policy=True,
    )

    reg_resp = register(req, db)
    assert reg_resp["access_token"], "Registration did not return access token"
    assert reg_resp["user"]["email"] == test_email.lower(), "User email mismatch in response"
    assert reg_resp["user"]["username"] == test_username, "Username mismatch in response"
    assert reg_resp["user"]["customer_id"].startswith("CUST-"), "Customer ID missing or wrong prefix"
    print(f"  [OK] Registration successful for {test_email} (Customer ID: {reg_resp['user']['customer_id']})")

    # Verify directly from Database entity
    db_user = db.query(User).filter(func.lower(User.email) == test_email.lower()).first()
    assert db_user is not None, "User was not persisted in database!"
    assert db_user.customer_id == reg_resp["user"]["customer_id"], "DB customer_id mismatch"
    assert db_user.id is not None, "DB UUID id is missing"
    assert db_user.full_name == test_fullname, "DB full_name mismatch"
    assert db_user.hashed_password != test_password, "Password was not hashed securely!"
    assert db_user.avatar_url == test_avatar, "DB avatar_url mismatch"
    assert db_user.city == test_city, "DB city mismatch"
    assert db_user.location_pin == test_pin, "DB location_pin mismatch"
    assert db_user.is_active is True, "DB is_active flag mismatch"
    assert db_user.created_at is not None, "DB created_at timestamp is missing"
    print("  [OK] User entity successfully verified in database with all required fields")

    # Verify audit log in user_signups table
    signup_log = db.query(UserSignup).filter(UserSignup.customer_id == db_user.customer_id).first()
    assert signup_log is not None, "UserSignup audit record not found in user_signups table"
    assert signup_log.email == test_email.lower(), "UserSignup audit email mismatch"
    print("  [OK] UserSignup audit log record verified in user_signups table")

    # --------------------------------------------------------------------------
    # TEST 2: Duplicate Email & Username Prevention
    # --------------------------------------------------------------------------
    print("\n[TEST 2] Duplicate Email (Case-Insensitive) & Username Prevention")
    # Exact and uppercase email repeat attempt
    dup_req_email = UserRegisterRequest(
        email=test_email.upper(),
        username=f"different_{secrets.token_hex(3)}",
        full_name="Dup Email User",
        phone="9876543211",
        password="ValidPassword123!",
        accepted_privacy_policy=True,
    )
    try:
        register(dup_req_email, db)
        assert False, "FAILED: Duplicate uppercase email was not rejected!"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "User already exists" in exc.detail
        print("  [OK] Duplicate email (case-insensitive) correctly rejected with 400 User already exists")

    # Duplicate username attempt
    dup_req_username = UserRegisterRequest(
        email=f"different_{secrets.token_hex(4)}@jodevents.com",
        username=test_username.upper(),
        full_name="Dup Username User",
        phone="9876543212",
        password="ValidPassword123!",
        accepted_privacy_policy=True,
    )
    try:
        register(dup_req_username, db)
        assert False, "FAILED: Duplicate username was not rejected!"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert "Username already taken" in exc.detail
        print("  [OK] Duplicate username correctly rejected with 400 Username already taken")

    # --------------------------------------------------------------------------
    # TEST 3: Login Verification with Stored Credentials
    # --------------------------------------------------------------------------
    print("\n[TEST 3] Login Verification with Stored Credentials & Session Token")
    login_form = OAuth2PasswordRequestForm(
        grant_type="password",
        username=test_email,
        password=test_password,
        scope="",
        client_id=None,
        client_secret=None
    )
    login_resp = login(login_form, db)
    assert login_resp["access_token"], "Login did not return access token"
    assert login_resp["user"]["customer_id"] == db_user.customer_id, "Login user customer_id mismatch"
    print(f"  [OK] Login successful with JWT token issued for Customer ID: {login_resp['user']['customer_id']}")

    # Verify user_logins audit log
    login_log = db.query(UserLogin).filter(UserLogin.customer_id == db_user.customer_id).first()
    assert login_log is not None, "UserLogin audit record not found in user_logins table"
    assert login_log.status == "SUCCESS", "UserLogin status is not SUCCESS"
    print("  [OK] UserLogin audit record verified in user_logins table")

    # --------------------------------------------------------------------------
    # TEST 4: Frontend Guest Interception & Modal Logic
    # --------------------------------------------------------------------------
    print("\n[TEST 4] Frontend Guest Interception & Modal Controls Verification")
    root = Path(__file__).parent.parent
    auth_js = (root / "frontend" / "js" / "auth.js").read_text(encoding="utf-8")
    script_js = (root / "frontend" / "js" / "script.js").read_text(encoding="utf-8")
    style_css = (root / "frontend" / "css" / "style.css").read_text(encoding="utf-8")
    header_html = (root / "frontend" / "components" / "header.html").read_text(encoding="utf-8")

    # 1. Check auth.js has universal guest modal, openGuestAuthModal, closeGuestAuthModal, showGuestModal
    assert "ensureGuestModal" in auth_js, "ensureGuestModal missing in auth.js"
    assert "openGuestAuthModal" in auth_js, "openGuestAuthModal missing in auth.js"
    assert "closeGuestAuthModal" in auth_js, "closeGuestAuthModal missing in auth.js"
    assert "showGuestModal" in auth_js, "showGuestModal alias missing in auth.js"
    assert "jod_redirect_after_login" in auth_js, "jod_redirect_after_login tracking missing in auth.js"
    print("  [OK] auth.js contains universal ensureGuestModal, openGuestAuthModal, closeGuestAuthModal")

    # 2. Check Host Your Event navigation and click interception
    assert "navigateToHostFlow" in auth_js, "navigateToHostFlow missing in auth.js"
    assert "Sign Up to Host Your Event" in auth_js, "Host flow guest messaging missing in auth.js"
    assert "host-your-event.html" in header_html, "Host Your Event link missing in header.html"
    assert ("handleGuestOrNavigate" in header_html or "navigateToHostFlow" in header_html), "Guest handling not wired in header.html"
    print("  [OK] Host Your Event nav option properly wired with guest modal interception")

    # 3. Check Event card, carousel, and booking button click interception
    assert "event-card" in auth_js, "event-card click interception missing in auth.js"
    assert "cat-event-card" in auth_js, "cat-event-card click interception missing in auth.js"
    assert "btn-book-now" in auth_js, "btn-book-now click interception missing in auth.js"
    assert "Sign Up to Book Tickets" in auth_js, "Book tickets guest messaging missing in auth.js"
    print("  [OK] Event cards, carousels, and booking buttons click interception verified")

    # 4. Check CSS modal backdrop and responsive box styles
    assert ".guest-auth-modal-backdrop" in style_css, ".guest-auth-modal-backdrop missing in style.css"
    assert ".guest-auth-modal-box" in style_css, ".guest-auth-modal-box missing in style.css"
    assert "z-index: 99999" in style_css, "High z-index missing for modal in style.css"
    assert "guestModalSlideUp" in style_css, "guestModalSlideUp animation missing in style.css"
    print("  [OK] CSS styling for modal backdrop, animations, and high z-index verified")

    print("\n==========================================================================")
    print("   ALL GUEST ACCESS CONTROL & SIGNUP FLOW CHECKS PASSED SUCCESSFULLY!    ")
    print("==========================================================================")


if __name__ == "__main__":
    test_guest_access_and_signup_persistence()
