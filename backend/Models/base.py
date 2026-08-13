"""
Database engine, session factory, and SQLAlchemy base class.
All models import Base from here.
"""

import os
from threading import Lock
from sqlalchemy import create_engine
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker
from dotenv import load_dotenv

load_dotenv()

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://jod_user:jod_password@localhost:5432/jod_events"
)

Base = declarative_base()

# ── Lazy engine/session creation ─────────────────────────────
_engine = None
_SessionLocal = None
_init_lock = Lock()


def _ensure_engine():
    """Create engine + session factory on first actual DB access."""
    global _engine, _SessionLocal
    if _engine is not None:
        return _engine
    with _init_lock:
        if _engine is None:
            connect_args = {}
            if "+psycopg" in DATABASE_URL or "postgresql" in DATABASE_URL:
                connect_args = {"connect_timeout": 5}
            _engine = create_engine(
                DATABASE_URL,
                pool_pre_ping=True,
                connect_args=connect_args,
            )
            _SessionLocal = sessionmaker(
                autocommit=False, autoflush=False, bind=_engine
            )
    return _engine


def get_engine():
    """Public accessor for the engine."""
    return _ensure_engine()


def get_session_factory():
    """Public accessor for the session factory."""
    _ensure_engine()
    return _SessionLocal


# Module-level legacy accessors (evaluated on first attribute access)
def __getattr__(name):
    if name == "engine":
        return _ensure_engine()
    if name == "SessionLocal":
        _ensure_engine()
        return _SessionLocal
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def get_db():
    """FastAPI dependency — yields a DB session and closes it after the request."""
    SessionLocal = get_session_factory()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def create_tables():
    """Create all tables defined in models. Called on app startup."""
    from Models.user import User  # noqa: F401
    from Models.event import Event  # noqa: F401
    from Models.organizer import OrganizerAccount, EmailOTP  # noqa: F401
    from Models.form_builder import FormDefinition, FormSubmission  # noqa: F401
    from Models.audit_logs import UserSignupLog, UserLoginLog, HostRegistrationLog  # noqa: F401
    from Models.host_event import (  # noqa: F401
        EventManagement, EventDesign, EventRegistrationForm,
        EventRegistrationSettings, EventRegistrationTicket,
        EventRegistration, EventCommunication, EventAttendanceCheckin,
        Exhibitor, EventEntryGate, EventStaffScanner
    )
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
