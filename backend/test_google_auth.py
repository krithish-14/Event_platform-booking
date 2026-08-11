import urllib.request
import urllib.error
import json
import base64
import random
import sys

BASE_URL = "http://127.0.0.1:8001"

def create_mock_google_token(email: str, name: str, picture: str = "https://lh3.googleusercontent.com/a/default=s96-c"):
    header = base64.b64encode(json.dumps({"alg": "HS256", "typ": "JWT"}).encode()).decode().rstrip("=")
    body_data = {
        "iss": "https://accounts.google.com",
        "sub": f"google-uid-{random.randint(100000, 999999)}",
        "email": email,
        "email_verified": True,
        "name": name,
        "picture": picture
    }
    body = base64.b64encode(json.dumps(body_data).encode()).decode().rstrip("=")
    return f"{header}.{body}.mock_signature"


def run_google_auth_tests():
    print("--- 1. Testing GET /api/auth/google/config ---")
    req = urllib.request.Request(f"{BASE_URL}/api/auth/google/config")
    try:
        with urllib.request.urlopen(req) as resp:
            data = json.loads(resp.read().decode())
            print(f"[OK] Google config returned: {data}")
            assert "client_id" in data, "Missing client_id in config response"
            assert "enabled" in data, "Missing enabled in config response"
    except Exception as e:
        print(f"[FAIL] Config endpoint failed: {e}")
        sys.exit(1)

    print("\n--- 2. Testing POST /api/auth/google with empty payload (Error Handling) ---")
    req = urllib.request.Request(
        f"{BASE_URL}/api/auth/google",
        data=json.dumps({}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        urllib.request.urlopen(req)
        print("[FAIL] Expected 400 error for empty payload but succeeded")
        sys.exit(1)
    except urllib.error.HTTPError as e:
        print(f"[OK] Empty payload correctly returned status {e.code}")
        assert e.code == 400, f"Expected 400 status code, got {e.code}"

    print("\n--- 3. Testing Google Sign-Up for New User ---")
    test_email = f"testgoogleuser_{random.randint(1000, 9999)}@gmail.com"
    test_name = "Google Test User"
    test_picture = "https://lh3.googleusercontent.com/a/test-avatar.jpg"
    mock_token = create_mock_google_token(test_email, test_name, test_picture)

    signup_payload = {
        "credential": mock_token,
        "city": "Chennai",
        "location_pincode": "600001"
    }

    req = urllib.request.Request(
        f"{BASE_URL}/api/auth/google",
        data=json.dumps(signup_payload).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req) as resp:
            assert resp.status == 200, f"Expected status 200, got {resp.status}"
            res_data = json.loads(resp.read().decode())
            print(f"[OK] Google registration response received")
            
            assert "access_token" in res_data, "Missing access_token in response"
            assert "user" in res_data, "Missing user in response"
            
            user = res_data["user"]
            print(f"[OK] User created: email={user['email']}, username={user['username']}, customer_id={user['customer_id']}, avatar_url={user.get('avatar_url')}")
            
            assert user["email"] == test_email.lower(), f"Email mismatch: {user['email']} != {test_email}"
            assert user["full_name"] == test_name, f"Name mismatch: {user['full_name']} != {test_name}"
            assert user["avatar_url"] == test_picture, f"Avatar mismatch: {user.get('avatar_url')}"
            assert user["customer_id"].startswith("CUST-") or len(user["customer_id"]) > 5, "Invalid customer_id format"
            
            access_token = res_data["access_token"]
    except Exception as e:
        print(f"[FAIL] Google Sign-Up test failed: {e}")
        sys.exit(1)

    print("\n--- 4. Testing Session Persistence via GET /api/auth/me ---")
    req = urllib.request.Request(
        f"{BASE_URL}/api/auth/me",
        headers={"Authorization": f"Bearer {access_token}"}
    )
    try:
        with urllib.request.urlopen(req) as resp:
            me_data = json.loads(resp.read().decode())
            print(f"[OK] /api/auth/me profile validated for Google user: {me_data['email']}")
            assert me_data["email"] == test_email.lower(), "Session user email mismatch"
    except Exception as e:
        print(f"[FAIL] Session validation failed: {e}")
        sys.exit(1)

    print("\n--- 5. Testing Repeat Sign-In for Existing Google User ---")
    req = urllib.request.Request(
        f"{BASE_URL}/api/auth/google",
        data=json.dumps({"credential": mock_token}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req) as resp:
            repeat_data = json.loads(resp.read().decode())
            print(f"[OK] Repeat Google Sign-In succeeded, retrieved existing user ID: {repeat_data['user']['id']}")
            assert repeat_data["user"]["email"] == test_email.lower()
    except Exception as e:
        print(f"[FAIL] Repeat sign-in failed: {e}")
        sys.exit(1)

    print("\n[SUCCESS] ALL GOOGLE OAUTH INTEGRATION TESTS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    run_google_auth_tests()
