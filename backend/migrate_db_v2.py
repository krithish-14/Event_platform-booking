"""
migrate_db_v2.py — Complete Database Normalization to make customer_id the Primary Key of users
and remove all redundant id/user_id columns across user-related tables.
"""
import os
import sys

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg://jod_user:jod_password@localhost:5432/jod_events"
)
engine = create_engine(DATABASE_URL, connect_args={"connect_timeout": 5})


def col_exists(conn, table: str, column: str) -> bool:
    r = conn.execute(text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema='public' AND table_name=:t AND column_name=:c"
    ), {"t": table, "c": column}).fetchone()
    return r is not None


def constraint_exists(conn, name: str) -> bool:
    r = conn.execute(text(
        "SELECT 1 FROM information_schema.table_constraints "
        "WHERE constraint_schema='public' AND constraint_name=:n"
    ), {"n": name}).fetchone()
    return r is not None


def log(msg: str):
    print(f"  [MIGRATE V2] {msg}", flush=True)


def run():
    with engine.begin() as conn:
        # ── 1. Fix user_signups and user_logins customer_id values ───────────
        log("Step 1: Updating customer_id in user_signups and user_logins to match users.customer_id...")
        if col_exists(conn, "user_signups", "user_id"):
            conn.execute(text("""
                UPDATE user_signups us
                SET customer_id = u.customer_id
                FROM users u
                WHERE us.user_id = u.id;
            """))
        conn.execute(text("""
            UPDATE user_signups us
            SET customer_id = u.customer_id
            FROM users u
            WHERE LOWER(us.email) = LOWER(u.email);
        """))

        if col_exists(conn, "user_logins", "user_id"):
            conn.execute(text("""
                UPDATE user_logins ul
                SET customer_id = u.customer_id
                FROM users u
                WHERE ul.user_id = u.id;
            """))
        conn.execute(text("""
            UPDATE user_logins ul
            SET customer_id = u.customer_id
            FROM users u
            WHERE LOWER(ul.email) = LOWER(u.email);
        """))
        log("  Updated user_signups and user_logins customer_id values.")

        # ── 2. Update events table: replace organizer_id with customer_id ─────
        log("Step 2: Updating events table to reference customer_id...")
        if not col_exists(conn, "events", "customer_id"):
            conn.execute(text("ALTER TABLE events ADD COLUMN customer_id VARCHAR(50);"))
            log("  Added events.customer_id column.")

        if col_exists(conn, "events", "organizer_id"):
            conn.execute(text("""
                UPDATE events e
                SET customer_id = u.customer_id
                FROM users u
                WHERE e.organizer_id = u.id;
            """))
            # Drop any FK on organizer_id
            fk_names = conn.execute(text("""
                SELECT tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                WHERE tc.table_schema = 'public'
                  AND tc.table_name = 'events'
                  AND tc.constraint_type = 'FOREIGN KEY'
                  AND kcu.column_name = 'organizer_id';
            """)).fetchall()
            for (fk_name,) in fk_names:
                conn.execute(text(f'ALTER TABLE events DROP CONSTRAINT IF EXISTS "{fk_name}" CASCADE;'))
                log(f"  Dropped FK constraint {fk_name} on events.organizer_id.")

            conn.execute(text("ALTER TABLE events DROP COLUMN organizer_id CASCADE;"))
            log("  Dropped events.organizer_id column.")

        # ── 3. Drop user_id from user_signups and user_logins ────────────────
        log("Step 3: Dropping user_id from user_signups and user_logins...")
        for table in ["user_signups", "user_logins"]:
            if col_exists(conn, table, "user_id"):
                fk_names = conn.execute(text(f"""
                    SELECT tc.constraint_name
                    FROM information_schema.table_constraints tc
                    JOIN information_schema.key_column_usage kcu
                      ON tc.constraint_name = kcu.constraint_name
                    WHERE tc.table_schema = 'public'
                      AND tc.table_name = '{table}'
                      AND tc.constraint_type = 'FOREIGN KEY'
                      AND kcu.column_name = 'user_id';
                """)).fetchall()
                for (fk_name,) in fk_names:
                    conn.execute(text(f'ALTER TABLE {table} DROP CONSTRAINT IF EXISTS "{fk_name}" CASCADE;'))
                    log(f"  Dropped FK {fk_name} from {table}.")
                
                conn.execute(text(f"ALTER TABLE {table} DROP COLUMN user_id CASCADE;"))
                log(f"  Dropped {table}.user_id column.")

        # ── 4. Drop remaining FKs referencing users(id) ──────────────────────
        log("Step 4: Dropping any remaining FK constraints referencing users(id)...")
        all_fks = conn.execute(text("""
            SELECT tc.table_name, tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
            WHERE tc.table_schema = 'public'
              AND tc.constraint_type = 'FOREIGN KEY'
              AND ccu.table_name = 'users'
              AND ccu.column_name = 'id';
        """)).fetchall()
        for (tname, cname) in all_fks:
            conn.execute(text(f'ALTER TABLE "{tname}" DROP CONSTRAINT IF EXISTS "{cname}" CASCADE;'))
            log(f"  Dropped FK {cname} from {tname}.")

        # ── 5. Change users Primary Key to customer_id ───────────────────────
        log("Step 5: Changing users PRIMARY KEY to customer_id and dropping id column...")
        if col_exists(conn, "users", "id"):
            # Drop old PK constraint if exists
            pk_name = conn.execute(text("""
                SELECT constraint_name
                FROM information_schema.table_constraints
                WHERE table_schema = 'public'
                  AND table_name = 'users'
                  AND constraint_type = 'PRIMARY KEY';
            """)).scalar()
            if pk_name:
                conn.execute(text(f'ALTER TABLE users DROP CONSTRAINT "{pk_name}" CASCADE;'))
                log(f"  Dropped users PK constraint {pk_name}.")

            if constraint_exists(conn, "uq_users_customer_id"):
                conn.execute(text('ALTER TABLE users DROP CONSTRAINT uq_users_customer_id CASCADE;'))
                log("  Dropped temporary uq_users_customer_id constraint.")

            # Drop id column
            conn.execute(text("ALTER TABLE users DROP COLUMN id CASCADE;"))
            log("  Dropped users.id column.")

            # Add Primary Key constraint on customer_id
            conn.execute(text("ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (customer_id);"))
            log("  Set PRIMARY KEY (customer_id) on users table!")

        # ── 6. Add Foreign Key constraints referencing users(customer_id) ────
        log("Step 6: Adding Foreign Keys referencing users(customer_id)...")
        
        fk_map = [
            ("user_signups", "customer_id", "fk_user_signups_customer_id", "CASCADE"),
            ("user_logins", "customer_id", "fk_user_logins_customer_id", "CASCADE"),
            ("host_registration_logs", "customer_id", "fk_host_registration_logs_customer_id", "CASCADE"),
            ("organizer_accounts", "customer_id", "fk_organizer_accounts_customer_id", "CASCADE"),
            ("events", "customer_id", "fk_events_customer_id", "CASCADE"),
            ("event_management", "customer_id", "fk_event_management_customer_id", "SET NULL"),
        ]

        for table, col, fk_name, on_delete in fk_map:
            if col_exists(conn, table, col):
                # Ensure column is indexed
                idx_name = f"ix_{table}_{col}"
                conn.execute(text(f"CREATE INDEX IF NOT EXISTS {idx_name} ON {table}({col});"))
                
                if not constraint_exists(conn, fk_name):
                    # Check if any orphan values exist before adding FK
                    orphans = conn.execute(text(f"""
                        SELECT COUNT(*) FROM {table} t
                        LEFT JOIN users u ON t.{col} = u.customer_id
                        WHERE t.{col} IS NOT NULL AND u.customer_id IS NULL;
                    """)).scalar()
                    if orphans > 0:
                        log(f"  WARNING: {orphans} rows in {table}.{col} have no matching user — clearing orphans...")
                        conn.execute(text(f"UPDATE {table} SET {col} = NULL WHERE {col} NOT IN (SELECT customer_id FROM users);"))

                    conn.execute(text(f"""
                        ALTER TABLE {table}
                        ADD CONSTRAINT {fk_name}
                        FOREIGN KEY ({col}) REFERENCES users(customer_id)
                        ON UPDATE CASCADE ON DELETE {on_delete};
                    """))
                    log(f"  Added FK {fk_name} on {table}.{col} -> users(customer_id).")

    # ── 7. Validation ─────────────────────────────────────────────────────────
    log("Step 7: Validating final database schema...")
    with engine.connect() as conn:
        # Check users PK
        pk_cols = conn.execute(text("""
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_schema = 'public' AND tc.table_name = 'users' AND tc.constraint_type = 'PRIMARY KEY';
        """)).fetchall()
        pk_list = [r[0] for r in pk_cols]
        assert pk_list == ["customer_id"], f"FAIL: users PK is {pk_list}, expected ['customer_id']"
        log("  PASS: users table PRIMARY KEY is customer_id!")

        assert not col_exists(conn, "users", "id"), "FAIL: users.id column still exists!"
        log("  PASS: users.id column removed.")

        assert not col_exists(conn, "user_signups", "user_id"), "FAIL: user_signups.user_id still exists!"
        log("  PASS: user_signups.user_id column removed.")

        assert not col_exists(conn, "user_logins", "user_id"), "FAIL: user_logins.user_id still exists!"
        log("  PASS: user_logins.user_id column removed.")

        assert not col_exists(conn, "events", "organizer_id"), "FAIL: events.organizer_id still exists!"
        log("  PASS: events.organizer_id column removed.")

        assert col_exists(conn, "events", "customer_id"), "FAIL: events.customer_id missing!"
        log("  PASS: events.customer_id added and configured.")

        print("\n  =======================================================")
        print("   MIGRATION V2 COMPLETE — customer_id is PRIMARY KEY!")
        print("  =======================================================\n")


if __name__ == "__main__":
    run()
