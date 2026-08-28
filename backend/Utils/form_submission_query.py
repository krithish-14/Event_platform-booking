"""Load attendee form_submissions without touching booking_id through the ORM.

Live PostgreSQL may store booking_id as uuid while older rows (or CHAR
columns) make SQLAlchemy Uuid + the Booking relationship abort the whole
SELECT. Listing uses information_schema + raw SQL so a missing/renamed
column cannot empty the admin and host attendee tables.
"""
import logging
from types import SimpleNamespace
from typing import Any, List, Optional, Set

from sqlalchemy import text
from sqlalchemy.orm import Session

logger = logging.getLogger("jod")

_TIME_CANDIDATES = ("submission_time", "submitted_at", "created_at", "updated_at")
_ANSWER_CANDIDATES = ("answers_json", "answers", "response_json", "form_answers", "data")
_EMAIL_CANDIDATES = ("user_email", "attendee_email", "email")
_SKIP_COLUMNS = frozenset({"booking_id"})


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
            import json
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


def _table_columns(db: Session, table: str) -> Set[str]:
    statements = (
        "SELECT column_name FROM information_schema.columns "
        "WHERE table_schema = 'public' AND table_name = :t",
        "SELECT column_name FROM information_schema.columns WHERE table_name = :t",
    )
    for sql in statements:
        try:
            rows = db.execute(text(sql), {"t": table}).fetchall()
            cols = {str(row[0]).lower() for row in rows if row and row[0]}
            if cols:
                return cols
        except Exception:
            _safe_rollback(db)
    return set()


def _first_existing(columns: Set[str], candidates: tuple) -> Optional[str]:
    for name in candidates:
        if name in columns:
            return name
    return None


def _select_sql(columns: Set[str]) -> Optional[str]:
    if "id" not in columns:
        return None
    chunks = ["id"]

    def add(alias: str, source: Optional[str], cast_text: bool = False) -> None:
        if not source:
            chunks.append("NULL AS {0}".format(alias))
            return
        expr = "CAST({0} AS TEXT)".format(source) if cast_text else source
        if source == alias and not cast_text:
            chunks.append(source)
        else:
            chunks.append("{0} AS {1}".format(expr, alias))

    add("form_id", "form_id" if "form_id" in columns else None, cast_text=True)
    add("event_id", "event_id" if "event_id" in columns else None, cast_text=True)
    add("customer_id", "customer_id" if "customer_id" in columns else None, cast_text=True)
    add("user_email", _first_existing(columns, _EMAIL_CANDIDATES))
    add("ticket_type", "ticket_type" if "ticket_type" in columns else None)
    add("ticket_price", "ticket_price" if "ticket_price" in columns else None)
    add("form_version", "form_version" if "form_version" in columns else None)
    answers_col = _first_existing(columns, _ANSWER_CANDIDATES)
    add("answers_json", answers_col, cast_text=bool(answers_col))
    add("status", "status" if "status" in columns else None)
    time_col = _first_existing(columns, _TIME_CANDIDATES)
    add("submission_time", time_col)
    order_col = time_col or "id"
    return (
        "SELECT " + ", ".join(chunks) +
        " FROM form_submissions ORDER BY {0} DESC NULLS LAST, id DESC".format(order_col)
    )


def _namespace_from_mapping(mapping: Any) -> SimpleNamespace:
    try:
        data = dict(mapping) if mapping is not None else {}
    except Exception:
        data = {}
    form_id = data.get("form_id")
    try:
        if form_id is not None and str(form_id).isdigit():
            form_id = int(form_id)
    except Exception:
        pass
    return SimpleNamespace(
        id=data.get("id"),
        form_id=form_id,
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


def _rows_from_result(result) -> List[Any]:
    if hasattr(result, "mappings"):
        return [_namespace_from_mapping(row) for row in result.mappings().all()]
    keys = list(result.keys())
    return [_namespace_from_mapping(dict(zip(keys, row))) for row in result.fetchall()]


def _sql_fetch_all(db: Session) -> List[Any]:
    columns = _table_columns(db, "form_submissions")
    statements = []
    discovered = _select_sql(columns)
    if discovered:
        statements.append(discovered)
    statements.extend(
        (
            """
            SELECT id, CAST(form_id AS TEXT) AS form_id, CAST(event_id AS TEXT) AS event_id,
                   CAST(customer_id AS TEXT) AS customer_id, user_email, ticket_type, ticket_price,
                   form_version, CAST(answers_json AS TEXT) AS answers_json, status, submission_time
            FROM form_submissions
            ORDER BY submission_time DESC NULLS LAST, id DESC
            """,
            """
            SELECT id, CAST(form_id AS TEXT) AS form_id, CAST(event_id AS TEXT) AS event_id,
                   CAST(customer_id AS TEXT) AS customer_id, user_email, ticket_type, ticket_price,
                   form_version, CAST(answers_json AS TEXT) AS answers_json, status, submitted_at AS submission_time
            FROM form_submissions
            ORDER BY id DESC
            """,
            """
            SELECT id, user_email, status FROM form_submissions ORDER BY id DESC
            """,
        )
    )
    seen_sql = set()
    for sql in statements:
        key = " ".join(sql.split())
        if key in seen_sql:
            continue
        seen_sql.add(key)
        try:
            result = db.execute(text(sql))
            rows = _rows_from_result(result)
            logger.info("form_submissions_sql_list count=%s", len(rows))
            return rows
        except Exception:
            logger.exception("form_submissions_sql_list_failed")
            _safe_rollback(db)
    return []


def fetch_form_submissions(db: Session) -> List[Any]:
    """Return every attendee registration row as plain objects (not ORM)."""
    return _sql_fetch_all(db)


def form_submission_by_id(db: Session, submission_id: int) -> Optional[Any]:
    if submission_id is None:
        return None
    for row in _sql_fetch_all(db):
        try:
            if int(row.id) == int(submission_id):
                return row
        except Exception:
            if row.id == submission_id:
                return row
    return None


def form_submission_booking_id(db: Session, submission_id: Optional[int]) -> Optional[str]:
    if submission_id is None:
        return None
    statements = (
        "SELECT CAST(booking_id AS TEXT) FROM form_submissions WHERE id = :id",
        "SELECT booking_id FROM form_submissions WHERE id = :id",
    )
    for sql in statements:
        try:
            row = db.execute(text(sql), {"id": submission_id}).first()
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
