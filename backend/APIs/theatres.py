"""
Theatre partner (movie host) registration and admin review.

Hosts:   /api/theatres/registration (GET, POST), /api/theatres/upload-document
Admins:  /api/admin/theatres (GET), /api/admin/theatres/{partner_id} (PATCH)
"""

import html
import json
import os
import uuid
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, Request, UploadFile, status
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_admin, get_current_user
from Models.base import get_db
from Models.organizer_accounts import OrganizerAccount
from Models.theatre_partner import TheatrePartner
from Models.user import User
from Services.client_meta import get_client_ip
from Services.host_agreement import HOST_AGREEMENT_VERSION, new_acceptance_reference
from Services import theatre_registration as rules
from Utils.categories import ASSET_FILE_LIMITS, is_allowed_kyc_bytes

router = APIRouter()
admin_router = APIRouter()

DOC_FIELDS = {
    "pan_card": "pan_card_url",
    "cancelled_cheque": "cancelled_cheque_url",
    "cinema_licence": "licence_url",
}


class ScreenIn(BaseModel):
    name: Optional[str] = Field(None, max_length=60)
    seats: Optional[int] = None
    format: Optional[str] = Field(None, max_length=20)


class TheatreRegistrationRequest(BaseModel):
    theatre_name: Optional[str] = Field(None, max_length=255)
    chain_name: Optional[str] = Field(None, max_length=255)
    theatre_address: Optional[str] = Field(None, max_length=1000)
    district: Optional[str] = Field(None, max_length=120)
    state: Optional[str] = Field(None, max_length=120)
    pincode: Optional[str] = Field(None, max_length=10)
    screens: List[ScreenIn] = []
    licence_number: Optional[str] = Field(None, max_length=80)
    licence_valid_till: Optional[str] = Field(None, max_length=10)

    legal_name: Optional[str] = Field(None, max_length=255)
    pan_number: Optional[str] = Field(None, max_length=20)
    org_address: Optional[str] = Field(None, max_length=1000)
    has_gstin: bool = False
    gstin_number: Optional[str] = Field(None, max_length=500)

    contact_full_name: Optional[str] = Field(None, max_length=200)
    contact_mobile: Optional[str] = Field(None, max_length=20)

    beneficiary_name: Optional[str] = Field(None, max_length=200)
    account_type: Optional[str] = Field(None, max_length=50)
    bank_name: Optional[str] = Field(None, max_length=150)
    account_number: Optional[str] = Field(None, max_length=50)
    bank_ifsc: Optional[str] = Field(None, max_length=20)

    pan_card_url: Optional[str] = Field(None, max_length=500)
    cancelled_cheque_url: Optional[str] = Field(None, max_length=500)
    licence_url: Optional[str] = Field(None, max_length=500)

    accepted_undertaking: bool = False
    accepted_agreement: bool = False
    agreement_version: Optional[str] = None
    is_final_submit: bool = False


class TheatreReviewRequest(BaseModel):
    action: str
    rejection_reason: Optional[str] = Field(None, max_length=2000)


def _partner_for(db: Session, user: User) -> Optional[TheatrePartner]:
    email = (user.email or "").lower().strip()
    clauses = [TheatrePartner.email == email]
    if user.customer_id:
        clauses.append(TheatrePartner.customer_id == user.customer_id)
    return db.query(TheatrePartner).filter(or_(*clauses)).order_by(TheatrePartner.created_at.desc()).first()


def _organizer_for(db: Session, user: User) -> Optional[OrganizerAccount]:
    email = (user.email or "").lower().strip()
    clauses = [OrganizerAccount.email == email]
    if user.customer_id:
        clauses.append(OrganizerAccount.customer_id == user.customer_id)
    return db.query(OrganizerAccount).filter(or_(*clauses)).first()


def _new_partner(db: Session, user: User) -> TheatrePartner:
    partner = TheatrePartner(
        email=(user.email or "").lower().strip(),
        customer_id=user.customer_id,
        partner_code=rules.partner_code_for(user.customer_id),
        contact_email=(user.email or "").lower().strip(),
        status="draft",
    )
    db.add(partner)
    return partner


def _ensure_editable(partner: TheatrePartner) -> None:
    state = (partner.status or "draft").lower()
    if state == "submitted":
        raise HTTPException(status_code=409, detail="Your theatre registration is with our team for review. You can edit it if it is sent back.")
    if state == "verified":
        raise HTTPException(status_code=409, detail="Your theatre is already approved. Raise a Help & Support request to change its details.")
    if state == "restricted":
        raise HTTPException(status_code=409, detail="Theatre access is restricted. Raise a Help & Support request so our team can review it.")


def _clean(value: Optional[str]) -> Optional[str]:
    text = str(value or "").strip()
    return text or None


def _notify(to: str, subject: str, text_body: str, html_body: str) -> bool:
    if not to or "@" not in to:
        return False
    try:
        from Services.email import send_email
        return bool(send_email(to, subject, text_body, html_body=html_body))
    except Exception:
        return False


def _notify_admin_submitted(partner: TheatrePartner) -> bool:
    admin_addr = (os.getenv("ADMIN_EMAIL") or "contact@jodevents.com").strip()
    screens = rules.screens_of(partner)
    seats = sum(int(s.get("seats") or 0) for s in screens)
    lines = [
        f"Theatre: {partner.theatre_name}",
        f"Location: {partner.district}, {partner.state} {partner.pincode or ''}".strip(),
        f"Screens: {len(screens)} ({seats} seats)",
        f"Cinema licence: {partner.licence_number} (valid till {partner.licence_valid_till})",
        f"Business: {partner.legal_name} / PAN {partner.pan_number}",
        f"Contact: {partner.contact_full_name} · {partner.contact_mobile} · {partner.email}",
    ]
    text_body = "A theatre partner registration is waiting for review.\n\n" + "\n".join(lines) + "\n\nReview it in Admin Portal > Host Data.\n"
    html_body = (
        "<h2 style='margin:0 0 12px;'>New theatre registration</h2>"
        + "".join(f"<p style='margin:4px 0;'>{html.escape(line)}</p>" for line in lines)
        + "<p style='margin-top:16px;'><a href='https://jodevents.com/admin-portal?section=host-data'>Open Host Data in the Admin Portal</a></p>"
    )
    return _notify(admin_addr, f"[Theatre registration] {partner.theatre_name} — {partner.district}", text_body, html_body)


def _registration_response(partner: Optional[TheatrePartner], org_acc: Optional[OrganizerAccount]) -> dict:
    editable = not partner or (partner.status or "draft").lower() in ("draft", "rejected")
    return {
        "exists": bool(partner),
        "verification_status": rules.public_status(partner),
        "editable": editable,
        "partner": rules.serialize(partner) if partner else None,
        "prefill": rules.prefill_from_organizer(org_acc) if editable else {},
        "is_event_host": bool(org_acc and (org_acc.status or "").lower() in ("submitted", "verified")),
        "missing_steps": rules.missing_steps(partner) if partner else rules.missing_steps(None),
        "review_reason": partner.review_reason if partner else None,
        "agreement_version": HOST_AGREEMENT_VERSION,
    }


@router.get("/registration")
def get_theatre_registration(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    return _registration_response(_partner_for(db, current_user), _organizer_for(db, current_user))


@router.post("/registration")
def save_theatre_registration(
    payload: TheatreRegistrationRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = _partner_for(db, current_user)
    if partner:
        _ensure_editable(partner)
    org_acc = _organizer_for(db, current_user)
    try:
        screens = rules.clean_screens([s.model_dump() for s in payload.screens])
        mobile = rules.normalize_mobile(payload.contact_mobile)
        rules.parse_licence_date(payload.licence_valid_till)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    pincode = _clean(payload.pincode)
    if pincode and not rules.PINCODE_RE.match(pincode):
        raise HTTPException(status_code=422, detail="Enter a valid 6-digit PIN code.")

    if not partner:
        partner = _new_partner(db, current_user)

    partner.theatre_name = _clean(payload.theatre_name)
    partner.chain_name = _clean(payload.chain_name)
    partner.theatre_address = _clean(payload.theatre_address)
    partner.district = _clean(payload.district)
    partner.state = _clean(payload.state)
    partner.pincode = pincode
    partner.screens_json = json.dumps(screens)
    partner.licence_number = (_clean(payload.licence_number) or "").upper() or None
    partner.licence_valid_till = _clean(payload.licence_valid_till)
    partner.legal_name = _clean(payload.legal_name)
    partner.pan_number = (_clean(payload.pan_number) or "").upper() or None
    partner.org_address = _clean(payload.org_address)
    partner.has_gstin = bool(payload.has_gstin)
    partner.gstin_number = ((_clean(payload.gstin_number) or "").upper() or None) if payload.has_gstin else None
    partner.contact_full_name = _clean(payload.contact_full_name)
    partner.contact_email = (current_user.email or "").lower().strip()
    partner.contact_mobile = mobile
    partner.beneficiary_name = _clean(payload.beneficiary_name)
    partner.account_type = _clean(payload.account_type)
    partner.bank_name = _clean(payload.bank_name)
    partner.account_number = _clean(payload.account_number)
    partner.bank_ifsc = (_clean(payload.bank_ifsc) or "").upper() or None
    # Documents only come from our own uploads, or an event-host KYC file already on record.
    for field in ("pan_card_url", "cancelled_cheque_url", "licence_url"):
        sent = _clean(getattr(payload, field))
        if not sent:
            setattr(partner, field, None)
            continue
        known = {getattr(partner, field, None)}
        if org_acc and field != "licence_url":
            known.add(getattr(org_acc, field, None))
        if sent in known:
            setattr(partner, field, sent)
    partner.accepted_undertaking = bool(payload.accepted_undertaking)
    partner.accepted_agreement = bool(payload.accepted_agreement)
    if not partner.accepted_agreement:
        partner.agreement_accepted_at = None
        partner.agreement_acceptance_ref = None

    emailed_admin = False
    if payload.is_final_submit:
        missing = rules.missing_steps(partner)
        if missing:
            db.rollback()
            raise HTTPException(status_code=400, detail="Please complete the following before submitting: " + ", ".join(missing) + ".")
        if payload.agreement_version and payload.agreement_version != HOST_AGREEMENT_VERSION:
            db.rollback()
            raise HTTPException(status_code=409, detail="The Host & Ticketing Agreement has been updated. Refresh the page and accept the latest version.")
        now = datetime.utcnow()
        partner.agreement_version = HOST_AGREEMENT_VERSION
        partner.agreement_accepted_at = now
        partner.agreement_accept_ip = (get_client_ip(request) or "")[:64] or None
        partner.agreement_acceptance_ref = new_acceptance_reference()
        partner.status = "submitted"
        partner.submitted_at = now
        partner.review_reason = None
        partner.verified_at = None
    db.commit()
    db.refresh(partner)
    if payload.is_final_submit:
        emailed_admin = _notify_admin_submitted(partner)
    body = _registration_response(partner, org_acc)
    body["message"] = "Theatre registration submitted for review." if payload.is_final_submit else "Theatre details saved."
    body["admin_notified"] = emailed_admin
    return body


@router.post("/upload-document")
def upload_theatre_document(
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if doc_type not in DOC_FIELDS:
        raise HTTPException(status_code=400, detail="Choose PAN card, cancelled cheque, or cinema licence.")
    partner = _partner_for(db, current_user)
    if partner:
        _ensure_editable(partner)
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in (".jpg", ".jpeg", ".png", ".pdf"):
        raise HTTPException(status_code=400, detail="Upload a clear image in .jpg, .png or .pdf format only.")
    contents = file.file.read()
    min_bytes, max_bytes, size_message = ASSET_FILE_LIMITS["document"]
    if len(contents) < min_bytes or len(contents) > max_bytes:
        raise HTTPException(status_code=400, detail=size_message)
    if not is_allowed_kyc_bytes(contents, file.filename or "", file.content_type or ""):
        raise HTTPException(status_code=400, detail="Upload a real JPG, PNG, or PDF file. The file contents do not match the extension.")

    from Services.file_storage import public_url, store_bytes

    try:
        stored = store_bytes(
            db,
            data=contents,
            filename=file.filename or f"{doc_type}{ext}",
            content_type=file.content_type,
            kind="kyc",
            purpose=f"theatre_{doc_type}",
            owner_customer_id=current_user.customer_id,
            owner_email=(current_user.email or "").lower().strip(),
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    url = public_url(stored)
    if not partner:
        partner = _new_partner(db, current_user)
    setattr(partner, DOC_FIELDS[doc_type], url)
    db.commit()
    return {"doc_type": doc_type, "file_url": url}


# ── Admin review ──────────────────────────────────────────────

ADMIN_STATUS = {"submitted": "pending", "verified": "approved", "rejected": "rejected", "restricted": "restricted", "draft": "draft"}


def _admin_row(partner: TheatrePartner) -> dict:
    row = rules.serialize(partner)
    state = ADMIN_STATUS.get((partner.status or "draft").lower(), "draft")
    row.update({
        "kind": "theatre",
        "application_id": f"theatre:{partner.id}",
        "org_name": partner.theatre_name,
        "host_id": partner.partner_code,
        "status": state,
        "can_approve": state == "pending",
        "can_reject": state == "pending",
        "can_restrict": state == "approved",
        "can_unrestrict": state == "restricted",
    })
    return row


@admin_router.get("")
def admin_list_theatres(
    q: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    rows = (
        db.query(TheatrePartner)
        .filter(TheatrePartner.status != "draft")
        .order_by(TheatrePartner.submitted_at.desc())
        .limit(300)
        .all()
    )
    items = [_admin_row(p) for p in rows]
    needle = (q or "").strip().lower()
    if needle:
        keys = ("theatre_name", "chain_name", "email", "contact_full_name", "contact_mobile", "district", "state", "partner_code", "licence_number")
        items = [i for i in items if any(needle in str(i.get(k) or "").lower() for k in keys)]
    return {"total": len(items), "pending": sum(1 for i in items if i["status"] == "pending"), "theatres": items}


@admin_router.patch("/{partner_id}")
def admin_review_theatre(
    partner_id: str,
    payload: TheatreReviewRequest,
    db: Session = Depends(get_db),
    current_admin: User = Depends(get_current_admin),
):
    try:
        key = uuid.UUID(str(partner_id).replace("theatre:", ""))
    except ValueError:
        raise HTTPException(status_code=404, detail="Theatre registration not found.")
    partner = db.query(TheatrePartner).filter(TheatrePartner.id == key).first()
    if not partner:
        raise HTTPException(status_code=404, detail="Theatre registration not found.")
    action = (payload.action or "").strip().lower()
    reason = (payload.rejection_reason or "").strip() or None
    current = (partner.status or "draft").lower()
    allowed = {"approve": "submitted", "reject": "submitted", "restrict": "verified", "unrestrict": "restricted"}
    if action not in allowed:
        raise HTTPException(status_code=400, detail="Choose approve, reject, restrict or unrestrict.")
    if current != allowed[action]:
        raise HTTPException(status_code=409, detail=f"This theatre is {ADMIN_STATUS.get(current, current)}; it cannot be {action}d now.")
    if action in ("reject", "restrict") and not reason:
        raise HTTPException(status_code=400, detail="Add a reason so the theatre knows what to fix.")

    now = datetime.utcnow()
    partner.status = {"approve": "verified", "reject": "rejected", "restrict": "restricted", "unrestrict": "verified"}[action]
    partner.review_reason = reason if action in ("reject", "restrict") else (reason if action == "unrestrict" else None)
    partner.reviewed_by = (current_admin.email or "").lower() or None
    partner.reviewed_at = now
    if action in ("approve", "unrestrict"):
        partner.verified_at = partner.verified_at or now
    db.commit()
    db.refresh(partner)

    name = partner.theatre_name or "your theatre"
    if action in ("approve", "unrestrict"):
        subject = f"{name} is approved on JOD Events"
        lead = f"Good news — {name} is now an approved JOD Events theatre partner. Open your theatre dashboard to set seat layouts, add movies and schedule shows."
    elif action == "reject":
        subject = f"Changes needed for {name} — JOD Events"
        lead = f"Your theatre registration for {name} needs a few changes before we can approve it. Update the details and submit again."
    else:
        subject = f"{name} access is restricted — JOD Events"
        lead = f"Access for {name} has been restricted. Raise a Help & Support request so our team can review it."
    note = f"\n\nTeam note: {reason}" if reason else ""
    emailed = _notify(
        partner.email,
        subject,
        f"Hi {partner.contact_full_name or ''},\n\n{lead}{note}\n\n— JOD Events\n",
        f"<p>Hi {html.escape(partner.contact_full_name or '')},</p><p>{html.escape(lead)}</p>"
        + (f"<p><strong>Team note:</strong> {html.escape(reason)}</p>" if reason else "")
        + ("<p><a href='https://jodevents.com/theatre-dashboard'>Open your theatre dashboard</a></p>" if action in ("approve", "unrestrict")
           else "<p><a href='https://jodevents.com/theatre-status'>View your theatre status</a></p>")
        + "<p>— JOD Events</p>",
    )
    labels = {"approve": "Theatre approved.", "reject": "Theatre sent back for changes.", "restrict": "Theatre access restricted.", "unrestrict": "Restriction revoked."}
    return {
        "message": labels[action] + (" Theatre emailed." if emailed else " Email could not be sent (check SMTP)."),
        "email_sent": emailed,
        "theatre": _admin_row(partner),
    }
