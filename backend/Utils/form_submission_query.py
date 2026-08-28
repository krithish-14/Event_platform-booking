"""Load attendee form_submissions without touching booking_id through the ORM.

Live PostgreSQL may store booking_id as uuid while older rows (or CHAR
columns) make SQLAlchemy Uuid + the Booking relationship abort the whole
SELECT. Payment proofs do not have that relationship, which is why the
payment tab still fills. Listing, analytics, and admin attendees must
never SELECT booking_id via the mapped column.
"""
import json
import logging
from types import SimpleNamespace
from typing import Any, List, Optional

from sqlalchemy import text
from sqlalchemy.orm import Session, defer, load_only, noload

from Models.form_submissions import FormSubmission

logger = logging.getLogger("jod")

_SAFE_COLUMNS = (
    FormSubmission.id,
    FormSubmission.form_id,
    FormSubmission.event_id,
    FormSubmission.customer_id,
    FormSubmission.user_email,
    FormSubmission.ticket_type,
    FormSubmission.ticket_price,
    FormSubmission.form_version,
    FormSubmission.answers_json,
    FormSubmission.status,
    FormSubmission.submission_time,
)


def event_id_compact(value: Any) -> str:
    return str(value or "").replace("-", "").lower().strip()


def parse_answers_json(raw: Any) -> dict:
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = raw.decode("utf-8")
        except Exception:
            return {}
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str) and raw.strip():
        try:
            data = json.loads(raw)
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}
    return {}


def _safe_rollback(db: Session) -> None:
    try:
        db.rollback()
    except Exception:
        pass


def _namespace_from_mapping(mapping: Any) -> SimpleNamespace:
    try:
        data = dict(mapping) if mapping is not None else {}
    except Exception:
        data = {}
    return SimpleNamespace(
        id=data.get("id"),
        form_id=data.get("form_id"),
        event_id=data.get("event_id"),
        customer_id=data.get("customer_id"),
        user_email=data.get("user_email"),
        ticket_type=data.get("ticket_type"),
        ticket_price=data.get("ticket_price"),
        form_version=data.get("form_version"),
        answers_json=parse_answers_json(data.get("answers_json")),
        status=data.get("status"),
        submission_time=data.get("submission_time"),
        booking_id=None,
        customer=None,
    )


def _sql_fetch_all(db: Session) -> List[Any]:
    statements = (
        """
        SELECT id, form_id, CAST(event_id AS TEXT) AS event_id, customer_id,
               user_email, ticket_type, ticket_price, form_version,
               answers_json, status, submission_time
        FROM form_submissions
        ORDER BY submission_time DESC NULLS LAST, id DESC
        """,
        """
        SELECT id, form_id, event_id, customer_id, user_email, ticket_type,
               ticket_price, form_version, answers_json, status, submission_time
        FROM form_submissions
        ORDER BY id DESC
        """,
    )
    for sql in statements:
        try:
            result = db.execute(text(sql))
            if hasattr(result, "mappings"):
                return [_namespace_from_mapping(row) for row in result.mappings().all()]
            keys = list(result.keys())
            return [_namespace_from_mapping(dict(zip(keys, row))) for row in result.fetchall()]
        except Exception:
            _safe_rollback(db)
    return []


def _orm_query(db: Session):
    return db.query(FormSubmission).options(
        load_only(*_SAFE_COLUMNS),
        defer(FormSubmission.booking_id),
        noload(FormSubmission.booking),
    )


def fetch_form_submissions(db: Session) -> List[Any]:
    """Return every attendee registration row, newest first when possible."""
    try:
        return (
            _orm_query(db)
            .order_by(FormSubmission.submission_time.desc(), FormSubmission.id.desc())
            .all()
        )
    except Exception:
        logger.exception("form_submissions_orm_list_failed")
        _safe_rollback(db)
        return _sql_fetch_all(db)


def form_submission_by_id(db: Session, submission_id: int) -> Optional[Any]:
    if submission_id is None:
        return None
    try:
        row = _orm_query(db).filter(FormSubmission.id == submission_id).first()
        if row is not None:
            return row
    except Exception:
        logger.exception("form_submissions_orm_get_failed")
        _safe_rollback(db)
    for row in _sql_fetch_all(db):
        if row.id == submission_id:
            return row
    return None


def form_submission_booking_id(db: Session, submission_id: Optional[int]) -> Optional[str]:
    if submission_id is None:
        return None
    try:
        row = db.execute(
            text("SELECT CAST(booking_id AS TEXT) FROM form_submissions WHERE id = :id"),
            {"id": submission_id},
        ).first()
        value = str(row[0]).strip() if row and row[0] is not None else ""
        if value and value.lower() not in ("none", "null"):
            return value
        return None
    except Exception:
        _safe_rollback(db)
        return None


def hydrate_customers(db: Session, rows: List[Any]) -> None:
    ids = [str(getattr(row, "customer_id", None) or "").strip() for row in rows]
    ids = [cid for cid in ids if cid]
    if not ids:
        return
    try:
        from Models.user import User
        users = db.query(User).filter(User.customer_id.in_(list(set(ids)))).all()
    except Exception:
        _safe_rollback(db)
        return
    by_id = {str(user.customer_id): user for user in users}
    for row in rows:
        cid = str(getattr(row, "customer_id", None) or "").strip()
        if cid and cid in by_id:
            try:
                row.customer = by_id[cid]
            except Exception:
                pass
