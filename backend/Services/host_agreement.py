"""Host & Ticketing Agreement version, acceptance wording and the acceptance-record PDF."""

from __future__ import annotations

import secrets
from datetime import datetime
from typing import Any, Dict, List, Optional

from Services.history_report_pdf import (
    BLUE,
    GREEN,
    INK,
    LEFT,
    MUTED,
    NAVY,
    PAGE_H,
    PAGE_W,
    RIGHT,
    RULE,
    _rect,
    _rule,
    _text,
    _text_right,
)
from Services.ticket_pdf import _ascii_text, _assemble_pdf

# Keep in sync with AGREEMENT_VERSION in frontend/js/account-setup.js and the text on account-setup.html.
HOST_AGREEMENT_VERSION = "JOD-HTA-1.0"
HOST_AGREEMENT_TITLE = "JOD Events Host & Ticketing Agreement (Electronic Acceptance Version)"
HOST_AGREEMENT_ACCEPT_TEXT = "I have read and agree to the JOD Host & Ticketing Agreement"
HOST_AGREEMENT_ACCEPT_ACTION = "Checkbox + Accept Agreement button"


def new_acceptance_reference() -> str:
    return "ACC-" + datetime.utcnow().strftime("%Y%m%d") + "-" + secrets.token_hex(4).upper()


def _utc(value: Optional[datetime]) -> str:
    if not value:
        return "Not recorded"
    return value.strftime("%d %b %Y, %H:%M:%S UTC")


def agreement_record_payload(org_acc) -> Dict[str, Any]:
    accepted_at = getattr(org_acc, "agreement_accepted_at", None)
    otp_at = getattr(org_acc, "agreement_otp_verified_at", None)
    status = str(getattr(org_acc, "status", "") or "").lower()
    verified_at = getattr(org_acc, "verified_at", None)
    if status == "verified":
        approval = "Approved" + (f" on {verified_at.strftime('%d %b %Y')}" if verified_at else "")
    elif status == "rejected":
        approval = "Rejected"
    elif status == "submitted":
        approval = "Pending review"
    else:
        approval = "Not submitted"
    return {
        "accepted": bool(getattr(org_acc, "accepted_agreement", False)) and accepted_at is not None,
        "host_legal_name": getattr(org_acc, "org_name", None) or getattr(org_acc, "contact_full_name", None) or "",
        "verified_email": getattr(org_acc, "agreement_accepted_email", None) or getattr(org_acc, "email", None) or "",
        "host_id": getattr(org_acc, "host_id", None) or "",
        "customer_id": getattr(org_acc, "customer_id", None) or "",
        "agreement_version": getattr(org_acc, "agreement_version", None) or "",
        "acceptance_text": getattr(org_acc, "agreement_accept_text", None) or "",
        "acceptance_action": HOST_AGREEMENT_ACCEPT_ACTION,
        "accepted_at_utc": accepted_at.isoformat() + "Z" if accepted_at else None,
        "email_otp_verified_at_utc": otp_at.isoformat() + "Z" if otp_at else None,
        "ip_address": getattr(org_acc, "agreement_accept_ip", None) or "",
        "browser": getattr(org_acc, "agreement_accept_user_agent", None) or "",
        "acceptance_reference": getattr(org_acc, "agreement_acceptance_ref", None) or "",
        "jod_approval": approval,
    }


def agreement_record_filename(record: Dict[str, Any]) -> str:
    ref = "".join(ch for ch in str(record.get("acceptance_reference") or "record") if ch.isalnum() or ch == "-")
    return f"JOD-Host-Agreement-Acceptance-{ref or 'record'}.pdf"


def build_agreement_record_pdf_bytes(org_acc) -> bytes:
    """One-page acceptance record for the host to download and keep."""
    record = agreement_record_payload(org_acc)
    accepted_at = getattr(org_acc, "agreement_accepted_at", None)
    otp_at = getattr(org_acc, "agreement_otp_verified_at", None)

    ops: List[str] = []
    ops.append(_rect(0, PAGE_H - 48, PAGE_W, 48, NAVY))
    ops.append(_rect(0, PAGE_H - 51, PAGE_W, 3, (0.98, 0.52, 0.12)))
    ops.append(_text(LEFT, PAGE_H - 30, "JOD EVENTS", 13, True, (1, 1, 1)))
    ops.append(_text_right(RIGHT, PAGE_H - 30, "ELECTRONIC ACCEPTANCE RECORD", 8, True, (0.85, 0.90, 0.97)))

    y = PAGE_H - 82
    ops.append(_text(LEFT, y, "HOST & TICKETING AGREEMENT", 8, True, BLUE))
    y -= 22
    ops.append(_text(LEFT, y, "Acceptance record", 18, True, INK))
    y -= 16
    ops.append(_text(LEFT, y, _ascii_text(HOST_AGREEMENT_TITLE), 9, False, MUTED))
    y -= 12
    ops.append(_rule(LEFT, y, RIGHT - LEFT, BLUE, 1.0))
    y -= 28

    rows = [
        ("Host legal name", record["host_legal_name"] or "-"),
        ("Verified email", record["verified_email"] or "-"),
        ("Host ID", record["host_id"] or "-"),
        ("Customer ID", record["customer_id"] or "-"),
        ("Accepted agreement version", record["agreement_version"] or "-"),
        ("Acceptance text", record["acceptance_text"] or "-"),
        ("Acceptance action", record["acceptance_action"]),
        ("Accepted at (UTC)", _utc(accepted_at)),
        ("Email OTP verified at (UTC)", _utc(otp_at)),
        ("IP address", record["ip_address"] or "Not recorded"),
        ("Browser", record["browser"] or "Not recorded"),
        ("Acceptance reference", record["acceptance_reference"] or "-"),
        ("JOD approval", record["jod_approval"]),
    ]
    for label, value in rows:
        ops.append(_text(LEFT, y, label, 8, False, MUTED))
        text_value = _ascii_text(value, "-")
        if len(text_value) > 62:
            ops.append(_text(LEFT + 170, y, text_value[:62], 9, True, INK))
            y -= 13
            ops.append(_text(LEFT + 170, y, text_value[62:124], 9, True, INK))
        else:
            ops.append(_text(LEFT + 170, y, text_value, 9, True, INK))
        y -= 10
        ops.append(_rule(LEFT, y, RIGHT - LEFT, RULE, 0.5))
        y -= 16

    y -= 6
    status_text = "Accepted" if record["accepted"] else "Not accepted"
    ops.append(_text(LEFT, y, "Status", 8, False, MUTED))
    ops.append(_text(LEFT + 170, y, status_text, 12, True, GREEN if record["accepted"] else (0.72, 0.12, 0.12)))
    y -= 30

    notes = [
        "Email OTP is an authentication step and is not represented as a certified digital signature.",
        "The parties intend electronic acceptance to form a binding contract to the extent permitted by law.",
        "Governing law: India. Courts in Chennai, Tamil Nadu have jurisdiction, subject to applicable law.",
    ]
    for line in notes:
        ops.append(_text(LEFT, y, line, 8, False, MUTED))
        y -= 13

    generated = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")
    ops.append(_rule(LEFT, 46, RIGHT - LEFT, RULE, 0.6))
    ops.append(_text(LEFT, 32, "Generated by JOD Events", 8, False, MUTED))
    ops.append(_text_right(RIGHT, 32, "Keep this record with your agreement", 8, False, MUTED))
    ops.append(_text(LEFT, 20, generated, 8, False, MUTED))
    ops.append(_text_right(RIGHT, 20, "Page 1 of 1", 8, False, MUTED))

    stream = "\n".join(ops).encode("latin-1", "replace")
    contents = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
    objects: List[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources "
        b"<< /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        contents,
    ]
    return _assemble_pdf(objects)
