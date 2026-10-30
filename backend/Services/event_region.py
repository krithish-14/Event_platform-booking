"""
State and district for public events, resolved from the venue map pin.

The public site lets visitors browse events by state, then district. Venue text
is unreliable for that (a Tambaram venue usually says "Chennai" but sits in
Chengalpattu district), so each event's pin is reverse-geocoded once with
OpenStreetMap Nominatim and stored on the event. `region_key` records which pin
was resolved, so moving the pin triggers a fresh lookup.

Nominatim allows about one request per second, so lookups run in a background
task, a few at a time, never inside a page request.
"""

import re
import threading
import time
from typing import Iterable, Optional, Tuple

import httpx

from Models.base import get_session_factory
from Models.event import Event

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_HEADERS = {
    "User-Agent": "JODEvents/1.0 (event-booking-platform; contact@jodevents.com)",
    "Accept-Language": "en",
}
_SUB_DISTRICT_RE = re.compile(r"\b(taluk|taluka|tehsil|tahsil|mandal|block|sub-?division|circle)\b", re.I)
_DISTRICT_SUFFIX_RE = re.compile(r"\s+district$", re.I)

_cache: dict = {}
_fill_lock = threading.Lock()


def region_key(lat, lon) -> Optional[str]:
    try:
        lat_f, lon_f = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat_f <= 90 and -180 <= lon_f <= 180) or (lat_f == 0 and lon_f == 0):
        return None
    return f"{lat_f:.4f},{lon_f:.4f}"


def _clean(name) -> str:
    return _DISTRICT_SUFFIX_RE.sub("", str(name or "").strip()).strip()


def region_from_address(address: Optional[dict]) -> Tuple[Optional[str], Optional[str]]:
    """(state, district) from a Nominatim address block."""
    address = address or {}
    state = _clean(address.get("state") or address.get("territory") or address.get("union_territory"))
    district = _clean(address.get("state_district"))
    if not district:
        county = _clean(address.get("county"))
        if county and not _SUB_DISTRICT_RE.search(county):
            district = county
    if not district and state in ("Chandigarh", "Lakshadweep"):
        district = state
    return (state or None), (district or None)


def lookup_region(lat: float, lon: float, timeout: float = 6.0) -> Optional[Tuple[Optional[str], Optional[str]]]:
    """Reverse-geocode a pin. None means the service failed; try again later."""
    key = region_key(lat, lon)
    if key in _cache:
        return _cache[key]
    params = {
        "lat": lat, "lon": lon, "format": "jsonv2", "addressdetails": 1,
        "zoom": 10, "accept-language": "en",
    }
    try:
        resp = httpx.get(NOMINATIM_URL, params=params, headers=NOMINATIM_HEADERS, timeout=timeout)
        resp.raise_for_status()
        data = resp.json() or {}
    except Exception:
        return None
    result = region_from_address(data.get("address"))
    _cache[key] = result
    return result


def needs_region(event) -> bool:
    key = region_key(getattr(event, "latitude", None), getattr(event, "longitude", None))
    return bool(key) and getattr(event, "region_key", None) != key


def fill_missing_regions(event_ids: Optional[Iterable] = None, limit: int = 6, pause: float = 1.1, lookup=None) -> int:
    """Resolve state/district for events whose pin has not been resolved yet."""
    if not _fill_lock.acquire(blocking=False):
        return 0
    lookup = lookup or lookup_region
    done = 0
    try:
        db = get_session_factory()()
        try:
            query = db.query(Event).filter(Event.latitude.isnot(None), Event.longitude.isnot(None))
            ids = list(event_ids or [])
            if ids:
                query = query.filter(Event.id.in_(ids))
            called = False
            for event in query.limit(200).all():
                if done >= limit:
                    break
                key = region_key(event.latitude, event.longitude)
                if not key or event.region_key == key:
                    continue
                if called and key not in _cache:
                    time.sleep(pause)
                called = True
                result = lookup(event.latitude, event.longitude)
                if result is None:
                    continue
                event.state, event.district = result
                event.region_key = key
                try:
                    db.commit()
                    done += 1
                except Exception:
                    db.rollback()
        finally:
            db.close()
    except Exception as exc:
        print(f"[EVENT REGION] fill failed: {exc}", flush=True)
    finally:
        _fill_lock.release()
    return done
