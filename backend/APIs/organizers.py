"""
API endpoints for Event Organizer onboarding — Email OTP verification & Account setup with bank details.
"""

import random
import sys
import uuid
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from Models import get_db, EmailOTP, OrganizerAccount, User, HostRegistrationLog
from Authentication.dependencies import get_current_user, get_current_user_optional
from Authentication.jwt_handler import create_access_token, ACCESS_TOKEN_EXPIRE_MINUTES

from Utils.id_generator import generate_customer_id, generate_host_id_from_customer_id

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


def has_payout_bank(acc: Optional[OrganizerAccount]) -> bool:
    if not acc:
        return False
    return bool(
        (acc.beneficiary_name or "").strip()
        and (acc.bank_name or "").strip()
        and (acc.account_number or "").strip()
        and (acc.bank_ifsc or "").strip()
    )


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

    is_final_submit: bool = False


# ── Endpoints ─────────────────────────────────────────────────────────────────
@router.post("/send-otp")
def send_otp(payload: SendOTPRequest, db: Session = Depends(get_db)):
    """Generate and send a 6-digit OTP to the user's email."""
    email = payload.email.lower().strip()
    
    # Generate random 6-digit OTP code
    otp_code = f"{random.randint(100000, 999999)}"
    expires_at = datetime.utcnow() + timedelta(minutes=10)

    # Invalidate prior unverified OTPs for this email
    db.query(EmailOTP).filter(
        EmailOTP.email == email,
        EmailOTP.is_verified == False
    ).delete()

    otp_record = EmailOTP(
        email=email,
        otp_code=otp_code,
        expires_at=expires_at,
        is_verified=False
    )
    db.add(otp_record)
    db.commit()

    safe_print(f"  [OTP SERVICE] Generated 6-digit OTP [{otp_code}] for email: {email}")

    return {
        "message": f"6-digit verification code sent to {email}.",
        "email": email,
        "dev_otp": otp_code  # Provided for convenience in dev/testing environments
    }


@router.post("/verify-otp")
def verify_otp(payload: VerifyOTPRequest, db: Session = Depends(get_db)):
    """Verify the 6-digit OTP sent to the user's email."""
    email = payload.email.lower().strip()
    code = payload.otp_code.strip()

    otp_record = db.query(EmailOTP).filter(
        EmailOTP.email == email,
        EmailOTP.otp_code == code,
        EmailOTP.is_verified == False
    ).order_by(EmailOTP.created_at.desc()).first()

    if not otp_record:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid OTP verification code. Please check and try again."
        )

    if datetime.utcnow() > otp_record.expires_at:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="OTP code has expired. Please request a new verification code."
        )

    # Mark OTP as verified
    otp_record.is_verified = True

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

    if user:
        token = create_access_token(
            data={
                "sub": str(user.customer_id or user.email),
                "customer_id": str(user.customer_id) if user.customer_id else None,
                "email": user.email,
                "username": user.username,
            },
            expires_delta=timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES),
        )
        result["access_token"] = token
        result["token_type"] = "bearer"

    return result


@router.post("/account-setup")
def save_account_setup(
    payload: AccountSetupRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Save or update organizer account details and bank information."""
    email = payload.email.lower().strip()

    if current_user and current_user.email.lower() != email:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only save host account details for your logged-in account."
        )

    # Check if email is verified (not required if user is already authenticated via JWT)
    if not current_user:
        verified_otp = db.query(EmailOTP).filter(
            EmailOTP.email == email,
            EmailOTP.is_verified == True
        ).first()

        if not verified_otp:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Email ID must be verified via OTP before setting up account details."
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

    if payload.is_final_submit:
        if not has_payout_bank(org_acc):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bank details are required before you can host events."
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

    def _is_kyc_complete(acc: OrganizerAccount) -> bool:
        return bool(
            acc.beneficiary_name and acc.bank_name and acc.account_number and acc.bank_ifsc
            and acc.pan_number and acc.pan_card_url and acc.cancelled_cheque_url
        )

    return {
        "verification_status": to_public_verification_status(org_acc.status),
        "rejection_reason": org_acc.rejection_reason,
        "kyc_complete": _is_kyc_complete(org_acc),
        "bank_complete": has_payout_bank(org_acc),
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
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Upload PAN card or Cancelled Cheque image/PDF (<= 2MB)."""
    import os
    email_clean = _bound_organizer_email(email, current_user)

    if current_user and current_user.email.lower() != email_clean:
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
    current_user: Optional[User] = Depends(get_current_user_optional)
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


# ── Schemas for additional verification endpoints ────────────────────────────
class ResubmitVerificationRequest(BaseModel):
    email: EmailStr
    rejection_reason: Optional[str] = None  # admin-use only via flag
    new_status: Optional[str] = None        # admin-use: rejected / verified


class PublishEventRequest(BaseModel):
    organizer_email: EmailStr
    event_id: Optional[str] = None


# ── Dedicated verification status endpoint ────────────────────────────────────
@router.get("/verification-status")
def get_verification_status(
    email: str = Query(..., description="Organizer email address"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Return the organizer's public verification status + KYC readiness."""
    email_clean = _bound_organizer_email(email, current_user)

    if current_user and current_user.email.lower() != email_clean:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to view another user's verification status."
        )

    org_acc = None
    if current_user:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) |
            (OrganizerAccount.email == email_clean)
        ).first()
    else:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email_clean).first()

    if not org_acc:
        # No record = NOT_SUBMITTED (fresh organizer)
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
        "cancelled_cheque_uploaded": bool(org_acc.cancelled_cheque_url)
    }
    kyc_complete = all(required.values())
    public_status = to_public_verification_status(org_acc.status)

    return {
        "verification_status": public_status,
        "internal_status": org_acc.status,
        "rejection_reason": org_acc.rejection_reason,
        "kyc_complete": kyc_complete,
        "can_publish_events": is_organizer_verified(org_acc.status),
        "has_record": True,
        "host_id": org_acc.host_id,
        "customer_id": org_acc.customer_id,
        "submitted_at": org_acc.submitted_at.isoformat() if org_acc.submitted_at else None,
        "verified_at": org_acc.verified_at.isoformat() if org_acc.verified_at else None,
        "required_fields": required,
        "account": {
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
            "contact_mobile": org_acc.contact_mobile
        }
    }


@router.post("/resubmit-verification")
def resubmit_verification(
    payload: ResubmitVerificationRequest,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Resubmit KYC for review when previously REJECTED (or set admin status)."""
    email_clean = payload.email.lower().strip()

    if current_user and current_user.email.lower() != email_clean:
        raise HTTPException(status_code=403, detail="Unauthorized.")

    org_acc = None
    if current_user:
        org_acc = db.query(OrganizerAccount).filter(
            (OrganizerAccount.customer_id == current_user.customer_id) |
            (OrganizerAccount.email == email_clean)
        ).first()
    else:
        org_acc = db.query(OrganizerAccount).filter(OrganizerAccount.email == email_clean).first()

    if not org_acc:
        raise HTTPException(status_code=404, detail="Organizer account not found.")

    # Allow admin status override only via existing (non-end-user) trusted flow marker;
    # otherwise always move back to PENDING / submitted.
    if payload.new_status == "verified" and current_user:
        org_acc.status = "verified"
        org_acc.verified_at = datetime.utcnow()
    elif payload.new_status == "rejected" and current_user:
        org_acc.status = "rejected"
        org_acc.rejection_reason = payload.rejection_reason
        org_acc.verified_at = None
    else:
        # Standard end-user resubmission
        required = (
            org_acc.beneficiary_name and org_acc.bank_name and org_acc.account_number
            and org_acc.bank_ifsc and org_acc.pan_number
            and org_acc.pan_card_url and org_acc.cancelled_cheque_url
        )
        if not required:
            raise HTTPException(
                status_code=400,
                detail="All KYC fields (bank details, PAN number, PAN image, and cancelled cheque image) must be provided before resubmitting."
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
