"""
Comprehensive Automated Verification Suite for Duplicate Email Prevention & Enforcement.
Tests:
 1. Google OAuth attempt with email registered via password -> Rejected with 400 "User already exists"
 2. Google OAuth attempt with email registered via Google OAuth -> Rejected with 400 "User already exists"
 3. Case-insensitive email attempts (uppercase vs lowercase) -> Rejected with 400 "User already exists"
 4. Manual password registration attempt with existing Google email -> Rejected with 400 "User already exists"
 5. Defensive DB verification (user count unchanged, no duplicates inserted)
"""
import base64
import json
import secrets
import asyncio
from sqlalchemy.orm import Session
from sqlalchemy import func

from fastapi import HTTPException
from Models.base import SessionLocal, get_engine, create_tables
from Models.user import User
from APIs.auth import GoogleAuthRequest, UserRegisterRequest, google_auth, register


def create_mock_google_token(email: str, name: str = "Test User") -> str:
    """Generates a JWT-formatted Google ID token structure for unit testing."""
    header = base64.b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.b64encode(json.dumps({
        "iss": "https://accounts.google.com",
        "sub": f"google-sub-{secrets.token_hex(6)}",
        "email": email,
        "email_verified": True,
        "name": name,
        "picture": "https://lh3.googleusercontent.com/a/test-avatar",
    }).encode()).decode().rstrip("=")
    return f"{header}.{payload}.test_signature"


async def run_duplicate_email_tests():
    print("==========================================================================")
    print("   STARTING DUPLICATE EMAIL & GOOGLE OAUTH REJECTION VERIFICATION")
    print("==========================================================================")
    create_tables()
    db: Session = SessionLocal()

    # --------------------------------------------------------------------------
    # TEST 1: Register user via email/password, then attempt Google OAuth sign-in
    # --------------------------------------------------------------------------
    print("\n[TEST 1] Manual Registration followed by Google OAuth attempt with same email")
    test_email_1 = f"manual_registered_{secrets.token_hex(4)}@example.com"
    test_user_1 = UserRegisterRequest(
        email=test_email_1,
        username=f"user_{secrets.token_hex(3)}",
        full_name="Manual User 1",
        phone="9876543210",
        password="Password123!",
        accepted_privacy_policy=True,
    )
    reg_resp_1 = register(test_user_1, db)
    assert reg_resp_1["access_token"], "Manual registration failed"
    print(f"  -> Successfully created manual user with email: {test_email_1}")

    initial_user_count = db.query(User).count()

    # Attempt Google OAuth with the exact same email
    token_1 = create_mock_google_token(test_email_1, "Google Attempt 1")
    req_google_1 = GoogleAuthRequest(credential=token_1)

    try:
        await google_auth(req_google_1, db)
        assert False, "FAILED: Expected Google OAuth attempt for existing email to be rejected, but it succeeded!"
    except HTTPException as exc:
        assert exc.status_code == 400, f"Expected 400 status code, got {exc.status_code}"
        assert exc.detail == "User already exists", f"Expected 'User already exists', got '{exc.detail}'"
        print(f"  [PASS] Google OAuth attempt correctly rejected with 400: '{exc.detail}'")

    assert db.query(User).count() == initial_user_count, "User count changed unexpectedly"

    # --------------------------------------------------------------------------
    # TEST 2: First-time Google OAuth registration, followed by repeat Google OAuth
    # --------------------------------------------------------------------------
    print("\n[TEST 2] First-time Google registration followed by repeat Google OAuth attempt")
    test_email_2 = f"google_user_{secrets.token_hex(4)}@gmail.com"
    token_2 = create_mock_google_token(test_email_2, "Google User 2")
    req_google_2 = GoogleAuthRequest(credential=token_2, city="Chennai", location_pincode="600001")

    res_google_2 = await google_auth(req_google_2, db)
    assert res_google_2["access_token"], "Google OAuth registration failed for new user"
    print(f"  -> Successfully registered new Google user with email: {test_email_2}")

    user_count_after_g2 = db.query(User).count()

    # Repeat Google OAuth attempt with same email
    req_google_repeat = GoogleAuthRequest(credential=token_2)
    try:
        await google_auth(req_google_repeat, db)
        assert False, "FAILED: Expected repeat Google OAuth attempt to be rejected, but it succeeded!"
    except HTTPException as exc:
        assert exc.status_code == 400, f"Expected 400 status code, got {exc.status_code}"
        assert exc.detail == "User already exists", f"Expected 'User already exists', got '{exc.detail}'"
        print(f"  [PASS] Repeat Google OAuth attempt correctly rejected with 400: '{exc.detail}'")

    assert db.query(User).count() == user_count_after_g2, "User count changed unexpectedly on repeat Google sign-in"

    # --------------------------------------------------------------------------
    # TEST 3: Case-insensitive email rejection test (Uppercase vs Lowercase)
    # --------------------------------------------------------------------------
    print("\n[TEST 3] Case-insensitive email rejection (UPPERCASE Google email attempt)")
    uppercase_email = test_email_2.upper()
    token_uppercase = create_mock_google_token(uppercase_email, "Uppercase Google User")
    req_google_upper = GoogleAuthRequest(credential=token_uppercase)

    try:
        await google_auth(req_google_upper, db)
        assert False, "FAILED: Expected uppercase email Google OAuth attempt to be rejected, but it succeeded!"
    except HTTPException as exc:
        assert exc.status_code == 400, f"Expected 400 status code, got {exc.status_code}"
        assert exc.detail == "User already exists", f"Expected 'User already exists', got '{exc.detail}'"
        print(f"  [PASS] Uppercase email ({uppercase_email}) correctly rejected with 400: '{exc.detail}'")

    # --------------------------------------------------------------------------
    # TEST 4: Manual registration attempt using an email registered via Google
    # --------------------------------------------------------------------------
    print("\n[TEST 4] Manual registration attempt using an already-registered Google email")
    test_user_dup = UserRegisterRequest(
        email=test_email_2,
        username=f"manual_dup_{secrets.token_hex(3)}",
        full_name="Dup Manual User",
        phone="9876543213",
        password="Password123!",
        accepted_privacy_policy=True,
    )
    try:
        register(test_user_dup, db)
        assert False, "FAILED: Expected manual registration for Google email to be rejected, but it succeeded!"
    except HTTPException as exc:
        assert exc.status_code == 400, f"Expected 400 status code, got {exc.status_code}"
        assert exc.detail == "User already exists", f"Expected 'User already exists', got '{exc.detail}'"
        print(f"  [PASS] Manual registration with existing Google email correctly rejected with 400: '{exc.detail}'")

    # --------------------------------------------------------------------------
    # TEST 5: Verify no duplicate emails exist in Database
    # --------------------------------------------------------------------------
    print("\n[TEST 5] Database Integrity Audit")
    emails = [u.email.lower() for u in db.query(User.email).all()]
    unique_emails = set(emails)
    assert len(emails) == len(unique_emails), f"Duplicate emails detected in DB! {emails}"
    print(f"  [PASS] Database integrity verified: {len(emails)} total users, 0 duplicate emails.")

    db.close()
    print("\n==========================================================================")
    print("   ALL DUPLICATE EMAIL & GOOGLE OAUTH REJECTION TESTS PASSED SUCCESSFULLY!")
    print("==========================================================================")

if __name__ == "__main__":
    asyncio.run(run_duplicate_email_tests())
