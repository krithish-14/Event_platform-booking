"""
Public event images on Cloudflare R2.

Object keys live next to existing static files, e.g.
  images/JOD Logo.png
  images/uploads/banner/<uuid>.jpg

Public URL:
  https://assets.jodevents.com/images/uploads/banner/<uuid>.jpg

KYC and payment screenshots stay in encrypted database storage.
"""

from __future__ import annotations

import logging
import os
import re
import uuid
from typing import Optional
from urllib.parse import quote

logger = logging.getLogger(__name__)

DEFAULT_PUBLIC_BASE = "https://assets.jodevents.com/images"
DEFAULT_OBJECT_PREFIX = "images"
_PURPOSE_RE = re.compile(r"^[a-z0-9_]{1,40}$")
_ENV_LOADED = False
_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/jpg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
}


def _load_env() -> None:
    global _ENV_LOADED
    if _ENV_LOADED:
        return
    try:
        from dotenv import load_dotenv
    except ImportError:
        _ENV_LOADED = True
        return
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    load_dotenv(os.path.join(backend_dir, ".env"))
    load_dotenv(os.path.join(os.path.dirname(backend_dir), ".env.production"))
    _ENV_LOADED = True


def public_base_url() -> str:
    _load_env()
    return (os.getenv("R2_PUBLIC_BASE_URL") or os.getenv("ASSETS_PUBLIC_BASE_URL") or DEFAULT_PUBLIC_BASE).rstrip("/")


def object_prefix() -> str:
    _load_env()
    raw = os.getenv("R2_OBJECT_PREFIX")
    if raw is None:
        return DEFAULT_OBJECT_PREFIX
    return raw.strip().strip("/")


def is_configured() -> bool:
    _load_env()
    account = (os.getenv("R2_ACCOUNT_ID") or "").strip()
    access = (os.getenv("R2_ACCESS_KEY_ID") or "").strip()
    secret = (os.getenv("R2_SECRET_ACCESS_KEY") or "").strip()
    bucket = (os.getenv("R2_BUCKET_NAME") or os.getenv("R2_BUCKET") or "").strip()
    return bool(account and access and secret and bucket)


def encode_key_url(relative_key: str) -> str:
    """Build a public HTTPS URL under the assets base (spaces become %20)."""
    parts = [quote(seg, safe="") for seg in str(relative_key or "").split("/") if seg]
    return public_base_url() + "/" + "/".join(parts)


def _safe_ext(filename: str, content_type: Optional[str]) -> str:
    name = (filename or "").lower()
    for ext in (".jpeg", ".jpg", ".png", ".webp"):
        if name.endswith(ext):
            return ".jpg" if ext == ".jpeg" else ext
    mime = (content_type or "").split(";")[0].strip().lower()
    return _EXT_BY_MIME.get(mime, ".jpg")


def _safe_purpose(purpose: str) -> str:
    value = re.sub(r"[^a-z0-9_]+", "_", (purpose or "file").strip().lower())
    if not _PURPOSE_RE.match(value):
        return "file"
    return value


def _safe_folder(value: Optional[str]) -> str:
    text = re.sub(r"[^a-zA-Z0-9_-]+", "", str(value or "").strip())
    return text[:80] or "host"


def relative_object_key(
    *,
    purpose: str,
    filename: str,
    content_type: Optional[str] = None,
    event_id: Optional[str] = None,
    owner_customer_id: Optional[str] = None,
    file_id: Optional[str] = None,
) -> str:
    folder = _safe_folder(event_id or owner_customer_id)
    name = (file_id or str(uuid.uuid4())).replace("-", "")
    ext = _safe_ext(filename, content_type)
    return f"uploads/{_safe_purpose(purpose)}/{folder}/{name}{ext}"


def object_key_for(relative_key: str) -> str:
    prefix = object_prefix()
    rel = "/".join(part for part in str(relative_key or "").split("/") if part)
    if not prefix:
        return rel
    if rel.startswith(prefix + "/"):
        return rel
    return f"{prefix}/{rel}"


def _client_and_bucket():
    _load_env()
    try:
        import boto3
        from botocore.config import Config
    except ImportError as exc:
        raise RuntimeError("boto3 is required to upload images to Cloudflare R2.") from exc

    account = (os.getenv("R2_ACCOUNT_ID") or "").strip()
    access = (os.getenv("R2_ACCESS_KEY_ID") or "").strip()
    secret = (os.getenv("R2_SECRET_ACCESS_KEY") or "").strip()
    bucket = (os.getenv("R2_BUCKET_NAME") or os.getenv("R2_BUCKET") or "").strip()
    if not (account and access and secret and bucket):
        raise RuntimeError("Cloudflare R2 is not configured.")

    cfg_kwargs = {
        "signature_version": "s3v4",
        "s3": {"addressing_style": "path"},
    }
    try:
        cfg = Config(
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            **cfg_kwargs,
        )
    except TypeError:
        cfg = Config(**cfg_kwargs)

    client = boto3.client(
        "s3",
        endpoint_url=f"https://{account}.r2.cloudflarestorage.com",
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="auto",
        config=cfg,
    )
    return client, bucket


def upload_public_image(
    *,
    data: bytes,
    filename: str,
    content_type: Optional[str] = None,
    purpose: str = "file",
    owner_customer_id: Optional[str] = None,
    event_id: Optional[str] = None,
) -> str:
    if not data:
        raise ValueError("Empty file.")
    relative = relative_object_key(
        purpose=purpose,
        filename=filename,
        content_type=content_type,
        event_id=event_id,
        owner_customer_id=owner_customer_id,
    )
    key = object_key_for(relative)
    mime = (content_type or "").split(";")[0].strip() or "application/octet-stream"
    client, bucket = _client_and_bucket()
    try:
        client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=mime,
            CacheControl="public, max-age=31536000, immutable",
        )
    except Exception as exc:
        logger.exception("Cloudflare R2 upload failed for key %s", key)
        raise RuntimeError("Could not store the image on Cloudflare R2. Try again in a moment.") from exc
    return encode_key_url(relative)
