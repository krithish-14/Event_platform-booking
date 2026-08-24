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

    print("\n--- 3. Unsigned / forged Google JWT must fail closed ---")
    test_email = f"testgoogleuser_{random.randint(1000, 9999)}@gmail.com"
    mock_token = create_mock_google_token(test_email, "Google Test User")
    req = urllib.request.Request(
        f"{BASE_URL}/api/auth/google",
        data=json.dumps({"credential": mock_token}).encode(),
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        urllib.request.urlopen(req)
        print("[FAIL] Forged Google JWT was accepted")
        sys.exit(1)
    except urllib.error.HTTPError as e:
        assert e.code == 400, f"Expected 400 status code, got {e.code}"
        print(f"[OK] Forged Google JWT correctly returned status {e.code}")

    print("\n[SUCCESS] GOOGLE AUTH HARDENING TESTS PASSED")

if __name__ == "__main__":
    run_google_auth_tests()
