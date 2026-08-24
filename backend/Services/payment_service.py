"""
Razorpay order creation, HMAC-SHA256 signature verification, and paid booking confirm.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import smtplib
from datetime import datetime
from email.message import EmailMessage
from typing import Any, Optional
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from Models.booking import Booking
from Models.event import Event
from Models.payment import Payment
from Models.ticket import Ticket, generate_qr_token
from Models.user import User


class PaymentGatewayError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.status_code = status_code
        self.message = message


def get_razorpay_keys() -> tuple[str, str]:
    key_id = (
        os.getenv("RAZORPAY_KEY_ID")
        or os.getenv("KEY_ID")
        or ""
    ).strip()
    key_secret = (
        os.getenv("RAZORPAY_KEY_SECRET")
        or os.getenv("KEY_SECRET")
        or ""
    ).strip()
    if not key_id or not key_secret:
        raise PaymentGatewayError(
            "Razorpay is not configured. Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in the environment.",
            status_code=503,
        )
    if key_secret.lower() in {"your_razorpay_key_secret", "change-me", "secret"}:
        raise PaymentGatewayError(
            "Razorpay KEY_SECRET is still a placeholder. Use a real key from the Razorpay dashboard.",
            status_code=503,
        )
    return key_id, key_secret


def get_razorpay_client():
    key_id, key_secret = get_razorpay_keys()
    try:
        import razorpay
    except ImportError as exc:
        raise PaymentGatewayError(
            "Razorpay SDK is not installed. Run: pip install razorpay",
            status_code=503,
        ) from exc
    return razorpay.Client(auth=(key_id, key_secret)), key_id, key_secret


def rupees_to_paise(amount_rupees: float) -> int:
    return int(round(float(amount_rupees or 0) * 100))


def paise_to_rupees(amount_paise: int) -> float:
    return round((int(amount_paise or 0)) / 100.0, 2)


def verify_razorpay_signature(order_id: str, payment_id: str, signature: str, key_secret: str) -> bool:
    """Verify Razorpay checkout signature with HMAC SHA256. Never skip this check."""
    if not order_id or not payment_id or not signature or not key_secret:
        return False
    message = f"{order_id}|{payment_id}".encode("utf-8")
    expected = hmac.new(key_secret.encode("utf-8"), message, hashlib.sha256).hexdigest()
    try:
        return hmac.compare_digest(expected, str(signature).strip())
    except Exception:
        return False


def _parse_ticket_types(raw: Any) -> list:
    if not raw:
        return []
    if isinstance(raw, list):
        return raw
    if isinstance(raw, str):
        try:
            parsed = json.loads(raw)
            return parsed if isinstance(parsed, list) else []
        except Exception:
            return []
    return []


def resolve_ticket_unit_price(event: Event, ticket_type: Optional[str]) -> float:
    wanted = str(ticket_type or "").strip().lower()
    for item in _parse_ticket_types(event.ticket_types):
        if not isinstance(item, dict):
            continue
        name = str(item.get("name") or item.get("ticket_type") or item.get("title") or "").strip().lower()
        if wanted and name == wanted:
            try:
                return max(0.0, float(item.get("price") or 0))
            except (TypeError, ValueError):
                break
    try:
        return max(0.0, float(event.price or 0))
    except (TypeError, ValueError):
        return 0.0


def _get_published_event(db: Session, event_id: str) -> Event:
    try:
        ev_uuid = UUID(str(event_id))
    except Exception as exc:
        raise PaymentGatewayError("Invalid event ID format.") from exc
    event = db.query(Event).filter(
        Event.id == ev_uuid,
        Event.is_published == True,
        Event.is_cancelled == False,
    ).first()
    if not event:
        raise PaymentGatewayError("This event is currently unavailable.", status_code=404)
    return event


def create_razorpay_order(
    db: Session,
    user: User,
    event_id: str,
    ticket_type: str = "General Admission",
    quantity: int = 1,
) -> dict:
    event = _get_published_event(db, event_id)
    qty = max(1, int(quantity or 1))
    unit_price = resolve_ticket_unit_price(event, ticket_type)
    amount_rupees = round(unit_price * qty, 2)
    amount_paise = rupees_to_paise(amount_rupees)
    if amount_paise < 100:
        raise PaymentGatewayError(
            "This ticket is free or below Razorpay's minimum amount. Complete booking without card payment.",
            status_code=400,
        )

    client, key_id, _secret = get_razorpay_client()
    receipt = f"jod_{secrets.token_hex(8)}"
    order = client.order.create({
        "amount": amount_paise,
        "currency": "INR",
        "payment_capture": 1,
        "receipt": receipt,
        "notes": {
            "event_id": str(event.id),
            "user_id": user.customer_id,
            "ticket_type": ticket_type or "General Admission",
            "quantity": str(qty),
        },
    })
    order_id = order.get("id")
    if not order_id:
        raise PaymentGatewayError("Razorpay did not return an order_id.", status_code=502)

    payment = Payment(
        order_id=order_id,
        amount=amount_paise,
        currency="INR",
        status="pending",
        user_id=user.customer_id,
        event_id=event.id,
        ticket_type=ticket_type or "General Admission",
        quantity=qty,
        receipt=receipt,
    )
    db.add(payment)
    db.commit()
    db.refresh(payment)

    return {
        "order_id": order_id,
        "amount": amount_paise,
        "currency": "INR",
        "key": key_id,
        "payment_capture": 1,
        "event_id": str(event.id),
        "event_title": event.title,
        "ticket_type": payment.ticket_type,
        "quantity": qty,
        "amount_rupees": amount_rupees,
        "prefill": {
            "name": user.full_name or user.username or "",
            "email": user.email or "",
            "contact": getattr(user, "phone", None) or "",
        },
    }


def _create_confirmed_booking(db: Session, payment: Payment, user: User, event: Event) -> Booking:
    qty = max(1, payment.quantity or 1)
    total_price = paise_to_rupees(payment.amount)
    gst_calc = round(total_price * 0.18, 2)
    booking = Booking(
        customer_id=user.customer_id,
        event_id=event.id,
        ticket_type=payment.ticket_type or "General Admission",
        quantity=qty,
        total_price=total_price,
        status="CONFIRMED",
        payment_id=payment.payment_id,
        payment_mode="Razorpay",
        gst_amount=gst_calc,
        seat_number="General Admission",
        receiver_name=user.full_name or user.username,
        receiver_email=user.email,
        receiver_phone=getattr(user, "phone", None),
    )
    db.add(booking)
    db.flush()
    for i in range(qty):
        seat = "General Admission" if qty == 1 else f"General Admission - Seat {i + 1}"
        db.add(Ticket(
            booking_id=booking.booking_id,
            event_id=event.id,
            customer_id=user.customer_id,
            ticket_type=booking.ticket_type,
            seat_number=seat,
            qr_token=generate_qr_token(),
            ticket_status="VALID",
        ))
    payment.booking_id = booking.booking_id
    return booking


def send_ticket_confirmation(user: User, event: Event, booking: Booking, payment: Payment) -> None:
    """Best-effort ticket confirmation. SMTP is optional; booking is already saved."""
    to_email = (user.email or "").strip()
    if not to_email:
        return
    subject = f"Ticket confirmed — {event.title}"
    body = (
        f"Hi {user.full_name or user.username or 'there'},\n\n"
        f"Your payment was verified and your ticket is confirmed.\n\n"
        f"Event: {event.title}\n"
        f"Venue: {event.venue or event.location or 'See event page'}\n"
        f"Ticket: {booking.ticket_type} x {booking.quantity}\n"
        f"Amount: INR {paise_to_rupees(payment.amount):.2f}\n"
        f"Payment ID: {payment.payment_id}\n"
        f"Booking ID: {booking.booking_id}\n\n"
        f"Show this booking in your JOD Events orders to enter the venue.\n"
    )
    host = (os.getenv("SMTP_HOST") or "").strip()
    if not host:
        print(f"[TICKET CONFIRM] {to_email} booking={booking.booking_id} event={event.title}", flush=True)
        return
    try:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = os.getenv("SMTP_FROM") or os.getenv("SMTP_USER") or "tickets@jodevents.com"
        msg["To"] = to_email
        msg.set_content(body)
        port = int(os.getenv("SMTP_PORT") or 587)
        with smtplib.SMTP(host, port, timeout=12) as smtp:
            smtp.starttls()
            user_name = os.getenv("SMTP_USER")
            password = os.getenv("SMTP_PASSWORD")
            if user_name and password:
                smtp.login(user_name, password)
            smtp.send_message(msg)
    except Exception as exc:
        print(f"[TICKET CONFIRM WARN] Could not send email: {exc}", flush=True)


def verify_and_confirm_payment(
    db: Session,
    user: User,
    order_id: str,
    payment_id: str,
    signature: str,
) -> dict:
    _key_id, key_secret = get_razorpay_keys()
    valid = verify_razorpay_signature(order_id, payment_id, signature, key_secret)
    payment = db.query(Payment).filter(Payment.order_id == order_id).first()

    if not valid:
        if payment and payment.user_id == user.customer_id:
            payment.payment_id = payment_id
            payment.signature = signature
            payment.status = "failed"
            db.commit()
        return {"status": "Verification Failed"}

    if not payment:
        return {"status": "Verification Failed"}
    if payment.user_id != user.customer_id:
        return {"status": "Verification Failed"}

    if payment.status == "success" and payment.booking_id:
        return {
            "status": "Payment Verified",
            "booking_id": str(payment.booking_id),
            "payment_id": payment.payment_id,
            "order_id": payment.order_id,
        }

    try:
        client, _kid, _secret = get_razorpay_client()
        remote = client.payment.fetch(payment_id)
        remote_amount = int(remote.get("amount") or 0)
        remote_order = str(remote.get("order_id") or "")
        remote_status = str(remote.get("status") or "").lower()
        if remote_order != order_id or remote_amount != int(payment.amount):
            payment.status = "failed"
            payment.payment_id = payment_id
            payment.signature = signature
            db.commit()
            return {"status": "Verification Failed"}
        if remote_status not in {"captured", "authorized"}:
            payment.status = "failed"
            payment.payment_id = payment_id
            payment.signature = signature
            db.commit()
            return {"status": "Verification Failed"}
    except PaymentGatewayError:
        raise
    except Exception as exc:
        print(f"[RAZORPAY] payment.fetch failed: {exc}", flush=True)
        payment.status = "failed"
        payment.payment_id = payment_id
        payment.signature = signature
        db.commit()
        return {"status": "Verification Failed"}

    event = db.query(Event).filter(Event.id == payment.event_id).first()
    if not event:
        payment.status = "failed"
        db.commit()
        return {"status": "Verification Failed"}

    payment.payment_id = payment_id
    payment.signature = signature
    payment.status = "success"
    payment.verified_at = datetime.utcnow()
    booking = _create_confirmed_booking(db, payment, user, event)
    db.commit()

    booking_full = (
        db.query(Booking)
        .options(joinedload(Booking.event), joinedload(Booking.customer), joinedload(Booking.tickets))
        .filter(Booking.booking_id == booking.booking_id)
        .first()
    )
    try:
        send_ticket_confirmation(user, event, booking_full or booking, payment)
    except Exception as exc:
        print(f"[TICKET CONFIRM WARN] {exc}", flush=True)

    return {
        "status": "Payment Verified",
        "booking_id": str(booking.booking_id),
        "payment_id": payment.payment_id,
        "order_id": payment.order_id,
        "amount": payment.amount,
        "event_id": str(payment.event_id),
    }
