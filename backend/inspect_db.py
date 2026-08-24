"""
Database inspection script — runs against the live PostgreSQL database.
Development/admin utility only. Excluded from production Docker images.
"""
import os
import sys
import re

_BACKEND = os.path.dirname(os.path.abspath(__file__))
os.chdir(_BACKEND)
sys.path.insert(0, _BACKEND)
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text

DATABASE_URL = (os.getenv("DATABASE_URL") or "").strip()
if not DATABASE_URL:
    raise SystemExit("DATABASE_URL is required")
engine = create_engine(DATABASE_URL, connect_args={"connect_timeout": 5})

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_ident(name: str) -> str:
    if not _IDENT.match(name or ""):
        raise SystemExit(f"Refusing unsafe identifier: {name!r}")
    return name


with engine.connect() as conn:
    tables = conn.execute(
        text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
    ).fetchall()
    print("=== ALL TABLES ===")
    for t in tables:
        print(f"  {t[0]}")

    print()

    for (tname,) in tables:
        tname = _safe_ident(tname)
        cols = conn.execute(
            text(
                """
                SELECT column_name, data_type, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name=:tname
                ORDER BY ordinal_position
                """
            ),
            {"tname": tname},
        ).fetchall()
        pks = conn.execute(
            text(
                """
                SELECT kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                WHERE tc.table_schema='public'
                  AND tc.table_name=:tname
                  AND tc.constraint_type='PRIMARY KEY'
                """
            ),
            {"tname": tname},
        ).fetchall()
        fks = conn.execute(
            text(
                """
                SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                  ON tc.constraint_name = kcu.constraint_name
                 AND tc.table_schema = kcu.table_schema
                JOIN information_schema.constraint_column_usage ccu
                  ON ccu.constraint_name = tc.constraint_name
                 AND ccu.table_schema = tc.table_schema
                WHERE tc.table_schema='public'
                  AND tc.table_name=:tname
                  AND tc.constraint_type='FOREIGN KEY'
                """
            ),
            {"tname": tname},
        ).fetchall()
        print(f"=== {tname} ===")
        print(f"  PK: {[p[0] for p in pks]}")
        for c in cols:
            print(f"  - {c[0]}: {c[1]} null={c[2]} default={c[3]}")
        for fk in fks:
            print(f"  FK: {fk[0]} -> {fk[1]}.{fk[2]}")
        print()
