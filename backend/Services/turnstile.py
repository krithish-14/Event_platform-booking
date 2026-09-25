"""Cloudflare Turnstile siteverify for email/password signup only."""

from __future__ import annotations

import os

import httpx
from fastapi import HTTPException, Request, status

from Services.runtime_env import is_production, is_staging

SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SIGNUP_ACTION = "signup"
MISSING_TOKEN = "Please complete the verification before signing up."
FAILED_TOKEN = "Verification failed. Please try again."
UNAVAILABLE = "Verification service is temporarily unavailable. Please try again."


def turnstile_secret() -> str:
    return (os.getenv("CLOUDFLARE_TURNSTILE_SECRET_KEY") or "").strip()


def turnstile_site_key() -> str:
    return (os.getenv("CLOUDFLARE_TURNSTILE_SITE_KEY") or "").strip()


def turnstile_public_config() -> dict:
    site_key = turnstile_site_key()
    return {
        "site_key": site_key,
        "enabled": bool(site_key and turnstile_secret()),
    }


def turnstile_hostnames() -> set[str]:
    raw = (
        os.getenv("CLOUDFLARE_TURNSTILE_HOSTNAMES")
        or os.getenv("TURNSTILE_HOSTNAMES")
        or ""
    ).strip()
    if raw:
        return {host.strip().lower() for host in raw.split(",") if host.strip()}
    if is_production() or is_staging():
        return {"jodevents.com", "www.jodevents.com"}
    return {"localhost", "127.0.0.1"}


def client_ip(request: Request) -> str | None:
    if request.client and request.client.host:
        host = request.client.host.strip()
        if host and host != "unknown":
            return host
    return None


def _verify_with_cloudflare(token: str, remote_ip: str | None) -> dict:
    payload = {
        "secret": turnstile_secret(),
        "response": token,
    }
    if remote_ip:
        payload["remoteip"] = remote_ip
    with httpx.Client(timeout=10.0) as client:
        response = client.post(SITEVERIFY_URL, data=payload)
        response.raise_for_status()
        return response.json()


def require_signup_turnstile(token: str | None, request: Request) -> None:
    """Fail closed in production. Local tests may omit keys and skip verification."""
    secret = turnstile_secret()
    if not secret:
        if is_production() or is_staging():
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNAVAILABLE)
        return

    cleaned = (token or "").strip()
    if not cleaned or len(cleaned) > 2048:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=MISSING_TOKEN)

    try:
        result = _verify_with_cloudflare(cleaned, client_ip(request))
    except (httpx.HTTPError, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=UNAVAILABLE)

    hosts = turnstile_hostnames()
    hostname = str(result.get("hostname") or "").strip().lower()
    if (
        result.get("success") is not True
        or result.get("action") != SIGNUP_ACTION
        or not hosts
        or hostname not in hosts
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=FAILED_TOKEN)
