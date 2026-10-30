"""
Theatre dashboard API (approved theatre partners only), mounted at /api/cinema.
"""

import json
import math
import uuid
from datetime import datetime, timedelta
from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import or_
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user
from Models.base import get_db
from Models.cinema import CinemaBooking, CinemaMovie, CinemaScreen, CinemaShow
from Models.theatre_partner import TheatrePartner
from Models.user import User
from Services import cinema_booking as cb
from Services.theatre_registration import screens_of
from Utils.datetimes import json_datetime, utc_now

router = APIRouter()

POSTER_MIN_BYTES = 20 * 1024
POSTER_MAX_BYTES = 3 * 1024 * 1024


# ── Access ─────────────────────────────────────────────────────

def verified_partner(db: Session, user: User) -> TheatrePartner:
    email = (user.email or "").lower().strip()
    clauses = [TheatrePartner.email == email]
    if user.customer_id:
        clauses.append(TheatrePartner.customer_id == user.customer_id)
    partner = db.query(TheatrePartner).filter(or_(*clauses)).order_by(TheatrePartner.created_at.desc()).first()
    if not partner:
        raise HTTPException(status_code=403, detail="Register your theatre first.")
    if (partner.status or "").lower() != "verified":
        raise HTTPException(status_code=403, detail="Your theatre dashboard opens once JOD Events approves your theatre.")
    return partner


def _uuid(value) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Not found.")


def _owned(db, model, partner, item_id, label):
    row = db.query(model).filter(model.id == _uuid(item_id), model.partner_id == partner.id).first()
    if not row:
        raise HTTPException(status_code=404, detail=f"{label} not found.")
    return row


def _fail(exc: cb.BookingError):
    raise HTTPException(status_code=422, detail=str(exc))


# ── Serializers ────────────────────────────────────────────────

def screen_out(screen: CinemaScreen) -> dict:
    layout = json.loads(screen.layout_json) if screen.layout_json else None
    return {
        "id": str(screen.id),
        "name": screen.name,
        "format": screen.screen_format or "2D",
        "seat_count": screen.seat_count,
        "status": screen.status,
        "layout": layout,
        "updated_at": json_datetime(screen.updated_at),
    }


def movie_out(movie: CinemaMovie) -> dict:
    return {
        "id": str(movie.id),
        "title": movie.title,
        "language": movie.language,
        "certificate": movie.certificate,
        "duration_min": movie.duration_min,
        "genres": movie.genres,
        "description": movie.description,
        "poster_url": movie.poster_url,
        "release_date": movie.release_date,
        "status": movie.status,
    }


def show_out(show: CinemaShow, screen: Optional[CinemaScreen] = None, movie: Optional[CinemaMovie] = None, sold: int = 0) -> dict:
    return {
        "id": str(show.id),
        "screen_id": str(show.screen_id),
        "movie_id": str(show.movie_id),
        "screen_name": screen.name if screen else None,
        "format": (screen.screen_format if screen else None) or "2D",
        "movie_title": movie.title if movie else None,
        "language": movie.language if movie else None,
        "starts_at": json_datetime(show.starts_at),
        "ends_at": json_datetime(show.ends_at),
        "starts_at_local": cb.utc_to_ist_local(show.starts_at),
        "prices": json.loads(show.prices_json or "{}"),
        "seat_count": show.seat_count,
        "sold": sold,
        "status": show.status,
    }


def booking_out(b: CinemaBooking) -> dict:
    return {
        "booking_code": b.booking_code,
        "show_id": str(b.show_id),
        "name": b.name,
        "email": b.email,
        "phone": b.phone,
        "seats": cb.seats_of(b),
        "seat_count": b.seat_count,
        "amount": b.amount_paise / 100,
        "platform_fee": b.platform_fee_paise / 100,
        "gst": b.gst_paise / 100,
        "payout": b.payout_paise / 100,
        "status": b.status,
        "confirmed_at": json_datetime(b.confirmed_at),
        "checked_in_at": json_datetime(b.checked_in_at),
    }


def _sold_counts(db, show_ids) -> Dict[str, int]:
    counts: Dict[str, int] = {}
    if not show_ids:
        return counts
    for b in db.query(CinemaBooking).filter(CinemaBooking.show_id.in_(list(show_ids)), CinemaBooking.status == "confirmed").all():
        counts[str(b.show_id)] = counts.get(str(b.show_id), 0) + int(b.seat_count or 0)
    return counts


def _seed_screens(db, partner: TheatrePartner) -> None:
    """First visit: turn the screens from registration into editable layouts."""
    if db.query(CinemaScreen.id).filter(CinemaScreen.partner_id == partner.id).first():
        return
    for item in screens_of(partner):
        seats = max(1, int(item.get("seats") or 1))
        cols = max(8, min(cb.MAX_COLS, math.ceil(math.sqrt(seats * 1.8))))
        rows = max(1, min(cb.MAX_ROWS, math.ceil(seats / max(1, cols - 1)) + (1 if seats >= 60 else 0)))
        layout, seat_list = cb.normalize_layout(cb.template_layout(rows, cols))
        fmt = item.get("format") if item.get("format") in cb.FORMATS else "2D"
        db.add(CinemaScreen(partner_id=partner.id, name=str(item.get("name") or "Screen")[:60], screen_format=fmt,
                            layout_json=json.dumps(layout), seat_count=len(seat_list)))
    db.commit()


# ── Overview ───────────────────────────────────────────────────

@router.get("/me")
def theatre_overview(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    _seed_screens(db, partner)
    now = utc_now()
    screens = db.query(CinemaScreen).filter(CinemaScreen.partner_id == partner.id, CinemaScreen.status == "active").all()
    movies = db.query(CinemaMovie).filter(CinemaMovie.partner_id == partner.id, CinemaMovie.status == "active").all()
    upcoming = (
        db.query(CinemaShow)
        .filter(CinemaShow.partner_id == partner.id, CinemaShow.status == "scheduled", CinemaShow.starts_at > now)
        .order_by(CinemaShow.starts_at.asc())
        .all()
    )
    confirmed = db.query(CinemaBooking).filter(CinemaBooking.partner_id == partner.id, CinemaBooking.status == "confirmed").all()
    today_start = (now + cb.IST_OFFSET).replace(hour=0, minute=0, second=0, microsecond=0) - cb.IST_OFFSET
    today = [b for b in confirmed if b.confirmed_at and b.confirmed_at >= today_start]
    screen_map = {s.id: s for s in screens}
    movie_map = {m.id: m for m in movies}
    sold = _sold_counts(db, [s.id for s in upcoming[:8]])
    return {
        "theatre": {
            "id": str(partner.id),
            "name": partner.theatre_name,
            "chain": partner.chain_name,
            "address": partner.theatre_address,
            "district": partner.district,
            "state": partner.state,
            "pincode": partner.pincode,
            "partner_code": partner.partner_code,
        },
        "stats": {
            "screens": len(screens),
            "seats": sum(s.seat_count for s in screens),
            "movies": len(movies),
            "upcoming_shows": len(upcoming),
            "tickets_today": sum(b.seat_count for b in today),
            "sales_today": sum(b.amount_paise for b in today) / 100,
            "tickets_total": sum(b.seat_count for b in confirmed),
            "gross_total": sum(b.amount_paise for b in confirmed) / 100,
            "payout_total": sum(b.payout_paise for b in confirmed) / 100,
        },
        "next_shows": [show_out(s, screen_map.get(s.screen_id), movie_map.get(s.movie_id), sold.get(str(s.id), 0)) for s in upcoming[:8]],
        "hold_minutes": cb.HOLD_MINUTES,
        "certificates": list(cb.CERTIFICATES),
        "formats": list(cb.FORMATS),
    }


# ── Screens ────────────────────────────────────────────────────

class ScreenCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=60)
    format: Optional[str] = "2D"
    rows: int = Field(10, ge=1, le=cb.MAX_ROWS)
    cols: int = Field(16, ge=1, le=cb.MAX_COLS)
    screen: Optional[str] = "top"


class ScreenUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=60)
    format: Optional[str] = None
    layout: Optional[dict] = None


@router.get("/screens")
def list_screens(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    _seed_screens(db, partner)
    rows = db.query(CinemaScreen).filter(CinemaScreen.partner_id == partner.id, CinemaScreen.status == "active").order_by(CinemaScreen.created_at.asc()).all()
    return {"screens": [screen_out(s) for s in rows], "template": cb.template_layout()}


@router.post("/screens")
def create_screen(payload: ScreenCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    name = payload.name.strip()
    if db.query(CinemaScreen.id).filter(CinemaScreen.partner_id == partner.id, CinemaScreen.status == "active", CinemaScreen.name == name).first():
        raise HTTPException(status_code=409, detail="You already have a screen with that name.")
    layout, seats = cb.normalize_layout(cb.template_layout(payload.rows, payload.cols, payload.screen or "top"))
    screen = CinemaScreen(partner_id=partner.id, name=name, screen_format=payload.format if payload.format in cb.FORMATS else "2D",
                          layout_json=json.dumps(layout), seat_count=len(seats))
    db.add(screen)
    db.commit()
    db.refresh(screen)
    return screen_out(screen)


@router.put("/screens/{screen_id}")
def update_screen(screen_id: str, payload: ScreenUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    screen = _owned(db, CinemaScreen, partner, screen_id, "Screen")
    if payload.name is not None:
        name = payload.name.strip()
        clash = db.query(CinemaScreen.id).filter(CinemaScreen.partner_id == partner.id, CinemaScreen.status == "active",
                                                 CinemaScreen.name == name, CinemaScreen.id != screen.id).first()
        if clash:
            raise HTTPException(status_code=409, detail="You already have a screen with that name.")
        screen.name = name
    if payload.format is not None:
        if payload.format not in cb.FORMATS:
            raise HTTPException(status_code=422, detail="Choose a supported screen format.")
        screen.screen_format = payload.format
    if payload.layout is not None:
        try:
            layout, seats = cb.normalize_layout(payload.layout)
        except cb.BookingError as exc:
            _fail(exc)
        screen.layout_json = json.dumps(layout)
        screen.seat_count = len(seats)
    db.commit()
    db.refresh(screen)
    return screen_out(screen)


@router.delete("/screens/{screen_id}")
def archive_screen(screen_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    screen = _owned(db, CinemaScreen, partner, screen_id, "Screen")
    upcoming = db.query(CinemaShow.id).filter(CinemaShow.screen_id == screen.id, CinemaShow.status == "scheduled", CinemaShow.starts_at > utc_now()).first()
    if upcoming:
        raise HTTPException(status_code=409, detail="This screen has upcoming shows. Cancel them first.")
    screen.status = "archived"
    db.commit()
    return {"status": "archived"}


# ── Movies ─────────────────────────────────────────────────────

class MovieIn(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    language: str = Field(..., min_length=2, max_length=40)
    certificate: Optional[str] = None
    duration_min: int = Field(..., ge=30, le=300)
    genres: Optional[str] = Field(None, max_length=200)
    description: Optional[str] = Field(None, max_length=3000)
    poster_url: Optional[str] = Field(None, max_length=500)
    release_date: Optional[str] = Field(None, max_length=10)


def _apply_movie(movie: CinemaMovie, payload: MovieIn) -> None:
    if payload.certificate and payload.certificate not in cb.CERTIFICATES:
        raise HTTPException(status_code=422, detail="Choose a CBFC certificate: " + ", ".join(cb.CERTIFICATES) + ".")
    if payload.poster_url and not (payload.poster_url.startswith("/api/media/") or payload.poster_url.startswith("https://")):
        raise HTTPException(status_code=422, detail="Upload the poster from the dashboard.")
    movie.title = payload.title.strip()
    movie.language = payload.language.strip()
    movie.certificate = payload.certificate or None
    movie.duration_min = payload.duration_min
    movie.genres = (payload.genres or "").strip() or None
    movie.description = (payload.description or "").strip() or None
    movie.poster_url = payload.poster_url or None
    movie.release_date = (payload.release_date or "").strip() or None


@router.get("/movies")
def list_movies(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    rows = db.query(CinemaMovie).filter(CinemaMovie.partner_id == partner.id, CinemaMovie.status == "active").order_by(CinemaMovie.created_at.desc()).all()
    return {"movies": [movie_out(m) for m in rows], "certificates": list(cb.CERTIFICATES)}


@router.post("/movies")
def create_movie(payload: MovieIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    movie = CinemaMovie(partner_id=partner.id, title="", language="", duration_min=payload.duration_min)
    _apply_movie(movie, payload)
    db.add(movie)
    db.commit()
    db.refresh(movie)
    return movie_out(movie)


@router.put("/movies/{movie_id}")
def update_movie(movie_id: str, payload: MovieIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    movie = _owned(db, CinemaMovie, partner, movie_id, "Movie")
    if payload.duration_min != movie.duration_min:
        future = db.query(CinemaShow.id).filter(CinemaShow.movie_id == movie.id, CinemaShow.status == "scheduled", CinemaShow.starts_at > utc_now()).first()
        if future:
            raise HTTPException(status_code=409, detail="Runtime can't change while shows are scheduled. Cancel those shows first.")
    _apply_movie(movie, payload)
    db.commit()
    db.refresh(movie)
    return movie_out(movie)


@router.delete("/movies/{movie_id}")
def archive_movie(movie_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    movie = _owned(db, CinemaMovie, partner, movie_id, "Movie")
    future = db.query(CinemaShow.id).filter(CinemaShow.movie_id == movie.id, CinemaShow.status == "scheduled", CinemaShow.starts_at > utc_now()).first()
    if future:
        raise HTTPException(status_code=409, detail="This movie has upcoming shows. Cancel them first.")
    movie.status = "archived"
    db.commit()
    return {"status": "archived"}


@router.post("/movies/poster")
def upload_poster(file: UploadFile = File(...), db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    verified_partner(db, current_user)
    from Utils.categories import is_allowed_image_bytes, is_allowed_image_filename

    if not is_allowed_image_filename(file.filename or ""):
        raise HTTPException(status_code=400, detail="Upload the poster as JPG, PNG or WEBP.")
    data = file.file.read()
    if not POSTER_MIN_BYTES <= len(data) <= POSTER_MAX_BYTES:
        raise HTTPException(status_code=400, detail="Poster must be 20 KB to 3 MB. A 600 × 900 px image works well.")
    if not is_allowed_image_bytes(data, file.content_type or ""):
        raise HTTPException(status_code=400, detail="That file is not a real JPG, PNG or WEBP image.")
    from Services.file_storage import store_public_image

    url = store_public_image(db, data=data, filename=file.filename or "poster.jpg", content_type=file.content_type,
                             purpose="movie_poster", owner_customer_id=current_user.customer_id, owner_email=current_user.email)
    db.commit()
    return {"poster_url": url}


# ── Shows ──────────────────────────────────────────────────────

class ShowCreate(BaseModel):
    screen_id: str
    movie_id: str
    starts_at: str  # IST wall clock, YYYY-MM-DDTHH:MM
    prices: Dict[str, float]


class ShowPrices(BaseModel):
    prices: Dict[str, float]


@router.get("/shows")
def list_shows(
    days: int = Query(14, ge=1, le=60),
    include_past: bool = Query(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = verified_partner(db, current_user)
    now = utc_now()
    query = db.query(CinemaShow).filter(CinemaShow.partner_id == partner.id, CinemaShow.starts_at < now + timedelta(days=days))
    if not include_past:
        query = query.filter(CinemaShow.starts_at > now - timedelta(hours=6))
    shows = query.order_by(CinemaShow.starts_at.asc()).limit(500).all()
    screens = {s.id: s for s in db.query(CinemaScreen).filter(CinemaScreen.partner_id == partner.id).all()}
    movies = {m.id: m for m in db.query(CinemaMovie).filter(CinemaMovie.partner_id == partner.id).all()}
    sold = _sold_counts(db, [s.id for s in shows])
    return {"shows": [show_out(s, screens.get(s.screen_id), movies.get(s.movie_id), sold.get(str(s.id), 0)) for s in shows]}


@router.post("/shows")
def create_show(payload: ShowCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    screen = _owned(db, CinemaScreen, partner, payload.screen_id, "Screen")
    movie = _owned(db, CinemaMovie, partner, payload.movie_id, "Movie")
    if screen.status != "active" or movie.status != "active":
        raise HTTPException(status_code=409, detail="Pick an active screen and movie.")
    try:
        starts = cb.ist_local_to_utc(payload.starts_at)
        layout, seats = cb.normalize_layout(screen.layout_json)
        prices = cb.clean_prices(payload.prices, layout)
    except cb.BookingError as exc:
        _fail(exc)
    if starts <= utc_now() + timedelta(minutes=10):
        raise HTTPException(status_code=422, detail="Schedule shows at least 10 minutes from now.")
    ends = starts + timedelta(minutes=movie.duration_min)
    clash = cb.find_overlap(db, screen.id, starts, ends)
    if clash:
        other = db.query(CinemaMovie).filter(CinemaMovie.id == clash.movie_id).first()
        raise HTTPException(status_code=409, detail=(
            f"{screen.name} is busy then: {other.title if other else 'another show'} at "
            f"{cb.utc_to_ist_local(clash.starts_at).replace('T', ' ')}. Leave {cb.CLEANING_BUFFER_MIN} minutes between shows."
        ))
    show = CinemaShow(partner_id=partner.id, screen_id=screen.id, movie_id=movie.id, starts_at=starts, ends_at=ends,
                      prices_json=json.dumps(prices), layout_json=json.dumps(layout), seat_count=len(seats))
    db.add(show)
    db.commit()
    db.refresh(show)
    return show_out(show, screen, movie)


@router.put("/shows/{show_id}/prices")
def update_show_prices(show_id: str, payload: ShowPrices, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    show = _owned(db, CinemaShow, partner, show_id, "Show")
    if show.status != "scheduled":
        raise HTTPException(status_code=409, detail="This show is cancelled.")
    try:
        prices = cb.clean_prices(payload.prices, json.loads(show.layout_json))
    except cb.BookingError as exc:
        _fail(exc)
    show.prices_json = json.dumps(prices)
    db.commit()
    return show_out(show)


@router.post("/shows/{show_id}/cancel")
def cancel_show(show_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    show = _owned(db, CinemaShow, partner, show_id, "Show")
    sold = db.query(CinemaBooking.id).filter(CinemaBooking.show_id == show.id, CinemaBooking.status == "confirmed").first()
    if sold:
        raise HTTPException(status_code=409, detail="Tickets are already sold for this show. Raise a Help & Support request so we can refund buyers before cancelling.")
    for booking in db.query(CinemaBooking).filter(CinemaBooking.show_id == show.id, CinemaBooking.status == "held").all():
        cb.release_booking(db, booking)
    show.status = "cancelled"
    db.commit()
    return {"status": "cancelled"}


@router.get("/shows/{show_id}/seats")
def owner_show_seats(show_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    show = _owned(db, CinemaShow, partner, show_id, "Show")
    states = cb.seat_states(db, show, utc_now())
    db.commit()
    bookings = db.query(CinemaBooking).filter(CinemaBooking.show_id == show.id, CinemaBooking.status == "confirmed").order_by(CinemaBooking.confirmed_at.asc()).all()
    return {
        "show": show_out(show),
        "layout": json.loads(show.layout_json),
        "seats": {sid: s["status"] for sid, s in states.items()},
        "bookings": [booking_out(b) for b in bookings],
    }


# ── Bookings and check-in ──────────────────────────────────────

class CheckinIn(BaseModel):
    code: str = Field(..., min_length=4, max_length=80)


@router.get("/bookings")
def list_bookings(
    show_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=500),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    partner = verified_partner(db, current_user)
    query = db.query(CinemaBooking).filter(CinemaBooking.partner_id == partner.id, CinemaBooking.status.in_(["confirmed", "payment_conflict"]))
    if show_id:
        query = query.filter(CinemaBooking.show_id == _uuid(show_id))
    rows = query.order_by(CinemaBooking.confirmed_at.desc()).limit(limit).all()
    return {"bookings": [booking_out(b) for b in rows]}


@router.post("/bookings/checkin")
def checkin_booking(payload: CheckinIn, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    partner = verified_partner(db, current_user)
    code = payload.code.strip()
    booking = (
        db.query(CinemaBooking)
        .filter(CinemaBooking.partner_id == partner.id, or_(CinemaBooking.qr_token == code, CinemaBooking.booking_code == code.upper()))
        .first()
    )
    if not booking or booking.status != "confirmed":
        raise HTTPException(status_code=404, detail="No confirmed ticket found for this code at your theatre.")
    show = db.query(CinemaShow).filter(CinemaShow.id == booking.show_id).first()
    already = booking.checked_in_at is not None
    if not already:
        booking.checked_in_at = utc_now()
        db.commit()
    return {"already_checked_in": already, "booking": booking_out(booking), "show": show_out(show) if show else None}
