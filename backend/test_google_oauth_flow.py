"""
Automated Verification Suite for Google OAuth 2.0 Backend Integration & Data Persistence.
"""
import base64
import json
import secrets
from pathlib import Path
from sqlalchemy.orm import Session

from fastapi import HTTPException
from Models.base import SessionLocal
from Models.user import User
from Models.event import Event
from Models.booking import Booking
from APIs.auth import GoogleAuthRequest, google_auth, google_config, google_auth_url

def create_mock_google_id_token(email: str, name: str, picture: str = "https://lh3.googleusercontent.com/a/default-user") -> str:
    """Generates a valid JWT-formatted Google ID token structure for testing."""
    header = base64.b64encode(json.dumps({"alg": "RS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    payload = base64.b64encode(json.dumps({
        "iss": "https://accounts.google.com",
        "sub": f"google-sub-{secrets.token_hex(6)}",
        "email": email,
        "email_verified": True,
        "name": name,
        "picture": picture,
    }).encode()).decode().rstrip("=")
    return f"{header}.{payload}.test_signature"

async def run_tests():
    print("--- Running Google OAuth 2.0 Integration Verification ---")
    db: Session = SessionLocal()

    # 1. Test google_config endpoint
    config = google_config()
    assert "client_id" in config and "enabled" in config
    print("[OK] /api/auth/google/config returned valid configuration structure")

    # 2. Test Google Sign-Up for a NEW User
    test_email = f"googletest_{secrets.token_hex(4)}@gmail.com"
    test_name = "Jane Google User"
    test_picture = "https://lh3.googleusercontent.com/a/jane-test-pic"

    token_str = create_mock_google_id_token(test_email, test_name, test_picture)
    req = GoogleAuthRequest(credential=token_str, city="Chennai", location_pincode="600001")

    res = await google_auth(req, db)
    assert res["access_token"], "Google Auth response missing access_token"
    assert res["user"]["email"] == test_email, f"Expected {test_email}, got {res['user']['email']}"
    assert res["user"]["avatar_url"] == test_picture, "Avatar URL not saved"
    assert res["user"]["city"] == "Chennai", "City location not saved"
    assert res["user"]["customer_id"].startswith("CUST-"), f"customer_id format invalid: {res['user']['customer_id']}"
    print(f"[OK] New Google user sign-up successful. Customer ID: {res['user']['customer_id']}, Email: {res['user']['email']}")

    # 3. Verify Database Persistence
    user_db = db.query(User).filter(User.email == test_email).first()
    assert user_db is not None, "User not found in PostgreSQL/SQLite database"
    assert user_db.username, "Username not generated"
    assert user_db.hashed_password, "Hashed password not generated"
    print(f"[OK] Database record verified. Username: {user_db.username}, Password Hashed: True")

    # 4. Test Google Login for EXISTING User (Must be Rejected)
    req_login = GoogleAuthRequest(credential=token_str)
    try:
        await google_auth(req_login, db)
        assert False, "Expected HTTPException 400 for existing Google user attempt"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "User already exists"
        print("[OK] Re-login attempt with existing Google registered email correctly rejected with 'User already exists'")

    # 5. Test Google Login for User who initially created account via manual signup (Must be Rejected)
    manual_email = f"manualuser_{secrets.token_hex(4)}@example.com"
    manual_user = User(
        email=manual_email,
        username=f"manual_{secrets.token_hex(3)}",
        full_name="Manual User",
        hashed_password="hashedpassword123"
    )
    db.add(manual_user)
    db.commit()

    token_manual = create_mock_google_id_token(manual_email, "Manual User Google", "https://lh3.googleusercontent.com/a/manual-pic")
    req_manual_google = GoogleAuthRequest(credential=token_manual)
    try:
        await google_auth(req_manual_google, db)
        assert False, "Expected HTTPException 400 for manual user Google OAuth attempt"
    except HTTPException as exc:
        assert exc.status_code == 400
        assert exc.detail == "User already exists"
        print("[OK] Google OAuth attempt with email matching existing manual signup account correctly rejected with 'User already exists'")

    db.close()
    print("\nALL GOOGLE OAUTH 2.0 VERIFICATION CHECKS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_tests())
