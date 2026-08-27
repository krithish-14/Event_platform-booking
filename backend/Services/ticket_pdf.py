"""M-ticket PDF used for email attachments and website download.

Stdlib + httpx (Pillow optional for WebP/GIF). Layout matches the on-screen
ticket card: rounded card, poster thumbnail, title, date, venue, ticket type,
QR, booking ID, and totals — no orange bar, no savings badge.
"""

from __future__ import annotations

import os
import re
import struct
import zlib
from datetime import datetime
from io import BytesIO
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
    parsed = value if isinstance(value, datetime) else None
    if parsed is None:
        text = str(value).strip()
        if not text:
            return "Date TBA"
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return _ascii_text(text[:48], "Date TBA")
    return f"{parsed.strftime('%a, %b')} {parsed.day}, {parsed.strftime('%Y, %I:%M %p')}"


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


def _fetch_bytes(url: str, timeout: float = 12.0) -> bytes:
    target = (url or "").strip()
    if not target.startswith("http://") and not target.startswith("https://"):
        return b""
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            res = client.get(target, headers={"User-Agent": "JOD-Events-TicketPDF/1.0"})
        if res.status_code != 200 or not res.content:
            return b""
        return res.content
    except Exception:
        return b""


def _fetch_jpeg(url: str, timeout: float = 12.0) -> bytes:
    data = _fetch_bytes(url, timeout=timeout)
    if data[:2] != b"\xff\xd8":
        return b""
    return data


def _fetch_qr_jpeg(qr_token: str) -> bytes:
    token = (qr_token or "").strip()
    if not token:
        return b""
    url = (
        "https://api.qrserver.com/v1/create-qr-code/"
        f"?size=280x280&format=jpeg&margin=8&data={quote(token)}"
    )
    return _fetch_jpeg(url)


def _paeth(a: int, b: int, c: int) -> int:
    p = a + b - c
    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
    if pa <= pb and pa <= pc:
        return a
    if pb <= pc:
        return b
    return c


def _unfilter_png_rows(raw: bytes, height: int, stride: int, bpp: int) -> Optional[list[bytearray]]:
    expected = (stride + 1) * height
    if len(raw) < expected or stride <= 0:
        return None
    prev = bytearray(stride)
    rows = []
    src = 0
    for _ in range(height):
        ftype = raw[src]
        src += 1
        row = bytearray(raw[src : src + stride])
        src += stride
        if ftype == 1:
            for i in range(stride):
                row[i] = (row[i] + (row[i - bpp] if i >= bpp else 0)) & 255
        elif ftype == 2:
            for i in range(stride):
                row[i] = (row[i] + prev[i]) & 255
        elif ftype == 3:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + ((left + prev[i]) // 2)) & 255
        elif ftype == 4:
            for i in range(stride):
                left = row[i - bpp] if i >= bpp else 0
                up = prev[i]
                ul = prev[i - bpp] if i >= bpp else 0
                row[i] = (row[i] + _paeth(left, up, ul)) & 255
        elif ftype != 0:
            return None
        prev = row
        rows.append(row)
    return rows


def _composite_white(r: int, g: int, b: int, a: int) -> tuple[int, int, int]:
    if a >= 255:
        return r, g, b
    inv = 255 - a
    return (
        (r * a + 255 * inv + 127) // 255,
        (g * a + 255 * inv + 127) // 255,
        (b * a + 255 * inv + 127) // 255,
    )


def _decode_png_rgb(data: bytes) -> Optional[tuple[bytes, int, int]]:
    """Decode common 8-bit PNG types to raw RGB. Returns None if unsupported."""
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    pos = 8
    width = height = bit_depth = color_type = None
    interlace = 0
    idat = []
    palette = b""
    trns = b""
    while pos + 8 <= len(data):
        length = int.from_bytes(data[pos : pos + 4], "big")
        if pos + 12 + length > len(data):
            break
        ctype = data[pos + 4 : pos + 8]
        chunk = data[pos + 8 : pos + 8 + length]
        pos += 12 + length
        if ctype == b"IHDR" and len(chunk) >= 13:
            width, height, bit_depth, color_type, _comp, _filt, interlace = struct.unpack(
                ">IIBBBBB", chunk[:13]
            )
        elif ctype == b"PLTE":
            palette = chunk
        elif ctype == b"tRNS":
            trns = chunk
        elif ctype == b"IDAT":
            idat.append(chunk)
        elif ctype == b"IEND":
            break
    if not width or not height or not idat or interlace != 0 or bit_depth != 8:
        return None
    if color_type not in (0, 2, 3, 4, 6):
        return None
    try:
        raw = zlib.decompress(b"".join(idat))
    except Exception:
        return None
    channels = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}[color_type]
    stride = width * channels
    rows = _unfilter_png_rows(raw, height, stride, channels)
    if rows is None:
        return None
    out = bytearray(width * height * 3)
    dst = 0
    if color_type == 2:
        for row in rows:
            out[dst : dst + stride] = row
            dst += stride
    elif color_type == 6:
        for row in rows:
            for i in range(0, stride, 4):
                r, g, b, a = row[i : i + 4]
                out[dst], out[dst + 1], out[dst + 2] = _composite_white(r, g, b, a)
                dst += 3
    elif color_type == 0:
        for row in rows:
            for v in row:
                out[dst : dst + 3] = bytes((v, v, v))
                dst += 3
    elif color_type == 4:
        for row in rows:
            for i in range(0, stride, 2):
                v, a = row[i], row[i + 1]
                c, _, _ = _composite_white(v, v, v, a)
                out[dst : dst + 3] = bytes((c, c, c))
                dst += 3
    else:
        if len(palette) < 3:
            return None
        for row in rows:
            for idx in row:
                base = idx * 3
                if base + 2 >= len(palette):
                    r = g = b = 0
                else:
                    r, g, b = palette[base], palette[base + 1], palette[base + 2]
                a = trns[idx] if idx < len(trns) else 255
                out[dst], out[dst + 1], out[dst + 2] = _composite_white(r, g, b, a)
                dst += 3
    return bytes(out), width, height


def _scale_rgb(rgb: bytes, width: int, height: int, max_w: int = 360, max_h: int = 480) -> tuple[bytes, int, int]:
    if width <= max_w and height <= max_h:
        return rgb, width, height
    scale = min(max_w / width, max_h / height)
    nw = max(1, int(width * scale))
    nh = max(1, int(height * scale))
    out = bytearray(nw * nh * 3)
    for y in range(nh):
        sy = min(height - 1, int(y / scale))
        for x in range(nw):
            sx = min(width - 1, int(x / scale))
            i = (sy * width + sx) * 3
            o = (y * nw + x) * 3
            out[o : o + 3] = rgb[i : i + 3]
    return bytes(out), nw, nh


def _via_pillow(data: bytes) -> Optional[tuple[str, bytes, int, int]]:
    try:
        from PIL import Image
    except Exception:
        return None
    try:
        image = Image.open(BytesIO(data))
        image = image.convert("RGB")
        image.thumbnail((360, 480))
        buf = BytesIO()
        image.save(buf, format="JPEG", quality=85)
        jpeg = buf.getvalue()
        return "DCTDecode", jpeg, image.size[0], image.size[1]
    except Exception:
        return None


def _load_poster_image(url: str) -> Optional[tuple[str, bytes, int, int]]:
    data = _fetch_bytes(url)
    if not data:
        return None
    if data[:2] == b"\xff\xd8":
        width, height = _jpeg_dimensions(data)
        return "DCTDecode", data, width, height
    png = _decode_png_rgb(data)
    if png:
        rgb, width, height = png
        rgb, width, height = _scale_rgb(rgb, width, height)
        return "FlateDecode", zlib.compress(rgb, 9), width, height
    return _via_pillow(data)


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


def _image_xobject(payload: bytes, width: int, height: int, pdf_filter: str = "DCTDecode") -> bytes:
    return (
        b"<< /Type /XObject /Subtype /Image "
        + f"/Width {width} /Height {height} ".encode("ascii")
        + b"/ColorSpace /DeviceRGB /BitsPerComponent 8 "
        + f"/Filter /{pdf_filter} ".encode("ascii")
        + f"/Length {len(payload)} >>\nstream\n".encode("ascii")
        + payload
        + b"\nendstream"
    )


def _draw_image(name: str, x: float, y: float, w: float, h: float) -> str:
    return f"q {w:.1f} 0 0 {h:.1f} {x:.1f} {y:.1f} cm /{name} Do Q"


def _round_rect_path(x: float, y: float, w: float, h: float, r: float) -> str:
    r = min(r, w / 2.0, h / 2.0)
    k = 0.552284749831 * r
    return (
        f"{x + r:.2f} {y:.2f} m "
        f"{x + w - r:.2f} {y:.2f} l "
        f"{x + w - r + k:.2f} {y:.2f} {x + w:.2f} {y + r - k:.2f} {x + w:.2f} {y + r:.2f} c "
        f"{x + w:.2f} {y + h - r:.2f} l "
        f"{x + w:.2f} {y + h - r + k:.2f} {x + w - r + k:.2f} {y + h:.2f} {x + w - r:.2f} {y + h:.2f} c "
        f"{x + r:.2f} {y + h:.2f} l "
        f"{x + r - k:.2f} {y + h:.2f} {x:.2f} {y + h - r + k:.2f} {x:.2f} {y + h - r:.2f} c "
        f"{x:.2f} {y + r:.2f} l "
        f"{x:.2f} {y + r - k:.2f} {x + r - k:.2f} {y:.2f} {x + r:.2f} {y:.2f} c h"
    )


def _cover_image(
    name: str,
    box_x: float,
    box_y: float,
    box_w: float,
    box_h: float,
    img_w: int,
    img_h: int,
    radius: float = 6.0,
) -> str:
    if img_w <= 0 or img_h <= 0:
        return ""
    scale = max(box_w / img_w, box_h / img_h)
    dw, dh = img_w * scale, img_h * scale
    x = box_x + (box_w - dw) / 2.0
    y = box_y + (box_h - dh) / 2.0
    clip = _round_rect_path(box_x, box_y, box_w, box_h, radius)
    return f"q {clip} W n {_draw_image(name, x, y, dw, dh)} Q"


def _tj_right(right_x: float, y: float, text: str, char_w: float) -> str:
    return f"1 0 0 1 {right_x - max(1, len(text)) * char_w:.1f} {y:.1f} Tm ({_pdf_escape(text)}) Tj"


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
        poster = _load_poster_image(_absolute_media_url(poster_url)) if poster_url else None
        badge_label = "Invoice" if not show_qr else "M-Ticket"

        poster_w, poster_h = 88.0, 110.0
        qr_size = 180.0
        header_h = poster_h
        seating_h = 58.0
        qr_block_h = (qr_size + 44.0) if show_qr else 0.0
        policy_h = 16.0
        totals_h = 86.0 if payment_mode else 70.0
        pad_x, pad_y = 22.0, 20.0
        card_w = 451.0
        card_h = pad_y * 2 + header_h + 18 + seating_h + (16 if show_qr else 8) + qr_block_h + 14 + policy_h + 18 + totals_h
        card_x = (595.0 - card_w) / 2.0
        card_y = max(36.0, (842.0 - card_h) / 2.0)
        inner_x = card_x + pad_x
        inner_right = card_x + card_w - pad_x
        y = card_y + card_h - pad_y

        ops = [
            "0.97 0.97 0.98 rg 0 0 595 842 re f",
            "1 1 1 rg 0.83 0.85 0.88 RG 1 w",
            f"{_round_rect_path(card_x, card_y, card_w, card_h, 12)} B",
        ]

        xobjects: dict[str, tuple[bytes, int, int, str]] = {}
        poster_box_x, poster_box_y = inner_x, y - poster_h
        if poster:
            filt, payload, pw, ph = poster
            xobjects["ImP"] = (payload, pw, ph, filt)
            ops.append(_cover_image("ImP", poster_box_x, poster_box_y, poster_w, poster_h, pw, ph, 8))
        else:
            ops.extend([
                "0.90 0.91 0.93 rg",
                f"{_round_rect_path(poster_box_x, poster_box_y, poster_w, poster_h, 8)} f",
            ])

        text_x = inner_x + poster_w + 12
        title_lines = _wrap_text(title, 30, 2)
        venue_lines = _wrap_text(venue_label, 38, 2)
        ops.extend([
            "BT",
            "/F1 15 Tf 0.07 0.09 0.15 rg",
            f"1 0 0 1 {text_x:.1f} {y - 16:.1f} Tm ({_pdf_escape(title_lines[0])}) Tj",
        ])
        cursor = y - 16
        if len(title_lines) > 1:
            cursor -= 16
            ops.append(f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(title_lines[1])}) Tj")
        cursor -= 15
        ops.extend([
            "/F2 9 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(format_label[:42])}) Tj",
        ])
        cursor -= 14
        ops.extend([
            "/F1 10 Tf 0.07 0.09 0.15 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(date_label[:44])}) Tj",
        ])
        cursor -= 13
        ops.extend([
            "/F2 9 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(venue_lines[0])}) Tj",
        ])
        if len(venue_lines) > 1:
            cursor -= 12
            ops.append(f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(venue_lines[1])}) Tj")
        ops.extend([
            "/F1 8 Tf 0.61 0.64 0.69 rg",
            _tj_right(inner_right, y - 16, badge_label, 5.1),
            "ET",
        ])

        block_top = poster_box_y - 16
        ops.extend([
            "0.89 0.91 0.94 RG 0.7 w",
            f"{inner_x:.1f} {block_top + 8:.1f} m {inner_right:.1f} {block_top + 8:.1f} l S",
            "BT",
            "/F2 9 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {inner_x:.1f} {block_top - 6:.1f} Tm ({_pdf_escape(f'{qty} Ticket(s)')}) Tj",
            "/F1 14 Tf 0.07 0.09 0.15 rg",
            f"1 0 0 1 {inner_x:.1f} {block_top - 26:.1f} Tm ({_pdf_escape(type_label[:34])}) Tj",
            "/F2 10 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {inner_x:.1f} {block_top - 42:.1f} Tm ({_pdf_escape(seat_label[:34])}) Tj",
            "ET",
        ])

        if show_qr:
            qr_top = block_top - 58
            qr_x = card_x + (card_w - qr_size) / 2.0
            qr_y = qr_top - qr_size
            if qr_jpeg:
                qw, qh = _jpeg_dimensions(qr_jpeg)
                xobjects["ImQ"] = (qr_jpeg, qw, qh, "DCTDecode")
                ops.append(_draw_image("ImQ", qr_x, qr_y, qr_size, qr_size))
            else:
                ops.extend([
                    "0.97 0.98 0.99 rg 0.82 0.84 0.86 RG 0.8 w",
                    f"{qr_x:.1f} {qr_y:.1f} {qr_size:.1f} {qr_size:.1f} re B",
                    "BT /F2 11 Tf 0.42 0.45 0.50 rg",
                    f"1 0 0 1 {qr_x + 48:.1f} {qr_y + 90:.1f} Tm ({_pdf_escape('QR pending')}) Tj ET",
                ])
            booking_text = f"BOOKING ID: #{booking_label}"
            booking_w = len(booking_text) * 6.35
            ops.extend([
                "BT",
                "/F1 11 Tf 0.07 0.09 0.15 rg",
                f"1 0 0 1 {card_x + (card_w - booking_w) / 2.0:.1f} {qr_y - 22:.1f} Tm ({_pdf_escape(booking_text)}) Tj",
                "ET",
            ])
            policy_y = qr_y - 42
        else:
            policy_y = block_top - 60

        policy_text = "Cancellation available up to 24h prior to showtime"
        policy_w = len(policy_text) * 4.35
        ops.extend([
            "BT",
            "/F2 8 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {card_x + (card_w - policy_w) / 2.0:.1f} {policy_y:.1f} Tm ({_pdf_escape(policy_text)}) Tj",
            "ET",
            "[5 4] 0 d 0.80 0.83 0.86 RG 1 w",
            f"{inner_x:.1f} {policy_y - 14:.1f} m {inner_right:.1f} {policy_y - 14:.1f} l S",
            "[] 0 d",
        ])
        divider_y = policy_y - 14
        ops.extend([
            "BT",
            "/F1 11 Tf 0.07 0.09 0.15 rg",
            f"1 0 0 1 {inner_x:.1f} {divider_y - 22:.1f} Tm ({_pdf_escape('Total Amount')}) Tj",
            _tj_right(inner_right, divider_y - 22, _money(total), 6.4),
            "/F2 9 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {inner_x:.1f} {divider_y - 40:.1f} Tm ({_pdf_escape(f'Ticket price (x{qty})')}) Tj",
            _tj_right(inner_right, divider_y - 40, _money(subtotal), 5.2),
            f"1 0 0 1 {inner_x:.1f} {divider_y - 54:.1f} Tm ({_pdf_escape('Convenience fee & GST (18%)')}) Tj",
            _tj_right(inner_right, divider_y - 54, _money(gst), 5.2),
        ])
        if payment_mode:
            ops.extend([
                f"1 0 0 1 {inner_x:.1f} {divider_y - 70:.1f} Tm ({_pdf_escape('Payment Mode')}) Tj",
                _tj_right(inner_right, divider_y - 70, _ascii_text(payment_mode)[:28], 5.2),
            ])
        ops.append("ET")

        stream = "\n".join(ops).encode("latin-1", "replace")
        xobject_refs = []
        image_objects = []
        next_obj = 7
        for name, (payload, width, height, pdf_filter) in xobjects.items():
            xobject_refs.append(f"/{name} {next_obj} 0 R")
            image_objects.append(_image_xobject(payload, width, height, pdf_filter))
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
