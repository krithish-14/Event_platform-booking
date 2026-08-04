"""
Location routes — resolve coordinates to city and store on user profile.
Uses OpenStreetMap Nominatim (free, no API key required).
"""

import httpx
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.user import User

router = APIRouter()

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_HEADERS = {
    "User-Agent": "JODEvents/1.0 (event-booking-platform; contact@jodevents.com)"
}


# ── Schemas ───────────────────────────────────────────────────────────────────
class LocationByCoords(BaseModel):
    lat: float
    lon: float


class LocationByCity(BaseModel):
    city: str
    pincode: Optional[str] = None


class LocationResponse(BaseModel):
    city: Optional[str]
    location_pincode: Optional[str]
    location_lat: Optional[float]
    location_lon: Optional[float]

    class Config:
        from_attributes = True


# ── Helpers ───────────────────────────────────────────────────────────────────
async def _reverse_geocode(lat: float, lon: float) -> dict:
    """Call Nominatim reverse geocoding and return a simplified address dict."""
    params = {
        "lat": lat,
        "lon": lon,
        "format": "jsonv2",
        "addressdetails": 1,
        "zoom": 10,
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

    address = data.get("address", {})
    # Nominatim returns city/town/village/county depending on zoom level
    city_name = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("county")
        or address.get("state_district")
        or address.get("state")
        or "Unknown"
    )
    pincode = address.get("postcode")
    return {"city": city_name, "pincode": pincode}


async def _forward_geocode(query: str) -> dict:
    """Resolve a city name or pincode to coordinates via Nominatim search."""
    params = {
        "q": query,
        "format": "jsonv2",
        "addressdetails": 1,
        "countrycodes": "in",
        "limit": 1,
    }
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                NOMINATIM_SEARCH_URL, params=params, headers=NOMINATIM_HEADERS
            )
            resp.raise_for_status()
            results = resp.json()
    except (httpx.RequestError, httpx.HTTPStatusError) as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Geocoding service unavailable: {exc}",
        )

    if not results:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Could not find that city or pincode. Please try another.",
        )

    hit = results[0]
    address = hit.get("address", {})
    city_name = (
        address.get("city")
        or address.get("town")
        or address.get("village")
        or address.get("county")
        or address.get("state_district")
        or query.strip().title()
    )
    pincode = address.get("postcode")
    return {
        "city": city_name,
        "pincode": pincode,
        "lat": float(hit["lat"]),
        "lon": float(hit["lon"]),
    }


def _update_user_location(user: User, city: str, pincode: Optional[str],
                           lat: Optional[float], lon: Optional[float],
                           db: Session) -> User:
    """Persist location fields on the user record and commit."""
    user.city = city
    if pincode:
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
    query = payload.city.strip() or (payload.pincode.strip() if payload.pincode else "")
    if not query:
        raise HTTPException(status_code=400, detail="City or pincode is required.")

    geo = await _forward_geocode(query)
    city = geo["city"]
    user = _update_user_location(
        current_user,
        city=city,
        pincode=geo.get("pincode") or (payload.pincode.strip() if payload.pincode else None),
        lat=geo["lat"],
        lon=geo["lon"],
        db=db,
    )
    return user


@router.get("/me", response_model=LocationResponse)
def get_my_location(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's saved location."""
    return current_user
