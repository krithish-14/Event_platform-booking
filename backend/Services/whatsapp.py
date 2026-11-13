"""
WhatsApp ticket delivery.

Priority:
1. Zoho CPaaS / Zepto WhatsApp approved template (booking confirmation)
2. Meta Cloud API free-form text/image
3. Twilio WhatsApp
4. wa.me deep link for the admin to send manually
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple
from urllib.parse import quote

import httpx


# Match the Zepto/Meta approved booking-confirmation template placeholders.
BOOKING_TEMPLATE_MERGE_KEYS = ("Name", "Event_Name", "Event_Date", "Ticket_Type", "Booking_id")


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


def e164_whatsapp_number(raw: Optional[str]) -> str:
    """Return +<country><number> for Zoho CPaaS / Meta template sends."""
    digits = normalize_whatsapp_number(raw)
    if not digits:
        return ""
    return f"+{digits}"


def wa_me_url(phone: str, text: str) -> str:
    number = normalize_whatsapp_number(phone)
    if not number:
        return ""
    return f"https://wa.me/{number}?text={quote(text)}"


def format_booking_id(booking_id: Any) -> str:
    raw = str(booking_id or "").replace("-", "").strip()
    return f"JOD-{(raw[:8] or '00000000').upper()}"


def booking_confirmation_merge_info(
    *,
    name: str,
    event_name: str,
    event_date: str,
    ticket_type: str,
    booking_id: Any,
) -> Dict[str, str]:
    """Build merge_info for the approved booking-confirmation WhatsApp template."""
    return {
        "Name": (name or "Guest").strip() or "Guest",
        "Event_Name": (event_name or "your event").strip() or "your event",
        "Event_Date": (event_date or "TBA").strip() or "TBA",
        "Ticket_Type": (ticket_type or "General Admission").strip() or "General Admission",
        "Booking_id": format_booking_id(booking_id),
    }


def _env_first(*names: str) -> str:
    for name in names:
        value = (os.getenv(name) or "").strip()
        if value:
            return value
    return ""


def zoho_cpaas_api_key() -> str:
    return _env_first(
        "ZOHO_CPAAS_API_KEY",
        "ZEPTO_WHATSAPP_API_KEY",
        "WHATSAPP_CPAAS_API_KEY",
    )


def zoho_cpaas_whatsapp_from() -> str:
    return _env_first(
        "ZOHO_CPAAS_WHATSAPP_FROM",
        "ZEPTO_WHATSAPP_FROM",
        "WHATSAPP_FROM",
    )


def zoho_cpaas_ticket_template_key() -> str:
    return _env_first(
        "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_KEY",
        "WHATSAPP_TEMPLATE_KEY",
        "ZEPTO_WHATSAPP_TEMPLATE_KEY",
    )


def zoho_cpaas_ticket_template_alias() -> str:
    return _env_first(
        "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_ALIAS",
        "WHATSAPP_TEMPLATE_ALIAS",
        "ZEPTO_WHATSAPP_TEMPLATE_ALIAS",
    )


def zoho_cpaas_agent_alias() -> str:
    return _env_first("ZOHO_CPAAS_AGENT_ALIAS")


def zoho_cpaas_whatsapp_test_to() -> str:
    return _env_first("ZOHO_CPAAS_WHATSAPP_TEST_TO")


def whatsapp_template_configured() -> bool:
    key = zoho_cpaas_ticket_template_key()
    alias = zoho_cpaas_ticket_template_alias()
    api_key = zoho_cpaas_api_key()
    sender = zoho_cpaas_whatsapp_from()
    return bool(api_key and sender and (key or alias))


def zepto_whatsapp_api_base() -> str:
    """
    Resolve Zoho CPaaS WhatsApp API base ending in /v1.1.
    Accepts ZOHO_CPAAS_HOST as host root or full base URL.
    """
    raw = _env_first(
        "ZOHO_CPAAS_HOST",
        "ZEPTO_WHATSAPP_API_BASE",
        "ZOHO_CPAAS_API_BASE",
    ) or "https://cpaas.zoho.com/v1.1"
    base = raw.rstrip("/")
    if base.endswith("/whatsapp"):
        base = base[: -len("/whatsapp")]
    if not base.endswith("/v1.1"):
        base = f"{base}/v1.1"
    return base


def zepto_whatsapp_auth_header(api_key: str) -> str:
    token = (api_key or "").strip()
    if token.lower().startswith("zoho-enczapikey "):
        return token
    return f"Zoho-enczapikey {token}"


def build_zepto_template_payload(
    *,
    to_phone: str,
    from_phone: str,
    template_key: str = "",
    template_alias: str = "",
    merge_info: Optional[Dict[str, str]] = None,
    attachment_file_key: Optional[str] = None,
    client_reference: Optional[str] = None,
) -> Dict[str, Any]:
    to_e164 = e164_whatsapp_number(to_phone)
    from_e164 = e164_whatsapp_number(from_phone) or (from_phone or "").strip()
    if from_e164 and not from_e164.startswith("+"):
        from_e164 = f"+{''.join(ch for ch in from_e164 if ch.isdigit())}"
    payload: Dict[str, Any] = {
        "from": from_e164,
        "to": to_e164,
    }
    key = (template_key or "").strip()
    alias = (template_alias or "").strip()
    if key:
        payload["template_key"] = key
    elif alias:
        payload["template_alias"] = alias
    if merge_info:
        payload["merge_info"] = dict(merge_info)
    if attachment_file_key:
        payload["attachment"] = {"file_key": str(attachment_file_key).strip()}
    if client_reference:
        payload["client_reference"] = str(client_reference)[:100]
    return payload


def send_whatsapp_template(
    to_phone: str,
    *,
    merge_info: Optional[Dict[str, str]] = None,
    attachment_file_key: Optional[str] = None,
    client_reference: Optional[str] = None,
    template_key: Optional[str] = None,
    template_alias: Optional[str] = None,
) -> Tuple[bool, str, str, Optional[str]]:
    """
    Send an approved Zoho CPaaS / Zepto WhatsApp template.

    Returns (sent, channel, wa_me_url, message_id).
    """
    number = normalize_whatsapp_number(to_phone)
    link = wa_me_url(to_phone, "Your JOD Events booking confirmation.")
    if not number:
        return False, "none", "", None

    api_key = zoho_cpaas_api_key()
    sender = zoho_cpaas_whatsapp_from()
    key = (template_key or zoho_cpaas_ticket_template_key()).strip()
    alias = (
        template_alias
        or _env_first(
            "ZOHO_CPAAS_WHATSAPP_TICKET_TEMPLATE_ALIAS",
            "WHATSAPP_TEMPLATE_ALIAS",
            "ZEPTO_WHATSAPP_TEMPLATE_ALIAS",
        )
    ).strip()
    if not api_key or not sender or not (key or alias):
        return False, "none", link, None

    payload = build_zepto_template_payload(
        to_phone=to_phone,
        from_phone=sender,
        template_key=key,
        template_alias=alias,
        merge_info=merge_info,
        attachment_file_key=attachment_file_key
        or _env_first("WHATSAPP_TEMPLATE_FILE_KEY", "ZOHO_CPAAS_WHATSAPP_FILE_KEY")
        or None,
        client_reference=client_reference,
    )
    url = f"{zepto_whatsapp_api_base()}/whatsapp"
    agent = zoho_cpaas_agent_alias()
    _safe_print(
        f"[WHATSAPP] template to={payload.get('to')} key={key or alias}"
        + (f" agent={agent}" if agent else "")
    )
    try:
        headers = {
            "Authorization": zepto_whatsapp_auth_header(api_key),
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        if agent:
            headers["agent-alias"] = agent
        res = httpx.post(
            url,
            headers=headers,
            json=payload,
            timeout=25,
        )
        body = (res.text or "")[:500]
        if 200 <= res.status_code < 300:
            message_id = None
            try:
                data = res.json()
                message_id = ((data.get("data") or {}) if isinstance(data, dict) else {}).get("message_id")
            except Exception:
                message_id = None
            _safe_print(f"[WHATSAPP] Zoho template queued message_id={message_id or '-'}")
            return True, "zepto-template", link, message_id
        _safe_print(f"[WHATSAPP] Zoho template failed {res.status_code}: {body}")
    except Exception as exc:
        _safe_print(f"[WHATSAPP] Zoho template error: {exc}")
    return False, "zepto-template", link, None


def send_booking_confirmation_whatsapp(
    to_phone: str,
    *,
    name: str,
    event_name: str,
    event_date: str,
    ticket_type: str,
    booking_id: Any,
    attachment_file_key: Optional[str] = None,
) -> Tuple[bool, str, str, Optional[str]]:
    """Send the approved booking-confirmation template for one booking."""
    merge = booking_confirmation_merge_info(
        name=name,
        event_name=event_name,
        event_date=event_date,
        ticket_type=ticket_type,
        booking_id=booking_id,
    )
    return send_whatsapp_template(
        to_phone,
        merge_info=merge,
        attachment_file_key=attachment_file_key,
        client_reference=format_booking_id(booking_id),
    )


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
