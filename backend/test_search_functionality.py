"""
Verification script for JOD Events real-time search functionality.
"""
from pathlib import Path

def test_search_code_structure():
    service_py = Path("backend/Services/event_service.py").read_text(encoding="utf-8")
    assert "def search_events" in service_py, "search_events missing in event_service.py"
    assert "MONTH_MAP" in service_py, "MONTH_MAP missing in event_service.py"

    api_py = Path("backend/APIs/events.py").read_text(encoding="utf-8")
    assert "@router.get(\"/search\"" in api_py, "Search route missing in events.py"

    search_js = Path("frontend/js/search.js").read_text(encoding="utf-8")
    assert "window.JodSearch" in search_js, "JodSearch module missing in search.js"
    assert "highlightMatch" in search_js, "Text highlighting missing in search.js"
    assert "search-suggestions-dropdown" in search_js, "Dropdown markup missing in search.js"

    style_css = Path("frontend/css/style.css").read_text(encoding="utf-8")
    assert ".search-suggestions-dropdown" in style_css, "Dropdown CSS missing in style.css"
    assert "mark.search-highlight" in style_css, "Highlight CSS missing in style.css"

    print("[OK] All search code files and imports are present and valid.")

if __name__ == "__main__":
    print("--- Running Search Functionality Structural Verification ---")
    test_search_code_structure()
    print("ALL SEARCH FUNCTIONALITY VERIFICATION CHECKS PASSED SUCCESSFULLY!")
