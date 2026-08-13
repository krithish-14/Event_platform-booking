"""
API endpoints for Event Organizer onboarding — Email OTP verification & Account setup with bank details.
"""

import random
import sys
from datetime import datetime, timedelta
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, UploadFile, File, Form
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr

from Models import get_db, EmailOTP, OrganizerAccount, User, HostRegistrationLog
from Authentication.dependencies import get_current_user, get_current_user_optional

from Utils.id_generator import generate_customer_id, generate_host_id_from_customer_id

router = APIRouter()


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

    db.commit()

    is_completed = bool(org_acc and org_acc.status in ["submitted", "verified"])

    return {
        "message": "Email verified successfully!",
        "verified": True,
        "email": email,
        "account_status": org_acc.status if org_acc else "draft",
        "is_completed": is_completed
    }


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
        org_acc.status = "submitted"
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
            "created_at": org_acc.created_at.isoformat() if org_acc.created_at else None,
            "updated_at": org_acc.updated_at.isoformat() if org_acc.updated_at else None
        }
    }


@router.get("/account-setup")
def get_account_setup(
    email: Optional[str] = Query(None, description="Organizer email address"),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional)
):
    """Fetch saved organizer account details by authenticated token or email."""
    if not current_user and not email:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication token or email is required."
        )

    email_clean = (email or (current_user.email if current_user else "")).lower().strip()

    if current_user and email and current_user.email.lower() != email_clean:
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
            "status": org_acc.status
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
    email_clean = email.lower().strip()

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

    # Ensure uploads directory exists inside backend
    here = os.path.dirname(os.path.abspath(__file__))
    backend_dir = os.path.dirname(here)
    uploads_dir = os.path.join(backend_dir, "uploads")
    os.makedirs(uploads_dir, exist_ok=True)

    safe_filename = f"{email_clean.replace('@', '_at_')}_{doc_type}{ext}"
    file_path = os.path.join(uploads_dir, safe_filename)

    with open(file_path, "wb") as f:
        f.write(contents)

    file_url = f"/uploads/{safe_filename}"

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
    email_clean = email.lower().strip()

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

    return {
        "organizer": {
            "email": email_clean,
            "org_name": org_name,
            "status": org_acc.status if org_acc else "verified"
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
