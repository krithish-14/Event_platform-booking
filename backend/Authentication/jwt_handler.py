"""
JWT token handler — encode and decode access tokens.
Algorithm is fixed to HS256 (not attacker-controllable via env).
"""

import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from jwt.exceptions import InvalidTokenError
from dotenv import load_dotenv

from Services.runtime_env import require_strong_secret

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))

SECRET_KEY = require_strong_secret(os.getenv("SECRET_KEY"), "SECRET_KEY")
# Fixed algorithm — ignore JWT_ALGORITHM env to prevent algorithm confusion.
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
AUTH_COOKIE_NAME = "jod_access_token"
JWT_ISSUER = (os.getenv("JWT_ISSUER") or "jod-events").strip()
JWT_AUDIENCE = (os.getenv("JWT_AUDIENCE") or "jod-events-api").strip()


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    """
    Create a signed JWT access token.

    Args:
        data: Payload to encode (must include `sub` claim).
        expires_delta: Token lifetime. Defaults to ACCESS_TOKEN_EXPIRE_MINUTES.

    Returns:
        Encoded JWT string.
    """
    to_encode = data.copy()
    now = datetime.now(timezone.utc)
    expire = now + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({
        "exp": expire,
        "iat": now,
        "iss": JWT_ISSUER,
        "aud": JWT_AUDIENCE,
        "jti": secrets.token_urlsafe(16),
    })
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> Optional[dict]:
    """
    Decode and verify a JWT token (signature, exp, iss, aud).

    Returns:
        Decoded payload dict, or None if invalid/expired.
    """
    try:
        return jwt.decode(
            token,
            SECRET_KEY,
            algorithms=[ALGORITHM],
            issuer=JWT_ISSUER,
            audience=JWT_AUDIENCE,
            options={"require": ["exp", "iss", "aud", "sub"]},
        )
    except InvalidTokenError:
        return None
