"""Validate venue coordinates and Google Place IDs without trusting the client."""

from __future__ import annotations

import re
from typing import Optional, Tuple

from fastapi import HTTPException

from Utils.text_sanitize import sanitize_text

_PLACE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{4,255}$")


def is_valid_latitude(value: Optional[float]) -> bool:
    try:
        lat = float(value)
    except (TypeError, ValueError):
        return False
    return -90.0 <= lat <= 90.0


def is_valid_longitude(value: Optional[float]) -> bool:
    try:
        lon = float(value)
    except (TypeError, ValueError):
        return False
    return -180.0 <= lon <= 180.0


def parse_venue_coords(
    latitude: Optional[float],
    longitude: Optional[float],
) -> Tuple[Optional[float], Optional[float]]:
    """Return a valid lat/lon pair, or (None, None) when both are unset.

    Raises HTTP 400 if only one value is sent or either value is out of range.
    """
    lat_set = latitude is not None
    lon_set = longitude is not None
    if not lat_set and not lon_set:
        return None, None
    if lat_set != lon_set:
        raise HTTPException(status_code=400, detail="Both latitude and longitude are required.")
    if not is_valid_latitude(latitude) or not is_valid_longitude(longitude):
        raise HTTPException(status_code=400, detail="Invalid venue coordinates.")
    return float(latitude), float(longitude)


def sanitize_place_id(value: Optional[str] = None) -> Optional[str]:
    text = sanitize_text(value, max_length=255)
    if not text:
        return None
    if not _PLACE_ID_RE.match(text):
        raise HTTPException(status_code=400, detail="Invalid place id.")
    return text


def sanitize_venue_address(value: Optional[str] = None, *, max_length: int = 300) -> str:
    return sanitize_text(value, max_length=max_length)
