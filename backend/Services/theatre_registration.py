"""
Theatre partner registration rules (movie hosts).

Same three steps as event hosts: theatre + business + bank details, KYC
documents (PAN, cancelled cheque, cinema licence), then the Host & Ticketing
Agreement. Admins approve before any movie tools unlock.
"""

import json
import re
from datetime import date, datetime
from typing import Optional

PAN_RE = re.compile(r"^[A-Z]{5}[0-9]{4}[A-Z]$")
IFSC_RE = re.compile(r"^[A-Z]{4}0[A-Z0-9]{6}$")
PINCODE_RE = re.compile(r"^[1-9][0-9]{5}$")
ACCOUNT_RE = re.compile(r"^\d{6,20}$")
SCREEN_FORMATS = ("2D", "3D", "IMAX", "4DX", "ScreenX", "Dolby Cinema")
MAX_SCREENS = 30
MAX_SEATS_PER_SCREEN = 2000
DOC_TYPES = ("pan_card", "cancelled_cheque", "cinema_licence")

PUBLIC_STATUS = {
    "draft": "NOT_SUBMITTED",
    "submitted": "PENDING",
    "verified": "VERIFIED",
    "rejected": "REJECTED",
    "restricted": "RESTRICTED",
}
LOCKED_STATUSES = ("submitted", "verified", "restricted")


def public_status(partner) -> str:
    if not partner:
        return "NOT_SUBMITTED"
    return PUBLIC_STATUS.get((partner.status or "draft").lower(), "NOT_SUBMITTED")


def partner_code_for(customer_id: Optional[str]) -> Optional[str]:
    match = re.search(r"\d{6}", customer_id or "")
    return f"THR-{match.group(0)}" if match else None


def normalize_mobile(value: Optional[str]) -> Optional[str]:
    digits = re.sub(r"\D", "", str(value or ""))
    if not digits:
        return None
    if len(digits) == 10:
        return f"+91{digits}"
    if len(digits) == 12 and digits.startswith("91"):
        return f"+{digits}"
    raise ValueError("Enter a valid 10-digit Indian mobile number.")


def clean_screens(raw) -> list:
    """Validated screen list; raises ValueError with a message for the host."""
    if raw is None:
        return []
    if isinstance(raw, str):
        try:
            raw = json.loads(raw or "[]")
        except ValueError:
            raise ValueError("Screen details could not be read. Add the screens again.")
    if not isinstance(raw, list):
        raise ValueError("Screen details could not be read. Add the screens again.")
    if len(raw) > MAX_SCREENS:
        raise ValueError(f"A theatre can list up to {MAX_SCREENS} screens.")
    screens = []
    for index, item in enumerate(raw, start=1):
        item = item if isinstance(item, dict) else {}
        name = str(item.get("name") or "").strip()[:60]
        fmt = str(item.get("format") or "2D").strip()
        if fmt not in SCREEN_FORMATS:
            fmt = "2D"
        try:
            seats = int(item.get("seats") or 0)
        except (TypeError, ValueError):
            seats = 0
        if not name and not seats:
            continue
        if not name:
            raise ValueError(f"Screen {index}: enter a screen name.")
        if seats < 1 or seats > MAX_SEATS_PER_SCREEN:
            raise ValueError(f"{name}: seats must be between 1 and {MAX_SEATS_PER_SCREEN}.")
        screens.append({"name": name, "seats": seats, "format": fmt})
    names = [s["name"].lower() for s in screens]
    if len(set(names)) != len(names):
        raise ValueError("Each screen needs a different name.")
    return screens


def screens_of(partner) -> list:
    try:
        data = json.loads(partner.screens_json or "[]")
        return data if isinstance(data, list) else []
    except (TypeError, ValueError):
        return []


def parse_licence_date(value: Optional[str]) -> Optional[date]:
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return datetime.strptime(text, "%Y-%m-%d").date()
    except ValueError:
        raise ValueError("Enter the licence validity date as YYYY-MM-DD.")


def missing_steps(partner, today: Optional[date] = None) -> list:
    """What still blocks a final submit, in the host's words."""
    today = today or date.today()
    missing = []
    p = partner
    if not (p and (p.theatre_name or "").strip()):
        missing.append("theatre name")
    if not (p and (p.theatre_address or "").strip() and (p.district or "").strip() and (p.state or "").strip()):
        missing.append("theatre address, district and state")
    if not (p and PINCODE_RE.match(p.pincode or "")):
        missing.append("6-digit PIN code")
    if not (p and screens_of(p)):
        missing.append("at least one screen")
    if not (p and (p.licence_number or "").strip()):
        missing.append("cinema licence number")
    valid_till = None
    try:
        valid_till = parse_licence_date(p.licence_valid_till if p else None)
    except ValueError:
        pass
    if not valid_till:
        missing.append("licence validity date")
    elif valid_till < today:
        missing.append("a cinema licence that has not expired")
    if not (p and (p.legal_name or "").strip()):
        missing.append("business legal name")
    if not (p and PAN_RE.match((p.pan_number or "").upper())):
        missing.append("valid PAN number")
    if not (p and (p.org_address or "").strip()):
        missing.append("registered business address")
    if p and p.has_gstin and not (p.gstin_number or "").strip():
        missing.append("GSTIN number")
    if not (p and (p.contact_full_name or "").strip() and (p.contact_mobile or "").strip()):
        missing.append("contact name and mobile")
    if not (p and p.beneficiary_name and p.account_type and p.bank_name
            and ACCOUNT_RE.match(p.account_number or "") and IFSC_RE.match((p.bank_ifsc or "").upper())):
        missing.append("bank details")
    if not (p and p.pan_card_url):
        missing.append("PAN card image")
    if not (p and p.cancelled_cheque_url):
        missing.append("cancelled cheque image")
    if not (p and p.licence_url):
        missing.append("cinema licence document")
    if not (p and p.accepted_undertaking):
        missing.append("accepted undertaking")
    if not (p and p.accepted_agreement):
        missing.append("signed agreement")
    return missing


ORGANIZER_PREFILL_FIELDS = (
    ("legal_name", "org_name"),
    ("pan_number", "pan_number"),
    ("org_address", "org_address"),
    ("has_gstin", "has_gstin"),
    ("gstin_number", "gstin_number"),
    ("contact_full_name", "contact_full_name"),
    ("contact_email", "contact_email"),
    ("contact_mobile", "contact_mobile"),
    ("beneficiary_name", "beneficiary_name"),
    ("account_type", "account_type"),
    ("bank_name", "bank_name"),
    ("account_number", "account_number"),
    ("bank_ifsc", "bank_ifsc"),
    ("pan_card_url", "pan_card_url"),
    ("cancelled_cheque_url", "cancelled_cheque_url"),
)


def prefill_from_organizer(org_acc) -> dict:
    """Business, contact, bank and KYC details an existing event host already gave us."""
    if not org_acc:
        return {}
    out = {}
    for theatre_field, org_field in ORGANIZER_PREFILL_FIELDS:
        value = getattr(org_acc, org_field, None)
        if value not in (None, ""):
            out[theatre_field] = value
    return out


def _iso(value):
    return value.isoformat() if value else None


def serialize(partner) -> dict:
    p = partner
    return {
        "id": str(p.id),
        "partner_code": p.partner_code,
        "email": p.email,
        "customer_id": p.customer_id,
        "theatre_name": p.theatre_name,
        "chain_name": p.chain_name,
        "theatre_address": p.theatre_address,
        "district": p.district,
        "state": p.state,
        "pincode": p.pincode,
        "screens": screens_of(p),
        "total_seats": sum(int(s.get("seats") or 0) for s in screens_of(p)),
        "licence_number": p.licence_number,
        "licence_valid_till": p.licence_valid_till,
        "licence_url": p.licence_url,
        "legal_name": p.legal_name,
        "pan_number": p.pan_number,
        "org_address": p.org_address,
        "has_gstin": bool(p.has_gstin),
        "gstin_number": p.gstin_number,
        "contact_full_name": p.contact_full_name,
        "contact_email": p.contact_email,
        "contact_mobile": p.contact_mobile,
        "beneficiary_name": p.beneficiary_name,
        "account_type": p.account_type,
        "bank_name": p.bank_name,
        "account_number": p.account_number,
        "bank_ifsc": p.bank_ifsc,
        "pan_card_url": p.pan_card_url,
        "cancelled_cheque_url": p.cancelled_cheque_url,
        "accepted_undertaking": bool(p.accepted_undertaking),
        "accepted_agreement": bool(p.accepted_agreement),
        "agreement_version": p.agreement_version,
        "agreement_accepted_at": _iso(p.agreement_accepted_at),
        "agreement_acceptance_ref": p.agreement_acceptance_ref,
        "status": p.status,
        "verification_status": public_status(p),
        "review_reason": p.review_reason,
        "reviewed_at": _iso(p.reviewed_at),
        "submitted_at": _iso(p.submitted_at),
        "verified_at": _iso(p.verified_at),
        "created_at": _iso(p.created_at),
        "updated_at": _iso(p.updated_at),
    }
