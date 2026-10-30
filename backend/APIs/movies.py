"""
Public movie listings and live seat booking, mounted at /api/movies.

Flow: GET now-showing -> GET shows/{id} (seat map, polled every few seconds)
-> POST shows/{id}/hold (8-minute hold) -> POST bookings/{code}/order (Razorpay)
-> POST bookings/{code}/verify -> confirmed ticket with QR.
"""

import html
import json
import logging
import uuid
from datetime import timedelta
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from Authentication.dependencies import get_current_user, get_current_user_optional
from Models.base import get_db
from Models.cinema import CinemaBooking, CinemaMovie, CinemaScreen, CinemaShow
from Models.theatre_partner import TheatrePartner
from Models.user import User
from Services import cinema_booking as cb
from Services.rate_limit import limit_payment
from Utils.datetimes import json_datetime, utc_now

router = APIRouter()
logger = logging.getLogger(__name__)


def _norm(text) -> str:
    return "".join(ch for ch in str(text or "").lower() if ch.isalnum())


def _uuid(value) -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        raise HTTPException(status_code=404, detail="Show not found.")


def _movie_card(movie: CinemaMovie) -> dict:
    return {
        "title": movie.title,
        "language": movie.language,
        "certificate": movie.certificate,
        "duration_min": movie.duration_min,
        "genres": movie.genres,
        "description": movie.description,
        "poster_url": movie.poster_url,
        "release_date": movie.release_date,
    }


@router.get("/now-showing")
def now_showing(
    state: Optional[str] = Query(None, max_length=120),
    district: Optional[str] = Query(None, max_length=120),
    days: int = Query(7, ge=1, le=14),
    db: Session = Depends(get_db),
):
    """Upcoming shows at approved theatres, grouped by movie (title + language)."""
    now = utc_now()
    partners = {p.id: p for p in db.query(TheatrePartner).filter(TheatrePartner.status == "verified").all()}
    if state:
        partners = {k: p for k, p in partners.items() if _norm(p.state) == _norm(state)}
    if district:
        partners = {k: p for k, p in partners.items() if _norm(p.district) == _norm(district)}
    if not partners:
        return {"movies": []}
    shows = (
        db.query(CinemaShow)
        .filter(CinemaShow.status == "scheduled", CinemaShow.starts_at > now, CinemaShow.starts_at < now + timedelta(days=days),
                CinemaShow.partner_id.in_(list(partners.keys())))
        .order_by(CinemaShow.starts_at.asc())
        .limit(2000)
        .all()
    )
    if not shows:
        return {"movies": []}
    movies = {m.id: m for m in db.query(CinemaMovie).filter(CinemaMovie.id.in_(list({s.movie_id for s in shows})), CinemaMovie.status == "active").all()}
    screens = {s.id: s for s in db.query(CinemaScreen).filter(CinemaScreen.id.in_(list({s.screen_id for s in shows}))).all()}
    taken = {}
    from Models.cinema import CinemaShowSeat

    for row in db.query(CinemaShowSeat.show_id).filter(CinemaShowSeat.show_id.in_([s.id for s in shows])).all():
        taken[row.show_id] = taken.get(row.show_id, 0) + 1

    grouped = {}
    for show in shows:
        movie = movies.get(show.movie_id)
        partner = partners.get(show.partner_id)
        if not movie or not partner:
            continue
        key = f"{_norm(movie.title)}-{_norm(movie.language)}"
        entry = grouped.setdefault(key, {"key": key, **_movie_card(movie), "theatres": {}, "next_show": json_datetime(show.starts_at)})
        if not entry.get("poster_url") and movie.poster_url:
            entry["poster_url"] = movie.poster_url
        theatre = entry["theatres"].setdefault(str(partner.id), {
            "theatre_id": str(partner.id),
            "name": partner.theatre_name,
            "chain": partner.chain_name,
            "address": partner.theatre_address,
            "district": partner.district,
            "state": partner.state,
            "shows": [],
        })
        prices = json.loads(show.prices_json or "{}")
        screen = screens.get(show.screen_id)
        theatre["shows"].append({
            "show_id": str(show.id),
            "starts_at": json_datetime(show.starts_at),
            "format": (screen.screen_format if screen else None) or "2D",
            "screen_name": screen.name if screen else None,
            "min_price": min(prices.values()) if prices else None,
            "seats_left": max(0, show.seat_count - taken.get(show.id, 0)),
            "seat_count": show.seat_count,
        })
    out = []
    for entry in grouped.values():
        entry["theatres"] = list(entry["theatres"].values())
        out.append(entry)
    return {"movies": out}


def _show_context(db, show_id):
    show = db.query(CinemaShow).filter(CinemaShow.id == _uuid(show_id)).first()
    if not show:
        raise HTTPException(status_code=404, detail="Show not found.")
    partner = db.query(TheatrePartner).filter(TheatrePartner.id == show.partner_id).first()
    if not partner or (partner.status or "") != "verified":
        raise HTTPException(status_code=404, detail="Show not found.")
    movie = db.query(CinemaMovie).filter(CinemaMovie.id == show.movie_id).first()
    screen = db.query(CinemaScreen).filter(CinemaScreen.id == show.screen_id).first()
    return show, partner, movie, screen


def _show_header(show, partner, movie, screen) -> dict:
    return {
        "show_id": str(show.id),
        "starts_at": json_datetime(show.starts_at),
        "ends_at": json_datetime(show.ends_at),
        "status": show.status,
        "format": (screen.screen_format if screen else None) or "2D",
        "screen_name": screen.name if screen else None,
        "movie": _movie_card(movie) if movie else None,
        "theatre": {
            "name": partner.theatre_name,
            "address": partner.theatre_address,
            "district": partner.district,
            "state": partner.state,
            "pincode": partner.pincode,
        },
    }


@router.get("/shows/{show_id}")
def show_seat_map(show_id: str, db: Session = Depends(get_db), current_user: Optional[User] = Depends(get_current_user_optional)):
    """Seat map with live availability. Seats held by the signed-in buyer come back as 'mine'."""
    show, partner, movie, screen = _show_context(db, show_id)
    now = utc_now()
    states = cb.seat_states(db, show, now)
    db.commit()
    mine = None
    if current_user and current_user.email:
        mine = (
            db.query(CinemaBooking)
            .filter(CinemaBooking.show_id == show.id, CinemaBooking.email == current_user.email.lower(), CinemaBooking.status == "held")
            .order_by(CinemaBooking.created_at.desc())
            .first()
        )
    seats = {}
    for seat_id, state in states.items():
        seats[seat_id] = "mine" if mine and state["booking_id"] == mine.id and state["status"] == "held" else state["status"]
    return {
        **_show_header(show, partner, movie, screen),
        "layout": json.loads(show.layout_json),
        "prices": json.loads(show.prices_json or "{}"),
        "seats": seats,
        "available": max(0, show.seat_count - len(states)),
        "seat_count": show.seat_count,
        "max_per_booking": cb.MAX_SEATS_PER_BOOKING,
        "hold_minutes": cb.HOLD_MINUTES,
        "booking_open": show.status == "scheduled" and show.starts_at > now,
        "my_hold": _booking_out(mine) if mine else None,
        "server_time": json_datetime(now),
    }


class HoldIn(BaseModel):
    seats: List[str] = Field(..., min_length=1, max_length=cb.MAX_SEATS_PER_BOOKING)
    name: Optional[str] = Field(None, max_length=200)
    phone: Optional[str] = Field(None, max_length=20)


def _booking_out(b: CinemaBooking) -> dict:
    return {
        "booking_code": b.booking_code,
        "show_id": str(b.show_id),
        "status": b.status,
        "seats": cb.seats_of(b),
        "seat_count": b.seat_count,
        "amount": b.amount_paise / 100,
        "hold_expires_at": json_datetime(b.hold_expires_at),
        "confirmed_at": json_datetime(b.confirmed_at),
        "qr_token": b.qr_token if b.status == "confirmed" else None,
        "checked_in_at": json_datetime(b.checked_in_at),
    }


@router.post("/shows/{show_id}/hold")
def hold(show_id: str, payload: HoldIn, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    limit_payment(request)
    show, partner, movie, screen = _show_context(db, show_id)
    try:
        booking = cb.hold_seats(db, show, current_user, payload.seats, utc_now(), name=payload.name, phone=payload.phone)
    except cb.SeatsTaken as exc:
        raise HTTPException(status_code=409, detail={"message": str(exc), "taken": exc.seats})
    except cb.BookingError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return {**_booking_out(booking), "show": _show_header(show, partner, movie, screen)}


def _my_booking(db, code: str, user: User) -> CinemaBooking:
    booking = db.query(CinemaBooking).filter(CinemaBooking.booking_code == str(code or "").strip().upper()).first()
    if not booking or booking.email != (user.email or "").lower().strip():
        raise HTTPException(status_code=404, detail="Booking not found.")
    return booking


def _assert_payable(booking: CinemaBooking) -> None:
    if booking.status == "confirmed":
        raise HTTPException(status_code=409, detail="This booking is already paid.")
    if booking.status != "held" or not booking.hold_expires_at or booking.hold_expires_at < utc_now():
        raise HTTPException(status_code=410, detail="Your seat hold has expired. Pick your seats again.")


@router.delete("/bookings/{code}")
def release(code: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    booking = _my_booking(db, code, current_user)
    cb.release_booking(db, booking)
    return {"status": booking.status}


def _local_bypass(request: Request) -> bool:
    from Services.runtime_env import local_dev_bypass_enabled, request_is_loopback

    host = request.client.host if request.client else ""
    return bool(local_dev_bypass_enabled() and request_is_loopback(host))


@router.post("/bookings/{code}/order")
def create_order(code: str, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    limit_payment(request)
    booking = _my_booking(db, code, current_user)
    _assert_payable(booking)
    if _local_bypass(request):
        return {"local_bypass": True, "booking_code": booking.booking_code, "amount": booking.amount_paise}
    if booking.amount_paise < 100:
        raise HTTPException(status_code=400, detail="Amount must be at least ₹1.")
    from APIs.payments import _razorpay_client

    client, key_id = _razorpay_client()
    try:
        order = client.order.create({
            "amount": booking.amount_paise,
            "currency": "INR",
            "receipt": booking.booking_code,
            "payment_capture": 1,
            "notes": {"kind": "movie", "booking_code": booking.booking_code, "show_id": str(booking.show_id),
                      "seats": ",".join(s["id"] for s in cb.seats_of(booking)), "customer_id": current_user.customer_id or ""},
        })
    except Exception as exc:
        logger.exception("Razorpay order for movie booking failed")
        raise HTTPException(status_code=502, detail="Could not start payment. Please try again.") from exc
    booking.razorpay_order_id = str(order.get("id") or "")[:120]
    db.commit()
    return {"order_id": booking.razorpay_order_id, "amount": order.get("amount"), "currency": "INR", "key_id": key_id,
            "booking_code": booking.booking_code, "hold_expires_at": json_datetime(booking.hold_expires_at)}


class VerifyIn(BaseModel):
    razorpay_order_id: str = Field(..., min_length=1, max_length=120)
    razorpay_payment_id: str = Field(..., min_length=1, max_length=120)
    razorpay_signature: str = Field(..., min_length=1, max_length=255)


def _send_ticket_email(db, booking: CinemaBooking) -> None:
    try:
        from Services.email import send_email

        show = db.query(CinemaShow).filter(CinemaShow.id == booking.show_id).first()
        movie = db.query(CinemaMovie).filter(CinemaMovie.id == show.movie_id).first() if show else None
        partner = db.query(TheatrePartner).filter(TheatrePartner.id == booking.partner_id).first()
        seats = ", ".join(s["id"] for s in cb.seats_of(booking))
        when = cb.utc_to_ist_local(show.starts_at).replace("T", " ") if show else ""
        title = movie.title if movie else "your movie"
        link = f"https://jodevents.com/movie-ticket?code={booking.booking_code}"
        text = (f"Your tickets for {title} are confirmed.\n\nBooking: {booking.booking_code}\nTheatre: {partner.theatre_name if partner else ''}\n"
                f"Show: {when} IST\nSeats: {seats}\nPaid: ₹{booking.amount_paise / 100:.2f}\n\nShow this QR at the entrance: {link}\n")
        body = (f"<h2>Tickets confirmed: {html.escape(title)}</h2><p><strong>Booking:</strong> {booking.booking_code}<br>"
                f"<strong>Theatre:</strong> {html.escape(partner.theatre_name if partner else '')}<br><strong>Show:</strong> {when} IST<br>"
                f"<strong>Seats:</strong> {html.escape(seats)}<br><strong>Paid:</strong> ₹{booking.amount_paise / 100:.2f}</p>"
                f"<p><a href='{link}'>Open your ticket and QR</a></p>")
        send_email(booking.email, f"Your tickets: {title} — {booking.booking_code}", text, html_body=body)
    except Exception:
        logger.exception("Could not email movie ticket %s", booking.booking_code)


@router.post("/bookings/{code}/verify")
def verify_payment(code: str, payload: VerifyIn, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    limit_payment(request)
    booking = _my_booking(db, code, current_user)
    if booking.status == "confirmed":
        return _booking_out(booking)
    if not booking.razorpay_order_id or booking.razorpay_order_id != payload.razorpay_order_id.strip():
        raise HTTPException(status_code=400, detail="This payment does not belong to this booking.")
    from APIs.payments import _razorpay_client

    client, _key = _razorpay_client()
    try:
        client.utility.verify_payment_signature({
            "razorpay_order_id": payload.razorpay_order_id.strip(),
            "razorpay_payment_id": payload.razorpay_payment_id.strip(),
            "razorpay_signature": payload.razorpay_signature.strip(),
        })
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Payment signature verification failed. You were not charged for unconfirmed seats; contact support if money was debited.") from exc
    try:
        booking = cb.confirm_booking(db, booking, utc_now(), payment_id=payload.razorpay_payment_id.strip())
    except cb.BookingError as exc:
        raise HTTPException(status_code=409, detail=str(exc))
    _send_ticket_email(db, booking)
    return _booking_out(booking)


@router.post("/bookings/{code}/local-confirm")
def local_confirm(code: str, request: Request, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    """Local workstation only: confirm without Razorpay. Live servers return 404."""
    if not _local_bypass(request):
        raise HTTPException(status_code=404, detail="Not found.")
    booking = _my_booking(db, code, current_user)
    _assert_payable(booking)
    booking = cb.confirm_booking(db, booking, utc_now(), payment_id="LOCAL-TEST")
    _send_ticket_email(db, booking)
    return _booking_out(booking)


@router.get("/bookings/mine")
def my_bookings(db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    rows = (
        db.query(CinemaBooking)
        .filter(CinemaBooking.email == (current_user.email or "").lower(), CinemaBooking.status.in_(["confirmed", "payment_conflict"]))
        .order_by(CinemaBooking.confirmed_at.desc())
        .limit(50)
        .all()
    )
    out = []
    for b in rows:
        try:
            header = _show_header(*_show_context(db, b.show_id))
        except HTTPException:
            header = None
        out.append({**_booking_out(b), "show": header})
    return {"bookings": out}


@router.get("/bookings/{code}")
def booking_detail(code: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    booking = _my_booking(db, code, current_user)
    show, partner, movie, screen = _show_context(db, booking.show_id)
    return {**_booking_out(booking), "show": _show_header(show, partner, movie, screen)}
