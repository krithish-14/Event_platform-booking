"""
Serve encrypted files from the database.
Public event media is readable by anyone.
KYC documents require the owner (or an admin).
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.base import get_db
from Models.user import User
from Services.file_storage import can_access, decrypt_bytes, get_by_id, get_by_legacy_path

router = APIRouter(tags=["Media"])


def _safe_content_disposition(filename: str) -> str:
    # HTTP header values must be latin-1; strip quotes/control/non-ascii for filename=
    raw = (filename or "file").replace('"', "").replace("\r", "").replace("\n", "").strip() or "file"
    ascii_name = raw.encode("ascii", "ignore").decode("ascii").strip() or "file"
    ascii_name = "".join(ch if ch.isprintable() else "_" for ch in ascii_name)[:120] or "file"
    return f'inline; filename="{ascii_name}"'


def _file_response(stored, *, private: bool) -> Response:
    try:
        payload = decrypt_bytes(stored.encrypted_data)
    except ValueError:
        raise HTTPException(status_code=500, detail="Stored file could not be read.")
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store" if private or stored.is_private else "public, max-age=86400",
        "Content-Disposition": _safe_content_disposition(stored.original_filename or "file"),
        "Accept-Ranges": "bytes",
    }
    return Response(
        content=payload,
        media_type=stored.content_type or "application/octet-stream",
        headers=headers,
    )


@router.get("/api/media/{file_id}")
def get_public_media(file_id: str, db: Session = Depends(get_db)):
    stored = get_by_id(db, file_id)
    if not stored or stored.is_private:
        raise HTTPException(status_code=404, detail="File not found.")
    return _file_response(stored, private=False)


@router.get("/api/media/private/{file_id}")
def get_private_media(
    file_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stored = get_by_id(db, file_id)
    if not stored:
        raise HTTPException(status_code=404, detail="File not found.")
    if not can_access(stored, current_user):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to view this document.",
        )
    return _file_response(stored, private=True)


@router.get("/uploads/{filename}")
def get_legacy_upload(
    filename: str,
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    """Compatibility path for older /uploads/... URLs after files moved into the database."""
    stored = get_by_legacy_path(db, filename)
    if not stored:
        raise HTTPException(status_code=404, detail="File not found.")
    if stored.is_private:
        if current_user is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sign in to view this document.")
        if not can_access(stored, current_user):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not allowed to view this document.",
            )
        return _file_response(stored, private=True)
    return _file_response(stored, private=False)
