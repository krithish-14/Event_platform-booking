"""Client IP / user-agent / rough geo helpers for audit logs.

CloudWatch (or any log shipper) does not populate database columns — callers must
persist these fields explicitly on login/signup audit rows.
"""

from __future__ import annotations

import ipaddress
import logging
import time
from datetime import datetime
from threading import Lock
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from fastapi import Request

logger = logging.getLogger("jod.client_meta")

_GEO_CACHE: dict[str, tuple[float, Optional[str]]] = {}
_GEO_LOCK = Lock()
_GEO_TTL_SECONDS = 6 * 60 * 60
_GEO_TIMEOUT = 1.5
_IST = ZoneInfo("Asia/Kolkata")


def get_client_ip(request: Request) -> Optional[str]:
    """Best-effort public client IP behind Cloudflare / nginx / ALB."""
    candidates = [
        (request.headers.get("cf-connecting-ip") or "").strip(),
        (request.headers.get("true-client-ip") or "").strip(),
        (request.headers.get("x-real-ip") or "").strip(),
    ]
    forwarded = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip()
    if forwarded:
        candidates.append(forwarded)
    if request.client and request.client.host:
        candidates.append(request.client.host.strip())

    for raw in candidates:
        if not raw or raw.lower() == "unknown":
            continue
        # Strip port if present (rare IPv4:port forms)
        host = raw.split("%", 1)[0].strip()
        if host.startswith("[") and "]" in host:
            host = host[1 : host.index("]")]
        elif host.count(":") == 1 and "." in host:
            host = host.rsplit(":", 1)[0]
        try:
            ipaddress.ip_address(host)
        except ValueError:
            continue
        return host
    return None


def parse_browser_name(ua: str | None) -> Optional[str]:
    """Return a short browser label (Chrome, Edge, …) instead of the raw UA string."""
    raw = (ua or "").strip()
    if not raw:
        return None
    u = raw.lower()
    # Order matters: Edge/Opera include "Chrome" in their UA.
    if "edg/" in u or "edgios/" in u or "edga/" in u:
        return "Edge"
    if "opr/" in u or "opera" in u:
        return "Opera"
    if "samsungbrowser" in u:
        return "Samsung Internet"
    if "firefox/" in u or "fxios/" in u:
        return "Firefox"
    if "crios/" in u or "chrome/" in u or "chromium/" in u:
        return "Chrome"
    if "safari/" in u:
        return "Safari"
    if "msie" in u or "trident/" in u:
        return "Internet Explorer"
    if "android" in u:
        return "Android Browser"
    return "Unknown"


def get_user_agent(request: Request) -> Optional[str]:
    """Browser name only — stored in user_logins.user_agent for readable audits."""
    return parse_browser_name(request.headers.get("user-agent"))


def login_at_ist() -> datetime:
    """India local date/time, seconds precision (easy to read in DB tools)."""
    return datetime.now(_IST).replace(tzinfo=None, microsecond=0)


def _is_public_ip(ip: str) -> bool:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return False
    return not (
        addr.is_private
        or addr.is_loopback
        or addr.is_link_local
        or addr.is_multicast
        or addr.is_reserved
        or addr.is_unspecified
    )


def _cf_country(request: Request) -> Optional[str]:
    code = (request.headers.get("cf-ipcountry") or "").strip().upper()
    if not code or code in {"XX", "T1"}:
        return None
    return code


def _format_region(city: str | None, region_name: str | None, country: str | None, country_code: str | None) -> Optional[str]:
    parts = [p.strip() for p in (city, region_name, country) if p and str(p).strip()]
    if parts:
        label = ", ".join(parts)
        if country_code and country_code not in label:
            return f"{label} ({country_code})"
        return label
    if country_code:
        return country_code
    return None


def _lookup_ip_api(ip: str) -> Optional[str]:
    url = f"http://ip-api.com/json/{ip}"
    params = {"fields": "status,message,country,regionName,city,countryCode"}
    try:
        with httpx.Client(timeout=_GEO_TIMEOUT) as client:
            res = client.get(url, params=params)
            res.raise_for_status()
            data = res.json()
    except Exception as exc:
        logger.debug("geo_lookup_failed ip=%s err=%s", ip, exc)
        return None
    if not isinstance(data, dict) or data.get("status") != "success":
        return None
    return _format_region(
        data.get("city"),
        data.get("regionName"),
        data.get("country"),
        data.get("countryCode"),
    )


def resolve_region(ip: Optional[str], request: Request | None = None) -> Optional[str]:
    """Return a human-readable region string, or country code as fallback."""
    cf_code = _cf_country(request) if request is not None else None

    if not ip or not _is_public_ip(ip):
        return cf_code

    now = time.monotonic()
    with _GEO_LOCK:
        cached = _GEO_CACHE.get(ip)
        if cached and (now - cached[0]) < _GEO_TTL_SECONDS:
            return cached[1] or cf_code

    label = _lookup_ip_api(ip)
    if not label and cf_code:
        label = cf_code

    with _GEO_LOCK:
        _GEO_CACHE[ip] = (now, label)
        # Bound cache size
        if len(_GEO_CACHE) > 2000:
            oldest = sorted(_GEO_CACHE.items(), key=lambda kv: kv[1][0])[:500]
            for key, _ in oldest:
                _GEO_CACHE.pop(key, None)

    return label


def request_audit_meta(request: Request) -> dict:
    """Fields suitable for UserLogin / similar audit rows."""
    ip = get_client_ip(request)
    return {
        "ip_address": ip,
        "user_agent": get_user_agent(request),
        "region": resolve_region(ip, request),
        "login_at": login_at_ist(),
    }
