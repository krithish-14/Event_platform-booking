"""
Schema dump utility — development/admin only. Excluded from production images.
Uses bound parameters for table names from information_schema.
"""
import os
import sys
import json
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
engine = create_engine(DATABASE_URL)

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _safe_ident(name: str) -> str:
    if not _IDENT.match(name or ""):
        raise SystemExit(f"Refusing unsafe identifier: {name!r}")
    return name


schema_data = {}

with engine.connect() as conn:
    tables = [
        r[0]
        for r in conn.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")
        ).fetchall()
    ]
    for tname in tables:
        tname = _safe_ident(tname)
        row_count = conn.execute(
            text(f'SELECT COUNT(*) FROM "{tname}"')
        ).scalar()
        cols = conn.execute(
            text(
                """
                SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name=:tname
                ORDER BY ordinal_position
                """
            ),
            {"tname": tname},
        ).fetchall()
        pks = [
            r[0]
            for r in conn.execute(
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
        ]
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

        schema_data[tname] = {
            "row_count": row_count,
            "primary_keys": pks,
            "columns": [
                {
                    "name": c[0],
                    "type": c[1],
                    "max_length": c[2],
                    "nullable": c[3],
                    "default": c[4],
                }
                for c in cols
            ],
            "foreign_keys": [
                {"column": fk[0], "ref_table": fk[1], "ref_column": fk[2]} for fk in fks
            ],
        }

out_path = os.path.join(_BACKEND, "schema_dump.json")
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(schema_data, f, indent=2, default=str)
print(f"Wrote {out_path}")
