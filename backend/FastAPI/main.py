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
from APIs.bookings import router as bookings_router
from APIs.tickets import router as tickets_router
from APIs.organizers import router as organizers_router
from APIs.forms import router as forms_router
from APIs.host_events_api import router as host_events_router
from APIs.wishlist import router as wishlist_router
from APIs.media import router as media_router
from APIs.payments import router as payments_router
from APIs.support import router as support_router
from Models.base import create_tables
from Models.user import User
from Models.event import Event
from Models.booking import Booking
from Models.ticket import Ticket
from Models.payment import Payment


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
        try:
            from Services.file_storage import migrate_disk_uploads
            moved = migrate_disk_uploads()
            if moved:
                safe_print(f"  [OK] Moved {moved} upload file(s) into encrypted database storage.")
        except Exception as migrate_exc:
            safe_print(f"  [WARN] Could not migrate disk uploads into the database: {migrate_exc}")
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

# ── Templates ─────────────────────────────────────────────────
from fastapi.templating import Jinja2Templates
from fastapi.requests import Request
from fastapi.responses import HTMLResponse

frontend_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "frontend"))
templates_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "templates"))
if not os.path.exists(templates_path):
    os.makedirs(templates_path, exist_ok=True)

templates = Jinja2Templates(directory=[templates_path, frontend_path])


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
app.include_router(payments_router)
app.include_router(support_router, prefix="/api/support", tags=["Support"])



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
            # Fallback to first available event if given ID isn't found
            events = list_events(db, limit=1)
            if events:
                event_obj = events[0]

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


@app.get("/payment", response_class=HTMLResponse, tags=["Payments"])
async def render_razorpay_payment_page(request: Request):
    """Jinja2 checkout page. Only KEY_ID is injected — KEY_SECRET stays on the server."""
    key_id = (os.getenv("RAZORPAY_KEY_ID") or os.getenv("KEY_ID") or "").strip()
    return templates.TemplateResponse(
        request=request,
        name="payment_checkout.html",
        context={
            "request": request,
            "razorpay_key_id": key_id,
            "theme_color": "#f59e0b",
            "api_base": str(request.base_url).rstrip("/"),
        },
    )



