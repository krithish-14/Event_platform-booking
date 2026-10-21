"""
Admin access management. The super admin (ADMIN_EMAIL) invites people by email,
they accept with that same email, and the super admin can revoke them later.
"""

from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime
from html import escape as html_escape
from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import func
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_admin, get_current_user
from Models.admin_access import AdminAccess, default_admin_invite_expiry
from Models.base import get_db
from Models.user import User
from Services.email import send_email
from Services.rate_limit import limit_admin

router = APIRouter(dependencies=[Depends(limit_admin)])


class AdminInviteRequest(BaseModel):
    email: EmailStr
    name: Optional[str] = Field(default=None, max_length=200)


def super_admin_email() -> str:
    return (os.getenv("ADMIN_EMAIL") or "").strip().lower()


def is_super_admin(user: Optional[User]) -> bool:
    owner = super_admin_email()
    return bool(user and owner and (user.email or "").strip().lower() == owner)


def get_current_super_admin(current_admin: User = Depends(get_current_admin)) -> User:
    if not is_super_admin(current_admin):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only the super admin can manage admin access.")
    return current_admin


def _hash_token(raw: str) -> str:
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


def _invite_url(request: Request, raw_token: str) -> str:
    from APIs.volunteers import _frontend_base
    return f"{_frontend_base(request)}/admin-invite.html?token={raw_token}"


def _effective_status(row: AdminAccess) -> str:
    current = (row.status or "PENDING").upper()
    if current == "PENDING" and row.is_expired():
        return "EXPIRED"
    return current


def _serialize(row: AdminAccess) -> dict:
    return {
        "id": str(row.id),
        "email": row.invited_email,
        "name": row.invited_name or "",
        "status": _effective_status(row),
        "invited_by": row.invited_by_email or "",
        "invited_at": row.invited_at.isoformat() + "Z" if row.invited_at else None,
        "expires_at": row.expires_at.isoformat() + "Z" if row.expires_at else None,
        "accepted_at": row.accepted_at.isoformat() + "Z" if row.accepted_at else None,
        "revoked_at": row.revoked_at.isoformat() + "Z" if row.revoked_at else None,
    }


def _issue_token(row: AdminAccess) -> str:
    raw = secrets.token_urlsafe(32)
    row.token_hash = _hash_token(raw)
    row.expires_at = default_admin_invite_expiry()
    row.status = "PENDING"
    row.invited_at = datetime.utcnow()
    row.accepted_at = None
    row.revoked_at = None
    row.revoked_by_email = None
    return raw


def _send_invite_email(row: AdminAccess, url: str, inviter: User) -> bool:
    inviter_name = inviter.full_name or inviter.email or "the JOD Events team"
    expires = row.expires_at.strftime("%d %b %Y, %I:%M %p UTC") if row.expires_at else "in 48 hours"
    subject = "You're invited to the JOD Events admin portal"
    text = (
        f"{inviter_name} has given you admin access to the JOD Events admin portal.\n\n"
        f"Accept the invitation and sign in with {row.invited_email}:\n{url}\n\n"
        f"This invitation expires on {expires}. If you were not expecting it, ignore this email.\n"
    )
    safe_url = html_escape(url, quote=True)
    html = f"""
    <div style="font-family:Arial,sans-serif;max-width:520px;line-height:1.5;color:#0f172a">
      <h2 style="margin:0 0 12px">You're invited to the JOD Events admin portal</h2>
      <p>{html_escape(str(inviter_name))} has given you admin access.</p>
      <p>Sign in with <strong>{html_escape(row.invited_email)}</strong> to accept.</p>
      <p><a href="{safe_url}" style="display:inline-block;background:#ff7508;color:#fff;padding:12px 18px;border-radius:8px;text-decoration:none;font-weight:700">Accept admin access</a></p>
      <p style="color:#64748b;font-size:13px">This invitation expires on {html_escape(expires)}. If you were not expecting it, ignore this email.</p>
    </div>
    """
    try:
        return bool(send_email(row.invited_email, subject, text, html))
    except Exception:
        return False


def _row_or_404(db: Session, access_id: str) -> AdminAccess:
    try:
        key = UUID(str(access_id))
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Admin access record not found.")
    row = db.query(AdminAccess).filter(AdminAccess.id == key).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Admin access record not found.")
    return row


def _row_for_token(db: Session, raw_token: str) -> AdminAccess:
    token = (raw_token or "").strip()
    row = db.query(AdminAccess).filter(AdminAccess.token_hash == _hash_token(token)).first() if token else None
    if row is None:
        raise HTTPException(status_code=404, detail="This admin invitation link is not valid. Ask the super admin for a new one.")
    return row


@router.get("")
def list_admin_access(db: Session = Depends(get_db), current: User = Depends(get_current_super_admin)):
    rows = db.query(AdminAccess).order_by(AdminAccess.created_at.desc()).all()
    return {
        "super_admin": {"email": current.email, "name": current.full_name or ""},
        "admins": [_serialize(row) for row in rows],
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def invite_admin(
    payload: AdminInviteRequest,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_super_admin),
):
    email = payload.email.strip().lower()
    if email == super_admin_email():
        raise HTTPException(status_code=400, detail="That email is the super admin and already has full access.")
    row = db.query(AdminAccess).filter(func.lower(AdminAccess.invited_email) == email).first()
    if row is not None and _effective_status(row) == "ACTIVE":
        raise HTTPException(status_code=409, detail=f"{email} already has admin access.")
    if row is None:
        row = AdminAccess(invited_email=email)
        db.add(row)
    row.invited_name = (payload.name or "").strip()[:200] or row.invited_name
    row.invited_by_email = current.email
    raw = _issue_token(row)
    db.commit()
    db.refresh(row)
    url = _invite_url(request, raw)
    sent = _send_invite_email(row, url, current)
    return {**_serialize(row), "invite_url": url, "email_sent": sent}


@router.post("/{access_id}/resend")
def resend_admin_invite(
    access_id: str,
    request: Request,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_super_admin),
):
    row = _row_or_404(db, access_id)
    if _effective_status(row) == "ACTIVE":
        raise HTTPException(status_code=409, detail=f"{row.invited_email} already has admin access.")
    row.invited_by_email = current.email
    raw = _issue_token(row)
    db.commit()
    db.refresh(row)
    url = _invite_url(request, raw)
    sent = _send_invite_email(row, url, current)
    return {**_serialize(row), "invite_url": url, "email_sent": sent}


@router.post("/{access_id}/revoke")
def revoke_admin_access(
    access_id: str,
    db: Session = Depends(get_db),
    current: User = Depends(get_current_super_admin),
):
    row = _row_or_404(db, access_id)
    email = (row.invited_email or "").strip().lower()
    if email == super_admin_email():
        raise HTTPException(status_code=400, detail="The super admin cannot be revoked.")
    row.status = "REVOKED"
    row.revoked_at = datetime.utcnow()
    row.revoked_by_email = current.email
    row.token_hash = None
    row.expires_at = None
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user is not None and not is_super_admin(user):
        user.is_admin = False
    db.commit()
    db.refresh(row)
    return _serialize(row)


public_router = APIRouter()


@public_router.get("/invite/{token}")
def peek_admin_invite(token: str, db: Session = Depends(get_db)):
    row = _row_for_token(db, token)
    return {
        "email": row.invited_email,
        "name": row.invited_name or "",
        "status": _effective_status(row),
        "invited_by": row.invited_by_email or "",
        "expires_at": row.expires_at.isoformat() + "Z" if row.expires_at else None,
    }


@public_router.post("/invite/{token}/accept")
def accept_admin_invite(
    token: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    row = _row_for_token(db, token)
    state = _effective_status(row)
    user_email = (current_user.email or "").strip().lower()
    if user_email != (row.invited_email or "").strip().lower():
        raise HTTPException(status_code=403, detail=f"Sign in with {row.invited_email} to accept this admin invitation.")
    if state == "ACTIVE":
        if not current_user.is_admin:
            current_user.is_admin = True
            db.commit()
        return {"status": "ACTIVE", "email": row.invited_email}
    if state == "EXPIRED":
        row.status = "EXPIRED"
        db.commit()
        raise HTTPException(status_code=410, detail="This admin invitation has expired. Ask the super admin to resend it.")
    if state != "PENDING":
        raise HTTPException(status_code=410, detail="This admin invitation is no longer valid.")
    row.status = "ACTIVE"
    row.accepted_at = datetime.utcnow()
    row.customer_id = current_user.customer_id
    current_user.is_admin = True
    db.commit()
    return {"status": "ACTIVE", "email": row.invited_email}
