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
    engine = get_engine()
    
    # Drop and recreate new event-related tables to ensure schema is up to date
    try:
        from sqlalchemy import text
        with engine.begin() as conn:
            # Drop new tables if they exist (so they can be recreated with latest schema)
            for table_name in ["event_attendance_checkins", "event_communications", "event_registration_tickets", 
                              "event_registration_settings", "event_registrations", "event_entry_gates", 
                              "event_staff_scanners", "exhibitors", "event_designs", "event_registration_forms", "event_managements"]:
                try:
                    conn.execute(text(f"DROP TABLE IF EXISTS {table_name} CASCADE;"))
                except Exception:
                    pass
    except Exception:
        pass
    
    Base.metadata.create_all(bind=engine)
    try:
        from sqlalchemy import text
        with engine.begin() as conn:
            conn.execute(text("ALTER TABLE users ADD COLUMN IF NOT EXISTS customer_id VARCHAR(50);"))
            conn.execute(text("ALTER TABLE organizer_accounts ADD COLUMN IF NOT EXISTS user_id UUID;"))
            conn.execute(text("ALTER TABLE organizer_accounts ADD COLUMN IF NOT EXISTS customer_id VARCHAR(50);"))
            conn.execute(text("ALTER TABLE organizer_accounts ADD COLUMN IF NOT EXISTS host_id VARCHAR(50);"))
            conn.execute(text("ALTER TABLE organizer_accounts ADD COLUMN IF NOT EXISTS gstin_number TEXT;"))
            conn.execute(text("ALTER TABLE organizer_accounts ADD COLUMN IF NOT EXISTS pan_card_url VARCHAR(500);"))
            conn.execute(text("ALTER TABLE organizer_accounts ADD COLUMN IF NOT EXISTS cancelled_cheque_url VARCHAR(500);"))
    except Exception:
        pass
