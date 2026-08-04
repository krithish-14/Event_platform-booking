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


def _sync_databases():
    """Sync user accounts between SQLite and PostgreSQL so logins never fail due to DB switching."""
    try:
        import sqlite3
        from sqlalchemy import text
        project_backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        sqlite_path = os.path.join(project_backend, "jod_events.db")
        
        # Connect to SQLite if it exists
        sqlite_users = []
        if os.path.exists(sqlite_path):
            try:
                s_conn = sqlite3.connect(sqlite_path)
                s_cur = s_conn.cursor()
                s_cur.execute("SELECT id, email, username, full_name, hashed_password, is_active, is_admin FROM users")
                sqlite_users = s_cur.fetchall()
                s_conn.close()
            except Exception:
                pass

        # Try connecting to PostgreSQL
        pg_engine = None
        try:
            db_url = DATABASE_URL
            if "postgresql" in db_url:
                pg_engine = create_engine(db_url, connect_args={"connect_timeout": 3})
                with pg_engine.connect() as conn:
                    pass
        except Exception:
            pg_engine = None

        if pg_engine and sqlite_users:
            with pg_engine.connect() as pg_conn:
                for row in sqlite_users:
                    u_id, u_email, u_name, u_full, u_hash, u_act, u_adm = row
                    pg_conn.execute(
                        text("""
                            INSERT INTO users (id, email, username, full_name, hashed_password, is_active, is_admin, created_at, updated_at)
                            VALUES (:id, :email, :username, :full_name, :hashed_password, :is_active, :is_admin, NOW(), NOW())
                            ON CONFLICT (email) DO UPDATE SET
                                hashed_password = EXCLUDED.hashed_password,
                                username = EXCLUDED.username
                        """),
                        {
                            "id": str(u_id),
                            "email": u_email,
                            "username": u_name,
                            "full_name": u_full,
                            "hashed_password": u_hash,
                            "is_active": bool(u_act),
                            "is_admin": bool(u_adm),
                        }
                    )
                pg_conn.commit()
    except Exception as exc:
        pass


def _migrate_tables(engine=None):
    """Ensure all required columns exist on tables (adds missing columns if tables already existed)."""
    if engine is None:
        engine = get_engine()
    from sqlalchemy import text, inspect
    try:
        inspector = inspect(engine)
        tables = inspector.get_table_names()
        is_pg = "postgresql" in engine.dialect.name

        if "users" in tables:
            existing_cols = {c["name"] for c in inspector.get_columns("users")}
            user_migrations = [
                ("city", "VARCHAR(200)"),
                ("location_pincode", "VARCHAR(20)"),
                ("location_lat", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("location_lon", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("bio", "TEXT"),
                ("avatar_url", "VARCHAR(500)"),
            ]
            with engine.connect() as conn:
                for col_name, col_type in user_migrations:
                    if col_name not in existing_cols:
                        try:
                            if is_pg:
                                conn.execute(text(f"ALTER TABLE users ADD COLUMN IF NOT EXISTS {col_name} {col_type};"))
                            else:
                                conn.execute(text(f"ALTER TABLE users ADD COLUMN {col_name} {col_type};"))
                            print(f"  [DB MIGRATION] Added column users.{col_name}", flush=True)
                        except Exception as e:
                            print(f"  [DB MIGRATION WARN] Could not add column users.{col_name}: {e}", flush=True)
                conn.commit()

        if "events" in tables:
            existing_cols = {c["name"] for c in inspector.get_columns("events")}
            event_migrations = [
                ("latitude", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("longitude", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("venue", "VARCHAR(300)"),
            ]
            with engine.connect() as conn:
                for col_name, col_type in event_migrations:
                    if col_name not in existing_cols:
                        try:
                            if is_pg:
                                conn.execute(text(f"ALTER TABLE events ADD COLUMN IF NOT EXISTS {col_name} {col_type};"))
                            else:
                                conn.execute(text(f"ALTER TABLE events ADD COLUMN {col_name} {col_type};"))
                            print(f"  [DB MIGRATION] Added column events.{col_name}", flush=True)
                        except Exception as e:
                            print(f"  [DB MIGRATION WARN] Could not add column events.{col_name}: {e}", flush=True)
                conn.commit()
    except Exception as exc:
        print(f"  [WARN] Auto-migration check: {exc}", flush=True)


def create_tables():
    """Create all tables defined in models and sync users across DBs. Called on app startup."""
    from Models.user import User  # noqa: F401
    from Models.event import Event  # noqa: F401
    engine = get_engine()
    Base.metadata.create_all(bind=engine)
    _migrate_tables(engine)
    _sync_databases()


