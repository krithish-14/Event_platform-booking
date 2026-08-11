"""
Verification for Google Button Click Delegation & DOM Integration in auth.js & auth.css
"""
from pathlib import Path

def test_google_button_dom_integration():
    print("--- Running Google Button DOM Integration Verification ---")
    root = Path(__file__).parent.parent
    auth_js_path = root / "frontend" / "js" / "auth.js"
    auth_css_path = root / "frontend" / "css" / "auth.css"
    signup_html_path = root / "frontend" / "signup.html"
    login_html_path = root / "frontend" / "login.html"

    # 1. Verify HTML Button IDs
    signup_html = signup_html_path.read_text(encoding="utf-8")
    login_html = login_html_path.read_text(encoding="utf-8")
    assert 'id="googleSignupBtn"' in signup_html, "googleSignupBtn ID missing in signup.html"
    assert 'id="googleLoginBtn"' in login_html, "googleLoginBtn ID missing in login.html"
    print("[OK] signup.html and login.html contain #googleSignupBtn and #googleLoginBtn")

    # 2. Verify auth.js click delegation & modal
    auth_js = auth_js_path.read_text(encoding="utf-8")
    assert "document.addEventListener(\"click\"" in auth_js, "Click delegation missing in auth.js"
    assert "#googleSignupBtn, #googleLoginBtn, .btn-google-auth" in auth_js, "Button click target selector missing in auth.js"
    assert "openGoogleDevModal" in auth_js, "openGoogleDevModal missing in auth.js"
    assert "googleDevAuthModal" in auth_js, "googleDevAuthModal missing in auth.js"
    print("[OK] auth.js has global click delegation and interactive DOM modal overlay")

    # 3. Verify auth.css modal styling
    auth_css = auth_css_path.read_text(encoding="utf-8")
    assert ".google-modal-backdrop" in auth_css, ".google-modal-backdrop style missing in auth.css"
    assert ".google-modal-box" in auth_css, ".google-modal-box style missing in auth.css"
    print("[OK] auth.css contains styling for .google-modal-backdrop and .google-modal-box")

    print("\nALL GOOGLE BUTTON CLICK & DOM INTEGRATION CHECKS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_google_button_dom_integration()
