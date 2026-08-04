"""
Geographic helpers — Haversine distance and event radius filtering.
"""

import math
from typing import List, Optional, Tuple


EARTH_RADIUS_KM = 6371.0
DEFAULT_RADIUS_KM = 20.0


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return great-circle distance in kilometres between two WGS-84 points."""
    lat1_r, lon1_r = math.radians(lat1), math.radians(lon1)
    lat2_r, lon2_r = math.radians(lat2), math.radians(lon2)
    dlat = lat2_r - lat1_r
    dlon = lon2_r - lon1_r
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1_r) * math.cos(lat2_r) * math.sin(dlon / 2) ** 2
    )
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def is_within_radius(
    user_lat: float,
    user_lon: float,
    event_lat: float,
    event_lon: float,
    radius_km: float = DEFAULT_RADIUS_KM,
) -> bool:
    """True when the event lies within radius_km of the user."""
    return haversine_km(user_lat, user_lon, event_lat, event_lon) <= radius_km


def filter_by_radius(
    items: List,
    user_lat: float,
    user_lon: float,
    radius_km: float = DEFAULT_RADIUS_KM,
    lat_attr: str = "latitude",
    lon_attr: str = "longitude",
) -> List[Tuple[object, float]]:
    """
    Filter objects that have lat/lon attributes and return (item, distance_km) pairs,
    sorted nearest-first.
    """
    results: List[Tuple[object, float]] = []
    for item in items:
        lat = getattr(item, lat_attr, None)
        lon = getattr(item, lon_attr, None)
        if lat is None or lon is None:
            continue
        dist = haversine_km(user_lat, user_lon, lat, lon)
        if dist <= radius_km:
            results.append((item, dist))
    results.sort(key=lambda pair: pair[1])
    return results
