"""Venue coordinate validation and Maps config — no live Google calls."""

import os
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from Services.geo_validation import (
    is_valid_latitude,
    is_valid_longitude,
    parse_venue_coords,
    sanitize_place_id,
    sanitize_venue_address,
)


class GeoValidationTests(unittest.TestCase):
    def test_valid_chennai_coords(self):
        lat, lon = parse_venue_coords(13.0827, 80.2707)
        self.assertAlmostEqual(lat, 13.0827)
        self.assertAlmostEqual(lon, 80.2707)

    def test_unset_coords_are_none(self):
        self.assertEqual(parse_venue_coords(None, None), (None, None))

    def test_rejects_partial_coords(self):
        with self.assertRaises(HTTPException) as ctx:
            parse_venue_coords(13.0, None)
        self.assertEqual(ctx.exception.status_code, 400)

    def test_rejects_out_of_range(self):
        with self.assertRaises(HTTPException):
            parse_venue_coords(91.0, 80.0)
        with self.assertRaises(HTTPException):
            parse_venue_coords(13.0, 181.0)
        self.assertFalse(is_valid_latitude(None))
        self.assertFalse(is_valid_longitude("east"))

    def test_place_id_sanitized(self):
        self.assertEqual(sanitize_place_id("ChIJN1t_tDeuEmsRUsoyG83frY4"), "ChIJN1t_tDeuEmsRUsoyG83frY4")
        self.assertIsNone(sanitize_place_id("  "))
        with self.assertRaises(HTTPException):
            sanitize_place_id("<script>alert(1)</script>")

    def test_venue_address_trimmed(self):
        self.assertEqual(sanitize_venue_address("  Anna Salai, Chennai  "), "Anna Salai, Chennai")
        self.assertEqual(sanitize_venue_address(""), "")


class MapsConfigTests(unittest.TestCase):
    def test_config_disabled_without_key(self):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": ""}, clear=False):
            client = TestClient(app)
            res = client.get("/api/maps/config")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertFalse(body["enabled"])
            self.assertIsNone(body["apiKey"])

    def test_config_returns_env_key(self):
        from fastapi.testclient import TestClient
        from FastAPI.main import app

        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "test-browser-key"}, clear=False):
            client = TestClient(app)
            res = client.get("/api/maps/config")
            self.assertEqual(res.status_code, 200)
            body = res.json()
            self.assertTrue(body["enabled"])
            self.assertEqual(body["apiKey"], "test-browser-key")


if __name__ == "__main__":
    unittest.main()
