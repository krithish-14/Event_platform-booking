import os, sys
os.chdir('d:/JOD-Events/backend')
sys.path.insert(0, 'd:/JOD-Events/backend')
from dotenv import load_dotenv
load_dotenv()
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql+psycopg://jod_user:jod_password@localhost:5432/jod_events')
engine = create_engine(DATABASE_URL)

with engine.connect() as conn:
    tables = conn.execute(text("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename;")).fetchall()
    for (tname,) in tables:
        cols = conn.execute(text(f"SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='{tname}';")).fetchall()
        col_list = [c[0] for c in cols]
        user_related = [c for c in col_list if c in ['id', 'user_id', 'customer_id', 'organizer_id']]
        print(f"{tname:<30}: {user_related}")
