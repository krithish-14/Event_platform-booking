"""
Serve encrypted files from the database.
Public event media is readable by anyone.
KYC documents require the owner (or an admin).
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import Response
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user_optional
from Models.base import get_db
from Models.user import User
from Services.file_storage import can_access, decrypt_bytes, get_by_id, get_by_legacy_path

router = APIRouter(tags=["Media"])


def _file_response(stored, *, private: bool) -> Response:
    try:
        payload = decrypt_bytes(stored.encrypted_data)
    except ValueError:
        raise HTTPException(status_code=500, detail="Stored file could not be read.")
    headers = {
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store" if private or stored.is_private else "public, max-age=86400",
        "Content-Disposition": f'inline; filename="{(stored.original_filename or "file").replace(chr(34), "")}"',
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
    current_user: Optional[User] = Depends(get_current_user_optional),
):
    stored = get_by_id(db, file_id)
    if not stored:
        raise HTTPException(status_code=404, detail="File not found.")
    if not can_access(stored, current_user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to view this document.",
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
    if stored.is_private and not can_access(stored, current_user):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Sign in to view this document.",
        )
    return _file_response(stored, private=stored.is_private)
