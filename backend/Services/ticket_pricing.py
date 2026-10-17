"""Authoritative ticket offer pricing.

Individual offers: total = unit price x tickets purchased, one attendee per ticket.
Group packages: total = package price x packages purchased, attendees = people per package x packages.
Legacy rows without pricing_type keep the older per-person price and optional bulk percentage.
All money math uses integer paise.
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional
from zoneinfo import ZoneInfo

from fastapi import HTTPException, status

IST = ZoneInfo("Asia/Kolkata")
PAISE = Decimal("100")
ONE = Decimal("1")


TICKET_KINDS = ("main", "standard", "early_bird", "group")
COUPON_CODE_CHARS = set("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_")


@dataclass
class PriceQuote:
    offer_id: str
    offer_name: str
    pricing_type: str
    purchase_quantity: int
    attendee_count: int
    total_paise: int
    currency: str = "INR"
    legacy: bool = False
    discount_paise: int = 0
    coupon_code: str = ""

    @property
    def total_rupees(self) -> float:
        return paise_to_rupees(self.total_paise)


def rupees_to_paise(value) -> int:
    if value is None or value == "":
        return 0
    amount = Decimal(str(value).strip())
    if amount < 0:
        raise HTTPException(status_code=400, detail="Price cannot be negative.")
    return int((amount * PAISE).quantize(ONE, rounding=ROUND_HALF_UP))


def paise_to_rupees(paise: int) -> float:
    return float((Decimal(int(paise)) / PAISE).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _as_int(value, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _offer_name(raw: dict) -> str:
    return str(raw.get("name") or raw.get("offer_name") or raw.get("ticket_name") or raw.get("type") or "").strip()


def normalize_offer(raw: dict, previous: Optional[dict] = None) -> dict:
    """Return a host ticket row with a stable offer id and an explicit pricing type."""
    if not isinstance(raw, dict):
        raise HTTPException(status_code=400, detail="Each ticket offer must be an object.")
    name = _offer_name(raw)
    if not name:
        raise HTTPException(status_code=400, detail="Ticket offer name is required.")
    previous = previous or {}
    offer_id = str(raw.get("offer_id") or previous.get("offer_id") or uuid.uuid4())
    pricing = str(raw.get("pricing_type") or "").strip().lower()
    if pricing not in ("per_person", "package"):
        pricing = str(previous.get("pricing_type") or "").strip().lower()
    if pricing not in ("per_person", "package"):
        pricing = ""

    sales_start = raw.get("sales_start", raw.get("sale_start_at", previous.get("sales_start")))
    sales_end = raw.get("sales_end", raw.get("sale_end_at", previous.get("sales_end")))
    if sales_start == "":
        sales_start = None
    if sales_end == "":
        sales_end = None
    _assert_window(sales_start, sales_end)

    active = raw.get("is_active", previous.get("is_active", True))
    is_active = str(active).strip().lower() not in ("0", "false", "no", "inactive")

    out = dict(raw)
    out["offer_id"] = offer_id
    out["name"] = name[:100]
    out["sales_start"] = sales_start
    out["sales_end"] = sales_end
    out["is_active"] = is_active
    capacity = raw.get("qty", raw.get("quantity", previous.get("qty")))
    if capacity not in (None, ""):
        out["qty"] = max(0, _as_int(capacity, 0))

    if pricing == "package":
        people = _as_int(raw.get("package_quantity") or raw.get("package_size"), 0)
        if people < 2:
            raise HTTPException(status_code=400, detail=f"{name}: a group package must include at least 2 attendees.")
        package_paise = rupees_to_paise(raw.get("package_price", raw.get("price")))
        if package_paise < 0:
            raise HTTPException(status_code=400, detail=f"{name}: package price cannot be negative.")
        out["pricing_type"] = "package"
        out["package_quantity"] = people
        out["package_price"] = paise_to_rupees(package_paise)
        out["price"] = out["package_price"]
        out["unit_price"] = None
    elif pricing == "per_person":
        unit_paise = rupees_to_paise(raw.get("unit_price", raw.get("price")))
        out["pricing_type"] = "per_person"
        out["unit_price"] = paise_to_rupees(unit_paise)
        out["price"] = out["unit_price"]
        out["package_quantity"] = None
        out["package_price"] = None
    else:
        # Untyped legacy row. Leave price as stored and do not invent a pricing type.
        out.pop("pricing_type", None)

    out.pop("max_per_order", None)
    if raw.get("max_per_order") not in (None, ""):
        limit = _as_int(raw.get("max_per_order"), 0)
        if limit < 1:
            raise HTTPException(status_code=400, detail=f"{name}: maximum per order must be at least 1.")
        out["max_per_order"] = limit

    kind = str(raw.get("ticket_kind") or "").strip().lower()
    if kind in TICKET_KINDS:
        out["ticket_kind"] = kind
    else:
        out.pop("ticket_kind", None)
    note = " ".join(str(raw.get("price_note") or "").split())[:200]
    if note:
        out["price_note"] = note
    else:
        out.pop("price_note", None)
    if kind == "early_bird":
        percent = _as_int(raw.get("discount_percent"), 0)
        if percent < 1 or percent > 90:
            raise HTTPException(status_code=400, detail=f"{name}: Early Bird discount must be between 1% and 90%.")
        out["discount_percent"] = percent
        out["base_offer_id"] = str(raw.get("base_offer_id") or "").strip()[:64] or None
    else:
        out.pop("discount_percent", None)
        out.pop("base_offer_id", None)
    return out


def _apply_early_bird_prices(offers: list) -> None:
    """Early Bird price is always the base ticket price minus its percentage."""
    by_id = {str(o.get("offer_id")): o for o in offers}
    for offer in offers:
        if offer.get("ticket_kind") != "early_bird":
            continue
        base = by_id.get(str(offer.get("base_offer_id") or ""))
        if base is None or base.get("pricing_type") != "per_person":
            raise HTTPException(
                status_code=400,
                detail=f"{_offer_name(offer)}: Early Bird needs the main ticket's price per person.",
            )
        base_paise = rupees_to_paise(base.get("unit_price", base.get("price")))
        percent = _as_int(offer.get("discount_percent"), 0)
        unit = int((Decimal(base_paise) * Decimal(100 - percent) / Decimal(100)).quantize(ONE, rounding=ROUND_HALF_UP))
        offer["pricing_type"] = "per_person"
        offer["unit_price"] = paise_to_rupees(unit)
        offer["price"] = offer["unit_price"]
        offer["base_price"] = paise_to_rupees(base_paise)


def normalize_ticket_list(incoming, previous=None) -> list:
    rows = incoming if isinstance(incoming, list) else []
    prior_rows = previous if isinstance(previous, list) else []
    prior_by_id = {}
    prior_by_name = {}
    for item in prior_rows:
        if not isinstance(item, dict):
            continue
        if item.get("offer_id"):
            prior_by_id[str(item.get("offer_id"))] = item
        name = _offer_name(item).lower()
        if name and name not in prior_by_name:
            prior_by_name[name] = item
    out = []
    seen = set()
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        if not _offer_name(raw):
            continue
        previous_row = None
        if raw.get("offer_id"):
            previous_row = prior_by_id.get(str(raw.get("offer_id")))
        if previous_row is None:
            previous_row = prior_by_name.get(_offer_name(raw).lower())
        offer = normalize_offer(raw, previous_row)
        if offer["offer_id"] in seen:
            raise HTTPException(status_code=400, detail="Each ticket offer must have its own id.")
        seen.add(offer["offer_id"])
        out.append(offer)
    _apply_early_bird_prices(out)
    return out


def normalize_coupons(incoming) -> list:
    """Host coupon codes. Stored privately in policies, never in the public ticket list."""
    rows = incoming if isinstance(incoming, list) else []
    out = []
    seen = set()
    for raw in rows:
        if not isinstance(raw, dict):
            continue
        code = "".join(str(raw.get("code") or "").split()).upper()
        if not code and raw.get("amount") in (None, ""):
            continue
        if len(code) < 3 or len(code) > 30 or any(ch not in COUPON_CODE_CHARS for ch in code):
            raise HTTPException(
                status_code=400,
                detail="Coupon code must be 3 to 30 letters or numbers (dash and underscore allowed).",
            )
        if code in seen:
            raise HTTPException(status_code=400, detail=f"Coupon code {code} is used more than once.")
        amount_paise = rupees_to_paise(raw.get("amount"))
        if amount_paise <= 0:
            raise HTTPException(status_code=400, detail=f"Coupon {code}: enter the amount to take off the ticket.")
        sales_start = raw.get("sales_start") or None
        sales_end = raw.get("sales_end") or None
        _assert_window(sales_start, sales_end)
        seen.add(code)
        out.append({
            "code": code,
            "amount": paise_to_rupees(amount_paise),
            "applies_to": str(raw.get("applies_to") or "").strip()[:64],
            "applies_to_name": str(raw.get("applies_to_name") or "").strip()[:100],
            "sales_start": sales_start,
            "sales_end": sales_end,
            "note": " ".join(str(raw.get("note") or "").split())[:200],
            "section_id": str(raw.get("section_id") or "").strip()[:64],
        })
    return out


def _load_event_coupons(db, event_id) -> list:
    host, _rows = _load_host_tickets(db, event_id)
    policies = getattr(host, "policies_json", None) if host is not None else None
    if isinstance(policies, str):
        import json
        try:
            policies = json.loads(policies)
        except Exception:
            policies = None
    if not isinstance(policies, dict):
        return []
    coupons = policies.get("_coupons")
    return [c for c in coupons if isinstance(c, dict)] if isinstance(coupons, list) else []


def apply_coupon(db, event_id: str, quote: PriceQuote, code: str, *, now: Optional[datetime] = None) -> PriceQuote:
    """Take the coupon amount off each ticket or package bought. The total never goes below zero."""
    wanted = "".join(str(code or "").split()).upper()
    if not wanted:
        return quote
    coupon = next((c for c in _load_event_coupons(db, event_id) if str(c.get("code") or "").upper() == wanted), None)
    if coupon is None:
        raise HTTPException(status_code=400, detail="This coupon code is not valid for this event.")
    applies_to = str(coupon.get("applies_to") or "")
    if applies_to:
        matches = applies_to == str(quote.offer_id or "")
        if not matches and not quote.offer_id:
            matches = str(coupon.get("applies_to_name") or "").strip().lower() == quote.offer_name.strip().lower()
        if not matches:
            label = coupon.get("applies_to_name") or "another ticket"
            raise HTTPException(status_code=400, detail=f"This coupon only works on {label}.")
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(IST)
    start_at = _parse_local(coupon.get("sales_start"), is_end=False)
    end_at = _parse_local(coupon.get("sales_end"), is_end=True)
    if start_at and moment < start_at:
        raise HTTPException(status_code=400, detail="This coupon code is not active yet.")
    if end_at and moment >= end_at:
        raise HTTPException(status_code=400, detail="This coupon code has expired.")
    per_unit = rupees_to_paise(coupon.get("amount"))
    discount = min(per_unit * max(1, quote.purchase_quantity), quote.total_paise)
    quote.discount_paise = discount
    quote.total_paise = quote.total_paise - discount
    quote.coupon_code = wanted
    return quote


def _parse_local(value, *, is_end: bool) -> Optional[datetime]:
    if value in (None, ""):
        return None
    text = str(value).strip()
    if len(text) == 10 and text[4] == "-" and text[7] == "-":
        day = datetime.strptime(text, "%Y-%m-%d").replace(tzinfo=IST)
        if is_end:
            return day + timedelta(days=1)
        return day
    text = text.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        raise HTTPException(status_code=400, detail="Offer dates must be a valid date or timestamp.")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


def _assert_window(start, end) -> None:
    start_at = _parse_local(start, is_end=False)
    end_at = _parse_local(end, is_end=True)
    if start_at and end_at and end_at <= start_at:
        raise HTTPException(status_code=400, detail="Offer end must be after the offer start.")


def offer_is_on_sale(offer: dict, now: Optional[datetime] = None) -> None:
    if str(offer.get("is_active", True)).strip().lower() in ("0", "false", "no", "inactive"):
        raise HTTPException(status_code=400, detail="This ticket offer is not on sale.")
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    moment = moment.astimezone(IST)
    start_at = _parse_local(offer.get("sales_start"), is_end=False)
    end_at = _parse_local(offer.get("sales_end"), is_end=True)
    if start_at and moment < start_at:
        raise HTTPException(status_code=400, detail="This ticket offer is not on sale yet.")
    if end_at and moment >= end_at:
        raise HTTPException(status_code=400, detail="This ticket offer has ended.")


def quote_offer(offer: dict, purchase_quantity: int, *, now: Optional[datetime] = None, legacy_percent: int = 0) -> PriceQuote:
    if not isinstance(offer, dict):
        raise HTTPException(status_code=400, detail="Ticket offer was not found.")
    offer_is_on_sale(offer, now)
    qty = _as_int(purchase_quantity, 0)
    if qty < 1:
        raise HTTPException(status_code=400, detail="Quantity must be at least 1.")
    raw_limit = offer.get("max_per_order")
    if raw_limit not in (None, ""):
        limit = _as_int(raw_limit, 0)
        if limit >= 1 and qty > limit:
            raise HTTPException(status_code=400, detail=f"You can buy at most {limit} in one order.")
    pricing = str(offer.get("pricing_type") or "").strip().lower()
    name = _offer_name(offer) or "Ticket"
    offer_id = str(offer.get("offer_id") or "")
    if pricing == "package":
        people = _as_int(offer.get("package_quantity"), 0)
        if people < 2:
            raise HTTPException(status_code=400, detail="This group package is not configured.")
        package_paise = rupees_to_paise(offer.get("package_price", offer.get("price")))
        return PriceQuote(
            offer_id=offer_id,
            offer_name=name,
            pricing_type="package",
            purchase_quantity=qty,
            attendee_count=people * qty,
            total_paise=package_paise * qty,
        )
    if pricing == "per_person":
        unit_paise = rupees_to_paise(offer.get("unit_price", offer.get("price")))
        return PriceQuote(
            offer_id=offer_id,
            offer_name=name,
            pricing_type="per_person",
            purchase_quantity=qty,
            attendee_count=qty,
            total_paise=unit_paise * qty,
        )
    unit_paise = rupees_to_paise(offer.get("price"))
    percent = max(0, min(int(legacy_percent or 0), 90))
    total = unit_paise * qty
    if percent:
        total = int((Decimal(total) * Decimal(100 - percent) / PAISE).quantize(ONE, rounding=ROUND_HALF_UP))
    return PriceQuote(
        offer_id=offer_id,
        offer_name=name,
        pricing_type="legacy",
        purchase_quantity=qty,
        attendee_count=qty,
        total_paise=total,
        legacy=True,
    )


def _load_host_tickets(db, event_id) -> tuple[Any, list]:
    from Models.event_management import EventManagement
    host = None
    try:
        host = db.query(EventManagement).filter(EventManagement.event_id == event_id).first()
    except Exception:
        db.rollback()
        host = None
    if host is None:
        try:
            host = db.query(EventManagement).filter(EventManagement.event_id == str(event_id)).first()
        except Exception:
            db.rollback()
            host = None
    raw = getattr(host, "tickets_json", None) if host is not None else None
    if isinstance(raw, str):
        import json
        try:
            raw = json.loads(raw)
        except Exception:
            raw = []
    if not isinstance(raw, list):
        raw = []
    return host, [row for row in raw if isinstance(row, dict)]


def find_offer(rows: list, *, offer_id: str = "", ticket_name: str = "") -> Optional[dict]:
    wanted_id = str(offer_id or "").strip()
    if wanted_id:
        for row in rows:
            if str(row.get("offer_id") or "") == wanted_id:
                return row
        return None
    wanted = str(ticket_name or "").strip().lower()
    if not wanted:
        return None
    exact = [row for row in rows if _offer_name(row).lower() == wanted]
    if len(exact) == 1:
        return exact[0]
    if len(exact) > 1:
        raise HTTPException(status_code=400, detail="Select the ticket offer again. More than one offer uses that name.")
    return None


def calculate_order_price(
    db,
    event_id: str,
    *,
    offer_id: str = "",
    ticket_name: str = "",
    purchase_quantity: int = 1,
    now: Optional[datetime] = None,
) -> PriceQuote:
    host, rows = _load_host_tickets(db, event_id)
    if not rows and not str(offer_id or "").strip():
        from Models.event import Event
        event = None
        try:
            event = db.query(Event).filter(Event.id == event_id).first()
        except Exception:
            db.rollback()
        unit = rupees_to_paise(getattr(event, "price", 0) or 0) if event is not None else 0
        qty = max(1, _as_int(purchase_quantity, 1))
        from APIs.events import _host_ticket_purchase_for_event
        purchase = _host_ticket_purchase_for_event(db, event_id)
        if str((purchase or {}).get("mode") or "single") != "multiple":
            qty = 1
        return PriceQuote(
            offer_id="",
            offer_name=(ticket_name or "General Admission")[:100],
            pricing_type="legacy",
            purchase_quantity=qty,
            attendee_count=qty,
            total_paise=unit * qty,
            legacy=True,
        )
    offer = find_offer(rows, offer_id=offer_id, ticket_name="" if offer_id else ticket_name)
    if offer is None:
        raise HTTPException(status_code=400, detail="Ticket offer was not found for this event.")
    if str(offer.get("pricing_type") or "") in ("per_person", "package"):
        try:
            if host is not None:
                db.query(type(host)).filter(type(host).event_id == host.event_id).with_for_update().first()
        except Exception:
            db.rollback()
        quote = quote_offer(offer, purchase_quantity, now=now, legacy_percent=0)
        assert_offer_capacity(db, event_id, offer, quote.purchase_quantity)
        return quote
    # Legacy unnamed pricing: honor single/multiple mode and bulk percentage.
    from APIs.events import _host_ticket_purchase_for_event, bulk_offer_percent
    purchase = _host_ticket_purchase_for_event(db, getattr(host, "event_id", None) or event_id) if host is not None else {}
    mode = str((purchase or {}).get("mode") or "single")
    qty = _as_int(purchase_quantity, 1)
    if mode != "multiple":
        qty = 1
    else:
        cap = _as_int((purchase or {}).get("per_person_limit") or 20, 20)
        qty = max(1, min(qty, max(2, min(cap, 20))))
    percent = bulk_offer_percent(purchase or {}, qty) if mode == "multiple" else 0
    return quote_offer(offer, qty, now=now, legacy_percent=percent)


def assert_client_amount(quote: PriceQuote, client_rupees) -> None:
    if client_rupees in (None, ""):
        return
    try:
        client_paise = rupees_to_paise(client_rupees)
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=400, detail="The submitted amount does not match this ticket offer.")
    if abs(client_paise - quote.total_paise) > 100:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The submitted amount does not match the ticket price. Refresh and try again.",
        )


def quote_from_proof(row) -> PriceQuote:
    """Rebuild the price frozen on a checkout reservation. Does not re-check the sale window."""
    paise = getattr(row, "total_amount_paise", None)
    if paise is None:
        paise = rupees_to_paise(getattr(row, "amount", 0) or 0)
    attendees = _as_int(getattr(row, "attendee_count", None) or getattr(row, "quantity", None), 1)
    purchased = _as_int(getattr(row, "purchase_quantity", None) or attendees, 1)
    pricing = str(getattr(row, "pricing_type", None) or "legacy")
    return PriceQuote(
        offer_id=str(getattr(row, "offer_id", None) or ""),
        offer_name=str(getattr(row, "ticket_type", None) or "Ticket")[:100],
        pricing_type=pricing,
        purchase_quantity=max(1, purchased),
        attendee_count=max(1, attendees),
        total_paise=int(paise),
        legacy=pricing not in ("per_person", "package"),
    )


def _reserved_units(db, event_id: str, offer: dict) -> int:
    from Models.payment_proof import PaymentProof
    offer_id = str(offer.get("offer_id") or "")
    name = _offer_name(offer).lower()
    try:
        rows = (
            db.query(PaymentProof)
            .filter(PaymentProof.event_id == str(event_id))
            .filter(PaymentProof.status.in_(("payment_submitted", "qr_ready")))
            .all()
        )
    except Exception:
        db.rollback()
        return 0
    used = 0
    for row in rows:
        if offer_id and str(getattr(row, "offer_id", "") or "") == offer_id:
            used += _as_int(getattr(row, "purchase_quantity", None) or getattr(row, "quantity", None), 0)
        elif not offer_id and str(getattr(row, "ticket_type", "") or "").strip().lower() == name:
            used += _as_int(getattr(row, "purchase_quantity", None) or getattr(row, "quantity", None), 0)
    return used


def assert_offer_capacity(db, event_id: str, offer: dict, purchase_quantity: int) -> None:
    """Capacity on the offer is the maximum number of tickets or packages, not a silent price."""
    raw_cap = offer.get("qty", offer.get("quantity"))
    if raw_cap in (None, ""):
        return
    cap = _as_int(raw_cap, 0)
    if cap <= 0:
        return
    if _reserved_units(db, event_id, offer) + purchase_quantity > cap:
        raise HTTPException(status_code=400, detail="Not enough tickets left for this offer.")


def seats_for_offer(
    offer: Optional[dict],
    *,
    stored_quantity: int = 1,
    purchase_quantity: int = 0,
    attendee_count: int = 0,
) -> int:
    """How many QR tickets to issue.

    One purchased package produces one ticket per person in that package.
    A package of 3, 6, 10, 15, or any larger size uses the same rule.
    Buying two packages multiplies by the number of packages, not by an
    attendee total that was already stored. A per-person purchase stays
    one ticket per purchased seat.
    """
    stored = max(1, _as_int(stored_quantity, 1))
    attendees = max(0, _as_int(attendee_count, 0))
    purchase = max(0, _as_int(purchase_quantity, 0))
    if not isinstance(offer, dict):
        return max(stored, attendees)
    pricing = str(offer.get("pricing_type") or "").strip().lower()
    people = _as_int(offer.get("package_quantity"), 0)
    if pricing != "package" or people < 2:
        return attendees if attendees >= 1 else stored
    # purchase_quantity is the number of packages. attendee_count and a stored
    # quantity that is already a multiple of the package size are seat totals.
    # Never multiply a seat total by the package size again.
    if purchase >= 1:
        seats = people * purchase
        if attendees == seats or stored == seats:
            return seats
        if attendees > seats and attendees % people == 0:
            return attendees
        if stored > seats and stored % people == 0:
            return stored
        return seats
    if attendees >= people and attendees % people == 0:
        return attendees
    if stored >= people and stored % people == 0:
        return stored
    return people * stored


def seat_count_for_proof(db, row, event_id, ticket_type: str = "") -> int:
    """Resolve issued QR count from the payment snapshot, then the event's package size."""
    stored = _as_int(getattr(row, "quantity", None), 1)
    attendees = _as_int(getattr(row, "attendee_count", None), 0)
    purchase = _as_int(getattr(row, "purchase_quantity", None), 0)
    offer_id = str(getattr(row, "offer_id", "") or "").strip()
    name = str(getattr(row, "ticket_type", None) or ticket_type or "").strip()
    offer = None
    try:
        _, rows = _load_host_tickets(db, event_id)
        offer = find_offer(rows, offer_id=offer_id, ticket_name="" if offer_id else name)
        if offer is None and name:
            offer = find_offer(rows, ticket_name=name)
    except Exception:
        offer = None
    return max(1, seats_for_offer(
        offer,
        stored_quantity=stored,
        purchase_quantity=purchase,
        attendee_count=attendees,
    ))


def apply_quote_to_proof(row, quote: PriceQuote) -> None:
    """Snapshot the server price onto a payment row. Quantity stored is the attendee count."""
    row.ticket_type = quote.offer_name[:100]
    row.amount = quote.total_rupees
    row.quantity = quote.attendee_count
    if hasattr(row, "offer_id"):
        row.offer_id = quote.offer_id or None
    if hasattr(row, "pricing_type"):
        row.pricing_type = quote.pricing_type
    if hasattr(row, "purchase_quantity"):
        row.purchase_quantity = quote.purchase_quantity
    if hasattr(row, "attendee_count"):
        row.attendee_count = quote.attendee_count
    if hasattr(row, "total_amount_paise"):
        row.total_amount_paise = quote.total_paise
    if hasattr(row, "currency"):
        row.currency = quote.currency
