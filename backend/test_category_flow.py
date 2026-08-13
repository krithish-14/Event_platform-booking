"""
Verification test for Event Category Listing Page, Sidebar Filters, and Carousel Navigation Flow.
"""
from pathlib import Path
import re

def test_category_flow():
    print("--- Running Event Category Flow & BookMyShow Layout Verification ---")

    root = Path(__file__).parent.parent
    index_html_path = root / "frontend" / "index.html"
    category_html_path = root / "frontend" / "category.html"
    category_css_path = root / "frontend" / "css" / "category.css"
    category_js_path = root / "frontend" / "js" / "category.js"
    search_js_path = root / "frontend" / "js" / "search.js"
    events_api_path = root / "backend" / "APIs" / "events.py"
    event_service_path = root / "backend" / "Services" / "event_service.py"

    # 1. Verify Category Page Files Existence
    assert category_html_path.exists(), "frontend/category.html does not exist"
    assert category_css_path.exists(), "frontend/css/category.css does not exist"
    assert category_js_path.exists(), "frontend/js/category.js does not exist"
    print("[OK] Category page core files exist (category.html, category.css, category.js)")

    # 2. Verify category.html elements & BookMyShow layout
    cat_html = category_html_path.read_text(encoding="utf-8")
    assert 'id="categoryTitle"' in cat_html, "#categoryTitle element missing in category.html"
    assert 'id="subtopicsBar"' in cat_html, "#subtopicsBar subtopics bar missing"
    assert 'id="catSidebar"' in cat_html, "#catSidebar filter panel missing"
    assert 'id="filterCategoriesList"' in cat_html, "#filterCategoriesList missing"
    assert 'id="filterDateList"' in cat_html, "#filterDateList missing"
    assert 'id="filterFormatList"' in cat_html, "#filterFormatList missing"
    assert 'id="filterPriceList"' in cat_html, "#filterPriceList missing"
    assert 'id="categoryEventsGrid"' in cat_html, "#categoryEventsGrid events grid missing"
    assert 'id="catEmptyState"' in cat_html, "#catEmptyState missing"
    print("[OK] category.html contains BookMyShow layout controls and filter sidebars")

    # 3. Verify index.html Category Carousel Navigation
    index_html = index_html_path.read_text(encoding="utf-8")
    assert 'category.html?name=' in index_html, "index.html category cards do not link to category.html?name=..."
    assert 'category.html?name=Corporate' in index_html, "Corporate Events category link missing"
    assert 'category.html?name=Wedding' in index_html, "Wedding Events category link missing"
    assert 'category.html?name=Comedy' in index_html, "Standup Comedy category link missing"
    assert 'category.html?name=Workshop' in index_html, "Workshop category link missing"
    print("[OK] index.html Category Carousel cards link correctly to category.html?name=...")

    # 4. Verify category.js & search.js links
    search_js = search_js_path.read_text(encoding="utf-8")
    assert 'category.html?name=' in search_js, "search.js category suggestions do not direct to category.html?name=..."
    cat_js = category_js_path.read_text(encoding="utf-8")
    assert 'fetchEventsFromBackend' in cat_js, "fetchEventsFromBackend missing in category.js"
    assert 'SEED_FALLBACK_EVENTS' in cat_js, "SEED_FALLBACK_EVENTS fallback data missing in category.js"
    assert 'event-details.html?id=' in cat_js or 'makeup-boutique-workshop.html?id=' in cat_js, "Event detail navigation target link missing in category.js"
    print("[OK] category.js controller and search.js contain dynamic fetch and booking navigation logic")

    # 5. Verify Backend API Query Parameters
    events_api = events_api_path.read_text(encoding="utf-8")
    assert 'event_format' in events_api, "event_format parameter missing in events.py"
    assert 'min_price' in events_api, "min_price parameter missing in events.py"
    assert 'max_price' in events_api, "max_price parameter missing in events.py"
    assert 'date_filter' in events_api, "date_filter parameter missing in events.py"
    
    event_service = event_service_path.read_text(encoding="utf-8")
    assert 'date_filter' in event_service, "date_filter logic missing in event_service.py"
    print("[OK] Backend FastAPI routes and event service support multi-column filtering")

    print("\nALL CATEGORY CAROUSEL & CATEGORY PAGE FLOW CHECKS PASSED SUCCESSFULLY!")

if __name__ == "__main__":
    test_category_flow()
