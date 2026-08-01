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
    "postgresql+psycopg://jod_user:jod_password@localhost:5432/jod_event"
)

import uuid
from sqlalchemy.types import TypeDecorator, CHAR
from sqlalchemy.dialects.postgresql import UUID as PG_UUID

Base = declarative_base()


class GUID(TypeDecorator):
    """Platform-independent GUID type. Uses PostgreSQL's UUID type, otherwise CHAR(36)."""
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        if dialect.name == "postgresql":
            return str(value)
        if isinstance(value, uuid.UUID):
            return str(value)
        return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        if not isinstance(value, uuid.UUID):
            return uuid.UUID(str(value))
        return value

# ── Lazy engine/session creation ─────────────────────────────
_engine = None
_SessionLocal = None
_init_lock = Lock()


def _ensure_engine():
    """Create engine + session factory on first actual DB access, falling back to SQLite if PostgreSQL is unreachable."""
    global _engine, _SessionLocal
    if _engine is not None:
        return _engine
    with _init_lock:
        if _engine is None:
            db_url = DATABASE_URL
            connect_args = {}
            if "sqlite" in db_url:
                connect_args = {"check_same_thread": False}
            elif "+psycopg" in db_url or "postgresql" in db_url:
                connect_args = {"connect_timeout": 3}

            engine_candidate = create_engine(
                db_url,
                pool_pre_ping=True,
                connect_args=connect_args,
            )
            if "postgresql" in db_url:
                try:
                    with engine_candidate.connect() as conn:
                        pass
                except Exception as err:
                    print(f"  [WARN] PostgreSQL unavailable ({err}). Falling back to SQLite database (jod_events.db)...", flush=True)
                    db_url = "sqlite:///./jod_events.db"
                    connect_args = {"check_same_thread": False}
                    engine_candidate = create_engine(
                        db_url,
                        pool_pre_ping=True,
                        connect_args=connect_args,
                    )
            _engine = engine_candidate
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
    Base.metadata.create_all(bind=get_engine())

