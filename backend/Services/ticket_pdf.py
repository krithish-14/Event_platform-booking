"""M-ticket PDF used for email attachments and website download.

Stdlib + httpx only. Layout matches the on-screen ticket card: poster, title,
date, venue, ticket type, QR, booking ID, and totals — no savings badge.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from typing import Optional
from urllib.parse import quote

import httpx


def _pdf_escape(text: str) -> str:
    cleaned = (text or "").encode("latin-1", "replace").decode("latin-1")
    return cleaned.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _ascii_text(value, fallback: str = "") -> str:
    text = str(value or fallback or "").replace("₹", "Rs.").replace("\u20b9", "Rs.")
    text = re.sub(r"\s+", " ", text).strip()
    return text.encode("latin-1", "replace").decode("latin-1")


def _format_event_date(value) -> str:
    if not value:
        return "Date TBA"
    if isinstance(value, datetime):
        return value.strftime("%a, %b %d, %Y, %I:%M %p").replace(" 0", " ")
    text = str(value).strip()
    if not text:
        return "Date TBA"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%a, %b %d, %Y, %I:%M %p").replace(" 0", " ")
    except Exception:
        return _ascii_text(text[:48], "Date TBA")


def _short_booking_id(booking_id) -> str:
    raw = str(booking_id or "00000000").replace("-", "")
    return (raw[:8] or "00000000").upper()


def _money(value) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0.0
    if abs(amount - round(amount)) < 0.005:
        return f"Rs. {int(round(amount)):,}"
    return f"Rs. {amount:,.2f}"


def _wrap_text(text: str, max_chars: int, max_lines: int = 3) -> list[str]:
    words = _ascii_text(text).split()
    if not words:
        return [""]
    lines, current = [], ""
    for word in words:
        trial = (current + " " + word).strip()
        if len(trial) <= max_chars:
            current = trial
            continue
        if current:
            lines.append(current)
        current = word if len(word) <= max_chars else word[:max_chars]
        if len(lines) >= max_lines:
            break
    if current and len(lines) < max_lines:
        lines.append(current)
    return lines or [""]


def _jpeg_dimensions(data: bytes) -> tuple[int, int]:
    i = 2
    while i < len(data) - 8:
        if data[i] != 0xFF:
            i += 1
            continue
        marker = data[i + 1]
        if marker in (0xC0, 0xC1, 0xC2, 0xC3):
            height = int.from_bytes(data[i + 5 : i + 7], "big")
            width = int.from_bytes(data[i + 7 : i + 9], "big")
            if width > 0 and height > 0:
                return width, height
        if marker in (0xD8, 0xD9, 0x01) or (0xD0 <= marker <= 0xD7):
            i += 2
            continue
        length = int.from_bytes(data[i + 2 : i + 4], "big")
        i += 2 + max(length, 0)
    return 280, 280


def _fetch_jpeg(url: str, timeout: float = 12.0) -> bytes:
    target = (url or "").strip()
    if not target.startswith("http://") and not target.startswith("https://"):
        return b""
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            res = client.get(target)
        if res.status_code != 200 or not res.content:
            return b""
        if res.content[:2] != b"\xff\xd8":
            return b""
        return res.content
    except Exception:
        return b""


def _fetch_qr_jpeg(qr_token: str) -> bytes:
    token = (qr_token or "").strip()
    if not token:
        return b""
    url = (
        "https://api.qrserver.com/v1/create-qr-code/"
        f"?size=280x280&format=jpeg&margin=8&data={quote(token)}"
    )
    return _fetch_jpeg(url)


def _absolute_media_url(path: str) -> str:
    raw = str(path or "").strip()
    if not raw:
        return ""
    if raw.startswith("http://") or raw.startswith("https://"):
        return raw
    origin = (
        os.getenv("PUBLIC_API_ORIGIN")
        or os.getenv("API_PUBLIC_ORIGIN")
        or "https://api.jodevents.com"
    ).rstrip("/")
    if raw.startswith("images/") or raw.startswith("./images/") or raw.startswith("/images/"):
        return "https://assets.jodevents.com/images/" + re.sub(r"^(\./)?/?images/", "", raw)
    if not raw.startswith("/"):
        raw = "/" + raw
    return origin + raw


def _assemble_pdf(object_bodies: list[bytes]) -> bytes:
    header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    chunks = [header]
    offsets = [0]
    pos = len(header)
    for body in object_bodies:
        offsets.append(pos)
        chunk = f"{len(chunks)} 0 obj\n".encode("ascii") + body + b"\nendobj\n"
        chunks.append(chunk)
        pos += len(chunk)
    xref = [f"xref\n0 {len(object_bodies) + 1}\n".encode("ascii"), b"0000000000 65535 f \n"]
    for offset in offsets[1:]:
        xref.append(f"{offset:010d} 00000 n \n".encode("ascii"))
    trailer = (
        f"trailer\n<< /Size {len(object_bodies) + 1} /Root 1 0 R >>\n"
        f"startxref\n{pos}\n%%EOF\n"
    ).encode("ascii")
    return b"".join(chunks + xref + [trailer])


def _image_xobject(jpeg: bytes, width: int, height: int) -> bytes:
    return (
        b"<< /Type /XObject /Subtype /Image "
        + f"/Width {width} /Height {height} ".encode("ascii")
        + b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
        + f"/Length {len(jpeg)} >>\nstream\n".encode("ascii")
        + jpeg
        + b"\nendstream"
    )


def _draw_image(name: str, x: float, y: float, w: float, h: float) -> str:
    return f"q {w:.1f} 0 0 {h:.1f} {x:.1f} {y:.1f} cm /{name} Do Q"


def ticket_pdf_filename(booking_id, kind: str = "ticket") -> str:
    prefix = "JOD-Invoice" if str(kind).strip().lower() == "invoice" else "JOD-Ticket"
    return f"{prefix}-{_short_booking_id(booking_id)}.pdf"


def build_mticket_pdf_bytes(
    *,
    booking_id,
    event_name: str,
    event_date=None,
    venue: str = "",
    language: str = "English",
    event_format: str = "Live Event",
    ticket_type: str = "General Admission",
    quantity: int = 1,
    total_price: float = 0,
    gst_amount: float = 0,
    qr_token: str = "",
    poster_url: str = "",
    seat_number: str = "General Admission",
    payment_mode: str = "",
    include_qr: bool = True,
) -> Optional[bytes]:
    """One-page M-ticket PDF. Returns None if assembly fails."""
    try:
        title = _ascii_text(event_name, "JOD Events") or "JOD Events"
        date_label = _ascii_text(_format_event_date(event_date), "Date TBA")
        venue_label = _ascii_text(venue, "Venue details at location")
        format_label = _ascii_text(
            f"{language or 'English'}, {event_format or 'Live Event'}",
            "English, Live Event",
        )
        type_label = _ascii_text(ticket_type, "Standard Access")
        seat_label = _ascii_text(seat_number, "General Admission")
        qty = max(1, int(quantity or 1))
        total = float(total_price or 0)
        gst = float(gst_amount or 0)
        if gst <= 0 and total > 0:
            gst = round(total * 0.18, 2)
        subtotal = max(0.0, total - gst)
        booking_label = f"JOD-{_short_booking_id(booking_id)}"
        show_qr = bool(include_qr)
        qr_jpeg = _fetch_qr_jpeg(qr_token) if show_qr else b""
        poster_jpeg = _fetch_jpeg(_absolute_media_url(poster_url)) if poster_url else b""
        badge_label = "INVOICE" if not show_qr else "M-TICKET"

        # A4 page, white ticket card centered.
        card_x, card_y, card_w, card_h = 72.0, 90.0, 451.0, 662.0
        inner_x = card_x + 22
        inner_right = card_x + card_w - 22
        y = card_y + card_h - 28

        ops = [
            "0.94 0.95 0.97 rg 0 0 595 842 re f",
            "1 1 1 rg 0.82 0.84 0.86 RG 1.2 w",
            f"{card_x:.1f} {card_y:.1f} {card_w:.1f} {card_h:.1f} re B",
            "1 0.46 0.03 rg",
            f"{card_x:.1f} {card_y + card_h - 6:.1f} {card_w:.1f} 6 re f",
        ]

        xobjects = {}
        poster_name = ""
        if poster_jpeg:
            poster_name = "ImP"
            pw, ph = _jpeg_dimensions(poster_jpeg)
            box_w, box_h = 78.0, 104.0
            xobjects[poster_name] = (poster_jpeg, pw, ph)
            ops.append(_draw_image(poster_name, inner_x, y - box_h, box_w, box_h))
            text_x = inner_x + box_w + 14
        else:
            text_x = inner_x

        title_width_chars = 28 if poster_jpeg else 36
        title_lines = _wrap_text(title, title_width_chars, 2)
        ops.extend([
            "BT",
            "/F1 16 Tf 0.07 0.09 0.16 rg",
            f"1 0 0 1 {text_x:.1f} {y - 18:.1f} Tm ({_pdf_escape(title_lines[0])}) Tj",
        ])
        cursor = y - 18
        if len(title_lines) > 1:
            cursor -= 18
            ops.append(f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(title_lines[1])}) Tj")
        cursor -= 16
        ops.extend([
            "/F2 10 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(format_label[:42])}) Tj",
        ])
        cursor -= 16
        ops.extend([
            "/F1 11 Tf 0.07 0.09 0.16 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(date_label[:42])}) Tj",
        ])
        cursor -= 15
        ops.extend([
            "/F2 10 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(venue_label[:42])}) Tj",
            "/F1 8 Tf 0.62 0.65 0.70 rg",
            f"1 0 0 1 {inner_right - 52:.1f} {y - 8:.1f} Tm ({_pdf_escape(badge_label)}) Tj",
            "ET",
        ])

        block_top = min(cursor, y - (104 if poster_jpeg else 70)) - 18
        ops.extend([
            "0.89 0.91 0.94 RG 0.8 w",
            f"{inner_x:.1f} {block_top + 10:.1f} m {inner_right:.1f} {block_top + 10:.1f} l S",
            "BT",
            "/F2 10 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {inner_x:.1f} {block_top - 6:.1f} Tm ({_pdf_escape(f'{qty} Ticket(s)')}) Tj",
            "/F1 16 Tf 0.07 0.09 0.16 rg",
            f"1 0 0 1 {inner_x:.1f} {block_top - 28:.1f} Tm ({_pdf_escape(type_label[:34])}) Tj",
            "/F2 10 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {inner_x:.1f} {block_top - 44:.1f} Tm ({_pdf_escape(seat_label[:34])}) Tj",
            "ET",
        ])

        if show_qr:
            qr_top = block_top - 64
            qr_size = 168.0
            qr_x = card_x + (card_w - qr_size) / 2
            qr_y = qr_top - qr_size
            if qr_jpeg:
                qw, qh = _jpeg_dimensions(qr_jpeg)
                xobjects["ImQ"] = (qr_jpeg, qw, qh)
                ops.extend([
                    "0.93 0.94 0.96 RG 1 w",
                    f"{qr_x - 8:.1f} {qr_y - 8:.1f} {qr_size + 16:.1f} {qr_size + 16:.1f} re S",
                    _draw_image("ImQ", qr_x, qr_y, qr_size, qr_size),
                ])
            else:
                ops.extend([
                    "0.97 0.98 0.99 rg 0.82 0.84 0.86 RG",
                    f"{qr_x:.1f} {qr_y:.1f} {qr_size:.1f} {qr_size:.1f} re B",
                    "BT /F2 11 Tf 0.42 0.45 0.50 rg",
                    f"1 0 0 1 {qr_x + 36:.1f} {qr_y + 84:.1f} Tm ({_pdf_escape('QR pending')}) Tj ET",
                ])
            policy_y = qr_y - 46
            ops.extend([
                "BT",
                "/F1 12 Tf 0.07 0.09 0.16 rg",
                f"1 0 0 1 {card_x + (card_w - 148) / 2:.1f} {qr_y - 24:.1f} Tm ({_pdf_escape('BOOKING ID: ' + booking_label)}) Tj",
                "/F2 9 Tf 0.42 0.45 0.50 rg",
                f"1 0 0 1 {inner_x:.1f} {policy_y:.1f} Tm ({_pdf_escape('Cancellation available up to 24h prior to showtime')}) Tj",
                "ET",
            ])
            divider_y = card_y + 92
        else:
            policy_y = block_top - 64
            ops.extend([
                "BT",
                "/F2 9 Tf 0.42 0.45 0.50 rg",
                f"1 0 0 1 {inner_x:.1f} {policy_y:.1f} Tm ({_pdf_escape('Cancellation available up to 24h prior to showtime')}) Tj",
                "ET",
            ])
            divider_y = policy_y - 22

        ops.extend([
            "[6 4] 0 d 0.80 0.83 0.86 RG 1 w",
            f"{inner_x:.1f} {divider_y:.1f} m {inner_right:.1f} {divider_y:.1f} l S",
            "[] 0 d",
            "BT",
            "/F1 12 Tf 0.07 0.09 0.16 rg",
            f"1 0 0 1 {inner_x:.1f} {divider_y - 24:.1f} Tm ({_pdf_escape('Total Amount')}) Tj",
            f"1 0 0 1 {inner_right - 78:.1f} {divider_y - 24:.1f} Tm ({_pdf_escape(_money(total))}) Tj",
            "/F2 9 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {inner_x:.1f} {divider_y - 42:.1f} Tm ({_pdf_escape(f'Ticket price (x{qty})')}) Tj",
            f"1 0 0 1 {inner_right - 78:.1f} {divider_y - 42:.1f} Tm ({_pdf_escape(_money(subtotal))}) Tj",
            f"1 0 0 1 {inner_x:.1f} {divider_y - 56:.1f} Tm ({_pdf_escape('Convenience fee & GST (18%)')}) Tj",
            f"1 0 0 1 {inner_right - 78:.1f} {divider_y - 56:.1f} Tm ({_pdf_escape(_money(gst))}) Tj",
        ])
        if payment_mode:
            ops.extend([
                f"1 0 0 1 {inner_x:.1f} {divider_y - 70:.1f} Tm ({_pdf_escape('Payment Mode')}) Tj",
                f"1 0 0 1 {inner_right - 110:.1f} {divider_y - 70:.1f} Tm ({_pdf_escape(_ascii_text(payment_mode)[:22])}) Tj",
            ])
        ops.append("ET")

        stream = "\n".join(ops).encode("latin-1", "replace")
        xobject_refs = []
        image_objects = []
        next_obj = 7
        for name, (jpeg, width, height) in xobjects.items():
            xobject_refs.append(f"/{name} {next_obj} 0 R")
            image_objects.append(_image_xobject(jpeg, width, height))
            next_obj += 1
        xobject_dict = f"/XObject << {' '.join(xobject_refs)} >>" if xobject_refs else ""
        resources = (
            f"<< /Font << /F1 4 0 R /F2 5 0 R >> {xobject_dict} >>".encode("ascii")
        )
        contents_obj = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
        page_obj = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources "
            + resources
            + b" /Contents 6 0 R >>"
        )
        objects = [
            b"<< /Type /Catalog /Pages 2 0 R >>",
            b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
            page_obj,
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
            b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
            contents_obj,
        ]
        objects.extend(image_objects)
        return _assemble_pdf(objects)
    except Exception:
        return None


def build_mticket_pdf_from_booking(booking, qr_token: str = "", db=None, include_qr: bool = True) -> Optional[bytes]:
    """Build the M-ticket PDF from a Booking ORM row."""
    event = getattr(booking, "event", None)
    token = (qr_token or "").strip()
    if not token:
        tickets = list(getattr(booking, "tickets", None) or [])
        for ticket in tickets:
            if (getattr(ticket, "qr_token", None) or "").strip():
                token = ticket.qr_token.strip()
                break
    poster = ""
    if event is not None:
        poster = getattr(event, "card_image", None) or getattr(event, "image_url", None) or ""
    qty = max(1, int(getattr(booking, "quantity", 1) or 1))
    total = float(getattr(booking, "total_price", 0) or 0)
    gst = float(getattr(booking, "gst_amount", 0) or 0)
    return build_mticket_pdf_bytes(
        booking_id=getattr(booking, "booking_id", ""),
        event_name=getattr(event, "title", None) if event is not None else "JOD Events",
        event_date=getattr(event, "start_date", None) if event is not None else None,
        venue=(getattr(event, "venue", None) or getattr(event, "location", None) or "") if event is not None else "",
        language=getattr(event, "language", None) if event is not None else "English",
        event_format=getattr(event, "event_format", None) if event is not None else "Live Event",
        ticket_type=getattr(booking, "ticket_type", None) or "General Admission",
        quantity=qty,
        total_price=total,
        gst_amount=gst,
        qr_token=token,
        poster_url=poster,
        seat_number=getattr(booking, "seat_number", None) or "General Admission",
        payment_mode=getattr(booking, "payment_mode", None) or "",
        include_qr=include_qr,
    )


def build_ticket_pdf_bytes(
    *,
    booking_id,
    event_name: str,
    event_date=None,
    qr_token: str,
    venue: str = "",
    language: str = "English",
    event_format: str = "Live Event",
    ticket_type: str = "General Admission",
    quantity: int = 1,
    total_price: float = 0,
    gst_amount: float = 0,
    poster_url: str = "",
    seat_number: str = "General Admission",
    payment_mode: str = "",
    include_qr: bool = True,
) -> Optional[bytes]:
    """Compatibility wrapper — same M-ticket PDF as email and download."""
    return build_mticket_pdf_bytes(
        booking_id=booking_id,
        event_name=event_name,
        event_date=event_date,
        venue=venue,
        language=language,
        event_format=event_format,
        ticket_type=ticket_type,
        quantity=quantity,
        total_price=total_price,
        gst_amount=gst_amount,
        qr_token=qr_token,
        poster_url=poster_url,
        seat_number=seat_number,
        payment_mode=payment_mode,
        include_qr=include_qr,
    )
