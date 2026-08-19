"""
Ensure the QR-generation admin account exists.

Default credentials (override with ADMIN_EMAIL / ADMIN_PASSWORD):
  email: admin@gmail.com
  password: Admin@123
"""

import os
import random
from sqlalchemy import func
from sqlalchemy.orm import Session

from Models.user import User
from Services.auth_service import get_password_hash


DEFAULT_ADMIN_EMAIL = "admin@gmail.com"
DEFAULT_ADMIN_PASSWORD = "Admin@123"
DEFAULT_ADMIN_USERNAME = "jod_admin"
DEFAULT_ADMIN_NAME = "JOD Admin"


def _safe_print(msg: str) -> None:
    try:
        print(msg, flush=True)
    except Exception:
        pass


def _unique_customer_id(db: Session) -> str:
    while True:
        cid = f"CUST-{random.randint(100000, 999999)}"
        if not db.query(User).filter(User.customer_id == cid).first():
            return cid


def seed_admin_user(db: Session) -> None:
    email = (os.getenv("ADMIN_EMAIL") or DEFAULT_ADMIN_EMAIL).strip().lower()
    password = os.getenv("ADMIN_PASSWORD") or DEFAULT_ADMIN_PASSWORD
    username = (os.getenv("ADMIN_USERNAME") or DEFAULT_ADMIN_USERNAME).strip()
    if not email or not password:
        return

    user = db.query(User).filter(func.lower(User.email) == email).first()
    hashed = get_password_hash(password)
    if user:
        changed = False
        if not user.is_admin:
            user.is_admin = True
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if user.hashed_password != hashed:
            user.hashed_password = hashed
            changed = True
        if not (user.full_name or "").strip():
            user.full_name = DEFAULT_ADMIN_NAME
            changed = True
        if changed:
            db.commit()
            _safe_print(f"  [OK] Admin account ready: {email}")
        return

    taken = db.query(User).filter(func.lower(User.username) == username.lower()).first()
    if taken:
        username = f"{username}_{random.randint(100, 999)}"

    user = User(
        customer_id=_unique_customer_id(db),
        email=email,
        username=username,
        full_name=DEFAULT_ADMIN_NAME,
        hashed_password=hashed,
        is_active=True,
        is_admin=True,
    )
    db.add(user)
    db.commit()
    _safe_print(f"  [OK] Created admin account: {email}")
