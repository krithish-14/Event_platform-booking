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
from APIs.location import router as location_router
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
    origins = ["*"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins if "*" not in origins else ["*"],
    allow_credentials=True if "*" not in origins else False,
    allow_origin_regex=r"https?://.*" if "*" in origins else None,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Jinja2 Templates Integration ─────────────────────────────
from fastapi.templating import Jinja2Templates
from fastapi.staticfiles import StaticFiles
from fastapi.requests import Request
from fastapi.responses import HTMLResponse

frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
templates_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "templates"))
if not os.path.exists(templates_path):
    os.makedirs(templates_path, exist_ok=True)

templates = Jinja2Templates(directory=[templates_path, frontend_path])


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router,     prefix="/api/auth",     tags=["Authentication"])
app.include_router(events_router,   prefix="/api/events",   tags=["Events"])
app.include_router(users_router,    prefix="/api/users",    tags=["Users"])
app.include_router(location_router, prefix="/api/location", tags=["Location"])


# ── Health & Template Routes ───────────────────────────────────────────────────
@app.get("/", tags=["Root"])
def root():
    return {"message": "JOD Events API is running 🚀", "docs": "/docs"}


@app.get("/health", tags=["Root"])
def health_check():
    return {"status": "healthy", "service": "JOD Events API"}


@app.get("/templates/events", response_class=HTMLResponse, tags=["Jinja2 Templates"])
async def render_events_template(request: Request, city: str = "Chennai", radius_km: float = 20.0):
    """Render Jinja2 template showcasing 20km Haversine recommended events for a given city."""
    return templates.TemplateResponse(
        request=request,
        name="events_list.html",
        context={
            "city": city,
            "radius_km": radius_km,
            "app_title": "JOD Events — Recommended Near You",
        },
    )

