"""
Authentication service — password hashing and JWT token creation.

bcrypt only uses the first 72 bytes of a password. We reject longer passwords
at the application boundary so two different long passwords cannot silently
collide. Existing passwords of 72 bytes or fewer continue to verify normally.
"""

import bcrypt
from Authentication.jwt_handler import create_access_token  # re-export

_BCRYPT_MAX_BYTES = 72


class PasswordTooLongError(ValueError):
    """Raised when a password exceeds bcrypt's 72-byte input limit."""


def password_byte_length(password: str) -> int:
    try:
        return len(password.encode("utf-8"))
    except Exception:
        return len(password or "")


def assert_password_within_bcrypt_limit(password: str) -> str:
    """Reject passwords that would be silently truncated by bcrypt."""
    if password_byte_length(password) > _BCRYPT_MAX_BYTES:
        raise PasswordTooLongError(
            f"Password cannot exceed {_BCRYPT_MAX_BYTES} bytes. "
            "Use a shorter passphrase or a password manager entry under that limit."
        )
    return password


def _to_bytes(s: str) -> bytes:
    """Encode password for bcrypt. Callers must enforce the 72-byte limit first."""
    try:
        encoded = s.encode("utf-8")
    except UnicodeEncodeError:
        encoded = s.encode("utf-8", errors="ignore")
    if len(encoded) > _BCRYPT_MAX_BYTES:
        # Defense in depth — never silently truncate for new hashes/verifies.
        raise PasswordTooLongError(
            f"Password cannot exceed {_BCRYPT_MAX_BYTES} bytes."
        )
    return encoded


def get_password_hash(password: str) -> str:
    """Hash a plain-text password using bcrypt."""
    assert_password_within_bcrypt_limit(password)
    pw = _to_bytes(password)
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pw, salt)
    return hashed.decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plain-text password against a bcrypt hash."""
    if password_byte_length(plain_password) > _BCRYPT_MAX_BYTES:
        return False
    try:
        pw = _to_bytes(plain_password)
    except PasswordTooLongError:
        return False
    try:
        stored = hashed_password.encode("utf-8")
    except Exception:
        return False
    try:
        return bool(bcrypt.checkpw(pw, stored))
    except ValueError:
        return False
