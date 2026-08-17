"""
Razorpay payment routes.

Public paths required by checkout:
  POST /create_order/
  POST /verify_payment/

REST aliases:
  POST /api/payments/create-order
  POST /api/payments/verify
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.user import User
from Services.payment_service import (
    PaymentGatewayError,
    create_razorpay_order,
    get_razorpay_keys,
    verify_and_confirm_payment,
)

router = APIRouter(tags=["Payments"])


class CreateOrderRequest(BaseModel):
    event_id: str
    ticket_type: Optional[str] = "General Admission"
    quantity: int = Field(default=1, ge=1, le=20)


class VerifyPaymentRequest(BaseModel):
    order_id: str
    payment_id: str
    signature: str


def _raise_gateway(exc: PaymentGatewayError):
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.post("/create_order/", operation_id="create_razorpay_order")
@router.post("/api/payments/create-order", operation_id="create_razorpay_order_alias")
def create_order(
    payload: CreateOrderRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Create a Razorpay order in paise (INR) with automatic payment capture."""
    try:
        return create_razorpay_order(
            db=db,
            user=current_user,
            event_id=payload.event_id,
            ticket_type=payload.ticket_type or "General Admission",
            quantity=payload.quantity,
        )
    except PaymentGatewayError as exc:
        _raise_gateway(exc)


@router.post("/verify_payment/", operation_id="verify_razorpay_payment")
@router.post("/api/payments/verify", operation_id="verify_razorpay_payment_alias")
def verify_payment(
    payload: VerifyPaymentRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Verify Razorpay HMAC-SHA256 signature with KEY_SECRET, then save
    the payment and confirmed ticket booking.
    """
    try:
        return verify_and_confirm_payment(
            db=db,
            user=current_user,
            order_id=payload.order_id,
            payment_id=payload.payment_id,
            signature=payload.signature,
        )
    except PaymentGatewayError as exc:
        _raise_gateway(exc)


@router.get("/api/payments/config")
def payment_public_config():
    """Expose only KEY_ID to the browser. KEY_SECRET never leaves the server."""
    try:
        key_id, _secret = get_razorpay_keys()
    except PaymentGatewayError as exc:
        _raise_gateway(exc)
    return {"key": key_id, "currency": "INR"}
