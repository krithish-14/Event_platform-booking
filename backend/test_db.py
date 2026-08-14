from sqlalchemy import create_engine, text
engine = create_engine('postgresql+psycopg://jod_user:jod_password@localhost:5432/jod_event')
with engine.connect() as conn:
    cols = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'user_signups'")).fetchall()
    for c in cols:
        print(c[0])
