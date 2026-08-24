from sqlalchemy import create_engine, text
import os
from dotenv import load_dotenv
load_dotenv()
url = (os.getenv("DATABASE_URL") or "").strip()
if not url:
    raise SystemExit("DATABASE_URL is required")
engine = create_engine(url)
with engine.connect() as conn:
    cols = conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'user_signups'")).fetchall()
    for c in cols:
        print(c[0])
