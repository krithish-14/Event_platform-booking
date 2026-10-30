"""
Movie seat booking rules.

Layouts: a grid of cells; each cell is a seat category id or empty (aisle / gap).
Rows that contain seats get letters starting from the screen side (A is nearest
the screen) and seats are numbered across the row, skipping gaps.

Holds: picking seats inserts one CinemaShowSeat row per seat. The table's
(show_id, seat_id) unique constraint is the lock, so concurrent buyers can never
get the same seat. A hold lasts HOLD_MINUTES; after that (plus a short grace for
payments that are already in flight) the seats are freed for others.
"""

import json
import re
import secrets
import string
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Iterable, Optional

from sqlalchemy.exc import IntegrityError

from Models.cinema import CinemaBooking, CinemaShow, CinemaShowSeat

HOLD_MINUTES = 8
HOLD_GRACE_SECONDS = 120
CLEANING_BUFFER_MIN = 15
MAX_SEATS_PER_BOOKING = 10
MAX_ROWS = 40
MAX_COLS = 60
MAX_CATEGORIES = 6
MAX_PRICE = 10000
PLATFORM_FEE_PERCENT = 5
GST_ON_FEE_PERCENT = 18
IST_OFFSET = timedelta(hours=5, minutes=30)
CERTIFICATES = ("U", "UA", "UA 7+", "UA 13+", "UA 16+", "A", "S")
FORMATS = ("2D", "3D", "IMAX", "4DX", "ScreenX", "Dolby Cinema")
CATEGORY_ID_RE = re.compile(r"^[a-z0-9_-]{1,20}$")
COLOR_RE = re.compile(r"^#[0-9a-fA-F]{6}$")

DEFAULT_CATEGORIES = [
    {"id": "classic", "name": "Classic", "color": "#64748b"},
    {"id": "prime", "name": "Prime", "color": "#2563eb"},
    {"id": "recliner", "name": "Recliner", "color": "#d97706"},
]


class BookingError(ValueError):
    """A rule the customer or theatre can fix; message is safe to show."""


class SeatsTaken(BookingError):
    def __init__(self, seats):
        self.seats = sorted(seats)
        super().__init__("Sorry, " + ", ".join(self.seats) + " just got booked. Pick other seats.")


# ── Layout ─────────────────────────────────────────────────────

def row_label(index: int) -> str:
    label = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        label = chr(65 + rem) + label
    return label


def template_layout(rows: int = 12, cols: int = 20, screen: str = "top") -> dict:
    """A ready-to-edit layout: centre aisle, walkway before the back rows, three categories."""
    rows = max(1, min(MAX_ROWS, int(rows)))
    cols = max(1, min(MAX_COLS, int(cols)))
    aisle = cols // 2 if cols >= 12 else None
    walkway = rows - 3 if rows >= 8 else None
    cells = []
    for r in range(rows):
        if r == walkway:
            cells.append([None] * cols)
            continue
        distance_from_screen = r if screen == "top" else rows - 1 - r
        if distance_from_screen >= rows - 2:
            category = "recliner"
        elif distance_from_screen >= rows // 3:
            category = "prime"
        else:
            category = "classic"
        cells.append([None if c == aisle else category for c in range(cols)])
    return {
        "rows": rows,
        "cols": cols,
        "screen": "bottom" if screen == "bottom" else "top",
        "numbering": "ltr",
        "categories": [dict(c) for c in DEFAULT_CATEGORIES],
        "cells": cells,
    }


def normalize_layout(raw) -> tuple:
    """Validated (layout, seats). Raises BookingError with a message for the theatre."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raise BookingError("The seat layout could not be read.")
    if not isinstance(raw, dict):
        raise BookingError("The seat layout could not be read.")
    try:
        rows = int(raw.get("rows") or 0)
        cols = int(raw.get("cols") or 0)
    except (TypeError, ValueError):
        raise BookingError("Rows and columns must be numbers.")
    if not (1 <= rows <= MAX_ROWS and 1 <= cols <= MAX_COLS):
        raise BookingError(f"Layouts can be up to {MAX_ROWS} rows and {MAX_COLS} columns.")
    screen = "bottom" if raw.get("screen") == "bottom" else "top"
    numbering = "rtl" if raw.get("numbering") == "rtl" else "ltr"

    categories = []
    seen = set()
    for item in raw.get("categories") or []:
        if not isinstance(item, dict):
            continue
        cid = str(item.get("id") or "").strip().lower()
        name = str(item.get("name") or "").strip()[:30]
        color = str(item.get("color") or "#64748b").strip()
        if not CATEGORY_ID_RE.match(cid) or not name or cid in seen:
            raise BookingError("Each seat category needs a unique short id and a name.")
        if not COLOR_RE.match(color):
            color = "#64748b"
        seen.add(cid)
        categories.append({"id": cid, "name": name, "color": color})
    if not categories:
        raise BookingError("Add at least one seat category.")
    if len(categories) > MAX_CATEGORIES:
        raise BookingError(f"Use up to {MAX_CATEGORIES} seat categories.")

    grid = raw.get("cells")
    if not isinstance(grid, list) or len(grid) != rows:
        raise BookingError("The seat grid does not match the number of rows.")
    cells = []
    for r, row in enumerate(grid):
        if not isinstance(row, list) or len(row) != cols:
            raise BookingError(f"Row {r + 1} does not match the number of columns.")
        clean = []
        for value in row:
            if value in (None, "", 0):
                clean.append(None)
                continue
            cid = str(value).strip().lower()
            if cid not in seen:
                raise BookingError(f"Row {r + 1} uses an unknown seat category.")
            clean.append(cid)
        cells.append(clean)

    layout = {"rows": rows, "cols": cols, "screen": screen, "numbering": numbering, "categories": categories, "cells": cells}
    seats = enumerate_seats(layout)
    if not seats:
        raise BookingError("Add at least one seat to the layout.")
    used = {s["category"] for s in seats}
    layout["categories"] = [c for c in categories if c["id"] in used]
    return layout, seats


def enumerate_seats(layout: dict) -> list:
    rows, cols, cells = layout["rows"], layout["cols"], layout["cells"]
    order = range(rows) if layout.get("screen", "top") == "top" else range(rows - 1, -1, -1)
    labels = {}
    next_label = 0
    for r in order:
        if any(cells[r]):
            labels[r] = row_label(next_label)
            next_label += 1
    seats = []
    for r in range(rows):
        if r not in labels:
            continue
        columns = range(cols) if layout.get("numbering", "ltr") == "ltr" else range(cols - 1, -1, -1)
        number = 0
        for c in columns:
            if cells[r][c]:
                number += 1
                seats.append({"id": f"{labels[r]}{number}", "row": labels[r], "number": number, "category": cells[r][c], "r": r, "c": c})
    return seats


@lru_cache(maxsize=256)
def _seat_index_cached(layout_json: str) -> dict:
    layout = json.loads(layout_json)
    return {s["id"]: s for s in enumerate_seats(layout)}


def seat_index(layout_json: str) -> dict:
    return _seat_index_cached(layout_json or "{}")


# ── Money ──────────────────────────────────────────────────────

def money_split(amount_paise: int) -> dict:
    platform = round(amount_paise * PLATFORM_FEE_PERCENT / 100)
    gst = round(platform * GST_ON_FEE_PERCENT / 100)
    return {"amount_paise": amount_paise, "platform_fee_paise": platform, "gst_paise": gst, "payout_paise": amount_paise - platform - gst}


def clean_prices(raw, layout: dict) -> dict:
    if not isinstance(raw, dict):
        raise BookingError("Set a ticket price for every seat category.")
    prices = {}
    for category in layout["categories"]:
        value = raw.get(category["id"])
        try:
            price = int(round(float(value)))
        except (TypeError, ValueError):
            raise BookingError(f"Set a ticket price for {category['name']}.")
        if not 1 <= price <= MAX_PRICE:
            raise BookingError(f"{category['name']} price must be between ₹1 and ₹{MAX_PRICE}.")
        prices[category["id"]] = price
    return prices


# ── Time ───────────────────────────────────────────────────────

def ist_local_to_utc(value: str) -> datetime:
    text = str(value or "").strip()
    for fmt in ("%Y-%m-%dT%H:%M", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            return datetime.strptime(text, fmt) - IST_OFFSET
        except ValueError:
            continue
    raise BookingError("Enter the show time as date and time (YYYY-MM-DDTHH:MM).")


def utc_to_ist_local(value: Optional[datetime]) -> Optional[str]:
    return (value + IST_OFFSET).strftime("%Y-%m-%dT%H:%M") if value else None


def find_overlap(db, screen_id, starts_at: datetime, ends_at: datetime, exclude_show_id=None) -> Optional[CinemaShow]:
    buffer = timedelta(minutes=CLEANING_BUFFER_MIN)
    candidates = (
        db.query(CinemaShow)
        .filter(
            CinemaShow.screen_id == screen_id,
            CinemaShow.status == "scheduled",
            CinemaShow.starts_at < ends_at + timedelta(days=1),
            CinemaShow.starts_at > starts_at - timedelta(days=1),
        )
        .all()
    )
    for show in candidates:
        if exclude_show_id and show.id == exclude_show_id:
            continue
        if show.starts_at < ends_at + buffer and show.ends_at + buffer > starts_at:
            return show
    return None


# ── Holds and bookings ─────────────────────────────────────────

def _booking_code(db) -> str:
    alphabet = string.ascii_uppercase + string.digits
    for _ in range(20):
        code = "MOV-" + "".join(secrets.choice(alphabet) for _ in range(8))
        if not db.query(CinemaBooking.id).filter(CinemaBooking.booking_code == code).first():
            return code
    return "MOV-" + secrets.token_hex(6).upper()


def purge_expired_holds(db, show_id, now: datetime) -> int:
    cutoff = now - timedelta(seconds=HOLD_GRACE_SECONDS)
    stale = (
        db.query(CinemaShowSeat)
        .filter(CinemaShowSeat.show_id == show_id, CinemaShowSeat.status == "held", CinemaShowSeat.expires_at < cutoff)
        .all()
    )
    booking_ids = {row.booking_id for row in stale}
    for row in stale:
        db.delete(row)
    if booking_ids:
        db.query(CinemaBooking).filter(CinemaBooking.id.in_(list(booking_ids)), CinemaBooking.status == "held").update(
            {"status": "expired"}, synchronize_session=False
        )
    db.flush()
    return len(stale)


def seat_states(db, show: CinemaShow, now: datetime) -> dict:
    purge_expired_holds(db, show.id, now)
    rows = db.query(CinemaShowSeat).filter(CinemaShowSeat.show_id == show.id).all()
    return {row.seat_id: {"status": row.status, "booking_id": row.booking_id} for row in rows}


def _release(db, booking: CinemaBooking, status: str = "released") -> None:
    db.query(CinemaShowSeat).filter(CinemaShowSeat.booking_id == booking.id, CinemaShowSeat.status == "held").delete(synchronize_session=False)
    booking.status = status


def hold_seats(db, show: CinemaShow, user, seat_ids: Iterable[str], now: datetime, name: Optional[str] = None, phone: Optional[str] = None) -> CinemaBooking:
    if show.status != "scheduled":
        raise BookingError("This show has been cancelled.")
    if show.starts_at <= now:
        raise BookingError("Booking has closed for this show.")
    wanted = []
    for seat_id in seat_ids or []:
        sid = str(seat_id or "").strip().upper()
        if sid and sid not in wanted:
            wanted.append(sid)
    if not wanted:
        raise BookingError("Pick at least one seat.")
    if len(wanted) > MAX_SEATS_PER_BOOKING:
        raise BookingError(f"You can book up to {MAX_SEATS_PER_BOOKING} seats at a time.")
    index = seat_index(show.layout_json)
    unknown = [s for s in wanted if s not in index]
    if unknown:
        raise BookingError("These seats are not on this screen: " + ", ".join(unknown) + ".")
    prices = json.loads(show.prices_json or "{}")

    email = (getattr(user, "email", "") or "").lower().strip()
    previous = (
        db.query(CinemaBooking)
        .filter(CinemaBooking.show_id == show.id, CinemaBooking.email == email, CinemaBooking.status == "held")
        .all()
    )
    for old in previous:
        _release(db, old)
    purge_expired_holds(db, show.id, now)

    seats = [{"id": s, "category": index[s]["category"], "price": int(prices.get(index[s]["category"], 0))} for s in wanted]
    if any(seat["price"] <= 0 for seat in seats):
        raise BookingError("Prices are missing for some seats. Ask the theatre to update the show.")
    amount_paise = sum(seat["price"] for seat in seats) * 100
    expires = now + timedelta(minutes=HOLD_MINUTES)
    booking = CinemaBooking(
        booking_code=_booking_code(db),
        show_id=show.id,
        partner_id=show.partner_id,
        customer_id=getattr(user, "customer_id", None),
        email=email,
        name=(name or getattr(user, "full_name", None) or "")[:200] or None,
        phone=(phone or getattr(user, "phone", None) or None),
        seats_json=json.dumps(seats),
        seat_count=len(seats),
        status="held",
        hold_expires_at=expires,
        **money_split(amount_paise),
    )
    db.add(booking)
    db.flush()
    for seat in seats:
        db.add(CinemaShowSeat(show_id=show.id, seat_id=seat["id"], booking_id=booking.id, status="held", expires_at=expires))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        taken = {
            row.seat_id
            for row in db.query(CinemaShowSeat).filter(CinemaShowSeat.show_id == show.id, CinemaShowSeat.seat_id.in_(wanted)).all()
        }
        raise SeatsTaken(taken or wanted)
    db.refresh(booking)
    return booking


def confirm_booking(db, booking: CinemaBooking, now: datetime, payment_id: Optional[str] = None) -> CinemaBooking:
    """Turn a paid hold into booked seats. Idempotent for an already confirmed booking."""
    if booking.status == "confirmed":
        return booking
    if booking.status not in ("held", "expired"):
        raise BookingError("This booking can no longer be confirmed.")
    rows = db.query(CinemaShowSeat).filter(CinemaShowSeat.booking_id == booking.id).all()
    if len(rows) != booking.seat_count:
        booking.status = "payment_conflict"
        booking.razorpay_payment_id = payment_id or booking.razorpay_payment_id
        db.commit()
        raise BookingError("Your seat hold ran out before the payment finished and the seats were taken. Our team will refund you; contact support with your booking code.")
    for row in rows:
        row.status = "booked"
        row.expires_at = None
    booking.status = "confirmed"
    booking.confirmed_at = now
    booking.hold_expires_at = None
    booking.razorpay_payment_id = payment_id or booking.razorpay_payment_id
    booking.qr_token = booking.qr_token or ("MOVQR-" + secrets.token_urlsafe(18))
    db.commit()
    db.refresh(booking)
    return booking


def release_booking(db, booking: CinemaBooking) -> None:
    if booking.status == "held":
        _release(db, booking)
        db.commit()


def seats_of(booking: CinemaBooking) -> list:
    try:
        return json.loads(booking.seats_json or "[]")
    except ValueError:
        return []
