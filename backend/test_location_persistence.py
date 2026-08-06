"""
Verification test for JOD Events Location Module logic and session storage key consistency.
"""
import re
from pathlib import Path

def test_location_js_structure():
    loc_js = Path("frontend/js/location.js").read_text(encoding="utf-8")
    
    assert "hasAcquiredLocation" in loc_js, "Missing hasAcquiredLocation function"
    assert "clearLocationSession" in loc_js, "Missing clearLocationSession function"
    assert "sessionStorage.setItem(LS_CITY_KEY, city)" in loc_js, "City not saved to sessionStorage"
    assert 'sessionStorage.setItem("jod_location_acquired", "true")' in loc_js, "jod_location_acquired not set in sessionStorage"
    print("[OK] location.js has acquired/session helper functions")

def test_auth_js_logout_clear():
    auth_js = Path("frontend/js/auth.js").read_text(encoding="utf-8")
    assert "clearLocationSession" in auth_js, "auth.js does not trigger clearLocationSession on logout"
    print("[OK] auth.js clears location session on logout")

if __name__ == "__main__":
    print("--- Testing Location Persistence Logic ---")
    test_location_js_structure()
    test_auth_js_logout_clear()
    print("ALL LOCATION PERSISTENCE CHECKS PASSED SUCCESSFULLY!")
