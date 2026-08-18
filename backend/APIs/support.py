"""
Help & Support tickets — guests and signed-in users can raise a query.
"""

import random
from datetime import datetime
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user_optional
from Models.base import get_db
from Models.support_ticket import SupportTicket, generate_ticket_code
from Models.user import User

router = APIRouter()

ALLOWED_CATEGORIES = {
    "bookings",
    "tickets",
    "payments",
    "hosting",
    "account",
    "checkin",
    "other",
}
ALLOWED_PRIORITIES = {"normal", "high", "urgent"}


class SupportTicketCreate(BaseModel):
    name: str = Field(..., min_length=2, max_length=200)
    email: EmailStr
    category: str = Field(..., min_length=2, max_length=80)
    priority: str = "normal"
    subject: str = Field(..., min_length=6, max_length=250)
    message: str = Field(..., min_length=20, max_length=4000)


class SupportTicketResponse(BaseModel):
    id: str
    ticket_code: str
    name: str
    email: str
    category: str
    priority: str
    subject: str
    message: str
    status: str
    created_at: Optional[datetime] = None


def _normalize_category(raw: str) -> str:
    value = str(raw or "").strip().lower().replace(" ", "_").replace("&", "")
    aliases = {
        "e-tickets": "tickets",
        "e_tickets": "tickets",
        "etickets": "tickets",
        "payments_refunds": "payments",
        "refunds": "payments",
        "check-in": "checkin",
        "check_in": "checkin",
    }
    value = aliases.get(value, value)
    if value not in ALLOWED_CATEGORIES:
        raise HTTPException(status_code=400, detail="Choose a valid support category.")
    return value


def _normalize_priority(raw: str) -> str:
    value = str(raw or "normal").strip().lower()
    if value not in ALLOWED_PRIORITIES:
        return "normal"
    return value


def _serialize(ticket: SupportTicket) -> SupportTicketResponse:
    return SupportTicketResponse(
        id=str(ticket.id),
        ticket_code=ticket.ticket_code,
        name=ticket.name,
        email=ticket.email,
        category=ticket.category,
        priority=ticket.priority,
        subject=ticket.subject,
        message=ticket.message,
        status=ticket.status,
        created_at=ticket.created_at,
    )


def _unique_code(db: Session) -> str:
    for _ in range(12):
        code = generate_ticket_code()
        exists = db.query(SupportTicket.ticket_code).filter(SupportTicket.ticket_code == code).first()
        if not exists:
            return code
    return f"HT-{random.randint(100000, 999999)}{random.randint(10, 99)}"


@router.post("/tickets", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
def create_support_ticket(
    payload: SupportTicketCreate,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    name = payload.name.strip()
    email = str(payload.email).strip().lower()
    if current_user and current_user.email:
        email = current_user.email.lower().strip()
        if current_user.full_name:
            name = current_user.full_name.strip() or name
    subject = payload.subject.strip()
    message = payload.message.strip()
    if not name or not subject or not message:
        raise HTTPException(status_code=400, detail="Name, subject, and message are required.")

    ticket = SupportTicket(
        ticket_code=_unique_code(db),
        customer_id=current_user.customer_id if current_user else None,
        name=name,
        email=current_user.email.lower() if current_user and current_user.email else email,
        category=_normalize_category(payload.category),
        priority=_normalize_priority(payload.priority),
        subject=subject,
        message=message,
        status="open",
    )
    db.add(ticket)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        ticket.ticket_code = _unique_code(db)
        db.add(ticket)
        db.commit()
    db.refresh(ticket)
    return _serialize(ticket)


@router.get("/tickets", response_model=List[SupportTicketResponse])
def list_support_tickets(
    email: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    query = db.query(SupportTicket)
    if current_user:
        query = query.filter(
            or_(
                SupportTicket.customer_id == current_user.customer_id,
                SupportTicket.email == (current_user.email or "").lower(),
            )
        )
    else:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to view your support tickets.",
        )

    rows = query.order_by(SupportTicket.created_at.desc()).limit(40).all()
    return [_serialize(row) for row in rows]
