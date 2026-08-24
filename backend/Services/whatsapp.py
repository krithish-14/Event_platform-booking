"""
WhatsApp ticket delivery. Uses Cloud API or Twilio when configured;
otherwise returns a wa.me link the admin can send in one click.
"""

import os
from typing import Optional, Tuple
from urllib.parse import quote

import httpx


def _safe_print(msg: str) -> None:
    try:
        print(msg, flush=True)
    except Exception:
        pass


def normalize_whatsapp_number(raw: Optional[str]) -> str:
    digits = "".join(ch for ch in str(raw or "") if ch.isdigit())
    if not digits:
        return ""
    if len(digits) == 10:
        return "91" + digits
    if digits.startswith("0") and len(digits) == 11:
        return "91" + digits[1:]
    if digits.startswith("00"):
        return digits[2:]
    return digits


def wa_me_url(phone: str, text: str) -> str:
    number = normalize_whatsapp_number(phone)
    if not number:
        return ""
    return f"https://wa.me/{number}?text={quote(text)}"


def send_whatsapp(to_phone: str, text: str, image_url: Optional[str] = None) -> Tuple[bool, str, str]:
    """
    Returns (sent, channel, wa_me_url).
    channel is cloud / twilio / link.
    """
    number = normalize_whatsapp_number(to_phone)
    link = wa_me_url(to_phone, text)
    if not number:
        return False, "none", ""

    _safe_print(f"[WHATSAPP] to={number}")
    _safe_print(text)

    token = (os.getenv("WHATSAPP_ACCESS_TOKEN") or os.getenv("WHATSAPP_TOKEN") or "").strip()
    phone_id = (os.getenv("WHATSAPP_PHONE_NUMBER_ID") or "").strip()
    if token and phone_id:
        try:
            payload = {
                "messaging_product": "whatsapp",
                "to": number,
                "type": "text",
                "text": {"preview_url": True, "body": text},
            }
            if image_url:
                payload = {
                    "messaging_product": "whatsapp",
                    "to": number,
                    "type": "image",
                    "image": {"link": image_url, "caption": text[:1024]},
                }
            url = f"https://graph.facebook.com/v21.0/{phone_id}/messages"
            res = httpx.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json=payload,
                timeout=20,
            )
            if 200 <= res.status_code < 300:
                _safe_print(f"[WHATSAPP] Cloud API delivered to {number}")
                return True, "cloud", link
            _safe_print(f"[WHATSAPP] Cloud API failed {res.status_code}: {res.text[:300]}")
        except Exception as exc:
            _safe_print(f"[WHATSAPP] Cloud API error: {exc}")

    twilio_sid = (os.getenv("TWILIO_ACCOUNT_SID") or "").strip()
    twilio_token = (os.getenv("TWILIO_AUTH_TOKEN") or "").strip()
    twilio_from = (os.getenv("TWILIO_WHATSAPP_FROM") or "").strip()
    if twilio_sid and twilio_token and twilio_from:
        try:
            from_num = twilio_from if twilio_from.startswith("whatsapp:") else f"whatsapp:{twilio_from}"
            res = httpx.post(
                f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json",
                auth=(twilio_sid, twilio_token),
                data={
                    "From": from_num,
                    "To": f"whatsapp:+{number}",
                    "Body": text,
                },
                timeout=20,
            )
            if 200 <= res.status_code < 300:
                _safe_print(f"[WHATSAPP] Twilio delivered to {number}")
                return True, "twilio", link
            _safe_print(f"[WHATSAPP] Twilio failed {res.status_code}: {res.text[:300]}")
        except Exception as exc:
            _safe_print(f"[WHATSAPP] Twilio error: {exc}")

    return False, "link", link
