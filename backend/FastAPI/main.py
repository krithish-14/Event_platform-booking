import os
import sys
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from APIs.auth import router as auth_router
from APIs.events import router as events_router
from APIs.users import router as users_router
from APIs.organizers import router as organizers_router
from APIs.forms import router as forms_router
from APIs.host_events_api import router as host_events_router
from Models.base import create_tables
from Models.user import User
from Models.event import Event


def safe_print(msg: str) -> None:
    """Print with fallback for Windows cp1252 / non-UTF-8 consoles."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        create_tables()
        safe_print("  [OK] Database tables ready.")
    except Exception as exc:
        safe_print(f"  [WARN] Could not connect to PostgreSQL: {exc}")
        safe_print("  [WARN] Auth/Events endpoints requiring the DB will 500 until Postgres is running.")
        safe_print("  [WARN] Create DB user with:  CREATE USER jod_user WITH PASSWORD 'jod_password'; CREATE DATABASE jod_events OWNER jod_user;")
    yield


app = FastAPI(
    title="JOD Events API",
    description="REST API for the JOD Events platform — manage events, users, and registrations.",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

# ── CORS ──────────────────────────────────────────────────────────────────────
allowed_origins_env = os.getenv("ALLOWED_ORIGINS", "")
origins = [o.strip() for o in allowed_origins_env.split(",") if o.strip()]
if not origins:
    origins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5500",
        "http://localhost:5500",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static Uploads ─────────────────────────────────────────────────────────────
from fastapi.staticfiles import StaticFiles
uploads_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(uploads_dir, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=uploads_dir), name="uploads")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router,       prefix="/api/auth",       tags=["Authentication"])
app.include_router(events_router,     prefix="/api/events",     tags=["Events"])
app.include_router(users_router,      prefix="/api/users",      tags=["Users"])
app.include_router(organizers_router, prefix="/api/organizers", tags=["Organizers"])
app.include_router(host_events_router, prefix="/api/host-events", tags=["Host Events"])
app.include_router(forms_router)


# ── Health Checks ─────────────────────────────────────────────────────────────
@app.get("/", tags=["Root"])
def root():
    return {"message": "JOD Events API is running 🚀", "docs": "/docs"}


@app.get("/health", tags=["Root"])
def health_check():
    return {"status": "healthy", "service": "JOD Events API"}
