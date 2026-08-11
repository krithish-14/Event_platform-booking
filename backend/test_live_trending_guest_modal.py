"""
Verification test for Live Trending Events section visibility and Guest Auth Modal behavior.
"""
from pathlib import Path
import re

def test_live_trending_and_guest_modal():
    print("--- Running Live Trending Events & Guest Auth Modal Verification ---")
    
    root = Path(__file__).parent.parent
    index_html_path = root / "frontend" / "index.html"
    style_css_path = root / "frontend" / "css" / "style.css"
    script_js_path = root / "frontend" / "js" / "script.js"

    # 1. Verify index.html
    index_html = index_html_path.read_text(encoding="utf-8")
    
    # Check section #upcoming exists and is NOT auth-only gated
    assert 'id="upcoming"' in index_html, "Section #upcoming not found in index.html"
    upcoming_section_match = re.search(r'<section[^>]*id="upcoming"[^>]*>', index_html)
    assert upcoming_section_match, "Could not match <section id='upcoming'>"
    upcoming_section_tag = upcoming_section_match.group(0)
    assert 'data-auth-only="true"' not in upcoming_section_tag, (
        f"Section #upcoming still has data-auth-only='true' attribute: {upcoming_section_tag}"
    )
    print("[OK] Section #upcoming is visible to all users (data-auth-only removed)")

    # Check #guestAuthModal elements
    assert 'id="guestAuthModal"' in index_html, "#guestAuthModal dialog missing in index.html"
    assert 'id="guestAuthModalCloseBtn"' in index_html, "#guestAuthModalCloseBtn missing"
    assert 'id="guestAuthModalCloseBackdrop"' in index_html, "#guestAuthModalCloseBackdrop missing"
    assert 'id="guestAuthSignupBtn"' in index_html, "#guestAuthSignupBtn missing"
    assert 'id="guestAuthCancelBtn"' in index_html, "#guestAuthCancelBtn missing"
    assert 'Sign Up to Book Tickets' in index_html, "Modal title missing"
    assert 'Sign In / Sign Up' in index_html, "Modal CTA button missing"
    print("[OK] #guestAuthModal markup is present with all required controls in index.html")

    # 2. Verify style.css
    style_css = style_css_path.read_text(encoding="utf-8")
    assert ".guest-auth-modal-backdrop" in style_css, ".guest-auth-modal-backdrop CSS rule missing"
    assert ".guest-auth-modal-box" in style_css, ".guest-auth-modal-box CSS rule missing"
    assert "backdrop-filter" in style_css, "backdrop-filter blur missing in CSS"
    assert "guestModalSlideUp" in style_css, "Modal slide animation missing"
    print("[OK] CSS styles for guestAuthModal backdrop, box, and animations are present in style.css")

    # 3. Verify script.js
    script_js = script_js_path.read_text(encoding="utf-8")
    assert "guestAuthModal" in script_js, "guestAuthModal logic missing in script.js"
    assert "openGuestAuthModal" in script_js, "openGuestAuthModal function missing"
    assert "closeGuestAuthModal" in script_js, "closeGuestAuthModal function missing"
    assert 'signup.html?redirect=' in script_js, "signup.html redirect link construction missing"
    assert "e.stopImmediatePropagation()" in script_js, "Click interception logic missing"
    assert "upcomingSection" in script_js, "upcomingSection click delegation missing"
    print("[OK] JS click delegation, auth check, click interception, and modal controls are present in script.js")

    print("\nALL LIVE TRENDING EVENTS & GUEST AUTH MODAL CHECKS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_live_trending_and_guest_modal()
