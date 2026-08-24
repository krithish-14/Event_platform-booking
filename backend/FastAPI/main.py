import logging
import os
import sys
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.trustedhost import TrustedHostMiddleware
from uvicorn.middleware.proxy_headers import ProxyHeadersMiddleware

from Services.runtime_env import (
    allowed_hosts,
    cors_origins,
    docs_enabled,
    is_production,
    is_staging,
    validate_production_env,
)
from Services.request_logging import RequestContextMiddleware, configure_logging
from Services.csrf import CookieCsrfMiddleware

_BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(_BACKEND_DIR, ".env"))
APP_VERSION = os.getenv("APP_VERSION", "1.0.0")
configure_logging()

from APIs.auth import router as auth_router
from APIs.events import router as events_router
from APIs.users import router as users_router
from APIs.location import router as location_router
from APIs.bookings import router as bookings_router
from APIs.tickets import router as tickets_router
from APIs.organizers import router as organizers_router
from APIs.forms import router as forms_router
from APIs.host_events_api import router as host_events_router
from APIs.wishlist import router as wishlist_router
from APIs.media import router as media_router
from APIs.support import router as support_router
from APIs.notifications import router as notifications_router
from APIs.volunteers import router as volunteers_router
from APIs.admin import router as admin_router
from APIs.payments import router as payments_router
from Models.base import create_tables
from Models.user import User
from Models.event import Event
from Models.booking import Booking
from Models.ticket import Ticket


def safe_print(msg: str) -> None:
    """Print with fallback for Windows cp1252 / non-UTF-8 consoles."""
    try:
        print(msg, flush=True)
    except UnicodeEncodeError:
        sys.stdout.buffer.write((msg + "\n").encode("utf-8", errors="replace"))
        sys.stdout.buffer.flush()


@asynccontextmanager
async def lifespan(app: FastAPI):
    validate_production_env()
    create_tables()
    safe_print("  [OK] Database tables ready.")
    try:
        from Services.file_storage import migrate_disk_uploads
        moved = migrate_disk_uploads()
        if moved:
            safe_print(f"  [OK] Moved {moved} upload file(s) into encrypted database storage.")
    except Exception as migrate_exc:
        safe_print(f"  [WARN] Could not migrate disk uploads into the database: {migrate_exc}")
    from Models.base import get_session_factory
    from Services.admin_seed import seed_admin_user
    session_factory = get_session_factory()
    seed_db = session_factory()
    try:
        seed_admin_user(seed_db)
    finally:
        seed_db.close()
    yield


_docs = "/docs" if docs_enabled() else None
app = FastAPI(
    title="JOD Events API",
    description="REST API for the JOD Events platform — manage events, users, and registrations.",
    version="1.0.0",
    docs_url=_docs,
    redoc_url="/redoc" if _docs else None,
    openapi_url="/openapi.json" if _docs else None,
    lifespan=lifespan,
)

origins = cors_origins() + ["https://jodevents.com"]
app.add_middleware(RequestContextMiddleware)
app.add_middleware(CookieCsrfMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(ProxyHeadersMiddleware, trusted_hosts="*")
_hosts = allowed_hosts()
if is_production() and _hosts and _hosts != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=_hosts)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    if is_production() or is_staging():
        return JSONResponse(status_code=422, content={"detail": "Invalid request."})
    return JSONResponse(status_code=422, content={"detail": exc.errors()})


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    if isinstance(exc, HTTPException):
        raise exc
    logging.getLogger("jod").exception(
        "unhandled_error",
        extra={"endpoint": request.url.path, "error_type": type(exc).__name__},
    )
    detail = "Internal server error."
    if not is_production() and not is_staging():
        detail = str(exc) or detail
    return JSONResponse(status_code=500, content={"detail": detail})


# Pragmatic production CSP for the static MPA (inline scripts still required).
# Blocks foreign script hosts and plugins; does not replace XSS escaping.
_CSP = (
    "default-src 'self'; "
    "base-uri 'self'; "
    "form-action 'self'; "
    "frame-ancestors 'self'; "
    "object-src 'none'; "
    "script-src 'self' 'unsafe-inline' https://accounts.google.com https://apis.google.com; "
    "style-src 'self' 'unsafe-inline'; "
    "img-src 'self' data: blob: https:; "
    "font-src 'self' data:; "
    "connect-src 'self' https://accounts.google.com https://oauth2.googleapis.com; "
    "frame-src https://accounts.google.com; "
    "worker-src 'self' blob:"
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(), geolocation=(self)"
    if is_production() or is_staging():
        response.headers["Content-Security-Policy"] = _CSP
    if is_production():
        response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
    return response

# ── Templates ─────────────────────────────────────────────────
from fastapi.templating import Jinja2Templates
from fastapi.responses import HTMLResponse

frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
templates_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "templates"))
if not os.path.exists(templates_path):
    os.makedirs(templates_path, exist_ok=True)

_template_dirs = [templates_path]
if os.path.isdir(frontend_path):
    _template_dirs.append(frontend_path)
templates = Jinja2Templates(directory=_template_dirs)


# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(auth_router,        prefix="/api/auth",        tags=["Authentication"])
app.include_router(events_router,      prefix="/api/events",      tags=["Events"])
app.include_router(users_router,       prefix="/api/users",       tags=["Users"])
app.include_router(location_router,    prefix="/api/location",    tags=["Location"])
app.include_router(bookings_router,    prefix="/api/bookings",    tags=["Bookings"])
app.include_router(tickets_router,     prefix="/api/tickets",     tags=["Tickets"])
app.include_router(organizers_router,  prefix="/api/organizers",  tags=["Organizers"])
app.include_router(host_events_router, prefix="/api/host-events", tags=["Host Events"])
app.include_router(wishlist_router,    prefix="/api/wishlist",    tags=["Wishlist"])
app.include_router(forms_router)
app.include_router(media_router)
app.include_router(support_router, prefix="/api/support", tags=["Support"])
app.include_router(notifications_router, prefix="/api/notifications", tags=["Notifications"])
app.include_router(volunteers_router, prefix="/api/volunteers", tags=["Volunteers"])
app.include_router(admin_router, prefix="/api/admin", tags=["Admin"])
app.include_router(payments_router, prefix="/api/payments", tags=["Payments"])



# ── Health & Template Routes ───────────────────────────────────────────────────
@app.get("/", tags=["Root"])
def root():
    payload = {"message": "JOD Events API is running 🚀", "version": APP_VERSION}
    if docs_enabled():
        payload["docs"] = "/docs"
    return payload


@app.get("/health", tags=["Root"])
def health_check():
    return {"status": "healthy", "version": APP_VERSION}


@app.get("/health/ready", tags=["Root"])
def health_ready():
    from sqlalchemy import text
    from Models.base import get_engine

    try:
        engine = get_engine()
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        logging.getLogger("jod").error("readiness_failed", extra={"endpoint": "/health/ready"})
        raise HTTPException(status_code=503, detail="not ready")
    return {"status": "ready", "version": APP_VERSION}


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


@app.get("/event/{event_id}", response_class=HTMLResponse, tags=["Jinja2 Templates"])
async def render_event_details_page(request: Request, event_id: str):
    """Query PostgreSQL for event details and render dynamic Jinja2 template."""
    import json
    from uuid import UUID
    from Models.base import get_session_factory
    from Services.event_service import get_event_by_id, list_events

    SessionLocal = get_session_factory()
    db = SessionLocal()
    event_data = None
    recommended_events = []
    try:
        try:
            uid = UUID(event_id)
            event_obj = get_event_by_id(db, uid)
        except Exception:
            event_obj = None

        if not event_obj:
            raise HTTPException(status_code=404, detail="Event not found.")

        if event_obj:
            def parse_j(val):
                if not val:
                    return []
                if isinstance(val, (list, dict)):
                    return val
                try:
                    return json.loads(val)
                except Exception:
                    return []

            cat_info = get_category_theme(event_obj.category)
            event_data = {
                "id": str(event_obj.id),
                "title": event_obj.title,
                "description": event_obj.description,
                "location": event_obj.location,
                "venue": event_obj.venue,
                "category": event_obj.category,
                "image_url": event_obj.image_url,
                "start_date": event_obj.start_date,
                "end_date": event_obj.end_date,
                "price": event_obj.price,
                "capacity": event_obj.capacity,
                "event_format": event_obj.event_format or "In-person",
                "duration": event_obj.duration or "2 Hours",
                "age_limit": event_obj.age_limit or "All ages",
                "language": event_obj.language or "English",
                "performers": parse_j(event_obj.performers),
                "highlights": parse_j(event_obj.highlights),
                "ticket_types": parse_j(event_obj.ticket_types),
                "terms": event_obj.terms,
                "category_theme": cat_info["theme_class"],
                "hero_badge": cat_info["hero_badge"],
                "performers_title": cat_info["performers_title"],
                "highlights_title": cat_info["highlights_title"],
            }
            # Fetch recommended events
            recs = list_events(db, limit=4)
            for r in recs:
                if str(r.id) != str(event_obj.id):
                    recommended_events.append({
                        "id": str(r.id),
                        "title": r.title,
                        "category": r.category,
                        "image_url": r.image_url,
                        "venue": r.venue or r.location,
                        "start_date": r.start_date.strftime("%b %d, %Y") if r.start_date else "",
                        "price": r.price,
                    })
    finally:
        db.close()

    return templates.TemplateResponse(
        request=request,
        name="event_details.html",
        context={
            "event": event_data,
            "recommended_events": recommended_events,
            "category_theme": event_data["category_theme"] if event_data else "category-theme-comedy",
            "app_title": f"{event_data['title'] if event_data else 'Event Details'} — JOD Events",
        },
    )


def get_category_theme(category: str) -> dict:
    cat = (category or "").lower()
    if "corporate" in cat or "conference" in cat or "business" in cat:
        return {
            "theme_class": "category-theme-corporate",
            "hero_badge": "💼 Executive Summit",
            "performers_title": "Keynote Speakers & Panelists",
            "highlights_title": "Summit Highlights & Key Takeaways",
        }
    elif "launch" in cat or "product" in cat or "tech" in cat:
        return {
            "theme_class": "category-theme-launch",
            "hero_badge": "🚀 Exclusive Product Reveal",
            "performers_title": "Innovation Leads & Creators",
            "highlights_title": "Interactive Demo Pods & Reveal Showcase",
        }
    elif "wedding" in cat or "luxury" in cat or "soiree" in cat:
        return {
            "theme_class": "category-theme-wedding",
            "hero_badge": "💍 Signature Luxury Showcase",
            "performers_title": "Featured Designers & Master Artisans",
            "highlights_title": "Couture Walk & Decor Exhibition",
        }
    elif "workshop" in cat or "makeup" in cat or "boutique" in cat or "fashion" in cat:
        return {
            "theme_class": "category-theme-workshop",
            "hero_badge": "💄 Interactive Masterclass",
            "performers_title": "Workshop Instructors & Beauty Experts",
            "highlights_title": "Workshop Highlights & Hands-on Sessions",
        }
    elif "festival" in cat or "cultural" in cat or "music" in cat:
        return {
            "theme_class": "category-theme-festival",
            "hero_badge": "🎸 Live Music & Cultural Fest",
            "performers_title": "Festival Lineup & Headliners",
            "highlights_title": "Open Air Stages & Festival Highlights",
        }
    else:
        # Default / Standup Comedy / Entertainment
        return {
            "theme_class": "category-theme-comedy",
            "hero_badge": "🎙️ Live Comedy Special",
            "performers_title": "Spotlight Artists & Performers",
            "highlights_title": "Show Laughs & Tour Highlights",
        }


@app.get("/event-details.html", response_class=HTMLResponse, tags=["Jinja2 Templates"])
async def render_event_details_static_fallback(request: Request, id: str = "11111111-1111-1111-1111-111111111111"):
    """Support static path event-details.html?id=... by delegating to template renderer."""
    return await render_event_details_page(request, event_id=id)


@app.get("/makeup-boutique-workshop.html", response_class=HTMLResponse, tags=["Jinja2 Templates"])
async def render_makeup_boutique_workshop_page(request: Request):
    """Render dedicated template page for Makeup & Boutique Workshop."""
    return templates.TemplateResponse(
        request=request,
        name="makeup_boutique_workshop.html",
        context={"request": request},
    )


