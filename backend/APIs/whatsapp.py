"""
WhatsApp Cloud API webhook (Meta callback) + outbound send helpers.
"""

from __future__ import annotations

import hmac
import os
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse

router = APIRouter()


def _verify_token() -> str:
	return (os.getenv("WHATSAPP_VERIFY_TOKEN") or "").strip()


@router.get("/webhook")
async def verify_whatsapp_webhook(
	hub_mode: Optional[str] = Query(None, alias="hub.mode"),
	hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
	hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
):
	"""Meta webhook handshake. Returns hub.challenge when the verify token matches."""
	expected = _verify_token()
	if not expected:
		raise HTTPException(status_code=503, detail="WhatsApp verify token is not configured.")
	if hub_mode != "subscribe" or not hub_verify_token or not hub_challenge:
		raise HTTPException(status_code=400, detail="Invalid webhook verification request.")
	if not hmac.compare_digest(hub_verify_token, expected):
		raise HTTPException(status_code=403, detail="Verify token mismatch.")
	return PlainTextResponse(content=hub_challenge, status_code=200)


@router.post("/webhook")
async def receive_whatsapp_webhook(request: Request):
	"""Acknowledge inbound Cloud API events so Meta marks the webhook as healthy."""
	payload: Any
	try:
		payload = await request.json()
	except Exception:
		payload = {}
	kind = ""
	if isinstance(payload, dict):
		kind = str(payload.get("object") or "")
	print(f"[WHATSAPP] webhook received object={kind or 'unknown'}", flush=True)
	return {"status": "ok"}
