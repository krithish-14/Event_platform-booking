"""
End-to-end verification + publish gate API tests.
Tests:
 S1: New organizer → NOT_SUBMITTED
 S2: Submit KYC → PENDING
 S3: PENDING → publish blocked
 S4: VERIFIED → status correct, can_publish=True
 S5: VERIFIED → publish success
 S6: REJECTED → status + rejection reason + resubmit works → PENDING again
 S7: VERIFIED → publish check for stitch redirect (confirm internal flow only)
 S8: Unauthenticated/anon → publish rejected 401/403
"""

import json
import os
import sys
import uuid
import urllib.request
import urllib.parse
import urllib.error

BASE = "http://127.0.0.1:8001"
PASS = 0
FAIL = 0


def req(method, path, body=None, headers=None, query=None, _redirect_count=0):
    url = BASE + path
    if query:
        url += "?" + urllib.parse.urlencode(query)
    data = None
    hdrs = {"Accept": "application/json"}
    if headers:
        hdrs.update(headers)
    saved_body = body
    saved_method = method
    saved_data = None
    if body is not None:
        if isinstance(body, dict):
            saved_data = json.dumps(body).encode("utf-8")
            hdrs["Content-Type"] = "application/json"
        else:
            saved_data = body
    data = saved_data
    saved_hdrs = dict(hdrs)  # save AFTER Content-Type is set so redirect carries it
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(r, timeout=15) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            try:
                return resp.status, json.loads(raw) if raw else None
            except Exception:
                return resp.status, raw
    except urllib.error.HTTPError as e:
        # Follow 307/308 redirects (POST method preserved) for trailing-slash mismatches
        if e.code in (307, 308) and e.headers and e.headers.get("Location") and _redirect_count < 3:
            new_url = e.headers["Location"]
            # Parse new URL and re-issue with same method + body + headers (INCLUDING Content-Type)
            try:
                resp_obj = urllib.request.urlopen(
                    urllib.request.Request(new_url, data=saved_data, method=saved_method, headers=saved_hdrs),
                    timeout=15
                )
                raw = resp_obj.read().decode("utf-8", errors="replace")
                try:
                    return resp_obj.status, json.loads(raw) if raw else None
                except Exception:
                    return resp_obj.status, raw
            except urllib.error.HTTPError as e2:
                raw = e2.read().decode("utf-8", errors="replace")
                try:
                    return e2.code, json.loads(raw) if raw else None
                except Exception:
                    return e2.code, raw
            except Exception as e2:
                return None, str(e2)
        raw = e.read().decode("utf-8", errors="replace")
        try:
            return e.code, json.loads(raw) if raw else None
        except Exception:
            return e.code, raw
    except Exception as e:
        return None, str(e)


def assert_eq(name, actual, expected, note=""):
    global PASS, FAIL
    ok = actual == expected
    if ok:
        PASS += 1
        status = "✅ PASS"
    else:
        FAIL += 1
        status = "❌ FAIL"
    print(f"  {status}  {name}: got {actual!r}  expected {expected!r}  {note}")


def assert_contains(name, haystack, needle, note=""):
    global PASS, FAIL
    ok = isinstance(haystack, str) and (needle.lower() in haystack.lower())
    if ok:
        PASS += 1
        status = "✅ PASS"
    else:
        FAIL += 1
        status = "❌ FAIL"
    print(f"  {status}  {name}: '{needle}' in {haystack!r}  {note}")


def assert_status(name, status_code, want):
    global PASS, FAIL
    ok = status_code is not None and (
        (isinstance(want, list) and status_code in want) or status_code == want
    )
    if ok:
        PASS += 1
        status = "✅ PASS"
    else:
        FAIL += 1
        status = "❌ FAIL"
    print(f"  {status}  {name}: HTTP {status_code}  wanted {want}")


# ── Signup helpers ──────────────────────────────────────────────────────────
def signup(email, password="Test@1234"):
    # UserRegisterRequest requires email, username, password (full_name optional, mobile not in schema)
    # username derived from email
    username = email.replace("@", "_at_").replace(".", "_")[:80]
    if len(username) < 3:
        username = username + "usr"
    return req("POST", "/api/auth/register", {
        "email": email,
        "username": username,
        "password": password,
        "full_name": "Test User"
    })


def login(email, password="Test@1234"):
    # OAuth2PasswordRequestForm uses application/x-www-form-urlencoded
    form_body = urllib.parse.urlencode({"username": email, "password": password}).encode("utf-8")
    hdrs = {"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"}
    s, d = req("POST", "/api/auth/login", body=form_body, headers=hdrs)
    if s == 200 and isinstance(d, dict):
        tok = d.get("access_token") or d.get("token")
        if tok:
            return tok
        from dotenv import load_dotenv
        load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
        from Models.base import get_session_factory
        from Models.user import User
        from Authentication.jwt_handler import create_access_token
        from sqlalchemy import func
        db = get_session_factory()()
        try:
            user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
            if not user:
                return None
            return create_access_token({
                "sub": str(user.customer_id),
                "customer_id": str(user.customer_id),
                "email": user.email,
                "username": user.username,
            })
        finally:
            db.close()
    return None


def auth_headers(tok):
    return {"Authorization": f"Bearer {tok}"} if tok else {}


def make_admin_token():
    """Create a unique admin user in the live DB without using production credentials."""
    email = f"secadmin_{uuid.uuid4().hex[:8]}@testjod.com"
    signup(email)
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env"))
    from Models.base import get_session_factory
    from Models.user import User
    from sqlalchemy import func
    db = get_session_factory()()
    try:
        user = db.query(User).filter(func.lower(User.email) == email.lower()).first()
        if not user:
            return None
        user.is_admin = True
        db.commit()
    finally:
        db.close()
    return login(email)


# ─────────────────────────────────────────────────────────────────────────────
print("=" * 70)
print("SCENARIO 1: New organizer → NOT_SUBMITTED verification status")
print("=" * 70)
email1 = f"scenario1_{uuid.uuid4().hex[:8]}@testjod.com"
s1, d1 = signup(email1)
print(f"  signup: HTTP {s1}  ok={s1 in (200,201)}")
tok1 = login(email1)
print(f"  login token: {'OK' if tok1 else 'MISSING'}")
s, d = req("GET", "/api/organizers/verification-status", headers=auth_headers(tok1), query={"email": email1})
assert_status("S1 HTTP status", s, 200)
if isinstance(d, dict):
    vs = d.get("verification_status")
    cp = d.get("can_publish_events")
    has_rec = d.get("has_record")
    assert_eq("S1 verification_status == NOT_SUBMITTED", vs, "NOT_SUBMITTED")
    assert_eq("S1 can_publish_events == False", cp, False)
    print(f"  info: has_record={has_rec}  kyc_complete={d.get('kyc_complete')}")
print()


print("=" * 70)
print("SCENARIO 2: KYC submitted → PENDING status")
print("=" * 70)
email2 = f"scenario2_{uuid.uuid4().hex[:8]}@testjod.com"
signup(email2)
tok2 = login(email2)
# Submit account-setup with is_final_submit=True
s, d = req("POST", "/api/organizers/account-setup", {
    "email": email2,
    "org_name": "Test Org 2",
    "beneficiary_name": "John Doe",
    "account_type": "Savings",
    "bank_name": "HDFC Bank",
    "account_number": "1234567890",
    "bank_ifsc": "HDFC0001234",
    "pan_number": "ABCDE1234F",
    "pan_card_url": "/uploads/dummy_pan_2.png",
    "cancelled_cheque_url": "/uploads/dummy_cheque_2.png",
    "contact_full_name": "John Doe",
    "contact_mobile": "9876543210",
    "accepted_agreement": True,
    "is_final_submit": True
}, headers=auth_headers(tok2))
assert_status("S2 account-setup submit HTTP status", s, [200, 201])
if isinstance(d, dict):
    print(f"  account-setup response: status={d.get('status')}  msg={str(d.get('message',''))[:80]}")
# Re-fetch status
s, d = req("GET", "/api/organizers/verification-status", headers=auth_headers(tok2), query={"email": email2})
assert_status("S2 verification-status HTTP", s, 200)
if isinstance(d, dict):
    vs = d.get("verification_status")
    cp = d.get("can_publish_events")
    assert_eq("S2 verification_status == PENDING", vs, "PENDING")
    assert_eq("S2 can_publish_events == False", cp, False)
print()


print("=" * 70)
print("SCENARIO 3: PENDING organizer → Publish Event → BLOCKED")
print("=" * 70)
# Same scenario2 account (PENDING)
s, d = req("POST", "/api/host-events/manage", {
    "organizer_email": email2,
    "event_title": "Pending Test Event",
    "event_status": "published"
}, headers=auth_headers(tok2))
assert_status("S3 PENDING publish → HTTP 403", s, 403)
msg = ""
if isinstance(d, dict):
    msg = d.get("detail", "") or str(d)
elif isinstance(d, str):
    msg = d
assert_contains("S3 PENDING rejection mentions 'under review'", msg, "under review")
print(f"  rejection message: {msg[:120]}")
print()


print("=" * 70)
print("SCENARIO 4/5: VERIFIED organizer → status correct + publish succeeds")
print("=" * 70)
event4_id = None
email4 = f"scenario4_{uuid.uuid4().hex[:8]}@testjod.com"
signup(email4)
tok4 = login(email4)
# First submit KYC with is_final_submit
req("POST", "/api/organizers/account-setup", {
    "email": email4,
    "org_name": "Verified Org",
    "beneficiary_name": "Jane Verified",
    "account_type": "Current",
    "bank_name": "ICICI",
    "account_number": "9988776655",
    "bank_ifsc": "ICIC0009999",
    "pan_number": "AAAAA1111A",
    "pan_card_url": "/uploads/verified_pan.png",
    "cancelled_cheque_url": "/uploads/verified_cheque.png",
    "contact_full_name": "Jane Verified",
    "contact_mobile": "9999999999",
    "accepted_agreement": True,
    "is_final_submit": True
}, headers=auth_headers(tok4))
admin_tok = make_admin_token()
print(f"  admin token for verify/reject: {'OK' if admin_tok else 'MISSING'}")
# Force VERIFIED status via resubmit-verification admin override
s, d = req("POST", "/api/organizers/resubmit-verification", {
    "email": email4,
    "new_status": "verified"
}, headers=auth_headers(admin_tok))
print(f"  force-status verified: HTTP {s}")
self_verify_s, _ = req("POST", "/api/organizers/resubmit-verification", {
    "email": email4,
    "new_status": "verified"
}, headers=auth_headers(tok4))
assert_status("S4 organizer self-verify blocked", self_verify_s, 403)
# Re-fetch status → VERIFIED
s, d = req("GET", "/api/organizers/verification-status", headers=auth_headers(tok4), query={"email": email4})
assert_status("S4 verification-status HTTP", s, 200)
if isinstance(d, dict):
    vs = d.get("verification_status")
    cp = d.get("can_publish_events")
    assert_eq("S4 verification_status == VERIFIED", vs, "VERIFIED")
    assert_eq("S4 can_publish_events == True", cp, True)
    print(f"  host_id={d.get('host_id')}  submitted_at={d.get('submitted_at')}")

# S5: VERIFIED → publish event → 200 success
s, d = req("POST", "/api/host-events/manage", {
    "organizer_email": email4,
    "event_title": "Verified Summit 2026",
    "event_status": "published"
}, headers=auth_headers(tok4))
assert_status("S5 VERIFIED publish HTTP status", s, 200)
if isinstance(d, dict):
    ev_status = None
    if isinstance(d.get("event"), dict):
        ev_status = d["event"].get("event_status")
    elif isinstance(d.get("organizer_verification"), dict):
        pass
    assert_eq("S5 published event_status == 'published'", ev_status, "published")
    ver_info = d.get("organizer_verification") or {}
    assert_eq("S5 organizer_verification.status == VERIFIED", ver_info.get("verification_status"), "VERIFIED")
    assert_eq("S5 can_publish_events == True (from response)", ver_info.get("can_publish_events"), True)
    eid = d.get("event_id")
    print(f"  event_id={eid}")
    event4_id = eid
else:
    event4_id = None
print()


print("=" * 70)
print("SCENARIO 6: REJECTED → rejection reason + resubmit works")
print("=" * 70)
email6 = f"scenario6_{uuid.uuid4().hex[:8]}@testjod.com"
signup(email6)
tok6 = login(email6)
# Submit KYC
req("POST", "/api/organizers/account-setup", {
    "email": email6,
    "org_name": "Rejected Org",
    "beneficiary_name": "Bob Rejected",
    "account_type": "Savings",
    "bank_name": "SBI",
    "account_number": "1122334455",
    "bank_ifsc": "SBIN0001111",
    "pan_number": "BBBBB2222B",
    "pan_card_url": "/uploads/rejected_pan.png",
    "cancelled_cheque_url": "/uploads/rejected_cheque.png",
    "contact_full_name": "Bob Rejected",
    "contact_mobile": "8888888888",
    "accepted_agreement": True,
    "is_final_submit": True
}, headers=auth_headers(tok6))
# Force REJECTED with reason — admin only
s, d = req("POST", "/api/organizers/resubmit-verification", {
    "email": email6,
    "new_status": "rejected",
    "rejection_reason": "PAN card image is blurry. Please upload a clear scan."
}, headers=auth_headers(admin_tok))
print(f"  force-status rejected: HTTP {s}")
# Check status → REJECTED + reason present
s, d = req("GET", "/api/organizers/verification-status", headers=auth_headers(tok6), query={"email": email6})
assert_status("S6 verification-status HTTP", s, 200)
if isinstance(d, dict):
    vs = d.get("verification_status")
    cp = d.get("can_publish_events")
    reason = d.get("rejection_reason") or ""
    assert_eq("S6 verification_status == REJECTED", vs, "REJECTED")
    assert_eq("S6 can_publish_events == False", cp, False)
    assert_contains("S6 rejection reason contains 'blurry'", reason, "blurry")
    print(f"  rejection_reason={reason}")

# Publish attempt when REJECTED → 403 + reason in message
s, d = req("POST", "/api/host-events/manage", {
    "organizer_email": email6,
    "event_title": "Rejected Try Event",
    "event_status": "published"
}, headers=auth_headers(tok6))
assert_status("S6 REJECTED publish → HTTP 403", s, 403)
msg6 = d.get("detail", "") if isinstance(d, dict) else str(d)
assert_contains("S6 REJECTED rejection mentions reason 'blurry'", msg6, "blurry")
print(f"  publish rejection: {msg6[:150]}")

# Now resubmit → PENDING
s, d = req("POST", "/api/organizers/account-setup", {
    "email": email6,
    "beneficiary_name": "Bob Rejected Fixed",
    "account_type": "Savings",
    "bank_name": "SBI",
    "account_number": "1122334455",
    "bank_ifsc": "SBIN0001111",
    "pan_number": "BBBBB2222B",
    "pan_card_url": "/uploads/rejected_pan_fixed.png",
    "cancelled_cheque_url": "/uploads/rejected_cheque_fixed.png",
    "accepted_agreement": True,
    "is_final_submit": True
}, headers=auth_headers(tok6))
s2, d2 = req("GET", "/api/organizers/verification-status", headers=auth_headers(tok6), query={"email": email6})
if isinstance(d2, dict):
    vs2 = d2.get("verification_status")
    reason2 = d2.get("rejection_reason")
    assert_eq("S6 after resubmit → PENDING", vs2, "PENDING")
    # Rejection reason should be cleared on successful resubmit
    cleared = (not reason2)
    if cleared:
        PASS += 1
        print(f"  ✅ PASS  S6 rejection_reason cleared on resubmit: {reason2!r}")
    else:
        FAIL += 1
        print(f"  ❌ FAIL  S6 rejection_reason not cleared on resubmit: {reason2!r}")
print()


print("=" * 70)
print("SCENARIO 7: VERIFIED publish flow → internal endpoints only (no Stitch)")
print("=" * 70)
# Reuse scenario 4/5 token (email4, VERIFIED). Confirm publish endpoint returns
# internal URL structures only; no 'stitch' string anywhere in the response.
s, d = req("POST", "/api/host-events/manage", {
    "organizer_email": email4,
    "event_title": "S7 Internal Publish Flow",
    "event_status": "published"
}, headers=auth_headers(tok4))
assert_status("S7 publish HTTP status", s, 200)
resp_str = json.dumps(d) if isinstance(d, (dict, list)) else str(d)
# Case-insensitive scan for 'stitch'
has_stitch = "stitch" in resp_str.lower()
if not has_stitch:
    PASS += 1
    print(f"  ✅ PASS  S7 No 'stitch' string found anywhere in publish response")
else:
    FAIL += 1
    print(f"  ❌ FAIL  S7 'stitch' string found in response! body={resp_str[:500]}")
# Also confirm event_id and internal status
if isinstance(d, dict):
    ev7 = d.get("event") or {}
    st7 = ev7.get("event_status")
    assert_eq("S7 event_status == published", st7, "published")
    eid7 = d.get("event_id")
    print(f"  event_id={eid7}")
print()


print("=" * 70)
print("SCENARIO 8: Unauthenticated / non-organizer → publish API rejected")
print("=" * 70)
# Case A: anonymous (no Authorization header), trying to publish any email
s, d = req("POST", "/api/host-events/manage", {
    "organizer_email": email4,
    "event_title": "Anonymous Hack Attempt",
    "event_status": "published"
})
assert_status("S8A anonymous publish → HTTP 401", s, 401)
msg8a = d.get("detail", "") if isinstance(d, dict) else str(d)
print(f"  anon rejection: {str(msg8a)[:120]}")

# Case B: organizer with token cannot modify another host's event by ID
email8b = f"scenario8b_{uuid.uuid4().hex[:8]}@testjod.com"
signup(email8b)
tok8b = login(email8b)
s, d = req("POST", "/api/host-events/manage", {
    "event_id": event4_id,
    "organizer_email": email4,
    "event_title": "Cross-owner hack",
    "event_status": "draft"
}, headers=auth_headers(tok8b))
assert_status("S8B cross-owner publish → HTTP 403", s, 403)
msg8b = d.get("detail", "") if isinstance(d, dict) else str(d)
print(f"  cross-owner rejection: {str(msg8b)[:120]}")

# Case C: also verify events CRUD publish gate (not VERIFIED)
s, d = req("POST", "/api/events", {
    "title": "Direct CRUD Publish Hack",
    "start_date": "2026-12-01T10:00:00",
    "is_published": True
}, headers=auth_headers(tok8b))  # tok8b is NOT_SUBMITTED
assert_status("S8C events CRUD publish not_verified → HTTP 403", s, 403)
msg8c = d.get("detail", "") if isinstance(d, dict) else str(d)
assert_contains("S8C mentions 'verification before publishing'", msg8c, "verification")
print(f"  CRUD publish rejection: {str(msg8c)[:120]}")
print()


# ── events.py _event_to_response customer_id regression test ────────────────
print("=" * 70)
print("REGRESSION: events.py _event_to_response uses customer_id (not organizer_id)")
print("=" * 70)
# Create an event as VERIFIED organizer email4 with is_published=True
s, d = req("POST", "/api/events", {
    "title": "Regression Event Customer ID",
    "start_date": "2026-12-15T18:00:00",
    "price": 0.0,
    "capacity": 100,
    "is_published": True
}, headers=auth_headers(tok4))
assert_status("Create VERIFIED published event HTTP", s, 201)
if isinstance(d, dict):
    eid = d.get("id")
    cid = d.get("customer_id")
    print(f"  created event id={eid}  customer_id={cid}")
    # No organizer_id leak in response
    has_org_key = "organizer_id" in d
    if not has_org_key:
        PASS += 1
        print(f"  ✅ PASS  response has NO 'organizer_id' key (bug fixed)")
    else:
        FAIL += 1
        print(f"  ❌ FAIL  response still has 'organizer_id' key! val={d.get('organizer_id')}")
    # customer_id should be present (not null) for authed creation
    if cid:
        PASS += 1
        print(f"  ✅ PASS  customer_id is populated: {cid!r}")
    else:
        FAIL += 1
        print(f"  ❌ FAIL  customer_id is empty!")
    # Fetch the single event to confirm same behavior
    s2, d2 = req("GET", f"/api/events/{eid}", headers=auth_headers(tok4))
    if isinstance(d2, dict):
        has_org2 = "organizer_id" in d2
        cid2 = d2.get("customer_id")
        if not has_org2 and cid2:
            PASS += 1
            print(f"  ✅ PASS  GET event/{eid} has customer_id={cid2!r} and NO organizer_id")
        else:
            FAIL += 1
            print(f"  ❌ FAIL  GET event: has_organizer_id={has_org2}, customer_id={cid2!r}")
print()


print("=" * 70)
print("SCENARIO 9: Anonymous access to critical endpoints is denied")
print("=" * 70)
s, d = req("GET", "/api/organizers/verification-status", query={"email": email4})
assert_status("S9A anonymous verification-status → 401", s, 401)
if isinstance(d, dict):
    acc = d.get("account") or {}
    leaked = any(acc.get(k) for k in ("account_number", "pan_number", "pan_card_url", "bank_ifsc"))
    assert_eq("S9A no sensitive account payload", leaked, False)

s, d = req("POST", "/api/organizers/resubmit-verification", {
    "email": email4,
    "new_status": "verified"
})
assert_status("S9B anonymous resubmit-verification → 401", s, 401)

s, d = req("GET", "/api/host-events/registrations/attendees", query={"email": email4})
assert_status("S9C anonymous host attendees → 401", s, 401)

s, d = req("POST", "/api/auth/google", {
    "id_token": "eyJhbGciOiJub25lIn0.eyJlbWFpbCI6ImF0dGFja2VyQGV4YW1wbGUuY29tIn0."
})
assert_status("S9D unsigned Google JWT → 400", s, 400)
print()


# ── Summary ─────────────────────────────────────────────────────────────────
print("=" * 70)
TOTAL = PASS + FAIL
pct = (PASS / TOTAL * 100.0) if TOTAL else 0.0
print(f"RESULTS: {PASS}/{TOTAL} passed  ({pct:.1f}%)   FAIL={FAIL}")
print("=" * 70)
sys.exit(0 if FAIL == 0 else 1)
