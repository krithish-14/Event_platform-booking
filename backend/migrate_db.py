"""
migrate_db.py — Idempotent database normalization migration for JOD Events.

Phases:
  1. Backfill users.customer_id for any NULL rows
  2. Backfill user_logins.customer_id from users
  3. Backfill organizer_accounts.customer_id + host_id from users
  4. Drop user_id FK + column from organizer_accounts
  5. Drop user_id column from host_registration_logs
  6. Add NOT NULL + UNIQUE on users.customer_id
  7. Add NOT NULL + UNIQUE + FK on organizer_accounts.customer_id
  8. Add UNIQUE on organizer_accounts.host_id
  9. Add location columns to users and user_signups
 10. Run integrity validation
"""
import os
import sys
import random

os.chdir(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import create_engine, text

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL is required")
engine = create_engine(DATABASE_URL, connect_args={"connect_timeout": 5})


def generate_customer_id(used: set) -> str:
    while True:
        code = f"CUST-{random.randint(100000, 999999)}"
        if code not in used:
            used.add(code)
            return code


def generate_host_id(customer_id: str) -> str:
    if customer_id and customer_id.startswith("CUST-"):
        return "HST-" + customer_id[5:]
    import re
    m = re.search(r"\d{6}", customer_id or "")
    if m:
        return f"HST-{m.group(0)}"
    return f"HST-{random.randint(100000, 999999)}"


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


def index_exists(conn, name: str) -> bool:
    r = conn.execute(text(
        "SELECT 1 FROM pg_indexes WHERE schemaname='public' AND indexname=:n"
    ), {"n": name}).fetchone()
    return r is not None


def log(msg: str):
    print(f"  [MIGRATE] {msg}", flush=True)


def run():
    with engine.begin() as conn:

        # STEP 1: Backfill users.customer_id for NULLs
        log("Step 1: Backfilling NULL customer_id in users...")
        null_users = conn.execute(text(
            "SELECT id FROM users WHERE customer_id IS NULL OR customer_id = '';"
        )).fetchall()

        existing_cids = set(
            r[0] for r in conn.execute(text(
                "SELECT customer_id FROM users WHERE customer_id IS NOT NULL;"
            )).fetchall()
        )

        for (uid,) in null_users:
            cid = generate_customer_id(existing_cids)
            conn.execute(text(
                "UPDATE users SET customer_id = :cid WHERE id = :uid;"
            ), {"cid": cid, "uid": str(uid)})
            log(f"  Assigned {cid} to user {uid}")

        if null_users:
            log(f"  Backfilled {len(null_users)} user(s) with new customer_id.")
        else:
            log("  All users already have customer_id. OK.")

        # STEP 2: Backfill user_logins.customer_id from users
        log("Step 2: Backfilling NULL customer_id in user_logins...")
        if col_exists(conn, "user_logins", "user_id") and col_exists(conn, "user_logins", "customer_id"):
            updated = conn.execute(text("""
                UPDATE user_logins ul
                SET customer_id = u.customer_id
                FROM users u
                WHERE ul.user_id = u.id
                  AND (ul.customer_id IS NULL OR ul.customer_id = '');
            """)).rowcount
            log(f"  Backfilled {updated} login log row(s).")
        else:
            log("  Skipped (columns not present or already cleaned).")

        # STEP 3: Backfill organizer_accounts.customer_id + host_id
        log("Step 3: Backfilling organizer_accounts.customer_id and host_id...")
        if col_exists(conn, "organizer_accounts", "user_id"):
            updated = conn.execute(text("""
                UPDATE organizer_accounts oa
                SET customer_id = u.customer_id
                FROM users u
                WHERE oa.user_id = u.id
                  AND (oa.customer_id IS NULL OR oa.customer_id = '');
            """)).rowcount
            log(f"  Backfilled customer_id for {updated} organizer account(s) via user_id JOIN.")

        updated2 = conn.execute(text("""
            UPDATE organizer_accounts oa
            SET customer_id = u.customer_id
            FROM users u
            WHERE LOWER(oa.email) = LOWER(u.email)
              AND (oa.customer_id IS NULL OR oa.customer_id = '');
        """)).rowcount
        log(f"  Backfilled customer_id for {updated2} organizer account(s) via email match.")

        org_rows = conn.execute(text(
            "SELECT id, customer_id FROM organizer_accounts WHERE host_id IS NULL OR host_id = '';"
        )).fetchall()
        for (oid, cid) in org_rows:
            hid = generate_host_id(cid or "")
            conn.execute(text(
                "UPDATE organizer_accounts SET host_id = :hid WHERE id = :oid;"
            ), {"hid": hid, "oid": str(oid)})
            log(f"  Assigned host_id={hid} to organizer {oid}")

        log(f"  Backfilled host_id for {len(org_rows)} organizer account(s).")

        # STEP 4: Drop user_id FK + column from organizer_accounts
        log("Step 4: Removing user_id from organizer_accounts...")
        if col_exists(conn, "organizer_accounts", "user_id"):
            fk_names = conn.execute(text("""
                SELECT tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                WHERE tc.table_schema = 'public'
                  AND tc.table_name = 'organizer_accounts'
                  AND tc.constraint_type = 'FOREIGN KEY'
                  AND kcu.column_name = 'user_id';
            """)).fetchall()
            for (fk_name,) in fk_names:
                conn.execute(text(
                    f'ALTER TABLE organizer_accounts DROP CONSTRAINT IF EXISTS "{fk_name}";'
                ))
                log(f"  Dropped FK constraint: {fk_name}")

            idx_names = conn.execute(text("""
                SELECT indexname FROM pg_indexes
                WHERE schemaname = 'public'
                  AND tablename = 'organizer_accounts'
                  AND indexdef LIKE '%user_id%';
            """)).fetchall()
            for (idx_name,) in idx_names:
                conn.execute(text(f'DROP INDEX IF EXISTS "{idx_name}";'))
                log(f"  Dropped index: {idx_name}")

            conn.execute(text("ALTER TABLE organizer_accounts DROP COLUMN user_id;"))
            log("  Dropped organizer_accounts.user_id column.")
        else:
            log("  organizer_accounts.user_id already absent. OK.")

        # STEP 5: Drop user_id column from host_registration_logs
        log("Step 5: Removing user_id from host_registration_logs...")
        if col_exists(conn, "host_registration_logs", "user_id"):
            fk_names = conn.execute(text("""
                SELECT tc.constraint_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                WHERE tc.table_schema = 'public'
                  AND tc.table_name = 'host_registration_logs'
                  AND tc.constraint_type = 'FOREIGN KEY'
                  AND kcu.column_name = 'user_id';
            """)).fetchall()
            for (fk_name,) in fk_names:
                conn.execute(text(
                    f'ALTER TABLE host_registration_logs DROP CONSTRAINT IF EXISTS "{fk_name}";'
                ))
                log(f"  Dropped FK constraint: {fk_name}")

            conn.execute(text("ALTER TABLE host_registration_logs DROP COLUMN user_id;"))
            log("  Dropped host_registration_logs.user_id column.")
        else:
            log("  host_registration_logs.user_id already absent. OK.")

        # STEP 6: NOT NULL + UNIQUE on users.customer_id
        log("Step 6: Enforcing NOT NULL + UNIQUE on users.customer_id...")
        conn.execute(text("ALTER TABLE users ALTER COLUMN customer_id SET NOT NULL;"))
        log("  Set users.customer_id NOT NULL.")

        if not constraint_exists(conn, "uq_users_customer_id"):
            conn.execute(text(
                "ALTER TABLE users ADD CONSTRAINT uq_users_customer_id UNIQUE (customer_id);"
            ))
            log("  Added UNIQUE constraint uq_users_customer_id.")
        else:
            log("  UNIQUE constraint uq_users_customer_id already exists. OK.")

        # STEP 7: NOT NULL + UNIQUE + FK on organizer_accounts.customer_id
        log("Step 7: Enforcing constraints on organizer_accounts.customer_id...")
        null_orgs = conn.execute(text(
            "SELECT COUNT(*) FROM organizer_accounts WHERE customer_id IS NULL;"
        )).scalar()

        if null_orgs == 0:
            if not constraint_exists(conn, "uq_organizer_accounts_customer_id"):
                conn.execute(text(
                    "ALTER TABLE organizer_accounts ADD CONSTRAINT uq_organizer_accounts_customer_id UNIQUE (customer_id);"
                ))
                log("  Added UNIQUE constraint on organizer_accounts.customer_id.")
            else:
                log("  UNIQUE constraint on organizer_accounts.customer_id already exists. OK.")

            if not constraint_exists(conn, "fk_organizer_accounts_customer_id"):
                conn.execute(text(
                    "ALTER TABLE organizer_accounts ADD CONSTRAINT fk_organizer_accounts_customer_id "
                    "FOREIGN KEY (customer_id) REFERENCES users(customer_id) ON UPDATE CASCADE ON DELETE SET NULL;"
                ))
                log("  Added FK organizer_accounts.customer_id -> users.customer_id.")
            else:
                log("  FK fk_organizer_accounts_customer_id already exists. OK.")
        else:
            log(f"  WARNING: {null_orgs} organizer account(s) still have NULL customer_id.")

        # STEP 8: UNIQUE on organizer_accounts.host_id
        log("Step 8: Enforcing UNIQUE on organizer_accounts.host_id...")
        null_host = conn.execute(text(
            "SELECT COUNT(*) FROM organizer_accounts WHERE host_id IS NULL;"
        )).scalar()

        if null_host == 0:
            if not constraint_exists(conn, "uq_organizer_accounts_host_id"):
                conn.execute(text(
                    "ALTER TABLE organizer_accounts ADD CONSTRAINT uq_organizer_accounts_host_id UNIQUE (host_id);"
                ))
                log("  Added UNIQUE constraint on organizer_accounts.host_id.")
            else:
                log("  UNIQUE constraint on organizer_accounts.host_id already exists. OK.")
        else:
            log(f"  WARNING: {null_host} organizer account(s) have NULL host_id.")

        # STEP 9: Add location columns to users and user_signups
        log("Step 9: Adding location columns...")
        for table in ["users", "user_signups"]:
            for col, dtype in [
                ("city", "VARCHAR(150)"),
                ("location_pin", "VARCHAR(20)"),
                ("latitude", "DECIMAL(10,8)"),
                ("longitude", "DECIMAL(11,8)"),
            ]:
                if not col_exists(conn, table, col):
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {dtype};"))
                    log(f"  Added {table}.{col} ({dtype}).")
                else:
                    log(f"  {table}.{col} already exists. OK.")

        # STEP 10: Indexes
        log("Step 10: Ensuring indexes on organizer_accounts...")
        if not index_exists(conn, "ix_organizer_accounts_customer_id"):
            conn.execute(text(
                "CREATE INDEX ix_organizer_accounts_customer_id ON organizer_accounts(customer_id);"
            ))
            log("  Created index ix_organizer_accounts_customer_id.")
        if not index_exists(conn, "ix_organizer_accounts_host_id"):
            conn.execute(text(
                "CREATE INDEX ix_organizer_accounts_host_id ON organizer_accounts(host_id);"
            ))
            log("  Created index ix_organizer_accounts_host_id.")

    # STEP 11: Validation
    log("Step 11: Running integrity validation...")
    with engine.connect() as conn:
        n = conn.execute(text("SELECT COUNT(*) FROM users WHERE customer_id IS NULL;")).scalar()
        assert n == 0, f"FAIL: {n} users have NULL customer_id"
        log("  PASS: All users have customer_id.")

        dups = conn.execute(text(
            "SELECT customer_id, COUNT(*) c FROM users GROUP BY customer_id HAVING COUNT(*) > 1;"
        )).fetchall()
        assert len(dups) == 0, f"FAIL: Duplicate customer_ids in users: {dups}"
        log("  PASS: All users have unique customer_id.")

        orphan_orgs = conn.execute(text("""
            SELECT COUNT(*) FROM organizer_accounts oa
            LEFT JOIN users u ON oa.customer_id = u.customer_id
            WHERE u.customer_id IS NULL AND oa.customer_id IS NOT NULL;
        """)).scalar()
        assert orphan_orgs == 0, f"FAIL: {orphan_orgs} organizer accounts reference non-existent users"
        log("  PASS: All organizer accounts reference valid users.")

        dup_hosts = conn.execute(text(
            "SELECT host_id, COUNT(*) c FROM organizer_accounts WHERE host_id IS NOT NULL GROUP BY host_id HAVING COUNT(*) > 1;"
        )).fetchall()
        assert len(dup_hosts) == 0, f"FAIL: Duplicate host_ids: {dup_hosts}"
        log("  PASS: All organizer host_ids are unique.")

        assert not col_exists(conn, "organizer_accounts", "user_id"), \
            "FAIL: organizer_accounts.user_id still exists!"
        log("  PASS: organizer_accounts.user_id removed.")

        assert not col_exists(conn, "host_registration_logs", "user_id"), \
            "FAIL: host_registration_logs.user_id still exists!"
        log("  PASS: host_registration_logs.user_id removed.")

        for table in ["users", "user_signups"]:
            for col in ["city", "location_pin", "latitude", "longitude"]:
                assert col_exists(conn, table, col), f"FAIL: {table}.{col} missing!"
        log("  PASS: All location columns present.")

        users_count = conn.execute(text("SELECT COUNT(*) FROM users;")).scalar()
        org_count = conn.execute(text("SELECT COUNT(*) FROM organizer_accounts;")).scalar()
        event_count = conn.execute(text("SELECT COUNT(*) FROM event_management;")).scalar()

        print("\n  ============================")
        print("   MIGRATION COMPLETE!")
        print(f"   users: {users_count}")
        print(f"   organizer_accounts: {org_count}")
        print(f"   event_management rows: {event_count}")
        print("  ============================\n")


if __name__ == "__main__":
    run()
