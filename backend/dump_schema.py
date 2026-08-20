import os, sys, json
os.chdir('d:/JOD-Events/backend')
sys.path.insert(0, 'd:/JOD-Events/backend')
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text

DATABASE_URL = (os.getenv('DATABASE_URL') or '').strip()
if not DATABASE_URL:
    raise SystemExit('DATABASE_URL is required')
engine = create_engine(DATABASE_URL)

schema_data = {}

with engine.connect() as conn:
    tables = [r[0] for r in conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")).fetchall()]
    for tname in tables:
        row_count = conn.execute(text(f'SELECT COUNT(*) FROM "{tname}";')).scalar()
        cols = conn.execute(text(f"""
            SELECT column_name, data_type, character_maximum_length, is_nullable, column_default
            FROM information_schema.columns
            WHERE table_schema='public' AND table_name='{tname}'
            ORDER BY ordinal_position;
        """)).fetchall()
        pks = [r[0] for r in conn.execute(text(f"""
            SELECT kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            WHERE tc.table_schema='public' AND tc.table_name='{tname}' AND tc.constraint_type='PRIMARY KEY';
        """)).fetchall()]
        fks = conn.execute(text(f"""
            SELECT kcu.column_name, ccu.table_name AS foreign_table, ccu.column_name AS foreign_column
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
            JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
            WHERE tc.table_schema='public' AND tc.table_name='{tname}' AND tc.constraint_type='FOREIGN KEY';
        """)).fetchall()
        
        schema_data[tname] = {
            'row_count': row_count,
            'pks': pks,
            'fks': [{'col': f[0], 'target_table': f[1], 'target_col': f[2]} for f in fks],
            'columns': [
                {
                    'name': c[0],
                    'type': c[1] + (f'({c[2]})' if c[2] else ''),
                    'nullable': c[3],
                    'default': str(c[4]) if c[4] is not None else None
                }
                for c in cols
            ]
        }

with open('schema_dump.json', 'w') as f:
    json.dump(schema_data, f, indent=2)

print('Dumped schema to schema_dump.json successfully!')
