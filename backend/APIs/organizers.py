"""
API endpoints for Event Organizer onboarding — Email OTP verification & Account setup with bank details.
"""

import sys
import uuid
from datetime import datetime
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from sqlalchemy import or_

from Models import get_db, EmailOTP, OrganizerAccount, User, HostRegistrationLog
from Authentication.dependencies import get_current_user
from Services.rate_limit import limit_otp
from Services import otp as otp_service

from Utils.id_generator import generate_customer_id, generate_host_id_from_customer_id
from Services.email import send_email
from Services.runtime_env import smtp_configured
from Utils.categories import is_allowed_kyc_bytes

router = APIRouter()


def _bound_organizer_email(email: Optional[str], current_user: Optional[User] = None) -> str:
    if current_user and getattr(current_user, "email", None):
        return current_user.email.lower().strip()
    return (email or "").lower().strip()


# ── Public verification status mapping ────────────────────────────────────────
# Internal (DB) status  →  Public (API / UI) state
# ──────────────────────────────────────────────────────────
#  (none / None)        →  NOT_SUBMITTED
#  "draft"              →  NOT_SUBMITTED
#  "submitted"          →  PENDING
#  "verified"           →  VERIFIED
#  "rejected"           →  REJECTED
def to_public_verification_status(internal_status: Optional[str]) -> str:
    s = (internal_status or "").lower().strip()
    if s == "verified":
        return "VERIFIED"
    if s == "rejected":
        return "REJECTED"
    if s == "submitted":
        return "PENDING"
    return "NOT_SUBMITTED"


def is_organizer_verified(internal_status: Optional[str]) -> bool:
    return to_public_verification_status(internal_status) == "VERIFIED"


def _organizer_otp_purpose():
    return or_(
        EmailOTP.purpose.is_(None),
        EmailOTP.purpose == "",
        EmailOTP.purpose == "organizer",
    )


def has_payout_bank(acc: Optional[OrganizerAccount]) -> bool:
    if not acc:
        return False
    return bool(
        (acc.beneficiary_name or "").strip()
        and (acc.bank_name or "").strip()
        and (acc.account_number or "").strip()
        and (acc.bank_ifsc or "").strip()
    )


def has_kyc_documents(acc: Optional[OrganizerAccount]) -> bool:
    if not acc:
        return False
    return bool(
        (acc.pan_number or "").strip()
        and (acc.pan_card_url or "").strip()
        and (acc.cancelled_cheque_url or "").strip()
    )


def has_signed_agreement(acc: Optional[OrganizerAccount]) -> bool:
    """Accounts submitted before the agreement step existed count as signed."""
    if not acc:
        return False
    if acc.accepted_agreement:
        return True
    return (acc.status or "").lower().strip() in ("submitted", "verified")


def is_setup_complete(acc: Optional[OrganizerAccount]) -> bool:
    """All three onboarding steps done: general info + bank, documents, agreement."""
    return has_payout_bank(acc) and has_kyc_documents(acc) and has_signed_agreement(acc)


def missing_setup_steps(acc: Optional[OrganizerAccount], strict_agreement: bool = False) -> list:
    missing = []
    if not has_payout_bank(acc):
        missing.append("bank details")
    if not (acc and (acc.pan_number or "").strip()):
        missing.append("PAN number")
    if not (acc and (acc.pan_card_url or "").strip()):
        missing.append("PAN card image")
    if not (acc and (acc.cancelled_cheque_url or "").strip()):
        missing.append("cancelled cheque image")
    signed = bool(acc and acc.accepted_agreement) if strict_agreement else has_signed_agreement(acc)
    if not signed:
        missing.append("signed agreement")
    return missing


def safe_print(msg: str) -> None:
    """Print helper for Windows non-UTF8 stdout fallback."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()


# ── Schemas ───────────────────────────────────────────────────────────────────
class SendOTPRequest(BaseModel):
    email: EmailStr
    channel: Optional[str] = "email"


class VerifyOTPRequest(BaseModel):
    email: EmailStr
    otp_code: str


class AccountSetupRequest(BaseModel):
    email: EmailStr
    org_name: Optional[str] = None
    pan_number: Optional[str] = None
    org_address: Optional[str] = None
    has_gstin: bool = False
    gstin_number: Optional[str] = None
    accepted_undertaking: bool = False
    itr_filed: bool = False
    state: Optional[str] = None

    contact_full_name: Optional[str] = None
    contact_email: Optional[str] = None
    contact_mobile: Optional[str] = None

    beneficiary_name: Optional[str] = None
    account_type: Optional[str] = None
    bank_name: Optional[str] = None
    account_number: Optional[str] = None
    bank_ifsc: Optional[str] = None

    pan_card_url: Optional[str] = None
    cancelled_cheque_url: Optional[str] = None
    accepted_agreement: bool = False

    is_final_submit: bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────
def _mask_mobile(phone: str) -> str:
    digits = "".join(ch for ch in (phone or "") if ch.isdigit())
    if len(digits) < 4:
        return phone or ""
    if len(digits) <= 6:
        return digits[0] + ("*" * (len(digits) - 2)) + digits[-1]
    return f"{digits[:2]}{'*' * (len(digits) - 4)}{digits[-2:]}"


@router.post("/send-otp")
def send_otp(
    payload: SendOTPRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Generate and send a 6-digit OTP to the logged-in user's email."""
    email = payload.email.lower().strip()
    limit_otp(request, email)
    if current_user.email.lower().strip() != email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only request a verification code for your own account.",
        )
    channel = (payload.channel or "email").strip().lower()
    if channel not in ("email", "phone"):
        channel = "email"

    if not smtp_configured():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Email delivery is not configured. You can still publish events from the host dashboard.",
        )

    otp_code = otp_service.generate_otp()
    otp_service.store_otp(db, email, "organizer", otp_code)

    org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email).first()
    phone = ""
    if org_acc:
        phone = str(getattr(org_acc, "contact_mobile", None) or "").strip()

    if channel == "phone" and not phone:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No mobile number is saved on your organizer account. Add it in Host Settings, or verify by email."
        )

    destination = _mask_mobile(phone) if channel == "phone" else email
    subject = "Your JOD Events verification code"
    if channel == "phone":
        text_body = (
            f"Your JOD Events mobile verification OTP is {otp_code}. "
            f"Use this code to confirm {destination}. It expires in 10 minutes."
        )
        html_body = (
            f"<p>Your JOD Events mobile verification code is <strong>{otp_code}</strong>.</p>"
            f"<p>Confirm number {destination}. This code expires in 10 minutes. Do not share it.</p>"
        )
    else:
        text_body = f"Your JOD Events OTP is {otp_code}. It expires in 10 minutes. Do not share this code."
        html_body = (
            f"<p>Your JOD Events verification code is <strong>{otp_code}</strong>.</p>"
            f"<p>It expires in 10 minutes. Do not share this code.</p>"
        )

    emailed = send_email(email, subject, text_body, html_body)
    if not emailed:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Could not send the verification email. Try again later.",
        )

    if channel == "phone":
        message = f"6-digit verification code sent to your registered email to confirm mobile {destination}."
    else:
        message = f"6-digit verification code sent to {email}."

    return {
        "message": message,
        "email": email,
        "channel": channel,
        "destination": destination,
        "email_delivered": True,
    }


@router.post("/verify-otp")
def verify_otp(
    payload: VerifyOTPRequest,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Verify the 6-digit OTP sent to the user's email."""
    email = payload.email.lower().strip()
    limit_otp(request, email)
    if current_user.email.lower().strip() != email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only verify a code for your own account.",
        )
    otp_service.verify_otp(db, email, payload.otp_code, "organizer")

    user = db.query(User).filter(User.email == email).first()

    # Ensure draft OrganizerAccount exists
    org_acc = db.query(OrganizerAccount).filter(
        (OrganizerAccount.email == email) | (user and OrganizerAccount.customer_id == user.customer_id)
    ).first()

    if not org_acc:
        org_acc = OrganizerAccount(
            email=email,
            customer_id=user.customer_id if user else None,
            contact_email=email,
            status="draft"
        )
        db.add(org_acc)
    elif user and not org_acc.customer_id:
        org_acc.customer_id = user.customer_id

    if not user and org_acc and org_acc.customer_id:
        user = db.query(User).filter(User.customer_id == org_acc.customer_id).first()

    db.commit()

    is_completed = bool(org_acc and org_acc.status in ["submitted", "verified"])

    result = {
        "message": "Email verified successfully!",
        "verified": True,
        "email": email,
        "account_status": org_acc.status if org_acc else "draft",
        "is_completed": is_completed,
    }

    return result


@router.post("/account-setup")
def save_account_setup(
    payload: AccountSetupRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Save or update organizer account details and bank information."""
    email = current_user.email.lower().strip()
    if payload.email and payload.email.lower().strip() != email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only save host account details for your logged-in account."
        )

    org_acc = None
    if current_user:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) | (OrganizerAccount.email == email)
        ).first()
    else:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email).first()

    if not org_acc:
        org_acc = OrganizerAccount(
            email=email,
            customer_id=current_user.customer_id if (current_user and current_user.customer_id) else None
        )
        db.add(org_acc)
    elif current_user:
        if not org_acc.customer_id and current_user.customer_id:
            org_acc.customer_id = current_user.customer_id

    # Ensure customer_id exists
    if not org_acc.customer_id:
        if current_user and current_user.customer_id:
            org_acc.customer_id = current_user.customer_id
        else:
            org_acc.customer_id = generate_customer_id()
            if current_user:
                current_user.customer_id = org_acc.customer_id

    # Generate permanent Host ID (HST-XXXXXX) upon host verification submission
    if not org_acc.host_id:
        org_acc.host_id = generate_host_id_from_customer_id(org_acc.customer_id)

    # Update organisation details
    org_acc.org_name = payload.org_name
    org_acc.pan_number = payload.pan_number.upper() if payload.pan_number else None
    org_acc.org_address = payload.org_address
    org_acc.has_gstin = payload.has_gstin
    org_acc.gstin_number = payload.gstin_number
    org_acc.accepted_undertaking = payload.accepted_undertaking
    org_acc.itr_filed = payload.itr_filed
    org_acc.state = payload.state

    # Update contact details
    org_acc.contact_full_name = payload.contact_full_name
    org_acc.contact_email = payload.contact_email or email
    org_acc.contact_mobile = payload.contact_mobile

    # Update bank details
    org_acc.beneficiary_name = payload.beneficiary_name
    org_acc.account_type = payload.account_type
    org_acc.bank_name = payload.bank_name
    org_acc.account_number = payload.account_number
    org_acc.bank_ifsc = payload.bank_ifsc.upper() if payload.bank_ifsc else None
    org_acc.pan_card_url = payload.pan_card_url
    org_acc.cancelled_cheque_url = payload.cancelled_cheque_url
    org_acc.accepted_agreement = payload.accepted_agreement

    if payload.is_final_submit:
        missing = missing_setup_steps(org_acc, strict_agreement=True)
        if missing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Please complete the following before finishing setup: " + ", ".join(missing) + "."
            )
        # Resubmission: if previously rejected, clear rejection reason
        if org_acc.status == "rejected":
            org_acc.rejection_reason = None
        org_acc.status = "submitted"
        org_acc.submitted_at = datetime.utcnow()
        org_acc.verified_at = None
    elif not org_acc.status:
        org_acc.status = "draft"

    db.commit()
    db.refresh(org_acc)

    # Log Host Registration in host_registration_logs table
    host_log = HostRegistrationLog(
        customer_id=org_acc.customer_id,
        email=email,
        org_name=payload.org_name,
        action="FINAL_SUBMIT" if payload.is_final_submit else "DRAFT_SAVED",
        status=org_acc.status
    )
    db.add(host_log)
    db.commit()

    return {
        "message": "Account setup details saved successfully!",
        "status": org_acc.status,
        "verification_status": to_public_verification_status(org_acc.status),
        "rejection_reason": org_acc.rejection_reason,
        "setup_complete": is_setup_complete(org_acc),
        "missing_steps": missing_setup_steps(org_acc),
        "account": {
            "id": str(org_acc.id),
            "customer_id": org_acc.customer_id,
            "host_id": org_acc.host_id,
            "email": org_acc.email,
            "org_name": org_acc.org_name,
            "pan_number": org_acc.pan_number,
            "org_address": org_acc.org_address,
            "has_gstin": org_acc.has_gstin,
            "gstin_number": org_acc.gstin_number,
            "accepted_undertaking": org_acc.accepted_undertaking,
            "itr_filed": org_acc.itr_filed,
            "state": org_acc.state,
            "contact_full_name": org_acc.contact_full_name,
            "contact_email": org_acc.contact_email,
            "contact_mobile": org_acc.contact_mobile,
            "beneficiary_name": org_acc.beneficiary_name,
            "account_type": org_acc.account_type,
            "bank_name": org_acc.bank_name,
            "account_number": org_acc.account_number,
            "bank_ifsc": org_acc.bank_ifsc,
            "pan_card_url": org_acc.pan_card_url,
            "cancelled_cheque_url": org_acc.cancelled_cheque_url,
            "accepted_agreement": bool(org_acc.accepted_agreement),
            "status": org_acc.status,
            "rejection_reason": org_acc.rejection_reason,
            "verification_status": to_public_verification_status(org_acc.status),
            "submitted_at": org_acc.submitted_at.isoformat() if org_acc.submitted_at else None,
            "verified_at": org_acc.verified_at.isoformat() if org_acc.verified_at else None,
            "created_at": org_acc.created_at.isoformat() if org_acc.created_at else None,
            "updated_at": org_acc.updated_at.isoformat() if org_acc.updated_at else None
        }
    }


@router.get("/account-setup")
def get_account_setup(
    email: Optional[str] = Query(None, description="Organizer email address"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetch saved organizer account details for the authenticated host."""
    email_clean = current_user.email.lower().strip()

    if email and current_user.email.lower() != email.lower().strip():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view another user's host account."
        )

    org_acc = None
    if current_user:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) | (OrganizerAccount.email == email_clean)
        ).first()
    else:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email_clean).first()

    if not org_acc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No account details found for this email."
        )

    return {
        "verification_status": to_public_verification_status(org_acc.status),
        "rejection_reason": org_acc.rejection_reason,
        "kyc_complete": has_payout_bank(org_acc) and has_kyc_documents(org_acc),
        "bank_complete": has_payout_bank(org_acc),
        "documents_complete": has_kyc_documents(org_acc),
        "agreement_signed": has_signed_agreement(org_acc),
        "setup_complete": is_setup_complete(org_acc),
        "missing_steps": missing_setup_steps(org_acc),
        "submitted_at": org_acc.submitted_at.isoformat() if org_acc.submitted_at else None,
        "verified_at": org_acc.verified_at.isoformat() if org_acc.verified_at else None,
        "account": {
            "id": str(org_acc.id),
            "customer_id": org_acc.customer_id,
            "host_id": org_acc.host_id,
            "email": org_acc.email,
            "org_name": org_acc.org_name,
            "pan_number": org_acc.pan_number,
            "org_address": org_acc.org_address,
            "has_gstin": org_acc.has_gstin,
            "gstin_number": org_acc.gstin_number,
            "accepted_undertaking": org_acc.accepted_undertaking,
            "itr_filed": org_acc.itr_filed,
            "state": org_acc.state,
            "contact_full_name": org_acc.contact_full_name,
            "contact_email": org_acc.contact_email,
            "contact_mobile": org_acc.contact_mobile,
            "beneficiary_name": org_acc.beneficiary_name,
            "account_type": org_acc.account_type,
            "bank_name": org_acc.bank_name,
            "account_number": org_acc.account_number,
            "bank_ifsc": org_acc.bank_ifsc,
            "pan_card_url": org_acc.pan_card_url,
            "cancelled_cheque_url": org_acc.cancelled_cheque_url,
            "accepted_agreement": bool(org_acc.accepted_agreement),
            "status": org_acc.status,
            "rejection_reason": org_acc.rejection_reason,
            "verification_status": to_public_verification_status(org_acc.status),
            "submitted_at": org_acc.submitted_at.isoformat() if org_acc.submitted_at else None,
            "verified_at": org_acc.verified_at.isoformat() if org_acc.verified_at else None,
            "created_at": org_acc.created_at.isoformat() if org_acc.created_at else None,
            "updated_at": org_acc.updated_at.isoformat() if org_acc.updated_at else None
        }
    }


@router.post("/upload-document")
def upload_document(
    email: str = Form(...),
    doc_type: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Upload PAN card or Cancelled Cheque image/PDF (<= 2MB)."""
    import os
    email_clean = current_user.email.lower().strip()

    if email and email.lower().strip() != email_clean:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only upload documents for your logged-in account."
        )
    
    # Validate document type
    if doc_type not in ["pan_card", "cancelled_cheque"]:
        raise HTTPException(status_code=400, detail="Invalid document type. Allowed: 'pan_card', 'cancelled_cheque'")

    # Validate file format (.jpg, .jpeg, .png, .pdf)
    allowed_exts = [".jpg", ".jpeg", ".png", ".pdf"]
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_exts:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file format '{ext}'. Upload a clear image in .jpg or .pdf format only."
        )

    # Read content to check file size (max 2MB = 2 * 1024 * 1024 bytes)
    contents = file.file.read()
    max_bytes = 2 * 1024 * 1024
    if len(contents) > max_bytes:
        raise HTTPException(
            status_code=400,
            detail="File size should not be greater than 2MB."
        )
    if not is_allowed_kyc_bytes(contents, file.filename or "", file.content_type or ""):
        raise HTTPException(
            status_code=400,
            detail="Upload a real JPG, PNG, or PDF file. The file contents do not match the extension.",
        )

    from Services.file_storage import public_url, store_bytes

    try:
        stored = store_bytes(
            db,
            data=contents,
            filename=file.filename or f"{doc_type}{ext}",
            content_type=file.content_type,
            kind="kyc",
            purpose=doc_type,
            owner_customer_id=current_user.customer_id if current_user else None,
            owner_email=email_clean,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    file_url = public_url(stored)

    # Update Database Record
    org_acc = None
    if current_user:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) | (OrganizerAccount.email == email_clean)
        ).first()
    else:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email_clean).first()

    if not org_acc:
        org_acc = OrganizerAccount(email=email_clean, customer_id=current_user.customer_id if current_user else None, status="draft")
        db.add(org_acc)
    elif current_user and not org_acc.customer_id:
        org_acc.customer_id = current_user.customer_id

    if doc_type == "pan_card":
        org_acc.pan_card_url = file_url
    elif doc_type == "cancelled_cheque":
        org_acc.cancelled_cheque_url = file_url

    db.commit()

    return {
        "message": f"{doc_type.replace('_', ' ').title()} uploaded successfully!",
        "file_url": file_url,
        "doc_type": doc_type,
        "filename": file.filename
    }


@router.get("/dashboard")
def get_organizer_dashboard(
    email: str = Query(..., description="Organizer email address"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Fetch organizer dashboard data, stats, and event metrics matching dashboard screenshot."""
    email_clean = _bound_organizer_email(email, current_user)

    if current_user and current_user.email.lower() != email_clean:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view another user's organizer dashboard."
        )

    org_acc = None
    if current_user:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) | (OrganizerAccount.email == email_clean)
        ).first()
    else:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email_clean).first()

    org_name = org_acc.org_name if (org_acc and org_acc.org_name) else "Organiser"
    event_title = f"{org_name}'s Grand Summit 2026" if org_name != "Organiser" else "Zylker Summit 2026"

    internal_status = org_acc.status if org_acc else None
    public_ver_status = to_public_verification_status(internal_status)

    return {
        "organizer": {
            "email": email_clean,
            "org_name": org_name,
            "status": org_acc.status if org_acc else "verified",
            "verification_status": public_ver_status,
            "rejection_reason": org_acc.rejection_reason if org_acc else None,
            "can_publish_events": is_organizer_verified(internal_status)
        },
        "event": {
            "title": event_title,
            "status": "Published",
            "date": "Aug 19, 2026 - 09:00 AM",
            "type": "Hybrid"
        },
        "metrics": {
            "total_sales": "$58,760.41",
            "total_registrations": 11480,
            "days_to_event": 15
        },
        "registrations_breakdown": {
            "sold": 11480,
            "sold_percentage": 82,
            "available": 2520,
            "available_percentage": 18,
            "total_capacity": 14000
        },
        "attendance": {
            "checked_in": 960,
            "checked_in_percentage": 60,
            "yet_to_checkin": 540,
            "yet_to_checkin_percentage": 40,
            "total_expected": 1500
        },
        "event_numbers": {
            "sessions": 24,
            "speakers": 12,
            "event_team": 4,
            "sponsors": 20,
            "exhibitors": 18,
            "badges": 8
        },
        "trend_data": [
            {"date": "Mar 19", "value": 400},
            {"date": "Mar 22", "value": 2800},
            {"date": "Mar 25", "value": 600},
            {"date": "Mar 28", "value": 1800},
            {"date": "Mar 30", "value": 3600},
            {"date": "Sat", "value": 2400}
        ]
    }


def _is_admin_user(user: Optional[User]) -> bool:
    return bool(user and getattr(user, "is_admin", False))


def _organizer_account_for_viewer(db: Session, current_user: User, requested_email: Optional[str]) -> tuple[str, Optional[OrganizerAccount], bool]:
    """Resolve which organizer the caller may view. Non-admins are bound to their JWT email."""
    own_email = (current_user.email or "").lower().strip()
    requested = (requested_email or "").lower().strip()
    is_admin = _is_admin_user(current_user)
    if requested and requested != own_email and not is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view another user's verification status.",
        )
    email_clean = requested if (is_admin and requested) else own_email
    if not email_clean:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Organizer email is required.")

    org_acc = None
    if is_admin and requested and requested != own_email:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email_clean).first()
    else:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) |
            (OrganizerAccount.email == own_email)
        ).first()
    return email_clean, org_acc, is_admin


def _verification_account_payload(org_acc: OrganizerAccount, *, include_sensitive: bool) -> dict:
    if not include_sensitive:
        return {
            "org_name": org_acc.org_name,
        }
    return {
        "beneficiary_name": org_acc.beneficiary_name,
        "account_type": org_acc.account_type,
        "bank_name": org_acc.bank_name,
        "account_number": org_acc.account_number,
        "bank_ifsc": org_acc.bank_ifsc,
        "pan_number": org_acc.pan_number,
        "pan_card_url": org_acc.pan_card_url,
        "cancelled_cheque_url": org_acc.cancelled_cheque_url,
        "org_name": org_acc.org_name,
        "contact_full_name": org_acc.contact_full_name,
        "contact_mobile": org_acc.contact_mobile,
    }


# ── Schemas for additional verification endpoints ────────────────────────────
class ResubmitVerificationRequest(BaseModel):
    email: Optional[EmailStr] = None
    rejection_reason: Optional[str] = None
    new_status: Optional[str] = None


class PublishEventRequest(BaseModel):
    organizer_email: EmailStr
    event_id: Optional[str] = None


# ── Dedicated verification status endpoint ────────────────────────────────────
@router.get("/verification-status")
def get_verification_status(
    email: Optional[str] = Query(None, description="Organizer email (admin only; ignored for organizers)"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the organizer's public verification status + KYC readiness."""
    email_clean, org_acc, is_admin = _organizer_account_for_viewer(db, current_user, email)
    own_email = (current_user.email or "").lower().strip()
    include_sensitive = is_admin or (email_clean == own_email)

    if not org_acc:
        return {
            "verification_status": "NOT_SUBMITTED",
            "internal_status": None,
            "rejection_reason": None,
            "kyc_complete": False,
            "can_publish_events": False,
            "has_record": False,
            "submitted_at": None,
            "verified_at": None,
            "account": None,
            "required_fields": {
                "beneficiary_name": False,
                "bank_name": False,
                "account_number": False,
                "bank_ifsc": False,
                "pan_number": False,
                "pan_card_uploaded": False,
                "cancelled_cheque_uploaded": False
            }
        }

    required = {
        "beneficiary_name": bool(org_acc.beneficiary_name),
        "bank_name": bool(org_acc.bank_name),
        "account_number": bool(org_acc.account_number),
        "bank_ifsc": bool(org_acc.bank_ifsc),
        "pan_number": bool(org_acc.pan_number),
        "pan_card_uploaded": bool(org_acc.pan_card_url),
        "cancelled_cheque_uploaded": bool(org_acc.cancelled_cheque_url),
        "agreement_signed": has_signed_agreement(org_acc)
    }
    kyc_complete = all(required.values())
    public_status = to_public_verification_status(org_acc.status)

    return {
        "verification_status": public_status,
        "internal_status": org_acc.status,
        "rejection_reason": org_acc.rejection_reason,
        "kyc_complete": kyc_complete,
        "setup_complete": is_setup_complete(org_acc),
        "missing_steps": missing_setup_steps(org_acc),
        "can_publish_events": is_organizer_verified(org_acc.status),
        "has_record": True,
        "host_id": org_acc.host_id,
        "customer_id": org_acc.customer_id,
        "submitted_at": org_acc.submitted_at.isoformat() if org_acc.submitted_at else None,
        "verified_at": org_acc.verified_at.isoformat() if org_acc.verified_at else None,
        "required_fields": required,
        "account": _verification_account_payload(org_acc, include_sensitive=include_sensitive),
    }


@router.post("/resubmit-verification")
def resubmit_verification(
    payload: ResubmitVerificationRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Organizers resubmit their own KYC as submitted. Only admins may verify or reject."""
    wanted = (payload.new_status or "").strip().lower()
    own_email = (current_user.email or "").lower().strip()

    if wanted in ("verified", "rejected"):
        if not _is_admin_user(current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Admin access required.",
            )
        target_email = str(payload.email or "").lower().strip()
        if not target_email:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Organizer email is required.",
            )
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == target_email).first()
        if not org_acc:
            raise HTTPException(status_code=404, detail="Organizer account not found.")
        if wanted == "verified":
            org_acc.status = "verified"
            org_acc.verified_at = datetime.utcnow()
            org_acc.rejection_reason = None
        else:
            org_acc.status = "rejected"
            org_acc.rejection_reason = payload.rejection_reason
            org_acc.verified_at = None
    else:
        requested = str(payload.email or "").lower().strip()
        if requested and requested != own_email:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You can only resubmit your own verification.",
            )
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) |
            (OrganizerAccount.email == own_email)
        ).first()
        if not org_acc:
            raise HTTPException(status_code=404, detail="Organizer account not found.")
        missing = missing_setup_steps(org_acc)
        if missing:
            raise HTTPException(
                status_code=400,
                detail="Please provide the following before resubmitting: " + ", ".join(missing) + "."
            )
        org_acc.status = "submitted"
        org_acc.rejection_reason = None
        org_acc.submitted_at = datetime.utcnow()
        org_acc.verified_at = None

    db.commit()
    db.refresh(org_acc)

    return {
        "message": "Verification status updated.",
        "verification_status": to_public_verification_status(org_acc.status),
        "rejection_reason": org_acc.rejection_reason
    }
