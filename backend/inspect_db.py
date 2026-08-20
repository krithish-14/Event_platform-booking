"""
Database inspection script — runs against the live PostgreSQL database.
"""
import os, sys
os.chdir('d:/JOD-Events/backend')
sys.path.insert(0, 'd:/JOD-Events/backend')
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text

DATABASE_URL = (os.getenv('DATABASE_URL') or '').strip()
if not DATABASE_URL:
    raise SystemExit('DATABASE_URL is required')
engine = create_engine(DATABASE_URL, connect_args={'connect_timeout': 5})

with engine.connect() as conn:
    # All tables
    tables = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")).fetchall()
    print("=== ALL TABLES ===")
    for t in tables:
        print(f"  {t[0]}")

    print()

    # For each table: columns + primary keys
    for (tname,) in tables:
        cols = conn.execute(text(f"""
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='{tname}'
            ORDER BY ordinal_position;
        """)).fetchall()
        pks = conn.execute(text(f"""
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_schema='public' AND tc.table_name='{tname}' AND tc.constraint_type='PRIMARY KEY';
        """)).fetchall()
        fks = conn.execute(text(f"""
            SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.table_schema='public' AND tc.table_name='{tname}' AND tc.constraint_type='FOREIGN KEY';
        """)).fetchall()
        row_count = conn.execute(text(f"SELECT COUNT(*) FROM {tname};")).scalar()
        print(f"=== TABLE: {tname} (rows: {row_count}) ===")
        pk_cols = [r[0] for r in pks]
        for c in cols:
            pk_flag = " [PK]" if c[0] in pk_cols else ""
            print(f"  {c[0]:<35} {c[1]:<30} nullable={c[2]}{pk_flag}")
        if fks:
            print("  FOREIGN KEYS:")
            for f in fks:
                print(f"    {f[0]} -> {f[1]}.{f[2]}")
        print()
