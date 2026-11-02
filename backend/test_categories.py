"""Tests for Utils.categories.normalize_category (presets + custom Others)."""

from Utils.categories import normalize_category, CANONICAL_CATEGORIES


def test_canonical_presets():
    for name in CANONICAL_CATEGORIES:
        assert normalize_category(name) == name
        assert normalize_category(name.lower()) == name
        assert normalize_category(f"  {name.upper()}  ") == name


def test_legacy_aliases():
    assert normalize_category("Experiences") == "Experiences"
    assert normalize_category("expositions") == "Expositions"


def test_others_placeholder_rejected():
    assert normalize_category("Others") is None
    assert normalize_category("other") is None
    assert normalize_category("Other Category") is None
    assert normalize_category("__others__") is None
    assert normalize_category("") is None
    assert normalize_category(None) is None


def test_custom_category_accepted():
    assert normalize_category("Rotary Meet") == "Rotary Meet"
    assert normalize_category("  Cultural   Festival  ") == "Cultural Festival"
    assert normalize_category("Fundraiser & Awards") == "Fundraiser & Awards"


def test_custom_category_trimmed_and_capped():
    long = "A" * 120
    assert len(normalize_category(long)) == 80
