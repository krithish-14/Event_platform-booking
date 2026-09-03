"""Verify create-order + signature verify endpoints without browser captcha."""
from __future__ import annotations

import hmac
import hashlib
import os
import random

import requests
from dotenv import load_dotenv

load_dotenv(r"D:\JOD-Events\backend\.env")
API = "http://127.0.0.1:8001"
SECRET = os.getenv("RAZORPAY_KEY_SECRET")


def main():
    s = requests.Session()
    suffix = random.randint(10000, 99999)
    email = f"rzp.api.{suffix}@gmail.com"
    r = s.post(
        f"{API}/api/auth/register",
        json={
            "email": email,
            "username": f"rzp_api_{suffix}",
            "password": "Test@1234!",
            "full_name": "Razorpay API",
            "phone": "9123456780",
            "accepted_privacy_policy": True,
        },
        timeout=30,
    )
    print("REGISTER", r.status_code)
    r.raise_for_status()

    order = s.post(
        f"{API}/api/create-order",
        json={
            "amount": 100,
            "currency": "INR",
            "receipt": f"api_{suffix}",
            "event_id": "rzp-e2e-event",
            "ticket_type": "General Admission",
            "quantity": 1,
        },
        timeout=30,
    )
    print("CREATE_ORDER", order.status_code, order.text[:300])
    order.raise_for_status()
    data = order.json()
    assert data.get("order_id") and data.get("key_id") and data.get("amount") == 100

    # Bad signature must 400
    bad = s.post(
        f"{API}/api/verify-payment",
        json={
            "razorpay_order_id": data["order_id"],
            "razorpay_payment_id": "pay_fake_bad",
            "razorpay_signature": "00" * 32,
            "event_id": "rzp-e2e-event",
            "amount": 1,
        },
        timeout=30,
    )
    print("VERIFY_BAD", bad.status_code, bad.text[:200])
    assert bad.status_code == 400

    # Good HMAC signature should pass crypto check (payment id need not exist at Razorpay)
    payment_id = f"pay_test_{suffix}"
    sig = hmac.new(
        SECRET.encode(),
        f"{data['order_id']}|{payment_id}".encode(),
        hashlib.sha256,
    ).hexdigest()
    good = s.post(
        f"{API}/api/verify-payment",
        json={
            "razorpay_order_id": data["order_id"],
            "razorpay_payment_id": payment_id,
            "razorpay_signature": sig,
            "event_id": "rzp-e2e-event",
            "ticket_type": "General Admission",
            "quantity": 1,
            "amount": 1,
            "attendee_name": "Razorpay API",
            "attendee_phone": "9123456780",
        },
        timeout=30,
    )
    print("VERIFY_GOOD", good.status_code, good.text[:300])
    assert good.status_code == 200 and good.json().get("success") is True
    print("BACKEND_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
