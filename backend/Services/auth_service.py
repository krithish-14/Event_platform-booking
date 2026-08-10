"""
Authentication service — password hashing and JWT token creation.
"""

import bcrypt
from Authentication.jwt_handler import create_access_token   # re-export

_BCRYPT_MAX_BYTES = 72


def _to_bytes(s: str) -> bytes:
    """Encode string to bytes for bcrypt, truncating safely at 72 bytes."""
    try:
        encoded = s.encode("utf-8")
    except UnicodeEncodeError:
        encoded = s.encode("utf-8", errors="ignore")
    if len(encoded) > _BCRYPT_MAX_BYTES:
        encoded = encoded[:_BCRYPT_MAX_BYTES]
    return encoded


def get_password_hash(password: str) -> str:
    """Hash a plain-text password using bcrypt."""
    pw = _to_bytes(password)
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pw, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    pw = _to_bytes(plain_password)
    try:
        stored = hashed_password.encode("utf-8")
    except Exception:
        return False
    try:
        return bool(bcrypt.checkpw(pw, stored)) 
    except ValueError:
        return False
