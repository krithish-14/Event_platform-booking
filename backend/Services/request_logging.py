"""Production-safe structured logging. Never log secrets, tokens, or KYC payloads."""

from __future__ import annotations

import json
import logging
import re
import sys
import uuid
from datetime import datetime, timezone

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response


_SECRET_QUERY = re.compile(
    r"(password|token|secret|authorization|api[_-]?key|otp)=([^&]+)",
    re.IGNORECASE,
)


class JsonLogFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        for key in ("request_id", "endpoint", "http_status", "error_type", "user_id", "booking_id"):
            value = getattr(record, key, None)
            if value not in (None, ""):
                payload[key] = value
        return json.dumps(payload, default=str)


def configure_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonLogFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)


def redact(value: str) -> str:
    return _SECRET_QUERY.sub(r"\1=[redacted]", value or "")


def new_request_id() -> str:
    return uuid.uuid4().hex[:16]


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next) -> Response:
        request_id = request.headers.get("x-request-id") or new_request_id()
        request.state.request_id = request_id
        path = request.url.path
        logger = logging.getLogger("jod")
        try:
            response = await call_next(request)
        except Exception:
            logger.exception(
                "unhandled_error",
                extra={"request_id": request_id, "endpoint": path, "error_type": "unhandled"},
            )
            raise
        response.headers["X-Request-ID"] = request_id
        status_code = response.status_code
        extra = {"request_id": request_id, "endpoint": path, "http_status": status_code}
        if status_code >= 500:
            logger.error("server_error", extra=extra)
        elif status_code in (401, 403) and path.startswith("/api/auth"):
            logger.warning("authentication_failure", extra=extra)
        elif path.startswith("/api/payments") and status_code >= 400:
            logger.warning("payment_failure", extra=extra)
        elif "ticket" in path and status_code >= 400:
            logger.warning("ticket_or_qr_failure", extra=extra)
        return response
