"""
Location routes — resolve coordinates to city and store on user profile.
Uses OpenStreetMap Nominatim (free, no API key required).
"""

import re

import httpx
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.user import User

router = APIRouter()

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"
NOMINATIM_HEADERS = {
    "User-Agent": "JODEvents/1.0 (event-booking-platform; contact@jodevents.com)",
    "Accept-Language": "en",
}
INDIC_SCRIPT_RE = re.compile(
    r"[\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF"
    r"\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F]"
)
COUNTRY_STATE_RE = re.compile(
    r"^(india|tamil nadu|karnataka|maharashtra|delhi|nct of delhi|west bengal|"
    r"telangana|kerala|andhra pradesh|gujarat|rajasthan|uttar pradesh|"
    r"madhya pradesh|bihar|odisha|punjab|haryana|assam)$",
    re.I,
)
ADMIN_ONLY_RE = re.compile(
    r"^(cmwssb(\s+division)?(\s+\d+)?|ward\s+\d+|zone\s+\d+|division\s+\d+|circle\s+\d+)$",
    re.I,
)
ADMIN_PREFIX_RE = re.compile(r"^(cmwssb\b|ward\s+\d+|division\s+\d+|circle\s+\d+)", re.I)
ZONE_PREFIX_RE = re.compile(r"^zone\s+\d+\s+(.+)$", re.I)


# ── Schemas ───────────────────────────────────────────────────────────────────
class LocationByCoords(BaseModel):
    lat: float
    lon: float


class LocationByCity(BaseModel):
    city: Optional[str] = None
    pincode: Optional[str] = None


class LocationResponse(BaseModel):
    city: Optional[str]
    location_pincode: Optional[str]
    location_lat: Optional[float]
    location_lon: Optional[float]

    class Config:
        from_attributes = True


class LocationPreviewResponse(BaseModel):
    city: Optional[str] = None
    location_pincode: Optional[str] = None
    location_lat: float
    location_lon: float
    display_name: Optional[str] = None
    formatted: Optional[str] = None
    boundingbox: Optional[List[float]] = None  # south, north, west, east


class VenueAddressResponse(BaseModel):
    formatted: str
    display_name: Optional[str] = None
    address: dict = {}
    location_lat: float
    location_lon: float


# ── Helpers ───────────────────────────────────────────────────────────────────
def _is_english_part(text: Optional[str]) -> bool:
    s = str(text or "").strip()
    if not s:
        return False
    if INDIC_SCRIPT_RE.search(s):
        return False
    return True


def _clean_admin_label(text: Optional[str]) -> str:
    """Drop ward/zone/CMWSSB labels; keep the place name after 'Zone 5 ...'."""
    s = str(text or "").strip()
    if not s:
        return ""
    if ADMIN_ONLY_RE.match(s) or ADMIN_PREFIX_RE.match(s):
        return ""
    zone = ZONE_PREFIX_RE.match(s)
    if zone:
        s = zone.group(1).strip()
    if COUNTRY_STATE_RE.match(s):
        return ""
    return s


def _is_admin_locality(text: Optional[str]) -> bool:
    s = str(text or "").strip()
    if not s:
        return True
    if ADMIN_ONLY_RE.match(s) or ADMIN_PREFIX_RE.match(s):
        return True
    if ZONE_PREFIX_RE.match(s) and not _clean_admin_label(s):
        return True
    return False


def _pick_english(*candidates) -> str:
    for raw in candidates:
        val = _clean_admin_label(raw)
        if _is_english_part(val):
            return val
    return ""


def _add_address_part(parts: list, value: Optional[str]) -> None:
    val = _clean_admin_label(value)
    if not val:
        pin = re.sub(r"\D", "", str(value or ""))
        if re.fullmatch(r"\d{6}", pin):
            val = pin
        else:
            return
    if not (re.fullmatch(r"\d{6}", val) or _is_english_part(val)):
        return
    if COUNTRY_STATE_RE.match(val):
        return
    low = val.lower()
    for idx, existing in enumerate(parts):
        ex = existing.lower()
        if ex == low:
            return
        if low in ex:
            return
        if ex in low and ex != low:
            parts[idx] = val
            return
    parts.append(val)


def format_street_area_pin(address: Optional[dict], display_name: str = "", namedetails: Optional[dict] = None) -> str:
    """Build an English street / area / city / pincode line from Nominatim fields."""
    addr = address or {}
    house = _pick_english(addr.get("house_number"))
    road = _pick_english(
        addr.get("road"),
        addr.get("pedestrian"),
        addr.get("residential"),
        addr.get("street"),
    )
    poi = _pick_english(
        addr.get("building"),
        addr.get("amenity"),
        addr.get("shop"),
        addr.get("tourism"),
        addr.get("railway"),
        addr.get("public_building"),
    )
    neighbourhood = _pick_english(
        addr.get("neighbourhood"),
        addr.get("quarter"),
        addr.get("hamlet"),
        addr.get("allotments"),
    )
    suburb = _pick_english(
        addr.get("suburb"),
        addr.get("village"),
        addr.get("city_district"),
    )
    city = _pick_english(
        addr.get("city"),
        addr.get("town"),
        addr.get("municipality"),
        addr.get("county"),
    )
    pin = re.sub(r"\s+", "", str(addr.get("postcode") or ""))
    street = " ".join(bit for bit in (house, road) if bit).strip()

    parts: list = []
    _add_address_part(parts, poi)
    _add_address_part(parts, street)
    _add_address_part(parts, neighbourhood)
    _add_address_part(parts, suburb)
    _add_address_part(parts, city)
    if re.fullmatch(r"\d{6}", pin):
        _add_address_part(parts, pin)

    if len(parts) < 2:
        for chunk in str(display_name or "").split(","):
            _add_address_part(parts, chunk.strip())

    return ", ".join(parts)


async def _nearby_locality_name(lat: float, lon: float) -> str:
    """Find the nearest English neighbourhood/suburb, skipping Chennai admin wards."""
    query = (
        "[out:json][timeout:6];"
        "("
        f'node["place"~"suburb|neighbourhood|quarter|locality"](around:800,{lat},{lon});'
        f'way["place"~"suburb|neighbourhood|quarter|locality"](around:800,{lat},{lon});'
        f'relation["place"~"suburb|neighbourhood|quarter|locality"](around:800,{lat},{lon});'
        ");"
        "out tags center 20;"
    )
    try:
        async with httpx.AsyncClient(timeout=7.0) as client:
            resp = await client.post(
                OVERPASS_URL,
                data={"data": query},
                headers=NOMINATIM_HEADERS,
            )
            resp.raise_for_status()
            payload = resp.json()
    except (httpx.RequestError, httpx.HTTPStatusError, ValueError):
        return ""

    best_name = ""
    best_dist = None
    for el in payload.get("elements") or []:
        tags = el.get("tags") or {}
        name = _clean_admin_label(tags.get("name:en") or tags.get("name"))
        if not _is_english_part(name) or _is_admin_locality(name):
            continue
        if el.get("type") == "node":
            elat, elon = el.get("lat"), el.get("lon")
        else:
            center = el.get("center") or {}
            elat, elon = center.get("lat"), center.get("lon")
        try:
            dist = (float(elat) - lat) ** 2 + (float(elon) - lon) ** 2
        except (TypeError, ValueError):
            dist = 9.0
        place = str(tags.get("place") or "")
        if place == "neighbourhood":
            dist *= 0.7
        if best_dist is None or dist < best_dist:
            best_dist = dist
            best_name = name
    return best_name


async def _nominatim_reverse(lat: float, lon: float, zoom: int = 18) -> dict:
    params = {
        "lat": lat,
        "lon": lon,
        "format": "jsonv2",
        "addressdetails": 1,
        "namedetails": 1,
        "zoom": zoom,
        "accept-language": "en",
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(NOMINATIM_URL, params=params, headers=NOMINATIM_HEADERS)
            resp.raise_for_status()
            data = resp.json()
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Geocoding service unavailable: {exc}",
        )
    return data if isinstance(data, dict) else {}


async def _reverse_geocode(lat: float, lon: float) -> dict:
    """Call Nominatim reverse geocoding and return a simplified address dict."""
    data = await _nominatim_reverse(lat, lon, zoom=10)
    address = data.get("address", {}) or {}
    city_name = (
        _pick_english(
            address.get("city"),
            address.get("town"),
            address.get("village"),
            address.get("county"),
            address.get("state_district"),
            address.get("state"),
        )
        or "Unknown"
    )
    pincode = address.get("postcode")
    return {
        "city": _friendly_city(city_name, None),
        "pincode": pincode,
        "display_name": data.get("display_name"),
        "boundingbox": _bbox_from_hit(data),
    }


async def _resolve_area_address(lat: float, lon: float) -> dict:
    """Street-level English area address for a dropped pin."""
    hit = await _nominatim_reverse(lat, lon, zoom=18)
    address = dict(hit.get("address") or {})
    neighbourhood = address.get("neighbourhood") or ""
    if _is_admin_locality(neighbourhood) or not _clean_admin_label(neighbourhood):
        nearby = await _nearby_locality_name(lat, lon)
        if nearby:
            address["neighbourhood"] = nearby
    formatted = format_street_area_pin(
        address,
        hit.get("display_name") or "",
        hit.get("namedetails") or {},
    )
    city = _friendly_city(
        _pick_english(
            address.get("city"),
            address.get("town"),
            address.get("municipality"),
            address.get("county"),
        ),
        None,
    )
    pin = re.sub(r"\s+", "", str(address.get("postcode") or "")) or None
    return {
        "formatted": formatted,
        "city": city,
        "pincode": pin,
        "address": address,
        "display_name": hit.get("display_name"),
        "boundingbox": _bbox_from_hit(hit),
    }


def _bbox_from_hit(hit: dict) -> Optional[List[float]]:
    raw = hit.get("boundingbox") if isinstance(hit, dict) else None
    if not raw or len(raw) != 4:
        return None
    try:
        return [float(raw[0]), float(raw[1]), float(raw[2]), float(raw[3])]
    except (TypeError, ValueError):
        return None


def _digits_pin(pincode: Optional[str]) -> str:
    return re.sub(r"\D", "", pincode or "")


def _friendly_city(osm_name: Optional[str], typed_city: Optional[str]) -> str:
    typed = (typed_city or "").strip()
    if typed and not typed.isdigit():
        cleaned = re.sub(r"\s+(municipal\s+)?corporation$", "", typed, flags=re.I).strip()
        return cleaned.title() if cleaned else typed.title()
    name = (osm_name or "").strip()
    name = re.sub(r"^(greater|brihan)\s+", "", name, flags=re.I)
    name = re.sub(r"\s+(municipal\s+)?corporation$", "", name, flags=re.I).strip()
    return name or typed or "Unknown"


def _osm_city(address: dict, fallback: Optional[str] = None) -> str:
    return (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("suburb")
        or address.get("neighbourhood")
        or address.get("county")
        or address.get("state_district")
        or fallback
        or "Unknown"
    )


def _hit_score(hit: dict, city: str, pin: str) -> float:
    addr = hit.get("address") or {}
    name = (hit.get("name") or hit.get("display_name") or "").lower()
    typ = (hit.get("addresstype") or hit.get("type") or "").lower()
    score = float(hit.get("importance") or 0) * 8
    post = re.sub(r"\D", "", str(addr.get("postcode") or ""))
    if pin and (post == pin or pin in post):
        score += 90
    city_l = city.lower()
    if city_l:
        for key in ("city", "town", "village", "suburb", "neighbourhood", "state_district"):
            val = str(addr.get(key) or "").lower()
            if city_l in val or val in city_l:
                score += 45
                break
        if city_l in name:
            score += 18
    if typ in ("postcode", "postal_code"):
        score += 55
    if typ in ("suburb", "neighbourhood", "quarter", "residential", "locality"):
        score += 28
    if typ in ("city", "town", "village", "hamlet"):
        score += 22
    if "corporation" in name:
        score -= 35
    bbox = _bbox_from_hit(hit)
    if bbox:
        span = abs(bbox[1] - bbox[0]) + abs(bbox[3] - bbox[2])
        if pin and span < 0.08:
            score += 20
        if span > 0.45:
            score -= 30
    return score


def _pack_hit(hit: dict, typed_city: Optional[str], typed_pin: Optional[str]) -> dict:
    address = hit.get("address") or {}
    pin = _digits_pin(typed_pin) or address.get("postcode")
    city = _friendly_city(_osm_city(address, typed_city), typed_city)
    state = address.get("state")
    label_parts = [city]
    if pin:
        label_parts.append(str(pin))
    if state:
        label_parts.append(state)
    label_parts.append("India")
    bbox = _bbox_from_hit(hit)
    if bbox:
        span = abs(bbox[1] - bbox[0]) + abs(bbox[3] - bbox[2])
        if span > 0.25:
            bbox = None
    return {
        "city": city,
        "pincode": pin,
        "lat": float(hit["lat"]),
        "lon": float(hit["lon"]),
        "display_name": ", ".join(label_parts),
        "boundingbox": bbox,
    }


async def _nominatim_search(params: dict) -> list:
    query = dict(params)
    query.setdefault("format", "jsonv2")
    query.setdefault("addressdetails", 1)
    query.setdefault("namedetails", 1)
    query.setdefault("limit", 5)
    query.setdefault("accept-language", "en")
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                NOMINATIM_SEARCH_URL, params=query, headers=NOMINATIM_HEADERS
            )
            resp.raise_for_status()
            data = resp.json()
    except (httpx.RequestError, httpx.HTTPStatusError):
        return []
    return data if isinstance(data, list) else []


async def _forward_geocode(query: str, city: Optional[str] = None, pincode: Optional[str] = None) -> dict:
    """Resolve a city name and/or pincode to coordinates via Nominatim."""
    city_s = _friendly_city((city or "").strip(), (city or "").strip()) if (city or "").strip() and not (city or "").strip().isdigit() else ""
    pin = _digits_pin(pincode)
    if not city_s and not pin:
        raw = (query or "").strip()
        maybe_pin = _digits_pin(raw)
        if len(maybe_pin) == 6 and maybe_pin == re.sub(r"\D", "", raw):
            pin = maybe_pin
        else:
            city_s = _friendly_city(raw, raw) if raw else ""

    attempts = []
    if city_s and len(pin) == 6:
        attempts.append({"q": f"{city_s} {pin}", "countrycodes": "in"})
    if len(pin) == 6:
        attempts.append({"q": pin, "countrycodes": "in"})
        attempts.append({"postalcode": pin, "country": "India"})
    if city_s:
        attempts.append({"q": f"{city_s}, India", "countrycodes": "in"})
        attempts.append({"city": city_s, "country": "India"})

    results: list = []
    for params in attempts:
        results = await _nominatim_search(params)
        if results:
            break

    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not find that city or pincode. Please try another.",
        )

    hit = max(results, key=lambda item: _hit_score(item, city_s, pin))
    return _pack_hit(hit, city_s, pin)


def _update_user_location(user: User, city: str, pincode: Optional[str],
                           lat: Optional[float], lon: Optional[float],
                           db: Session) -> User:
    """Persist location fields on the user record and commit."""
    user.city = city
    user.location_pincode = pincode
    if lat is not None:
        user.location_lat = lat
    if lon is not None:
        user.location_lon = lon
    db.commit()
    db.refresh(user)
    return user


# ── Routes ────────────────────────────────────────────────────────────────────
@router.post("/update/coords", response_model=LocationResponse)
async def update_location_by_coords(
    payload: LocationByCoords,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Accept GPS coordinates from the browser Geolocation API.
    Resolves city name via OpenStreetMap Nominatim, then stores on user record.
    """
    geo = await _reverse_geocode(payload.lat, payload.lon)
    user = _update_user_location(
        current_user,
        city=geo["city"],
        pincode=geo.get("pincode"),
        lat=payload.lat,
        lon=payload.lon,
        db=db,
    )
    return user


@router.post("/update/manual", response_model=LocationResponse)
async def update_location_manual(
    payload: LocationByCity,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Accept a manual city name / pincode from the fallback modal.
    Forward-geocodes via OpenStreetMap to resolve coordinates for recommendations.
    """
    city = (payload.city or "").strip()
    pin = (payload.pincode or "").strip()
    if not city and not pin:
        raise HTTPException(status_code=400, detail="City or pincode is required.")

    geo = await _forward_geocode(city or pin, city=city or None, pincode=pin or None)
    user = _update_user_location(
        current_user,
        city=geo["city"],
        pincode=geo.get("pincode") or (pin or None),
        lat=geo["lat"],
        lon=geo["lon"],
        db=db,
    )
    return user


@router.get("/preview", response_model=LocationPreviewResponse)
async def preview_location(city: Optional[str] = None, pincode: Optional[str] = None):
    """Forward-geocode a city/pincode for the location modal map (does not save)."""
    city_s = (city or "").strip()
    pin = (pincode or "").strip()
    if not city_s and not pin:
        raise HTTPException(status_code=400, detail="City or pincode is required.")
    geo = await _forward_geocode(city_s or pin, city=city_s or None, pincode=pin or None)
    return LocationPreviewResponse(
        city=geo.get("city"),
        location_pincode=geo.get("pincode") or (pin or None),
        location_lat=geo["lat"],
        location_lon=geo["lon"],
        display_name=geo.get("display_name"),
        boundingbox=geo.get("boundingbox"),
    )


@router.get("/preview/coords", response_model=LocationPreviewResponse)
async def preview_location_coords(lat: float, lon: float):
    """Reverse-geocode GPS coordinates for the location modal map (does not save)."""
    area = await _resolve_area_address(lat, lon)
    return LocationPreviewResponse(
        city=area.get("city"),
        location_pincode=area.get("pincode"),
        location_lat=lat,
        location_lon=lon,
        display_name=area.get("formatted") or area.get("display_name"),
        formatted=area.get("formatted"),
        boundingbox=area.get("boundingbox"),
    )


@router.get("/venue-reverse", response_model=VenueAddressResponse)
async def venue_reverse(lat: float, lon: float):
    """Street-level English reverse geocode for the host venue map pin."""
    area = await _resolve_area_address(lat, lon)
    formatted = area.get("formatted") or ""
    if not formatted:
        raise HTTPException(status_code=404, detail="Could not resolve an English address for that pin.")
    return VenueAddressResponse(
        formatted=formatted,
        display_name=area.get("display_name"),
        address=area.get("address") or {},
        location_lat=lat,
        location_lon=lon,
    )


@router.get("/venue-search")
async def venue_search(q: str):
    """English forward-geocode for typing a venue address, place, or pincode."""
    query = (q or "").strip()
    if len(query) < 3:
        raise HTTPException(status_code=400, detail="Enter at least 3 characters.")

    pin = _digits_pin(query)
    is_bare_pin = len(pin) == 6 and pin == re.sub(r"\s", "", query)

    attempts: List[dict] = []
    if is_bare_pin:
        # A bare pincode resolves better through the postalcode field than free text.
        attempts.append({"postalcode": pin, "country": "India", "limit": 1})
        attempts.append({"q": f"{pin}, India", "countrycodes": "in", "limit": 1})
    attempts.append({"q": query, "countrycodes": "in", "limit": 1})
    if not is_bare_pin and "india" not in query.lower():
        attempts.append({"q": f"{query}, India", "countrycodes": "in", "limit": 1})

    results: list = []
    for params in attempts:
        results = await _nominatim_search(params)
        if results:
            break

    if not results:
        raise HTTPException(status_code=404, detail="Place not found.")
    hit = results[0]
    address = hit.get("address") or {}
    formatted = format_street_area_pin(
        address,
        hit.get("display_name") or hit.get("name") or "",
        hit.get("namedetails") or {},
    )
    return {
        "formatted": formatted,
        "display_name": hit.get("display_name"),
        "address": address,
        "location_lat": float(hit["lat"]),
        "location_lon": float(hit["lon"]),
    }


@router.get("/me", response_model=LocationResponse)
def get_my_location(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's saved location."""
    return current_user
