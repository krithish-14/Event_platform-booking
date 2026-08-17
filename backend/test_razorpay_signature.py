"""HMAC-SHA256 Razorpay signature verification (no live Razorpay calls)."""

import hashlib
import hmac
import os
import sys

BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
if BACKEND_DIR not in sys.path:
    sys.path.insert(0, BACKEND_DIR)

from Services.payment_service import verify_razorpay_signature


def test_valid_signature():
    secret = "test_key_secret"
    order_id = "order_ABC123"
    payment_id = "pay_XYZ789"
    expected = hmac.new(
        secret.encode("utf-8"),
        f"{order_id}|{payment_id}".encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()
    assert verify_razorpay_signature(order_id, payment_id, expected, secret) is True


def test_invalid_signature():
    assert verify_razorpay_signature("order_1", "pay_1", "not-a-real-signature", "secret") is False


def test_tampered_payment_id_fails():
    secret = "test_key_secret"
    expected = hmac.new(secret.encode("utf-8"), b"order_1|pay_1", hashlib.sha256).hexdigest()
    assert verify_razorpay_signature("order_1", "pay_TAMPERED", expected, secret) is False


if __name__ == "__main__":
    test_valid_signature()
    test_invalid_signature()
    test_tampered_payment_id_fails()
    print("Razorpay signature tests passed.")
