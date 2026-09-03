"""Removed sponsors must stay hidden on the public event-details page."""

from APIs.events import _normalize_sponsors, _prefer_design_list


def test_empty_design_sponsors_do_not_use_stale_highlights():
    stale = [
        {"title": "Old Sponsor", "subtitle": "Title Sponsor", "image_url": "/old-logo.png"}
    ]
    resolved = _prefer_design_list([], stale, _normalize_sponsors)
    assert resolved == []


def test_missing_design_still_falls_back_to_catalog_highlights():
    catalog = [
        {"title": "Legacy Sponsor", "subtitle": "Gold", "image_url": "/legacy.png"}
    ]
    resolved = _prefer_design_list(None, catalog, _normalize_sponsors)
    assert resolved == [
        {"name": "Legacy Sponsor", "tier": "Gold", "logo_url": "/legacy.png"}
    ]


def test_live_design_sponsors_are_kept():
    live = [{"name": "Acme", "tier": "Title Sponsor", "logo_url": "/acme.png"}]
    resolved = _prefer_design_list(live, [{"title": "Old"}], _normalize_sponsors)
    assert resolved == live


if __name__ == "__main__":
    test_empty_design_sponsors_do_not_use_stale_highlights()
    test_missing_design_still_falls_back_to_catalog_highlights()
    test_live_design_sponsors_are_kept()
    print("[OK] Removed sponsors are not resurrected from stale highlights.")
