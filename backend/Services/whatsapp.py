"""
WhatsApp ticket delivery.

Priority:
1. Zoho CPaaS / Zepto WhatsApp approved template (booking confirmation)
2. Meta Cloud API free-form text/image
3. Twilio WhatsApp
4. wa.me deep link for the admin to send manually
"""

from __future__ import annotations

import base64
import os
import subprocess
import tempfile
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
    base = raw.strip().rstrip("/")
    if base.startswith("//"):
        base = f"https:{base}"
    elif "://" not in base:
        base = f"https://{base}"
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


def _extract_file_cache_key(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    data = payload.get("data") if isinstance(payload.get("data"), dict) else payload
    for key_name in ("file_cache_key", "file_key", "key"):
        value = str((data or {}).get(key_name) or "").strip()
        if value:
            return value
    return ""


def _multipart_file_body(
    *,
    field_name: str,
    filename: str,
    content: bytes,
    content_type: str,
) -> Tuple[str, bytes]:
    """Build a multipart/form-data body with a known Content-Length."""
    boundary = f"----JodFormBoundary{os.urandom(12).hex()}"
    header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="{field_name}"; filename="{filename}"\r\n'
        f"Content-Type: {content_type}\r\n"
        f"\r\n"
    ).encode("ascii")
    footer = f"\r\n--{boundary}--\r\n".encode("ascii")
    return boundary, header + content + footer


def _parse_upload_response(status_code: int, text: str, *, via: str, name: str) -> Optional[str]:
    body = (text or "")[:500]
    try:
        import json as _json

        data = _json.loads(text or "{}")
    except Exception:
        data = {}
    key = _extract_file_cache_key(data if isinstance(data, dict) else {})
    if key:
        _safe_print(f"[WHATSAPP] file uploaded via {via} name={name} key={key[:28]}…")
        return key
    if isinstance(data, dict) and data.get("error"):
        _safe_print(f"[WHATSAPP] file upload failed via {via}: {body}")
        return None
    if 200 <= status_code < 300:
        _safe_print(f"[WHATSAPP] file upload missing file_cache_key via {via}: {body}")
    else:
        _safe_print(f"[WHATSAPP] file upload failed via {via} {status_code}: {body}")
    return None


def upload_cpaas_file(
    content: bytes,
    filename: str = "ticket.pdf",
    *,
    content_type: str = "application/pdf",
) -> Optional[str]:
    """
    Upload bytes to Zoho CPaaS File Cache and return file_cache_key.

    Required for DOCUMENT-header WhatsApp templates so each booking gets the
    real ticket PDF instead of the template's sample document.

    Working clients (ZeptoMail / CPaaS SDKs) POST the raw file bytes with
    Content-Type set to the file MIME type — not multipart/form-data. Multipart
    consistently returns UE_104 ("File with empty content") on cpaas.zoho.in.
    """
    api_key = zoho_cpaas_api_key()
    raw = bytes(content) if isinstance(content, (bytes, bytearray)) else b""
    if not api_key or not raw:
        _safe_print("[WHATSAPP] file upload skipped: missing api key or empty bytes")
        return None
    name = (filename or "ticket.pdf").strip() or "ticket.pdf"
    name = name.replace("\\", "/").split("/")[-1][:120]
    if not name.lower().endswith(".pdf"):
        name = f"{name}.pdf"
    mime = (content_type or "application/pdf").strip() or "application/pdf"
    url = f"{zepto_whatsapp_api_base()}/files"
    auth = zepto_whatsapp_auth_header(api_key)
    agent = zoho_cpaas_agent_alias()
    _safe_print(
        f"[WHATSAPP] uploading file name={name} bytes={len(raw)} magic={raw[:8]!r}"
    )

    upload_url = f"{url}?name={quote(name)}"
    attempts: list[Tuple[str, Dict[str, str], bytes]] = []

    # Primary: raw body + MIME (ZeptoMail / working CPaaS SDK shape).
    agent_modes = [("raw-body", True), ("raw-body-no-agent", False)] if agent else [("raw-body", False)]
    for label, with_agent in agent_modes:
        hdrs = {
            "Authorization": auth,
            "Accept": "application/json",
            "Content-Type": mime,
            "Content-Length": str(len(raw)),
        }
        if with_agent and agent:
            hdrs["agent-alias"] = agent
        attempts.append((label, hdrs, raw))

    # Fallback: multipart (docs say this; IN DC often returns UE_104).
    boundary, multipart_body = _multipart_file_body(
        field_name="file",
        filename=name,
        content=raw,
        content_type=mime,
    )
    mp_headers = {
        "Authorization": auth,
        "Accept": "application/json",
        "Content-Type": f"multipart/form-data; boundary={boundary}",
        "Content-Length": str(len(multipart_body)),
    }
    if agent:
        mp_headers["agent-alias"] = agent
    attempts.append(("multipart-file", mp_headers, multipart_body))

    try:
        for via, headers, body in attempts:
            res = httpx.post(upload_url, headers=headers, content=body, timeout=60)
            text = res.text or ""
            key = _parse_upload_response(res.status_code, text, via=via, name=name)
            if key:
                return key
            # Hard auth failures won't be fixed by alternate encodings.
            if res.status_code in (401, 403) or '"TM_4001"' in text:
                if via.startswith("raw"):
                    continue
                return None

        # curl raw-body fallback (same shape as working ZeptoMail clients).
        tmp_path = ""
        try:
            with tempfile.NamedTemporaryFile(prefix="jod-wa-", suffix=".pdf", delete=False) as tmp:
                tmp.write(raw)
                tmp.flush()
                os.fsync(tmp.fileno())
                tmp_path = tmp.name
            on_disk = os.path.getsize(tmp_path)
            _safe_print(f"[WHATSAPP] curl raw-body fallback path={tmp_path} on_disk={on_disk}")
            if on_disk <= 0:
                return None
            curl_cmd = [
                "curl",
                "-sS",
                "-X",
                "POST",
                upload_url,
                "-H",
                f"Authorization: {auth}",
                "-H",
                f"Content-Type: {mime}",
                "--data-binary",
                f"@{tmp_path}",
            ]
            if agent:
                curl_cmd.extend(["-H", f"agent-alias: {agent}"])
            completed = subprocess.run(
                curl_cmd,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
            curl_text = completed.stdout or completed.stderr or ""
            key = _parse_upload_response(
                200 if completed.returncode == 0 else 400,
                curl_text,
                via="curl-raw",
                name=name,
            )
            if key:
                return key
        finally:
            if tmp_path:
                try:
                    os.unlink(tmp_path)
                except Exception:
                    pass
        return None
    except Exception as exc:
        _safe_print(f"[WHATSAPP] file upload error: {exc}")
        return None


def build_zepto_template_payload(
    *,
    to_phone: str,
    from_phone: str,
    template_key: str = "",
    template_alias: str = "",
    merge_info: Optional[Dict[str, str]] = None,
    attachment_file_key: Optional[str] = None,
    attachment_bytes: Optional[bytes] = None,
    attachment_filename: str = "ticket.pdf",
    client_reference: Optional[str] = None,
    attachment_style: str = "attachments_file_cache_key",
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
    # DOCUMENT-header media. Empirical on cpaas.zoho.in:
    # - top-level file_key / nested "attachment" → GE_121 extra key
    # - "attachments" is schema-accepted (not GE_121); email uses file_cache_key
    #   or base64 content inside that array.
    file_key = str(attachment_file_key or "").strip()
    raw = bytes(attachment_bytes) if isinstance(attachment_bytes, (bytes, bytearray)) else b""
    fname = (attachment_filename or "ticket.pdf").strip() or "ticket.pdf"
    style = (attachment_style or "attachments_file_cache_key").strip()
    if style == "attachments_base64" and raw:
        payload["attachments"] = [
            {
                "content": base64.b64encode(raw).decode("ascii"),
                "mime_type": "application/pdf",
                "name": fname,
            }
        ]
    elif file_key:
        if style == "attachments_file_key":
            payload["attachments"] = [{"file_key": file_key}]
        elif style == "attachments_file_cache_key":
            payload["attachments"] = [{"file_cache_key": file_key}]
        elif style == "attachments_file_cache_key_named":
            payload["attachments"] = [
                {
                    "file_cache_key": file_key,
                    "name": fname,
                    "mime_type": "application/pdf",
                }
            ]
        elif style == "attachments_file_key_named":
            payload["attachments"] = [
                {"file_key": file_key, "name": fname, "mime_type": "application/pdf"}
            ]
        elif style == "attachments_string":
            payload["attachments"] = [file_key]
        elif style == "top_file_cache_key":
            payload["file_cache_key"] = file_key
        elif style == "merge_file_cache_key":
            payload.setdefault("merge_info", {})
            payload["merge_info"]["file_cache_key"] = file_key
        elif style == "merge_file_key":
            payload.setdefault("merge_info", {})
            payload["merge_info"]["file_key"] = file_key
        else:
            payload["attachments"] = [{"file_cache_key": file_key}]
    if client_reference:
        payload["client_reference"] = str(client_reference)[:100]
    return payload


def _attachment_debug(payload: Dict[str, Any]) -> str:
    if payload.get("attachment"):
        att = payload["attachment"]
        if isinstance(att, dict):
            val = att.get("file_cache_key") or att.get("file_key") or ""
            return f"attachment={str(val)[:28]}"
    atts = payload.get("attachments")
    if isinstance(atts, list) and atts:
        first = atts[0]
        if isinstance(first, dict):
            if first.get("content"):
                return f"attachments[content]={len(str(first.get('content') or ''))}b64"
            val = first.get("file_cache_key") or first.get("file_key") or ""
            return f"attachments[key]={str(val)[:28]}"
        return f"attachments[0]={str(first)[:28]}"
    if payload.get("file_cache_key"):
        return f"file_cache_key={str(payload.get('file_cache_key'))[:28]}"
    merge = payload.get("merge_info") if isinstance(payload.get("merge_info"), dict) else {}
    if merge.get("file_cache_key") or merge.get("file_key"):
        return "merge_info.file*"
    return "file_key=MISSING"


def send_whatsapp_template(
    to_phone: str,
    *,
    merge_info: Optional[Dict[str, str]] = None,
    attachment_file_key: Optional[str] = None,
    attachment_bytes: Optional[bytes] = None,
    attachment_filename: str = "ticket.pdf",
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

    # Only attach when the caller passes a real per-message file_cache_key
    # and/or PDF bytes. Do NOT fall back to a static env sample key.
    file_key = str(attachment_file_key).strip() if attachment_file_key else ""
    raw = bytes(attachment_bytes) if isinstance(attachment_bytes, (bytes, bytearray)) else b""
    fname = (attachment_filename or "ticket.pdf").strip() or "ticket.pdf"
    styles: list[str] = []
    if file_key:
        styles.extend(
            [
                "attachments_file_cache_key",
                "attachments_file_key",
                "attachments_file_cache_key_named",
                "attachments_file_key_named",
                "attachments_string",
                "merge_file_cache_key",
                "merge_file_key",
                "top_file_cache_key",
            ]
        )
    if raw:
        styles.append("attachments_base64")
    if not styles:
        styles = [""]
    url = f"{zepto_whatsapp_api_base()}/whatsapp"
    agent = zoho_cpaas_agent_alias()
    headers = {
        "Authorization": zepto_whatsapp_auth_header(api_key),
        "Content-Type": "application/json",
        "Accept": "application/json",
    }
    if agent:
        headers["agent-alias"] = agent

    try:
        for style in styles:
            payload = build_zepto_template_payload(
                to_phone=to_phone,
                from_phone=sender,
                template_key=key,
                template_alias=alias,
                merge_info=merge_info,
                attachment_file_key=file_key or None,
                attachment_bytes=raw or None,
                attachment_filename=fname,
                client_reference=client_reference,
                attachment_style=style or "attachments_file_cache_key",
            )
            _safe_print(
                f"[WHATSAPP] template to={payload.get('to')} key={key or alias}"
                + (f" agent={agent}" if agent else "")
                + f" style={style or 'none'} {_attachment_debug(payload)}"
            )
            res = httpx.post(url, headers=headers, json=payload, timeout=45)
            body = (res.text or "")[:500]
            if 200 <= res.status_code < 300:
                message_id = None
                try:
                    data = res.json()
                    message_id = ((data.get("data") or {}) if isinstance(data, dict) else {}).get(
                        "message_id"
                    )
                except Exception:
                    message_id = None
                _safe_print(
                    f"[WHATSAPP] Zoho template queued message_id={message_id or '-'} style={style or 'none'}"
                )
                return True, "zepto-template", link, message_id
            _safe_print(f"[WHATSAPP] Zoho template failed {res.status_code} style={style or 'none'}: {body}")
            # Keep probing shapes on schema/shape errors; stop on auth/template errors.
            retryable = (
                "GE_121" in body
                or "GE_101" in body
                or "extra key" in body.lower()
                or "Internal Error" in body
                or res.status_code >= 500
            )
            if not retryable:
                break
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
    attachment_bytes: Optional[bytes] = None,
    attachment_filename: str = "ticket.pdf",
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
        attachment_bytes=attachment_bytes,
        attachment_filename=attachment_filename,
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
