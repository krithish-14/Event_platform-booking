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


from sqlalchemy.types import JSON as GenericJSON
from sqlalchemy.dialects.postgresql import JSONB


class JSONType(TypeDecorator):
    """Platform-independent JSON type. Uses PostgreSQL's JSONB type, otherwise generic JSON."""
    impl = GenericJSON
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(JSONB)
        return dialect.type_descriptor(GenericJSON)


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
                # Ensure customer_id column exists in SQLite
                s_cur.execute("PRAGMA table_info(users)")
                cols = [c[1] for c in s_cur.fetchall()]
                if "customer_id" not in cols:
                    s_cur.execute("ALTER TABLE users ADD COLUMN customer_id VARCHAR(100)")
                    s_conn.commit()
                s_cur.execute("SELECT id, customer_id, email, username, full_name, hashed_password, is_active, is_admin FROM users")
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
                    u_id, u_cust_id, u_email, u_name, u_full, u_hash, u_act, u_adm = row
                    if not u_cust_id or not str(u_cust_id).startswith("CUST-"):
                        import random
                        u_cust_id = f"CUST-{random.randint(100000, 999999)}"

                    pg_conn.execute(
                        text("""
                            INSERT INTO users (id, customer_id, email, username, full_name, hashed_password, is_active, is_admin, created_at, updated_at)
                            VALUES (:id, :customer_id, :email, :username, :full_name, :hashed_password, :is_active, :is_admin, NOW(), NOW())
                            ON CONFLICT (email) DO NOTHING
                        """),
                        {
                            "id": str(u_id),
                            "customer_id": str(u_cust_id),
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
    """Ensure all required columns exist on tables (adds missing columns if tables already existed) and backfill customer_id."""
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
                ("id", "UUID" if is_pg else "VARCHAR(36)"),
                ("customer_id", "VARCHAR(100)"),
                ("city", "VARCHAR(200)"),
                ("location_pin", "VARCHAR(20)"),
                ("location_pincode", "VARCHAR(20)"),
                ("latitude", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("longitude", "DOUBLE PRECISION" if is_pg else "FLOAT"),
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

                # Backfill users.id for rows missing internal GUID
                try:
                    refreshed_cols = {c["name"] for c in inspector.get_columns("users")}
                    if "id" in refreshed_cols:
                        if is_pg:
                            conn.execute(text("UPDATE users SET id = gen_random_uuid() WHERE id IS NULL;"))
                        else:
                            import uuid as _uuid
                            rows = conn.execute(text("SELECT customer_id FROM users WHERE id IS NULL OR id = ''")).fetchall()
                            for r in rows:
                                conn.execute(
                                    text("UPDATE users SET id = :uid WHERE customer_id = :cid"),
                                    {"uid": str(_uuid.uuid4()), "cid": r[0]}
                                )
                        conn.commit()
                except Exception as e:
                    print(f"  [DB MIGRATION WARN] Could not backfill users.id: {e}", flush=True)
                
                # Backfill missing or legacy customer_ids to CUST-<number> format
                try:
                    import random
                    if is_pg and "bookings" in tables:
                        try:
                            conn.execute(text("ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_customer_id_fkey;"))
                            conn.commit()
                        except Exception:
                            pass

                    rows = conn.execute(text("SELECT customer_id FROM users WHERE customer_id IS NULL OR customer_id = '' OR customer_id NOT LIKE 'CUST-%'")).fetchall()
                    for r in rows:
                        old_cid = r[0]
                        new_cust_id = f"CUST-{random.randint(100000, 999999)}"
                        conn.execute(
                            text("UPDATE users SET customer_id = :cid WHERE customer_id = :old_cid"),
                            {"cid": new_cust_id, "old_cid": old_cid}
                        )
                        if "bookings" in tables and old_cid:
                            conn.execute(
                                text("UPDATE bookings SET customer_id = :ncid WHERE customer_id = :ocid"),
                                {"ncid": new_cust_id, "ocid": old_cid}
                            )
                    conn.commit()
                    if rows:
                        print(f"  [DB MIGRATION] Backfilled customer_id (CUST-<number>) for {len(rows)} users.", flush=True)

                    if is_pg:
                        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_customer_id ON users (customer_id);"))
                        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);"))
                        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_lower ON users (lower(email));"))
                        conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username_lower ON users (lower(username));"))
                        conn.commit()
                    else:
                        try:
                            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email);"))
                            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_lower ON users (lower(email));"))
                            conn.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_username_lower ON users (lower(username));"))
                            conn.commit()
                        except Exception:
                            pass
                        if "bookings" in tables:
                            try:
                                conn.execute(text("""
                                    ALTER TABLE bookings 
                                    ADD CONSTRAINT bookings_customer_id_fkey 
                                    FOREIGN KEY (customer_id) REFERENCES users(customer_id) 
                                    ON DELETE CASCADE;
                                """))
                                conn.commit()
                            except Exception:
                                pass
                except Exception as e:
                    print(f"  [DB MIGRATION WARN] Could not backfill/index customer_id: {e}", flush=True)

                conn.commit()





        if "events" in tables:
            existing_cols = {c["name"] for c in inspector.get_columns("events")}
            event_migrations = [
                ("organizer_id", "UUID" if is_pg else "VARCHAR(36)"),
                ("customer_id", "VARCHAR(50)"),
                ("latitude", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("longitude", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("venue", "VARCHAR(300)"),
                ("event_format", "VARCHAR(100)"),
                ("duration", "VARCHAR(100)"),
                ("age_limit", "VARCHAR(50)"),
                ("language", "VARCHAR(100)"),
                ("performers", "TEXT"),
                ("highlights", "TEXT"),
                ("ticket_types", "TEXT"),
                ("terms", "TEXT"),
                ("host_id", "VARCHAR(50)"),
                ("customer_id", "VARCHAR(100)"),
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

        if "bookings" in tables:
            existing_cols = {c["name"] for c in inspector.get_columns("bookings")}
            booking_migrations = [
                ("ticket_type", "VARCHAR(100)"),
                ("quantity", "INTEGER"),
                ("total_price", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("status", "VARCHAR(50)"),
                ("payment_id", "VARCHAR(100)"),
                ("payment_mode", "VARCHAR(100)"),
                ("gst_amount", "DOUBLE PRECISION" if is_pg else "FLOAT"),
                ("seat_number", "VARCHAR(100)"),
                ("receiver_name", "VARCHAR(200)"),
                ("receiver_email", "VARCHAR(200)"),
                ("receiver_phone", "VARCHAR(50)"),
            ]
            with engine.connect() as conn:
                for col_name, col_type in booking_migrations:
                    if col_name not in existing_cols:
                        try:
                            if is_pg:
                                conn.execute(text(f"ALTER TABLE bookings ADD COLUMN IF NOT EXISTS {col_name} {col_type};"))
                            else:
                                conn.execute(text(f"ALTER TABLE bookings ADD COLUMN {col_name} {col_type};"))
                            print(f"  [DB MIGRATION] Added column bookings.{col_name}", flush=True)
                        except Exception as e:
                            print(f"  [DB MIGRATION WARN] Could not add column bookings.{col_name}: {e}", flush=True)
                conn.commit()

        if "organizer_accounts" in tables:
            existing_cols = {c["name"] for c in inspector.get_columns("organizer_accounts")}
            org_migrations = [
                ("rejection_reason", "TEXT"),
                ("submitted_at", "TIMESTAMP" if is_pg else "DATETIME"),
                ("verified_at", "TIMESTAMP" if is_pg else "DATETIME"),
                ("beneficiary_name", "VARCHAR(200)"),
                ("account_type", "VARCHAR(50)"),
                ("bank_name", "VARCHAR(150)"),
                ("account_number", "VARCHAR(50)"),
                ("bank_ifsc", "VARCHAR(20)"),
                ("pan_card_url", "VARCHAR(500)"),
                ("cancelled_cheque_url", "VARCHAR(500)"),
                ("pan_number", "VARCHAR(20)"),
                ("contact_full_name", "VARCHAR(200)"),
                ("contact_email", "VARCHAR(255)"),
                ("contact_mobile", "VARCHAR(20)"),
                ("org_name", "VARCHAR(255)"),
                ("host_id", "VARCHAR(50)"),
                ("customer_id", "VARCHAR(50)"),
                ("status", "VARCHAR(50)"),
            ]
            with engine.connect() as conn:
                for col_name, col_type in org_migrations:
                    if col_name not in existing_cols:
                        try:
                            if is_pg:
                                conn.execute(text(f"ALTER TABLE organizer_accounts ADD COLUMN IF NOT EXISTS {col_name} {col_type};"))
                            else:
                                conn.execute(text(f"ALTER TABLE organizer_accounts ADD COLUMN {col_name} {col_type};"))
                            print(f"  [DB MIGRATION] Added column organizer_accounts.{col_name}", flush=True)
                        except Exception as e:
                            print(f"  [DB MIGRATION WARN] Could not add column organizer_accounts.{col_name}: {e}", flush=True)
                conn.commit()

        if "event_management" in tables:
            existing_cols = {c["name"] for c in inspector.get_columns("event_management")}
            em_migrations = [
                ("host_id", "VARCHAR(50)"),
                ("customer_id", "VARCHAR(50)"),
                ("event_category", "VARCHAR(100)"),
                ("event_type", "VARCHAR(100)"),
                ("event_mode", "VARCHAR(100)"),
                ("event_start_date", "TIMESTAMP" if is_pg else "DATETIME"),
                ("event_end_date", "TIMESTAMP" if is_pg else "DATETIME"),
                ("event_start_time", "VARCHAR(50)"),
                ("event_end_time", "VARCHAR(50)"),
                ("venue", "VARCHAR(300)"),
                ("address", "TEXT"),
                ("organizer_name", "VARCHAR(200)"),
                ("organizer_phone", "VARCHAR(50)"),
                ("event_status", "VARCHAR(50)"),
                ("published_at", "TIMESTAMP" if is_pg else "DATETIME"),
                ("tickets_json", "JSON" if is_pg else "TEXT"),
                ("agenda_json", "JSON" if is_pg else "TEXT"),
            ]
            with engine.connect() as conn:
                for col_name, col_type in em_migrations:
                    if col_name not in existing_cols:
                        try:
                            if is_pg:
                                conn.execute(text(f"ALTER TABLE event_management ADD COLUMN IF NOT EXISTS {col_name} {col_type};"))
                            else:
                                conn.execute(text(f"ALTER TABLE event_management ADD COLUMN {col_name} {col_type};"))
                            print(f"  [DB MIGRATION] Added column event_management.{col_name}", flush=True)
                        except Exception as e:
                            print(f"  [DB MIGRATION WARN] Could not add column event_management.{col_name}: {e}", flush=True)
                conn.commit()
    except Exception as exc:
        print(f"  [WARN] Auto-migration check: {exc}", flush=True)


def _seed_demo_events():
    """Seed initial sample events with full details into events table."""
    import json
    from sqlalchemy import text
    engine = get_engine()
    try:
        with engine.connect() as conn:
            # Ensure an organizer user exists
            org_res = conn.execute(text("SELECT customer_id FROM users LIMIT 1")).fetchone()
            if org_res:
                org_id = str(org_res[0])
            else:
                org_id = "CUST-000001"
                conn.execute(
                    text("""
                        INSERT INTO users (customer_id, email, username, full_name, hashed_password, is_active, is_admin, created_at, updated_at)
                        VALUES (:cid, 'organizer@jodevents.com', 'jod_organizer', 'JOD Events Organizer', 'hashed_pass_placeholder', true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                        ON CONFLICT (email) DO NOTHING
                    """),
                    {"cid": org_id}
                )
                conn.commit()

            demo_events = [
                {
                    "id": "11111111-1111-1111-1111-111111111111",
                    "title": "VIR DAS - SOUNDS OF INDIA - CHENNAI",
                    "description": "Vir Das takes you across the nation in an immersive audio-visual stand-up comedy experience, where the vibrant sounds that we hear across India in our daily lives take us on a journey to celebrate the small nuances of our great nation. Through the symphony of sound International Emmy winning stand-up comedian Vir Das is back with his brand new global tour!",
                    "location": "Lady Andal School Campus, Harrington Rd, Chetpet, Chennai",
                    "venue": "Sir Mutha Venkatasubba Rao Concert Hall, Chennai",
                    "latitude": 13.0722,
                    "longitude": 80.2425,
                    "category": "Standup Comedy",
                    "image_url": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=1200&q=80",
                    "start_date": "2026-10-31 19:30:00",
                    "end_date": "2026-10-31 21:00:00",
                    "price": 1999.0,
                    "capacity": 1200,
                    "event_format": "In-person",
                    "duration": "1 hour 30 minutes",
                    "age_limit": "10yrs +",
                    "language": "English",
                    "performers": json.dumps([
                        {
                            "name": "Vir Das",
                            "role": "Comedian / Artist",
                            "image_url": "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=400&q=80"
                        }
                    ]),
                    "highlights": json.dumps([
                        {
                            "title": "International Emmy Award Winner",
                            "description": "Emmy-winning standup special performance",
                            "image_url": "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80"
                        },
                        {
                            "title": "Sold Out Global Arena Tour",
                            "description": "Performed across 35 countries worldwide",
                            "image_url": "https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=600&q=80"
                        },
                        {
                            "title": "Live Acoustic & Audio-Visual Production",
                            "description": "State-of-the-art stage surround sound",
                            "image_url": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80"
                        }
                    ]),
                    "ticket_types": json.dumps([
                        {"name": "Silver Access", "price": 1999, "availability": "Available"},
                        {"name": "Gold VIP", "price": 3499, "availability": "Filling Fast"},
                        {"name": "Front Row Fan Zone", "price": 5999, "availability": "Limited Seats"}
                    ]),
                    "terms": "1. Tickets are non-refundable.\n2. Age restriction: 10 years and above.\n3. Photography and recording strictly prohibited.\n4. Gates open 45 minutes prior to showtime.",
                    "is_published": True,
                    "is_cancelled": False,
                    "customer_id": org_id,
                },
                {
                    "id": "22222222-2222-2222-2222-222222222222",
                    "title": "Chennai Business Leaders Summit 2026",
                    "description": "The city's most anticipated corporate gathering bringing together CEOs, founders, venture capitalists, and industry innovators. Featuring keynote panels on AI transformation, sustainable growth, and global market expansion.",
                    "location": "No. 63, Mount Rd, Guindy, Chennai, Tamil Nadu 600032",
                    "venue": "ITC Grand Chola, Chennai",
                    "latitude": 13.0108,
                    "longitude": 80.2206,
                    "category": "Corporate Conference",
                    "image_url": "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=80",
                    "start_date": "2026-08-15 09:00:00",
                    "end_date": "2026-08-15 17:00:00",
                    "price": 4999.0,
                    "capacity": 800,
                    "event_format": "Hybrid",
                    "duration": "8 hours",
                    "age_limit": "18yrs +",
                    "language": "English",
                    "performers": json.dumps([
                        {
                            "name": "Dr. Aris Thorne",
                            "role": "Keynote Speaker & AI Strategist",
                            "image_url": "https://images.unsplash.com/photo-1560250097-0b93528c311a?auto=format&fit=crop&w=400&q=80"
                        },
                        {
                            "name": "Priya Sundaram",
                            "role": "Venture Partner & Tech Executive",
                            "image_url": "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=400&q=80"
                        }
                    ]),
                    "highlights": json.dumps([
                        {
                            "title": "Over 500+ C-Suite Executives",
                            "description": "Exclusive networking lounge and pitch session",
                            "image_url": "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=600&q=80"
                        }
                    ]),
                    "ticket_types": json.dumps([
                        {"name": "Virtual Pass", "price": 1499, "availability": "Available"},
                        {"name": "Standard Pass", "price": 4999, "availability": "Available"},
                        {"name": "VIP Executive Pass", "price": 9999, "availability": "Filling Fast"}
                    ]),
                    "terms": "1. Formal business attire required.\n2. ID card verification at entrance.\n3. Includes 5-star networking lunch.",
                    "is_published": True,
                    "is_cancelled": False,
                    "customer_id": org_id,
                },
                {
                    "id": "33333333-3333-3333-3333-333333333333",
                    "title": "BrandLaunchpad - Product Reveal Night",
                    "description": "An immersive launch experience for D2C brands, tech startups, and lifestyle innovations. Live product demos, VIP lounge access, exclusive brand gifting, and live acoustic music.",
                    "location": "Velachery Main Rd, Velachery, Chennai, Tamil Nadu 600042",
                    "venue": "Phoenix MarketCity, Chennai",
                    "latitude": 12.9958,
                    "longitude": 80.2170,
                    "category": "Product Launch",
                    "image_url": "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=1200&q=80",
                    "start_date": "2026-09-12 18:00:00",
                    "end_date": "2026-09-12 21:00:00",
                    "price": 1299.0,
                    "capacity": 500,
                    "event_format": "In-person",
                    "duration": "3 hours",
                    "age_limit": "16yrs +",
                    "language": "English",
                    "performers": json.dumps([
                        {
                            "name": "Ananya Roy",
                            "role": "Brand Ambassador & Content Creator",
                            "image_url": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80"
                        }
                    ]),
                    "highlights": json.dumps([
                        {
                            "title": "Interactive Tech Demos",
                            "description": "First look at flagship innovations",
                            "image_url": "https://images.unsplash.com/photo-1475721027785-f74eccf877e2?auto=format&fit=crop&w=600&q=80"
                        }
                    ]),
                    "ticket_types": json.dumps([
                        {"name": "Standard Access", "price": 1299, "availability": "Available"},
                        {"name": "VIP Gift Bag Pass", "price": 2499, "availability": "Filling Fast"}
                    ]),
                    "terms": "1. Entry subject to security check.\n2. Early arrival recommended.",
                    "is_published": True,
                    "is_cancelled": False,
                    "customer_id": org_id,
                },
                {
                    "id": "44444444-4444-4444-4444-444444444444",
                    "title": "The Royal Soiree - Signature Wedding Showcase",
                    "description": "Curated luxury ideas for couples planning an extraordinary celebration. Featuring bridal fashion walk, gourmet tasting session, decor concepts, and premier wedding planners.",
                    "location": "Adyar Sea Face, MRC Nagar, Raja Annamalaipuram, Chennai, Tamil Nadu 600028",
                    "venue": "Leela Palace, Chennai",
                    "latitude": 13.0067,
                    "longitude": 80.2546,
                    "category": "Wedding Showcase",
                    "image_url": "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=1200&q=80",
                    "start_date": "2026-10-05 11:00:00",
                    "end_date": "2026-10-05 17:00:00",
                    "price": 2499.0,
                    "capacity": 400,
                    "event_format": "In-person",
                    "duration": "6 hours",
                    "age_limit": "All ages",
                    "language": "English / Tamil",
                    "performers": json.dumps([
                        {
                            "name": "Manish Malhotra Design Team",
                            "role": "Couture & Runway Designers",
                            "image_url": "https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=400&q=80"
                        }
                    ]),
                    "highlights": json.dumps([
                        {
                            "title": "5-Star Gourmet & Runway Walk",
                            "description": "Exquisite bridal setup and menu tasting",
                            "image_url": "https://images.unsplash.com/photo-1519741497674-611481863552?auto=format&fit=crop&w=600&q=80"
                        }
                    ]),
                    "ticket_types": json.dumps([
                        {"name": "Couple Pass", "price": 2499, "availability": "Available"}
                    ]),
                    "terms": "1. Pass valid for 2 guests.\n2. Prior RSVP required.",
                    "is_published": True,
                    "is_cancelled": False,
                    "customer_id": org_id,
                },
                {
                    "id": "55555555-5555-5555-5555-555555555555",
                    "title": "Marina Cultural Fest",
                    "description": "A vibrant community celebration of music, street food, traditional arts, indie band performances, and cultural heritage by the beach.",
                    "location": "Marina Beach Promenade, Triplicane, Chennai, Tamil Nadu 600005",
                    "venue": "Marina Grounds, Chennai",
                    "latitude": 13.0500,
                    "longitude": 80.2824,
                    "category": "Cultural Festival",
                    "image_url": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=1200&q=80",
                    "start_date": "2026-11-22 15:00:00",
                    "end_date": "2026-11-22 22:00:00",
                    "price": 499.0,
                    "capacity": 3000,
                    "event_format": "In-person",
                    "duration": "7 hours",
                    "age_limit": "All ages",
                    "language": "Tamil & English",
                    "performers": json.dumps([
                        {
                            "name": "Thaikkudam Bridge",
                            "role": "Headliner Fusion Band",
                            "image_url": "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=400&q=80"
                        }
                    ]),
                    "highlights": json.dumps([
                        {
                            "title": "Open Air Oceanfront Stage",
                            "description": "Over 10,000 festival goers",
                            "image_url": "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80"
                        }
                    ]),
                    "ticket_types": json.dumps([
                        {"name": "General Admission", "price": 499, "availability": "Available"}
                    ]),
                    "terms": "1. Single entry pass.\n2. Plastic bottles strictly prohibited.",
                    "is_published": True,
                    "is_cancelled": False,
                    "customer_id": org_id,
                },
                {
                    "id": "66666666-6666-6666-6666-666666666666",
                    "title": "Makeup & Boutique Workshop",
                    "description": "An exclusive hands-on masterclass on professional makeup artistry, boutique styling, and fashion trends. Learn bridal glam, contouring techniques, saree draping, and boutique curation from industry-leading beauty master artists and fashion stylists.",
                    "location": "Express Avenue Mall, Royapettah, Chennai, Tamil Nadu 600014",
                    "venue": "Express Avenue, Chennai",
                    "latitude": 13.0600,
                    "longitude": 80.2635,
                    "category": "Workshop & Fashion",
                    "image_url": "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=1200&q=80",
                    "start_date": "2026-09-25 10:00:00",
                    "end_date": "2026-09-25 14:00:00",
                    "price": 499.0,
                    "capacity": 150,
                    "event_format": "In-person",
                    "duration": "4 hours",
                    "age_limit": "14yrs +",
                    "language": "English & Tamil",
                    "performers": json.dumps([
                        {
                            "name": "Ananya Sharma",
                            "role": "Master Makeup Artist & Educator",
                            "image_url": "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=400&q=80"
                        },
                        {
                            "name": "Ritu Kumar Studio Team",
                            "role": "Boutique & Couture Designers",
                            "image_url": "https://images.unsplash.com/photo-1583394838336-acd977736f90?auto=format&fit=crop&w=400&q=80"
                        }
                    ]),
                    "highlights": json.dumps([
                        {
                            "title": "Hands-on Makeup Masterclass",
                            "description": "Live interactive demonstration and professional kit showcase",
                            "image_url": "https://images.unsplash.com/photo-1487412720507-e7ab37603c6f?auto=format&fit=crop&w=600&q=80"
                        },
                        {
                            "title": "Boutique Styling & Draping",
                            "description": "Personalized styling advice and boutique trend guide",
                            "image_url": "https://images.unsplash.com/photo-1558769132-cb1aea458c5e?auto=format&fit=crop&w=600&q=80"
                        }
                    ]),
                    "ticket_types": json.dumps([
                        {"name": "Silver Access", "price": 499, "availability": "Available"},
                        {"name": "Gold VIP", "price": 999, "availability": "Filling Fast"},
                        {"name": "Front Row Fan Zone", "price": 1499, "availability": "Limited Seats"}
                    ]),
                    "terms": "1. Single entry pass per registrant.\n2. Practice makeup kits will be provided at the venue.\n3. Tickets are non-refundable.",
                    "is_published": True,
                    "is_cancelled": False,
                    "customer_id": org_id,
                }
            ]

            insert_sql = text("""
                INSERT INTO events (
                    id, title, description, location, venue, latitude, longitude,
                    category, image_url, start_date, end_date, price, capacity,
                    event_format, duration, age_limit, language, performers, highlights,
                    ticket_types, terms, is_published, is_cancelled, customer_id, created_at, updated_at
                ) VALUES (
                    :id, :title, :description, :location, :venue, :latitude, :longitude,
                    :category, :image_url, :start_date, :end_date, :price, :capacity,
                    :event_format, :duration, :age_limit, :language, :performers, :highlights,
                    :ticket_types, :terms, :is_published, :is_cancelled, :customer_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
                ) ON CONFLICT (id) DO NOTHING
            """)

            update_sql = text("""
                UPDATE events SET ticket_types = :ticket_types WHERE id = :id
            """)

            for ev in demo_events:
                conn.execute(insert_sql, ev)
                conn.execute(update_sql, {"id": ev["id"], "ticket_types": ev["ticket_types"]})
            conn.commit()
            print("  [DB SEED] Successfully seeded demo events into events table.", flush=True)

    except Exception as exc:
        print(f"  [DB SEED WARN] Could not seed demo events: {exc}", flush=True)


def create_tables():
    """Create all tables defined in models and sync users across DBs. Called on app startup."""
    import Models  # noqa: F401
    engine = get_engine()
    _migrate_tables(engine)
    Base.metadata.create_all(bind=engine)
    _sync_databases()
    _seed_demo_events()

