"""
Create the admin account from environment variables.

Never ships a default password. Never overwrites an existing password unless
ADMIN_SYNC_PASSWORD=true (used for first-time local setup).
"""

import os
import random
from sqlalchemy import func
from sqlalchemy.orm import Session

from Models.user import User
from Services.auth_service import get_password_hash, verify_password
from Services.runtime_env import WEAK_PASSWORDS, is_production


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
    email = (os.getenv("ADMIN_EMAIL") or "").strip().lower()
    password = os.getenv("ADMIN_PASSWORD") or ""
    username = (os.getenv("ADMIN_USERNAME") or "jod_admin").strip()
    sync_password = os.getenv("ADMIN_SYNC_PASSWORD", "").strip().lower() in ("1", "true", "yes")

    if not email or not password:
        _safe_print("  [WARN] ADMIN_EMAIL and ADMIN_PASSWORD are required to seed an admin user.")
        return
    if password in WEAK_PASSWORDS:
        raise RuntimeError("ADMIN_PASSWORD is too weak. Choose a unique password.")
    if sync_password and is_production():
        raise RuntimeError(
            "ADMIN_SYNC_PASSWORD must be false in production. "
            "Reset an admin password through a controlled break-glass process, not on every boot."
        )
    user = db.query(User).filter(func.lower(User.email) == email).first()
    if user:
        changed = False
        if not user.is_admin:
            user.is_admin = True
            changed = True
        if not user.is_active:
            user.is_active = True
            changed = True
        if not (user.full_name or "").strip():
            user.full_name = DEFAULT_ADMIN_NAME
            changed = True
        wanted = (username or "").strip()
        if wanted and (user.username or "").lower() != wanted.lower():
            taken = db.query(User).filter(func.lower(User.username) == wanted.lower()).first()
            if taken and taken.id != user.id:
                taken.username = f"{taken.username}_{random.randint(100, 999)}"
                db.flush()
                changed = True
            user.username = wanted
            changed = True
        if sync_password and not verify_password(password, user.hashed_password or ""):
            user.hashed_password = get_password_hash(password)
            changed = True
        if changed:
            db.commit()
            _safe_print(f"  [OK] Admin account ready: {email}")
    else:
        taken = db.query(User).filter(func.lower(User.username) == username.lower()).first()
        if taken:
            username = f"{username}_{random.randint(100, 999)}"

        user = User(
            customer_id=_unique_customer_id(db),
            email=email,
            username=username,
            full_name=DEFAULT_ADMIN_NAME,
            hashed_password=get_password_hash(password),
            is_active=True,
            is_admin=True,
        )
        db.add(user)
        db.commit()
        _safe_print(f"  [OK] Created admin account: {email}")

    if email != "admin@gmail.com":
        legacy = db.query(User).filter(func.lower(User.email) == "admin@gmail.com").first()
        if legacy and legacy.is_admin:
            legacy.is_admin = False
            db.commit()
            _safe_print("  [OK] Removed admin role from the old default admin@gmail.com account.")
