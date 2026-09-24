"""Public Maps JavaScript config. The browser key is referrer-restricted in Google Cloud."""

import os
from fastapi import APIRouter

router = APIRouter()


def _maps_api_key() -> str:
    return (os.getenv("GOOGLE_MAPS_API_KEY") or "").strip()


@router.get("/config")
def maps_config():
    key = _maps_api_key()
    return {
        "enabled": bool(key),
        "apiKey": key or None,
        "libraries": ["places"],
    }
