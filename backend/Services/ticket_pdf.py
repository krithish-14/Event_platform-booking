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
from typing import List, Optional, Tuple
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
    if not isinstance(value, datetime):
        text = str(value).strip()
        if not text:
            return "Date TBA"
        if "T" not in text:
            return _ascii_text(text[:56], "Date TBA")
        try:
            value = datetime.fromisoformat(text.replace("Z", "+00:00"))
        except Exception:
            return _ascii_text(text[:48], "Date TBA")
    try:
        from Utils.datetimes import format_utc_naive_as_ist_when
        label = format_utc_naive_as_ist_when(value)
        if label:
            return _ascii_text(label, "Date TBA")
    except Exception:
        pass
    parsed = value
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


def _assemble_pdf_from_page_chunks(page_chunks: list[dict]) -> Optional[bytes]:
    """Build one PDF from one or more page chunks ({ops, xobjects})."""
    if not page_chunks:
        return None
    if len(page_chunks) == 1:
        chunk = page_chunks[0]
        stream = "\n".join(chunk["ops"]).encode("latin-1", "replace")
        page_w = float(chunk.get("page_w") or 595)
        page_h = float(chunk.get("page_h") or 842)
        xobjects = chunk.get("xobjects") or {}
        xobject_refs = []
        image_objects = []
        next_obj = 7
        for name, (payload, width, height, pdf_filter) in xobjects.items():
            xobject_refs.append(f"/{name} {next_obj} 0 R")
            image_objects.append(_image_xobject(payload, width, height, pdf_filter))
            next_obj += 1
        xobject_dict = f"/XObject << {' '.join(xobject_refs)} >>" if xobject_refs else ""
        extra = str(chunk.get("resource_extra") or "")
        resources = (
            f"<< /Font << /F1 4 0 R /F2 5 0 R >> {xobject_dict} {extra} >>".encode("ascii")
        )
        contents_obj = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
        page_obj = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "
            + f"{page_w:.1f} {page_h:.1f}".encode("ascii")
            + b"] /Resources "
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

    objects: list[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"",  # Pages — filled after page objects are known
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    page_obj_ids: list[int] = []
    for chunk in page_chunks:
        page_obj_id = len(objects) + 1
        contents_obj_id = page_obj_id + 1
        page_obj_ids.append(page_obj_id)

        xobject_refs = []
        image_objects = []
        for name, (payload, width, height, pdf_filter) in (chunk.get("xobjects") or {}).items():
            img_id = contents_obj_id + 1 + len(image_objects)
            xobject_refs.append(f"/{name} {img_id} 0 R")
            image_objects.append(_image_xobject(payload, width, height, pdf_filter))

        stream = "\n".join(chunk["ops"]).encode("latin-1", "replace")
        page_w = float(chunk.get("page_w") or 595)
        page_h = float(chunk.get("page_h") or 842)
        contents_obj = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
        xobject_dict = f"/XObject << {' '.join(xobject_refs)} >>" if xobject_refs else ""
        extra = str(chunk.get("resource_extra") or "")
        resources = f"<< /Font << /F1 3 0 R /F2 4 0 R >> {xobject_dict} {extra} >>".encode("ascii")
        page_obj = (
            b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 "
            + f"{page_w:.1f} {page_h:.1f}".encode("ascii")
            + b"] /Resources "
            + resources
            + f" /Contents {contents_obj_id} 0 R >>".encode("ascii")
        )
        objects.append(page_obj)
        objects.append(contents_obj)
        objects.extend(image_objects)

    kids = " ".join(f"{obj_id} 0 R" for obj_id in page_obj_ids)
    objects[1] = f"<< /Type /Pages /Kids [{kids}] /Count {len(page_obj_ids)} >>".encode("ascii")
    return _assemble_pdf(objects)


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


def _tj_center(center_x: float, y: float, text: str, char_w: float) -> str:
    width = max(1, len(text)) * char_w
    return f"1 0 0 1 {center_x - width / 2.0:.1f} {y:.1f} Tm ({_pdf_escape(text)}) Tj"


def pdf_page_count(data: bytes) -> int:
    """Count PDF page objects. The Pages parent dictionary is not a page."""
    if not data:
        return 0
    import re
    return len(re.findall(br"/Type\s*/Page(?!s)", data))


def guest_label_for_index(index: int) -> str:
    """The first ticket uses the buyer name. Every other ticket in the order is a guest."""
    idx = int(index or 0)
    if idx <= 0:
        return ""
    return "Guest"


def registration_contact(
    form_name: str = "",
    form_email: str = "",
    form_phone: str = "",
    saved_name: str = "",
    saved_email: str = "",
    saved_phone: str = "",
) -> tuple:
    """Name, email, and phone for a ticket.

    Each field uses the registration-form answer when that answer exists.
    The saved booking value is only the checkout copy of the same form.
    A login profile name, email, or phone is never read here.
    """
    name = str(form_name or "").strip() or str(saved_name or "").strip() or "Guest"
    email = str(form_email or "").strip() or str(saved_email or "").strip()
    phone = str(form_phone or "").strip() or str(saved_phone or "").strip()
    return name, email, phone


def ticket_attendee_name(form_name: str = "", receiver_name: str = "") -> str:
    """Ticket face name. Registration-form answer first, then the name saved from that form."""
    name, _, _ = registration_contact(form_name, saved_name=receiver_name)
    return name


def _compact_event_id(value) -> str:
    return str(value or "").replace("-", "").strip().lower()


def layout_belongs_to_event(layout, event_id) -> bool:
    """True only when a layout was stamped for this exact event."""
    if not isinstance(layout, dict):
        return False
    stamped = _compact_event_id(layout.get("event_id"))
    wanted = _compact_event_id(event_id)
    return bool(stamped and wanted and stamped == wanted)


def _form_identity_for_booking(booking, db) -> tuple:
    if db is None or booking is None:
        return "", "", ""
    try:
        from APIs.bookings import _form_attendee_for_booking
        name, email, phone = _form_attendee_for_booking(db, booking)
        return (name or "").strip(), (email or "").strip(), (phone or "").strip()
    except Exception:
        return "", "", ""


def attendee_display_name(name: str, index: int) -> str:
    """Buyer name on ticket 1. Later tickets read 'Buyer name (Guest)'."""
    base = _ascii_text(name, "")
    label = guest_label_for_index(index)
    if label and base:
        return f"{base} ({label})"
    return base or label


def ticket_pdf_filename(booking_id, kind: str = "ticket", *, ticket_index: int = 0) -> str:
    prefix = "JOD-Invoice" if str(kind).strip().lower() == "invoice" else "JOD-Ticket"
    short = _short_booking_id(booking_id)
    if int(ticket_index) == -1:
        return f"{prefix}-{short}-All.pdf"
    guest = guest_label_for_index(ticket_index).replace(" ", "")
    if guest:
        return f"{prefix}-{short}-{guest}.pdf"
    return f"{prefix}-{short}.pdf"


def _ordered_booking_tickets(booking, db=None) -> list:
    tickets = list(getattr(booking, "tickets", None) or [])
    if not tickets and db is not None:
        try:
            from APIs.bookings import _booking_tickets

            tickets = _booking_tickets(booking, db=db)
        except Exception:
            tickets = []
    tickets = [t for t in tickets if (getattr(t, "qr_token", None) or "").strip()]
    try:
        tickets.sort(key=lambda t: (getattr(t, "created_at", None) or "", str(getattr(t, "ticket_id", ""))))
    except Exception:
        pass
    return tickets


def _resolve_per_ticket_context(booking, qr_token: str = "", db=None) -> dict:
    """Map a booking + optional QR token to single-ticket PDF fields."""
    tickets = _ordered_booking_tickets(booking, db=db)
    booking_qty = max(1, int(getattr(booking, "quantity", 1) or 1))
    total = float(getattr(booking, "total_price", 0) or 0)
    gst = float(getattr(booking, "gst_amount", 0) or 0)

    token = (qr_token or "").strip()
    index = 0
    if token:
        for i, ticket in enumerate(tickets):
            if (getattr(ticket, "qr_token", None) or "").strip() == token:
                index = i
                break
    elif tickets:
        token = (tickets[0].qr_token or "").strip()
        index = 0

    multi = len(tickets) > 1 or (len(tickets) == 1 and booking_qty > 1)
    if multi and tickets:
        divisor = max(len(tickets), booking_qty)
        return {
            "qr_token": token,
            "ticket_index": index,
            "guest_label": guest_label_for_index(index),
            "quantity": 1,
            "total_price": total / divisor if divisor else total,
            "gst_amount": gst / divisor if divisor else gst,
            "ticket_count": len(tickets),
        }

    return {
        "qr_token": token,
        "ticket_index": 0,
        "guest_label": "",
        "quantity": booking_qty,
        "total_price": total,
        "gst_amount": gst,
        "ticket_count": max(len(tickets), booking_qty),
    }


def _event_id_lookup_candidates(event_id) -> list:
    candidates = []
    if event_id is None:
        return candidates
    candidates.append(event_id)
    text_id = str(event_id).strip()
    if text_id and text_id not in {str(c) for c in candidates}:
        candidates.append(text_id)
    try:
        import uuid as _uuid
        parsed = _uuid.UUID(text_id)
        if parsed not in candidates:
            candidates.append(parsed)
    except Exception:
        pass
    return candidates


def _published_ticket_layout_for_event(db, event_id) -> Optional[dict]:
    """Load the published ticket canvas for this event only.

    Never falls back to another host or another event's design.
    """
    if db is None or event_id is None:
        return None
    try:
        from Models.event_design import EventDesign
        from Models.event_management import EventManagement
        from Models.organizer_accounts import OrganizerAccount
        from Services.ticket_templates import is_premium_tier, normalize_ticket_layout
    except Exception:
        return None

    design = None
    host_event = None
    for cand in _event_id_lookup_candidates(event_id):
        try:
            design = db.query(EventDesign).filter(EventDesign.event_id == cand).first()
        except Exception:
            design = None
        if design:
            break
        try:
            host_event = db.query(EventManagement).filter(EventManagement.event_id == cand).first()
        except Exception:
            host_event = None
        if host_event:
            try:
                design = db.query(EventDesign).filter(EventDesign.event_id == host_event.event_id).first()
            except Exception:
                design = None
            if design:
                break

    # A design row is usable only when it belongs to this event.
    # An empty published canvas stays on the generic template, never another event.
    if not design or not isinstance(design.ticket_layout_json, dict) or not design.ticket_layout_json:
        if not design or not (design.ticket_template_id and _compact_event_id(getattr(design, "event_id", None)) == _compact_event_id(event_id)):
            return None
    if _compact_event_id(getattr(design, "event_id", None)) != _compact_event_id(event_id):
        return None

    premium = False
    try:
        em = host_event
        if em is None:
            for cand in _event_id_lookup_candidates(getattr(design, "event_id", None) or event_id):
                try:
                    em = db.query(EventManagement).filter(EventManagement.event_id == cand).first()
                except Exception:
                    em = None
                if em:
                    break
        email = (getattr(em, "organizer_email", None) or "").strip().lower()
        org = None
        if email:
            org = db.query(OrganizerAccount).filter(OrganizerAccount.email == email).first()
        premium = is_premium_tier(getattr(org, "subscription_tier", None) if org else None)
    except Exception:
        premium = False

    layout = normalize_ticket_layout(
        design.ticket_layout_json if isinstance(design.ticket_layout_json, dict) else {},
        template_id=design.ticket_template_id,
        is_premium=premium,
    )
    layout["event_id"] = str(getattr(design, "event_id", None) or event_id)
    if not layout_belongs_to_event(layout, event_id):
        return None
    return layout


_CANVAS_CSS = {
    "midnight": (760.0, 280.0),
    "sunset": (820.0, 250.0),
    "vip_gold": (820.0, 240.0),
}
_CANVAS_HIDDEN = {
    "midnight": {"poster", "badge", "qty", "footer"},
    "sunset": {"poster", "badge", "qty", "footer"},
    "vip_gold": {"poster", "badge", "qty", "footer", "stub"},
}
_CANVAS_FLAGS = {
    "date": "show_date",
    "time": "show_time",
    "venue": "show_venue",
    "ticket_type": "show_ticket_type",
    "seat": "show_seat",
    "name": "show_attendee_name",
    "phone": "show_attendee_phone",
    "email": "show_attendee_email",
    "qr": "show_qr",
    "price": "show_price",
    "qty": "show_qty",
    "organizer": "show_organizer",
    "ticket_id": "show_ticket_id",
    "jod_logo": "show_jod_logo",
}
_CENTER_TYPES = {"qty", "ticket_type", "seat", "booking_id", "footer", "badge"}


def canvas_page_metrics(template_id: str):
    """Page size matches the designer card, so the ticket is not letterboxed on A4."""
    css_w, css_h = _CANVAS_CSS.get(str(template_id or ""), (340.0, 520.0))
    long_side = 760.0
    scale = long_side / max(css_w, css_h, 1.0)
    page_w = css_w * scale
    page_h = css_h * scale
    return page_w, page_h, 0.0, 0.0, page_w, page_h, css_h


def _ellipse_path(cx: float, cy: float, rx: float, ry: float) -> str:
    k = 0.5522847498
    return (
        f"{cx + rx:.2f} {cy:.2f} m "
        f"{cx + rx:.2f} {cy + ry * k:.2f} {cx + rx * k:.2f} {cy + ry:.2f} {cx:.2f} {cy + ry:.2f} c "
        f"{cx - rx * k:.2f} {cy + ry:.2f} {cx - rx:.2f} {cy + ry * k:.2f} {cx - rx:.2f} {cy:.2f} c "
        f"{cx - rx:.2f} {cy - ry * k:.2f} {cx - rx * k:.2f} {cy - ry:.2f} {cx:.2f} {cy - ry:.2f} c "
        f"{cx + rx * k:.2f} {cy - ry:.2f} {cx + rx:.2f} {cy - ry * k:.2f} {cx + rx:.2f} {cy:.2f} c h"
    )


def _midnight_resources(card_x: float, card_y: float, card_w: float, card_h: float) -> str:
    """Diagonal purple gradient plus soft glows, matching the Midnight Stage preview."""
    return (
        "/Shading << /Sh1 << /ShadingType 2 /ColorSpace /DeviceRGB "
        f"/Coords [{card_x:.2f} {card_y:.2f} {card_x + card_w:.2f} {card_y + card_h * 0.62:.2f}] "
        "/Function << /FunctionType 2 /Domain [0 1] "
        "/C0 [0.298 0.114 0.584] /C1 [0.486 0.227 0.929] /N 1 >> "
        "/Extend [true true] >> >> "
        "/ExtGState << "
        "/GsGlow << /Type /ExtGState /ca 0.50 /CA 0.50 >> "
        "/GsMist << /Type /ExtGState /ca 0.22 /CA 0.22 >> "
        "/GsRing << /Type /ExtGState /CA 0.20 >> "
        ">>"
    )


def _paint_midnight_face(ops, card_x: float, card_y: float, card_w: float, card_h: float) -> None:
    """Rings, perforation, and edge notches from the Midnight Stage preview."""
    radius = max(8.0, card_h * (22.0 / 280.0))
    unit = card_h / 280.0
    ops.extend([
        "q",
        f"{_round_rect_path(card_x, card_y, card_w, card_h, radius)} W n",
        "/Sh1 sh",
        "/GsGlow gs",
        "0.298 0.114 0.584 rg",
        f"{_ellipse_path(card_x + card_w * 0.08, card_y - card_h * 0.08, card_w * 0.42, card_h * 0.42)} f",
        "/GsMist gs",
        "1 1 1 rg",
        f"{_ellipse_path(card_x + card_w * 0.92, card_y + card_h * 1.08, card_w * 0.34, card_h * 0.46)} f",
        "0.769 0.710 0.992 rg",
        f"{_ellipse_path(card_x + card_w * 0.62, card_y, card_w * 0.22, card_h * 0.28)} f",
        "/GsRing gs",
        "1 1 1 RG",
        f"{18.0 * unit:.2f} w",
        f"{_ellipse_path(card_x + card_w - card_w * (100.0 / 760.0), card_y + card_h - card_h * (20.0 / 280.0), card_w * (140.0 / 760.0), card_h * (90.0 / 280.0))} S",
        f"{_ellipse_path(card_x + card_w * (246.8 / 760.0), card_y + card_h - card_h * (290.0 / 280.0), card_w * (110.0 / 760.0), card_h * (70.0 / 280.0))} S",
        "Q",
    ])
    perf_x = card_x + card_w * 0.73
    ops.extend([
        "[3 2.2] 0 d",
        "1 1 1 RG",
        f"{max(1.0, 1.6 * unit):.2f} w",
        f"{perf_x:.2f} {card_y + 14.0 * unit:.2f} m {perf_x:.2f} {card_y + card_h - 14.0 * unit:.2f} l S",
        "[] 0 d",
        "0.071 0.031 0.122 rg",
        f"{_ellipse_path(card_x, card_y + card_h / 2.0, 16.0 * unit, 16.0 * unit)} f",
        f"{_ellipse_path(perf_x, card_y + card_h, 13.0 * unit, 13.0 * unit)} f",
        f"{_ellipse_path(perf_x, card_y, 13.0 * unit, 13.0 * unit)} f",
    ])


def canvas_element_box(el, card_x: float, card_y: float, card_w: float, card_h: float):
    """Map a canvas percentage box onto PDF points. Canvas y grows downward."""
    x_pct = float(el.get("x") or 0)
    y_pct = float(el.get("y") or 0)
    w_pct = float(el.get("w") or 10)
    h_pct = float(el.get("h") or 6)
    x = card_x + (x_pct / 100.0) * card_w
    w = max(1.0, (w_pct / 100.0) * card_w)
    h = max(1.0, (h_pct / 100.0) * card_h)
    top = card_y + card_h - (y_pct / 100.0) * card_h
    return x, top - h, w, h


def _canvas_align(el) -> str:
    align = str(el.get("align") or "").strip().lower()
    if align in {"left", "center", "right"}:
        return align
    return "center" if str(el.get("type") or "") in _CENTER_TYPES else "left"


def _canvas_font_px(el, template_id: str) -> float:
    try:
        saved = float(el.get("fontSize") or 0)
    except (TypeError, ValueError):
        saved = 0
    if saved >= 6:
        return saved
    etype = str(el.get("type") or "")
    if template_id == "sunset" and etype == "ticket_type":
        return 28
    if template_id == "sunset" and etype == "title":
        return 10
    if template_id == "vip_gold" and etype == "ticket_type":
        return 28
    if template_id == "vip_gold" and etype == "title":
        return 12
    if template_id == "midnight" and etype == "name":
        return 18
    if template_id == "midnight" and etype == "ticket_type":
        return 22
    if template_id == "midnight" and etype == "title":
        return 12
    if template_id == "midnight" and etype in {"email", "phone", "venue"}:
        return 11
    if template_id == "midnight" and etype == "stub":
        return 10
    if etype in {"ticket_type", "title", "name"}:
        return 16
    if etype in {"stub", "badge"}:
        return 10
    return 12


def _split_to_width(text: str, max_chars: int) -> list[str]:
    """Wrap the whole string. Long words continue on the next line instead of being cut."""
    max_chars = max(4, int(max_chars))
    words = _ascii_text(text, "").split()
    lines: list[str] = []
    current = ""
    for word in words:
        pieces = [word[i:i + max_chars] for i in range(0, len(word), max_chars)] or [word]
        for piece in pieces:
            trial = (current + " " + piece).strip()
            if current and len(trial) > max_chars:
                lines.append(current)
                current = piece
            else:
                current = trial
    if current:
        lines.append(current)
    return lines or [""]


def _draw_text_box(ops, text, x, y, w, h, size, rgb, align, font="/F1"):
    """Draw the full string inside the canvas box, shrinking the type so nothing is clipped."""
    text = _ascii_text(text, "")
    if not text or w < 4 or h < 4:
        return
    size = min(72.0, max(6.0, float(size or 10)))
    lines = [text]
    char_w = size * 0.5
    while size >= 5.0:
        char_w = max(1.6, size * 0.46)
        max_chars = max(4, int((w - 2.0) / char_w))
        line_h = size * 1.08
        max_lines = max(1, int(h / max(line_h, 1.0)))
        lines = _split_to_width(text, max_chars)
        if len(lines) <= max_lines:
            break
        size -= 0.35
    line_h = max(size * 1.08, 5.5)
    # Keep every line. A tiny box shrinks the type instead of dropping the rest of the name.
    if len(lines) * line_h > h and len(lines) > 1:
        line_h = max(5.0, h / len(lines))
        size = min(size, line_h / 1.08)
        char_w = max(1.6, size * 0.46)
    block = line_h * len(lines)
    ops.append("BT")
    ops.append(f"{font} {size:.1f} Tf {rgb} rg")
    for index, line in enumerate(lines):
        line_y = y + max(0.0, (h - block) / 2.0) + (len(lines) - 1 - index) * line_h
        if align == "center":
            ops.append(_tj_center(x + w / 2.0, line_y, line, char_w))
        elif align == "right":
            ops.append(_tj_right(x + w - 1.0, line_y, line, char_w))
        else:
            ops.append(f"1 0 0 1 {x + 1.0:.1f} {line_y:.1f} Tm ({_pdf_escape(line)}) Tj")
    ops.append("ET")


def _render_canvas_ticket(
    *,
    layout: dict,
    style: str,
    page_rgb,
    card_rgb,
    accent_rgb,
    text_rgb,
    muted_rgb,
    title: str,
    date_label: str,
    venue_label: str,
    type_label: str,
    seat_label: str,
    guest_name: str,
    guest_email: str,
    guest_phone: str,
    qty: int,
    total: float,
    booking_label: str,
    custom_footer: str,
    qr_jpeg: bytes,
    poster,
    logo,
    show_qr: bool,
    organizer_name: str = "",
) -> Optional[dict]:
    """Place every host canvas element on a ticket with the same proportions."""
    elements = [el for el in (layout.get("canvas_elements") or []) if isinstance(el, dict)]
    if not elements:
        return None
    custom = str(layout.get("canvas_mode") or "") == "custom"
    template_id = "custom" if custom else str(layout.get("template_id") or "classic")
    if layout.get("text_color"):
        text_rgb = hex_to_rgb01_safe(layout.get("text_color"))
    if custom:
        orient = "portrait" if str(layout.get("orientation") or "") == "portrait" else "landscape"
        if orient == "portrait":
            page_w, page_h, css_h = 570.0, 760.0, 760.0
        else:
            page_w, page_h, css_h = 760.0, 427.5, 427.5
        card_x, card_y, card_w, card_h = 0.0, 0.0, page_w, page_h
        card_rgb = hex_to_rgb01_safe(layout.get("card_color") or "#ffffff")
        if not layout.get("text_color"):
            text_rgb = hex_to_rgb01_safe("#111111")
        hidden = set()
        from Services.ticket_templates import logo_variant_for_color
        variant = "black" if layout.get("background_image") else logo_variant_for_color(layout.get("card_color") or "#ffffff")
        chosen = _load_jod_logo_image(variant)
        if chosen:
            logo = chosen
    else:
        if layout.get("card_color") and template_id not in {"midnight", "sunset", "vip_gold"}:
            card_rgb = hex_to_rgb01_safe(layout.get("card_color"))
        page_w, page_h, card_x, card_y, card_w, card_h, css_h = canvas_page_metrics(template_id)
        hidden = set(_CANVAS_HIDDEN.get(template_id, set()))
        if template_id not in {"midnight", "sunset"}:
            hidden.add("stub")

    def _rgb(rgb):
        return f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f}"

    text_paint = _rgb(text_rgb)
    muted_paint = _rgb(muted_rgb)
    radius = max(8.0, card_h * (22.0 / 280.0)) if template_id == "midnight" else (8.0 if template_id == "vip_gold" else 12.0)
    ops = [
        f"{_rgb(page_rgb)} rg 0 0 {page_w:.1f} {page_h:.1f} re f",
        f"{_rgb(card_rgb)} rg",
        f"{_round_rect_path(card_x, card_y, card_w, card_h, radius)} f",
    ]
    resource_extra = ""
    if custom:
        pass
    elif template_id == "midnight":
        resource_extra = _midnight_resources(card_x, card_y, card_w, card_h)
        _paint_midnight_face(ops, card_x, card_y, card_w, card_h)
    elif template_id == "vip_gold":
        gold_w = card_w * 0.68
        ops.extend([
            "q",
            f"{_round_rect_path(card_x, card_y, card_w, card_h, radius)} W n",
            "0.93 0.78 0.35 rg",
            f"{card_x:.1f} {card_y:.1f} {gold_w:.1f} {card_h:.1f} re f",
            "0.04 0.04 0.04 rg",
            f"{card_x + gold_w:.1f} {card_y:.1f} {card_w - gold_w:.1f} {card_h:.1f} re f",
            "Q",
        ])
    elif template_id == "sunset":
        stub_w = card_w * 0.26
        ops.extend([
            "q",
            f"{_round_rect_path(card_x, card_y, card_w, card_h, radius)} W n",
            "1.00 0.48 0.10 rg",
            f"{card_x:.1f} {card_y:.1f} {card_w:.1f} {card_h:.1f} re f",
            "0.78 0.18 0.08 rg",
            f"{card_x + card_w - stub_w:.1f} {card_y:.1f} {stub_w:.1f} {card_h:.1f} re f",
            "Q",
        ])
    elif template_id in {"concert", "festival", "neon_night"}:
        ops.extend([
            "q",
            f"{_round_rect_path(card_x, card_y, card_w, card_h, radius)} W n",
            f"{_rgb(accent_rgb)} rg",
            f"{card_x:.1f} {card_y:.1f} {max(8.0, card_w * 0.025):.1f} {card_h:.1f} re f",
            "Q",
        ])
    elif template_id == "minimal":
        ops.extend([
            f"{_rgb(accent_rgb)} rg",
            f"{card_x + 16:.1f} {card_y + card_h - 14:.1f} {min(88.0, card_w * 0.28):.1f} 3.5 re f",
        ])
    else:
        ops.extend([
            "q",
            f"{_round_rect_path(card_x, card_y, card_w, card_h, radius)} W n",
            f"{_rgb(accent_rgb)} rg",
            f"{card_x:.1f} {card_y:.1f} {card_w:.1f} 5 re f",
            "Q",
        ])

    xobjects: dict[str, tuple[bytes, int, int, str]] = {}
    image_seq = 0
    if custom and layout.get("background_image"):
        bg = _load_poster_image(_absolute_media_url(str(layout.get("background_image") or "")))
        if bg:
            filt, payload, iw, ih = bg[0], bg[1], bg[2], bg[3]
            xobjects["ImB"] = (payload, iw, ih, filt)
            ops.append(_cover_image("ImB", card_x, card_y, card_w, card_h, iw, ih, 0))
    price_text = _money(total)
    qty_text = "1 Ticket" if qty == 1 else f"{qty} Tickets"
    date_value = date_label
    time_value = ""
    if custom and date_label.count(",") >= 3:
        date_value, time_value = date_label.rsplit(",", 1)
        date_value = date_value.strip()
        time_value = time_value.strip()
    booking_text = booking_label if template_id in {"midnight", "sunset", "vip_gold", "custom"} else f"BOOKING ID: #{booking_label}"
    values = {
        "title": title,
        "badge": "E-Ticket",
        "date": date_value,
        "time": time_value or "Time TBA",
        "venue": venue_label,
        "qty": qty_text,
        "ticket_type": type_label,
        "seat": seat_label,
        "name": guest_name,
        "phone": guest_phone,
        "email": guest_email,
        "booking_id": booking_text,
        "ticket_id": f"TICKET-{booking_label}",
        "organizer": _ascii_text(organizer_name, "") or "Organizer",
        "price": price_text if template_id in {"midnight", "sunset", "vip_gold", "custom"} else f"Price  {price_text}",
        "footer": custom_footer,
    }
    plain_types = {"midnight", "sunset", "vip_gold"}
    if template_id == "midnight":
        for key in ("ticket_type", "title"):
            if values.get(key):
                values[key] = values[key].upper()
        guest_name_text = values.get("name") or ""
        if guest_name_text.endswith(" (Guest)"):
            values["name"] = guest_name_text[:-8].upper() + " (Guest)"
        elif guest_name_text:
            values["name"] = guest_name_text.upper()

    for el in elements:
        etype = str(el.get("type") or "").strip().lower()
        if not etype or etype in hidden:
            continue
        flag = _CANVAS_FLAGS.get(etype)
        if flag and not bool(layout.get(flag, True)):
            continue
        x, y, w, h = canvas_element_box(el, card_x, card_y, card_w, card_h)
        own = str(el.get("color") or "").strip()
        paint = text_paint
        if own.startswith("#"):
            paint = _rgb(hex_to_rgb01_safe(own))
        size = _canvas_font_px(el, template_id) * (card_h / css_h)
        align = _canvas_align(el)

        if etype in {"line", "dashed_line"}:
            color = _rgb(hex_to_rgb01_safe(own or "#94a3b8"))
            if etype == "dashed_line":
                ops.append("[3 2] 0 d")
            ops.extend([
                f"{color} RG {max(1.0, min(w, h) * 0.35):.1f} w",
                (
                    f"{x + w / 2.0:.1f} {y:.1f} m {x + w / 2.0:.1f} {y + h:.1f} l S"
                    if h > w * 1.4
                    else f"{x:.1f} {y + h / 2.0:.1f} m {x + w:.1f} {y + h / 2.0:.1f} l S"
                ),
            ])
            if etype == "dashed_line":
                ops.append("[] 0 d")
            continue
        if etype == "rectangle":
            color = _rgb(hex_to_rgb01_safe(own or "#38bdf8"))
            ops.extend([
                f"{color} RG 1.2 w",
                f"{x:.1f} {y:.1f} {w:.1f} {h:.1f} re S",
            ])
            continue
        if etype == "circle":
            color = _rgb(hex_to_rgb01_safe(own or "#22d3ee"))
            fill = str(el.get("fill") or "").strip()
            ops.append(f"{color} RG 1.2 w")
            if fill.startswith("#"):
                ops.append(f"{_rgb(hex_to_rgb01_safe(fill))} rg")
                ops.append(_ellipse_path(x + w / 2.0, y + h / 2.0, w / 2.0, h / 2.0) + " B")
            else:
                ops.append(_ellipse_path(x + w / 2.0, y + h / 2.0, max(1.0, w / 2.0), max(1.0, h / 2.0)) + " S")
            continue
        if etype == "qr":
            if not show_qr:
                continue
            pad = 3.0
            if qr_jpeg:
                qw, qh = _jpeg_dimensions(qr_jpeg)
                xobjects["ImQ"] = (qr_jpeg, qw, qh, "DCTDecode")
                side = min(w, h) - pad * 2
                qx = x + (w - side) / 2.0
                qy = y + (h - side) / 2.0
                if template_id in {"sunset", "vip_gold"}:
                    ops.append(f"1 1 1 rg {qx - 2:.1f} {qy - 2:.1f} {side + 4:.1f} {side + 4:.1f} re f")
                ops.append(_draw_image("ImQ", qx, qy, side, side))
            continue
        if etype == "jod_logo":
            if custom and layout.get("background_image"):
                ops.append(f"1 1 1 rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f")
            if logo:
                filt, payload, lw, lh = logo
                xobjects["ImL"] = (payload, lw, lh, filt)
                aspect = (lw / float(lh)) if lh else 3.0
                draw_h = min(h * 0.8, w / aspect)
                draw_w = draw_h * aspect
                ops.append(_draw_image("ImL", x + (w - draw_w) / 2.0, y + (h - draw_h) / 2.0, draw_w, draw_h))
            else:
                _draw_text_box(ops, "JOD Events", x, y, w, h, size, paint, "center")
            continue
        if etype in {"poster", "image", "organizer_logo"}:
            image = poster if etype == "poster" else None
            if etype in {"image", "organizer_logo"}:
                image = _load_poster_image(_absolute_media_url(str(el.get("src") or "")))
            if image:
                filt, payload, iw, ih, = image[0], image[1], image[2], image[3]
                image_seq += 1
                name = f"ImC{image_seq}"
                xobjects[name] = (payload, iw, ih, filt)
                ops.append(_cover_image(name, x, y, w, h, iw, ih, 4))
            continue
        if etype == "text":
            _draw_text_box(ops, str(el.get("text") or ""), x, y, w, h, size, paint, align, "/F1")
            continue
        if etype == "stub":
            stub = str(el.get("text") or "").strip() or " ".join(part for part in (type_label, title) if part)
            if template_id == "midnight":
                stub = stub.upper()
            stub = _ascii_text(stub, "")[:80]
            if not stub:
                continue
            cx = x + w / 2.0
            cy = y + h / 2.0
            char_w = max(3.0, size * 0.52)
            text_w = len(stub) * char_w
            ops.extend([
                "BT",
                f"/F1 {max(7.0, size):.1f} Tf {paint} rg",
                f"0 1 -1 0 {cx:.1f} {cy - text_w / 2.0:.1f} Tm ({_pdf_escape(stub)}) Tj",
                "ET",
            ])
            continue
        value = values.get(etype, "")
        if not value:
            continue
        font = "/F1" if etype in {"title", "ticket_type", "name", "booking_id", "price", "ticket_id"} or str(el.get("fontWeight") or "") in {"600", "700", "800"} else "/F2"
        use_paint = muted_paint if etype in {"date", "venue", "qty", "seat", "footer"} and template_id not in plain_types else paint
        _draw_text_box(ops, value, x, y, w, h, size, use_paint, align, font)

    return {
        "ops": ops,
        "xobjects": xobjects,
        "page_w": page_w,
        "page_h": page_h,
        "resource_extra": resource_extra,
    }


def hex_to_rgb01_safe(hex_color: str):
    from Services.ticket_templates import hex_to_rgb01
    return hex_to_rgb01(hex_color)


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
    ticket_layout: Optional[dict] = None,
    attendee_name: str = "",
    attendee_email: str = "",
    attendee_phone: str = "",
    attendee_guest_label: str = "",
    organizer_name: str = "",
    _return_page_chunk: bool = False,
) -> Optional[bytes | dict]:
    """One-page M-ticket PDF. Returns None if assembly fails."""
    try:
        from Services.ticket_templates import (
            DEFAULT_LAYOUT,
            get_template,
            hex_to_rgb01,
            normalize_ticket_layout,
        )

        layout = normalize_ticket_layout(
            ticket_layout if isinstance(ticket_layout, dict) else DEFAULT_LAYOUT,
            is_premium=True,
        )
        tmpl = get_template(layout.get("template_id"))
        pdf_theme = tmpl.get("pdf") or {}
        page_rgb = pdf_theme.get("page_rgb", (0.97, 0.97, 0.98))
        card_rgb = pdf_theme.get("card_rgb", (1, 1, 1))
        accent_rgb = hex_to_rgb01(layout.get("accent_color") or tmpl["preview"]["accent"])
        text_rgb = pdf_theme.get("text_rgb", (0.07, 0.09, 0.15))
        muted_rgb = pdf_theme.get("muted_rgb", (0.42, 0.45, 0.50))
        style = str(pdf_theme.get("style") or "classic")

        show_venue = bool(layout.get("show_venue", True))
        show_date = bool(layout.get("show_date", True))
        show_price = bool(layout.get("show_price", True))
        show_seat = bool(layout.get("show_seat", True))
        show_ticket_type = bool(layout.get("show_ticket_type", True))
        show_jod_logo = bool(layout.get("show_jod_logo", True))
        allow_attendee_name = bool(layout.get("show_attendee_name", True))
        show_attendee_name = allow_attendee_name and bool(str(attendee_name or "").strip())
        show_attendee_email = bool(layout.get("show_attendee_email", True)) and bool(str(attendee_email or "").strip())
        show_attendee_phone = bool(layout.get("show_attendee_phone", True)) and bool(str(attendee_phone or "").strip())
        custom_footer = _ascii_text(layout.get("custom_footer") or "", "")
        headline_override = _ascii_text(layout.get("headline_override") or "", "")
        ticket_type_override = _ascii_text(layout.get("ticket_type_override") or "", "")
        guest_name = _ascii_text(attendee_name, "") if show_attendee_name else ""
        guest_email = _ascii_text(attendee_email, "") if show_attendee_email else ""
        guest_phone = _ascii_text(attendee_phone, "") if show_attendee_phone else ""
        guest_sub_label = _ascii_text(attendee_guest_label, "") if attendee_guest_label else ""
        attendee_rows: list[tuple[str, str]] = []
        name_value = guest_name
        if guest_name or (guest_sub_label and allow_attendee_name):
            if guest_sub_label and guest_name:
                name_value = f"{guest_name} ({guest_sub_label})"
            else:
                name_value = guest_name or guest_sub_label
            attendee_rows.append(("Name", name_value))
        if guest_phone:
            attendee_rows.append(("Phone", guest_phone))
        if guest_email:
            attendee_rows.append(("Email", guest_email))
        attendee_h = (10.0 + len(attendee_rows) * 14.0) if attendee_rows else 0.0

        title = _ascii_text(headline_override or event_name, "JOD Events") or "JOD Events"
        date_label = _ascii_text(_format_event_date(event_date), "Date TBA") if show_date else ""
        venue_label = _ascii_text(venue, "Venue details at location") if show_venue else ""
        format_label = _ascii_text(
            f"{language or 'English'}, {event_format or 'Live Event'}",
            "English, Live Event",
        )
        type_label = _ascii_text(ticket_type_override or ticket_type, "Standard Access") if show_ticket_type else ""
        seat_label = _ascii_text(seat_number, "General Admission") if show_seat else ""
        qty = max(1, int(quantity or 1))
        total = float(total_price or 0)
        gst = float(gst_amount or 0)
        if gst <= 0 and total > 0:
            gst = round(total * 0.18, 2)
        subtotal = max(0.0, total - gst)
        booking_label = f"JOD-{_short_booking_id(booking_id)}"
        show_qr = bool(include_qr and layout.get("show_qr", True))
        qr_jpeg = _fetch_qr_jpeg(qr_token) if show_qr else b""
        poster = _load_poster_image(_absolute_media_url(poster_url)) if poster_url else None
        badge_label = "Invoice" if not show_qr else "E-Ticket"
        logo = _load_jod_logo_image() if show_jod_logo else None
        if isinstance(layout.get("canvas_elements"), list) and layout.get("canvas_elements"):
            canvas_chunk = _render_canvas_ticket(
                layout=layout,
                style=style,
                page_rgb=page_rgb,
                card_rgb=card_rgb,
                accent_rgb=accent_rgb,
                text_rgb=text_rgb,
                muted_rgb=muted_rgb,
                title=title,
                date_label=date_label,
                venue_label=venue_label,
                type_label=type_label,
                seat_label=seat_label,
                guest_name=name_value,
                guest_email=guest_email,
                guest_phone=guest_phone,
                qty=qty,
                total=total,
                booking_label=booking_label,
                custom_footer=custom_footer,
                qr_jpeg=qr_jpeg,
                poster=poster,
                logo=logo,
                show_qr=show_qr,
                organizer_name=organizer_name,
            )
            if canvas_chunk:
                if _return_page_chunk:
                    return canvas_chunk
                return _assemble_pdf_from_page_chunks([canvas_chunk])

        poster_w, poster_h = 88.0, 110.0
        qr_size = 180.0
        header_h = poster_h
        seating_h = 58.0 if (show_ticket_type or show_seat) else 18.0
        qr_block_h = (qr_size + 44.0) if show_qr else 0.0
        totals_h = 0.0
        if show_price:
            totals_h = 86.0 if payment_mode else 70.0
        brand_h = 42.0 if show_jod_logo else (22.0 if custom_footer else 8.0)
        pad_x, pad_y = 22.0, 20.0
        card_w = 451.0
        card_h = (
            pad_y * 2
            + header_h
            + 18
            + seating_h
            + attendee_h
            + (16 if show_qr else 8)
            + qr_block_h
            + 18
            + totals_h
            + brand_h
        )
        card_x = (595.0 - card_w) / 2.0
        card_y = max(36.0, (842.0 - card_h) / 2.0)
        inner_x = card_x + pad_x
        inner_right = card_x + card_w - pad_x
        y = card_y + card_h - pad_y

        def _rgb(rgb):
            return f"{rgb[0]:.3f} {rgb[1]:.3f} {rgb[2]:.3f}"

        ops = [
            f"{_rgb(page_rgb)} rg 0 0 595 842 re f",
            f"{_rgb(card_rgb)} rg 0.83 0.85 0.88 RG 1 w",
            f"{_round_rect_path(card_x, card_y, card_w, card_h, 12)} B",
        ]

        # Accent marks clipped to the rounded card so corners stay clean.
        ops.append("q")
        ops.append(f"{_round_rect_path(card_x, card_y, card_w, card_h, 12)} W n")
        if style in ("concert", "festival", "neon_night"):
            ops.extend([
                f"{_rgb(accent_rgb)} rg",
                f"{card_x:.1f} {card_y:.1f} 10 {card_h:.1f} re f",
            ])
        elif style in ("midnight", "sunset", "vip_gold"):
            pass
        elif style == "minimal":
            # Larger short rule, inset past corner radius (matches canvas preview).
            ops.extend([
                f"{_rgb(accent_rgb)} rg",
                f"{inner_x:.1f} {card_y + card_h - pad_y - 6:.1f} 88 3.5 re f",
            ])
        else:
            # Classic bottom bar — drawn inside the clipped card.
            ops.extend([
                f"{_rgb(accent_rgb)} rg",
                f"{card_x:.1f} {card_y:.1f} {card_w:.1f} 5 re f",
            ])
        ops.append("Q")

        xobjects: dict[str, tuple[bytes, int, int, str]] = {}
        poster_box_x, poster_box_y = inner_x, y - poster_h
        if poster:
            filt, payload, pw, ph = poster
            xobjects["ImP"] = (payload, pw, ph, filt)
            ops.append(_cover_image("ImP", poster_box_x, poster_box_y, poster_w, poster_h, pw, ph, 8))
        else:
            muted_soft = tuple(min(1.0, c + 0.35) for c in muted_rgb)
            ops.extend([
                f"{_rgb(muted_soft)} rg",
                f"{_round_rect_path(poster_box_x, poster_box_y, poster_w, poster_h, 8)} f",
            ])

        text_x = inner_x + poster_w + 12
        title_lines = _wrap_text(title, 30, 2)
        venue_lines = _split_to_width(venue_label, 42)[:6] if venue_label else []
        ops.extend([
            "BT",
            f"/F1 15 Tf {_rgb(text_rgb)} rg",
            f"1 0 0 1 {text_x:.1f} {y - 16:.1f} Tm ({_pdf_escape(title_lines[0])}) Tj",
        ])
        cursor = y - 16
        if len(title_lines) > 1:
            cursor -= 16
            ops.append(f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(title_lines[1])}) Tj")
        cursor -= 15
        ops.extend([
            f"/F2 9 Tf {_rgb(muted_rgb)} rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(format_label[:42])}) Tj",
        ])
        if date_label:
            cursor -= 14
            ops.extend([
                f"/F1 10 Tf {_rgb(text_rgb)} rg",
                f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(date_label[:44])}) Tj",
            ])
        if venue_lines:
            ops.append(f"/F2 8 Tf {_rgb(muted_rgb)} rg")
            for line in venue_lines:
                cursor -= 11
                ops.append(f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(line)}) Tj")
        ops.extend([
            f"/F1 8 Tf {_rgb(muted_rgb)} rg",
            _tj_right(inner_right, y - 16, badge_label, 5.1),
            "ET",
        ])

        block_top = poster_box_y - 16
        center_x = card_x + card_w / 2.0
        ops.extend([
            f"{_rgb(muted_rgb)} RG 0.7 w",
            f"{inner_x:.1f} {block_top + 8:.1f} m {inner_right:.1f} {block_top + 8:.1f} l S",
            "BT",
            f"/F2 9 Tf {_rgb(muted_rgb)} rg",
            _tj_center(center_x, block_top - 6, f"{qty} Ticket" if qty == 1 else f"{qty} Tickets", 4.8),
        ])
        if type_label:
            type_size = 11 if len(type_label) > 28 else 14
            type_char = 5.6 if len(type_label) > 28 else 8.0
            ops.extend([
                f"/F1 {type_size} Tf {_rgb(text_rgb)} rg",
                _tj_center(center_x, block_top - 26, type_label, type_char),
            ])
        if seat_label:
            ops.extend([
                f"/F2 10 Tf {_rgb(muted_rgb)} rg",
                _tj_center(center_x, block_top - 42, seat_label, 5.5),
            ])
        ops.append("ET")

        attendee_top = block_top - (58.0 if (show_ticket_type or show_seat) else 20.0)
        if attendee_rows:
            ops.append("BT")
            cursor_a = attendee_top
            for label, value in attendee_rows:
                ops.extend([
                    f"/F2 9 Tf {_rgb(muted_rgb)} rg",
                    f"1 0 0 1 {inner_x:.1f} {cursor_a:.1f} Tm ({_pdf_escape(label)}) Tj",
                    f"/F1 9 Tf {_rgb(text_rgb)} rg",
                    _tj_right(inner_right, cursor_a, value, 4.6 if len(value) > 28 else 5.0),
                ])
                cursor_a -= 13
            ops.append("ET")
            qr_anchor = cursor_a - 14
        else:
            qr_anchor = block_top - 58

        if show_qr:
            qr_top = qr_anchor
            qr_x = card_x + (card_w - qr_size) / 2.0
            qr_y = qr_top - qr_size
            if qr_jpeg:
                qw, qh = _jpeg_dimensions(qr_jpeg)
                xobjects["ImQ"] = (qr_jpeg, qw, qh, "DCTDecode")
                ops.append(_draw_image("ImQ", qr_x, qr_y, qr_size, qr_size))
            else:
                ops.extend([
                    f"0.97 0.98 0.99 rg {_rgb(muted_rgb)} RG 0.8 w",
                    f"{qr_x:.1f} {qr_y:.1f} {qr_size:.1f} {qr_size:.1f} re B",
                    f"BT /F2 11 Tf {_rgb(muted_rgb)} rg",
                    f"1 0 0 1 {qr_x + 48:.1f} {qr_y + 90:.1f} Tm ({_pdf_escape('QR pending')}) Tj ET",
                ])
            booking_text = f"BOOKING ID: #{booking_label}"
            booking_w = len(booking_text) * 6.35
            ops.extend([
                "BT",
                f"/F1 11 Tf {_rgb(text_rgb)} rg",
                f"1 0 0 1 {card_x + (card_w - booking_w) / 2.0:.1f} {qr_y - 22:.1f} Tm ({_pdf_escape(booking_text)}) Tj",
                "ET",
            ])
            policy_y = qr_y - 38
        else:
            policy_y = qr_anchor - 8

        divider_y = policy_y
        if show_price:
            ops.extend([
                "[5 4] 0 d 0.80 0.83 0.86 RG 1 w",
                f"{inner_x:.1f} {divider_y:.1f} m {inner_right:.1f} {divider_y:.1f} l S",
                "[] 0 d",
            ])
            ops.extend([
                "BT",
                f"/F1 11 Tf {_rgb(text_rgb)} rg",
                f"1 0 0 1 {inner_x:.1f} {divider_y - 22:.1f} Tm ({_pdf_escape('Price')}) Tj",
                _tj_right(inner_right, divider_y - 22, _money(total), 6.4),
                f"/F2 9 Tf {_rgb(muted_rgb)} rg",
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
            brand_top = divider_y - (88.0 if payment_mode else 72.0)
        else:
            brand_top = divider_y

        if show_jod_logo or custom_footer:
            ops.extend([
                f"{_rgb(muted_rgb)} RG 0.6 w",
                f"{inner_x:.1f} {brand_top:.1f} m {inner_right:.1f} {brand_top:.1f} l S",
            ])
            if show_jod_logo and logo:
                filt, payload, lw, lh = logo
                xobjects["ImL"] = (payload, lw, lh, filt)
                logo_h = 28.0
                aspect = (lw / float(lh)) if lh else 3.0
                logo_w = min(140.0, logo_h * aspect)
                logo_x = center_x - logo_w / 2.0
                logo_y = brand_top - 8 - logo_h
                ops.append(_draw_image("ImL", logo_x, logo_y, logo_w, logo_h))
                if custom_footer:
                    ops.extend([
                        "BT",
                        f"/F2 8 Tf {_rgb(muted_rgb)} rg",
                        _tj_center(center_x, logo_y - 12, custom_footer[:48], 4.2),
                        "ET",
                    ])
            elif show_jod_logo:
                ops.extend([
                    "BT",
                    f"/F1 10 Tf {_rgb(accent_rgb)} rg",
                    _tj_center(center_x, brand_top - 16, "JOD Events", 5.8),
                    "ET",
                ])
            elif custom_footer:
                ops.extend([
                    "BT",
                    f"/F2 8 Tf {_rgb(muted_rgb)} rg",
                    _tj_center(center_x, brand_top - 14, custom_footer[:48], 4.2),
                    "ET",
                ])

        if _return_page_chunk:
            return {"ops": ops, "xobjects": xobjects}
        return _assemble_pdf_from_page_chunks([{"ops": ops, "xobjects": xobjects}])
    except Exception:
        return None


def build_mticket_pdf_from_booking(
    booking,
    qr_token: str = "",
    db=None,
    include_qr: bool = True,
    *,
    ticket_index: Optional[int] = None,
    _return_page_chunk: bool = False,
) -> Optional[bytes | dict]:
    """Build one M-ticket PDF from a Booking ORM row (per unique QR when qty > 1)."""
    event = getattr(booking, "event", None)
    ctx = _resolve_per_ticket_context(booking, qr_token=qr_token, db=db)
    token = ctx["qr_token"]
    poster = ""
    if event is not None:
        poster = getattr(event, "card_image", None) or getattr(event, "image_url", None) or ""
    qty = max(1, int(ctx.get("quantity") or 1))
    total = float(ctx.get("total_price") or 0)
    gst = float(ctx.get("gst_amount") or 0)
    guest_label = ctx.get("guest_label") or ""
    if ticket_index is not None:
        guest_label = guest_label_for_index(int(ticket_index))
    event_date = None
    public_start = getattr(event, "start_date", None) if event is not None else None
    if db is not None:
        try:
            from APIs.bookings import _event_schedule_display
            start_display, _, _, _ = _event_schedule_display(
                db,
                getattr(booking, "event_id", None),
                public_start,
                getattr(event, "end_date", None) if event is not None else None,
            )
            event_date = start_display
        except Exception:
            event_date = None
    if not event_date:
        try:
            from Utils.datetimes import format_utc_naive_as_ist_when
            event_date = format_utc_naive_as_ist_when(public_start) or public_start
        except Exception:
            event_date = public_start

    event_id = getattr(booking, "event_id", None)
    ticket_layout = _published_ticket_layout_for_event(db, event_id)
    if ticket_layout and not layout_belongs_to_event(ticket_layout, event_id):
        ticket_layout = None
    form_name, form_email, form_phone = _form_identity_for_booking(booking, db)
    attendee_name, attendee_email, attendee_phone = registration_contact(
        form_name,
        form_email,
        form_phone,
        getattr(booking, "receiver_name", None),
        getattr(booking, "receiver_email", None),
        getattr(booking, "receiver_phone", None),
    )

    return build_mticket_pdf_bytes(
        booking_id=getattr(booking, "booking_id", ""),
        event_name=getattr(event, "title", None) if event is not None else "JOD Events",
        event_date=event_date,
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
        ticket_layout=ticket_layout,
        attendee_name=attendee_name,
        attendee_email=attendee_email,
        attendee_phone=attendee_phone,
        attendee_guest_label=guest_label,
        organizer_name=(getattr(event, "organizer_name", None) or "") if event is not None else "",
        _return_page_chunk=_return_page_chunk,
    )


def build_combined_mticket_pdf_from_booking(
    booking,
    db=None,
    include_qr: bool = True,
) -> Optional[bytes]:
    """One PDF with one page per unique QR ticket (primary + Guest 1, Guest 2, …)."""
    tickets = [
        ticket for ticket in _ordered_booking_tickets(booking, db=db)
        if (getattr(ticket, "qr_token", None) or "").strip()
    ]
    if len(tickets) <= 1:
        result = build_mticket_pdf_from_booking(
            booking,
            qr_token=(tickets[0].qr_token if tickets else ""),
            db=db,
            include_qr=include_qr,
        )
        return result if isinstance(result, bytes) else None

    chunks: list[dict] = []
    for index, ticket in enumerate(tickets):
        token = (getattr(ticket, "qr_token", None) or "").strip()
        if not token:
            continue
        chunk = build_mticket_pdf_from_booking(
            booking,
            qr_token=token,
            db=db,
            include_qr=include_qr,
            ticket_index=index,
            _return_page_chunk=True,
        )
        if isinstance(chunk, dict):
            chunks.append(chunk)
    if not chunks:
        return None
    return _assemble_pdf_from_page_chunks(chunks)


def build_all_mticket_pdfs_from_booking(
    booking,
    db=None,
    include_qr: bool = True,
) -> List[Tuple[str, bytes, str]]:
    """Build one PDF per unique QR ticket (primary + Guest 1, Guest 2, …)."""
    tickets = _ordered_booking_tickets(booking, db=db)
    booking_qty = max(1, int(getattr(booking, "quantity", 1) or 1))
    if not tickets:
        pdf = build_mticket_pdf_from_booking(booking, db=db, include_qr=include_qr)
        if not pdf:
            return []
        return [(ticket_pdf_filename(booking.booking_id), pdf, "application/pdf")]

    if len(tickets) == 1 and booking_qty <= 1:
        pdf = build_mticket_pdf_from_booking(booking, qr_token=tickets[0].qr_token, db=db, include_qr=include_qr)
        if not pdf:
            return []
        return [(ticket_pdf_filename(booking.booking_id), pdf, "application/pdf")]

    out: List[Tuple[str, bytes, str]] = []
    for index, ticket in enumerate(tickets):
        token = (getattr(ticket, "qr_token", None) or "").strip()
        if not token:
            continue
        pdf = build_mticket_pdf_from_booking(booking, qr_token=token, db=db, include_qr=include_qr)
        if not pdf:
            continue
        filename = ticket_pdf_filename(booking.booking_id, ticket_index=index)
        out.append((filename, pdf, "application/pdf"))
    return out


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


# Admin portal download only — fixed 85mm x 130mm card on A4, attendee name instead of prices.
_ADMIN_CARD_W = 85.0 * 72.0 / 25.4  # ≈ 240.94 pt
_ADMIN_CARD_H = 130.0 * 72.0 / 25.4  # ≈ 368.50 pt
_ADMIN_TAGLINE = "PEOPLE | EVENTS | POSSIBILITIES"


def _load_image_from_bytes(data: bytes, max_w: int = 360, max_h: int = 480) -> Optional[tuple[str, bytes, int, int]]:
    if not data:
        return None
    if data[:2] == b"\xff\xd8":
        width, height = _jpeg_dimensions(data)
        return "DCTDecode", data, width, height
    png = _decode_png_rgb(data)
    if png:
        rgb, width, height = png
        rgb, width, height = _scale_rgb(rgb, width, height, max_w=max_w, max_h=max_h)
        return "FlateDecode", zlib.compress(rgb, 9), width, height
    return _via_pillow(data)


def _admin_logo_candidates(variant: str = "black") -> list[str]:
    here = os.path.dirname(os.path.abspath(__file__))
    repo_root = os.path.abspath(os.path.join(here, "..", ".."))
    if str(variant or "black") == "white":
        names = ("JOD Events Logo White.png", "JOD Events Logo.png")
    else:
        names = ("JOD Events Logo.png", "jod-logo.png", "JOD Logo.png")
    paths = []
    for name in names:
        paths.append(os.path.join(repo_root, "frontend", "images", name))
        paths.append(os.path.join(here, "assets", name))
    env_logo = (os.getenv("JOD_TICKET_LOGO_PATH") or "").strip()
    if env_logo and str(variant or "black") != "white":
        paths.insert(0, env_logo)
    return paths


def _load_jod_logo_image(variant: str = "black") -> Optional[tuple[str, bytes, int, int]]:
    """Load the black or white JOD Events wordmark (local file, then CDN fallback)."""
    for path in _admin_logo_candidates(variant):
        try:
            if path and os.path.isfile(path):
                with open(path, "rb") as fh:
                    loaded = _load_image_from_bytes(fh.read(), max_w=420, max_h=180)
                if loaded:
                    return loaded
        except Exception:
            continue
    if str(variant or "black") == "white":
        return _load_jod_logo_image("black")
    for url in (
        "https://assets.jodevents.com/images/JOD%20Events%20Logo.png",
        "https://jodevents.com/images/JOD%20Events%20Logo.png",
    ):
        loaded = _load_image_from_bytes(_fetch_bytes(url), max_w=420, max_h=180)
        if loaded:
            return loaded
    return None


def _admin_footer_shapes(card_x: float, card_y: float, card_w: float, shape_h: float = 22.0) -> list[str]:
    """Darker orange corner shapes at the card bottom only (no light shade band)."""
    left = (
        f"{card_x:.2f} {card_y:.2f} m "
        f"{card_x + 78:.2f} {card_y:.2f} l "
        f"{card_x + 58:.2f} {card_y + shape_h * 0.55:.2f} "
        f"{card_x + 30:.2f} {card_y + shape_h * 0.35:.2f} "
        f"{card_x:.2f} {card_y + shape_h:.2f} c h"
    )
    right = (
        f"{card_x + card_w:.2f} {card_y:.2f} m "
        f"{card_x + card_w - 78:.2f} {card_y:.2f} l "
        f"{card_x + card_w - 58:.2f} {card_y + shape_h * 0.55:.2f} "
        f"{card_x + card_w - 30:.2f} {card_y + shape_h * 0.35:.2f} "
        f"{card_x + card_w:.2f} {card_y + shape_h:.2f} c h"
    )
    clip = _round_rect_path(card_x, card_y, card_w, _ADMIN_CARD_H, 10)
    return [
        f"q {clip} W n",
        "1.00 0.62 0.20 rg",
        f"{left} f",
        "0.98 0.52 0.12 rg",
        f"{right} f",
        "Q",
    ]


def build_admin_mticket_pdf_bytes(
    *,
    booking_id,
    event_name: str,
    event_date=None,
    venue: str = "",
    language: str = "English",
    event_format: str = "Live Event",
    ticket_type: str = "General Admission",
    quantity: int = 1,
    qr_token: str = "",
    poster_url: str = "",
    seat_number: str = "General Admission",
    attendee_name: str = "",
) -> Optional[bytes]:
    """Admin-only ticket PDF: 85x130mm card, brand footer + attendee name (no prices)."""
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
        booking_label = f"JOD-{_short_booking_id(booking_id)}"
        guest_name = _ascii_text(attendee_name, "Guest") or "Guest"
        qr_jpeg = _fetch_qr_jpeg(qr_token) if (qr_token or "").strip() else b""
        poster = _load_poster_image(_absolute_media_url(poster_url)) if poster_url else None
        logo = _load_jod_logo_image()

        card_w, card_h = _ADMIN_CARD_W, _ADMIN_CARD_H
        card_x = (595.0 - card_w) / 2.0
        card_y = max(36.0, (842.0 - card_h) / 2.0)
        pad_x, pad_y = 14.0, 12.0
        inner_x = card_x + pad_x
        inner_right = card_x + card_w - pad_x
        poster_w, poster_h = 54.0, 68.0
        qr_size = 96.0
        y = card_y + card_h - pad_y
        center_x = card_x + card_w / 2.0

        ops = [
            "0.97 0.97 0.98 rg 0 0 595 842 re f",
            "1 1 1 rg 0.83 0.85 0.88 RG 1 w",
            f"{_round_rect_path(card_x, card_y, card_w, card_h, 10)} B",
        ]
        # Low orange corner shapes only — leave white space above for the name.
        shape_h = 16.0
        ops.extend(_admin_footer_shapes(card_x, card_y, card_w, shape_h=shape_h))

        xobjects: dict[str, tuple[bytes, int, int, str]] = {}
        poster_box_x, poster_box_y = inner_x, y - poster_h
        if poster:
            filt, payload, pw, ph = poster
            xobjects["ImP"] = (payload, pw, ph, filt)
            ops.append(_cover_image("ImP", poster_box_x, poster_box_y, poster_w, poster_h, pw, ph, 6))
        else:
            ops.extend([
                "0.90 0.91 0.93 rg",
                f"{_round_rect_path(poster_box_x, poster_box_y, poster_w, poster_h, 6)} f",
            ])

        text_x = inner_x + poster_w + 10
        title_lines = _wrap_text(title, 20, 2)
        venue_lines = _wrap_text(venue_label, 24, 2)
        # Header: poster + event details only (no E-Ticket badge).
        ops.extend([
            "BT",
            "/F1 11 Tf 0.07 0.09 0.15 rg",
            f"1 0 0 1 {text_x:.1f} {y - 12:.1f} Tm ({_pdf_escape(title_lines[0])}) Tj",
        ])
        cursor = y - 12
        if len(title_lines) > 1:
            cursor -= 12
            ops.append(f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(title_lines[1])}) Tj")
        cursor -= 12
        ops.extend([
            "/F2 7 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(format_label[:30])}) Tj",
        ])
        cursor -= 11
        ops.extend([
            "/F1 8 Tf 0.07 0.09 0.15 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(date_label[:32])}) Tj",
        ])
        cursor -= 10
        ops.extend([
            "/F2 7 Tf 0.42 0.45 0.50 rg",
            f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(venue_lines[0])}) Tj",
        ])
        if len(venue_lines) > 1:
            cursor -= 9
            ops.append(f"1 0 0 1 {text_x:.1f} {cursor:.1f} Tm ({_pdf_escape(venue_lines[1])}) Tj")
        ops.append("ET")

        block_top = poster_box_y - 10
        ops.extend([
            "0.89 0.91 0.94 RG 0.7 w",
            f"{inner_x:.1f} {block_top + 5:.1f} m {inner_right:.1f} {block_top + 5:.1f} l S",
            "BT",
            "/F2 8 Tf 0.42 0.45 0.50 rg",
            _tj_center(center_x, block_top - 4, f"{qty} Ticket(s)", 4.2),
            "/F1 12 Tf 0.07 0.09 0.15 rg",
            _tj_center(center_x, block_top - 20, type_label[:26], 6.8),
            "/F2 8 Tf 0.42 0.45 0.50 rg",
            _tj_center(center_x, block_top - 34, seat_label[:26], 4.5),
            "ET",
        ])

        qr_top = block_top - 44
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
                "BT /F2 9 Tf 0.42 0.45 0.50 rg",
                f"1 0 0 1 {qr_x + 24:.1f} {qr_y + 50:.1f} Tm ({_pdf_escape('QR pending')}) Tj ET",
            ])
        booking_text = f"BOOKING ID: #{booking_label}"
        booking_w = len(booking_text) * 5.2
        ops.extend([
            "BT",
            "/F1 9 Tf 0.07 0.09 0.15 rg",
            f"1 0 0 1 {card_x + (card_w - booking_w) / 2.0:.1f} {qr_y - 14:.1f} Tm ({_pdf_escape(booking_text)}) Tj",
            "ET",
        ])

        # Brand footer: dashed rule → logo → tagline → dashed rule → name → orange shapes.
        brand_top = qr_y - 24
        ops.extend([
            "[4 3] 0 d 0.80 0.83 0.86 RG 0.9 w",
            f"{inner_x:.1f} {brand_top:.1f} m {inner_right:.1f} {brand_top:.1f} l S",
            "[] 0 d",
        ])

        logo_draw_h = 24.0
        logo_y = brand_top - 6 - logo_draw_h
        if logo:
            filt, payload, lw, lh = logo
            xobjects["ImL"] = (payload, lw, lh, filt)
            aspect = (lw / float(lh)) if lh else 2.6
            logo_draw_w = min(108.0, logo_draw_h * aspect)
            logo_x = center_x - logo_draw_w / 2.0
            ops.append(_draw_image("ImL", logo_x, logo_y, logo_draw_w, logo_draw_h))
            tagline_y = logo_y - 10
        else:
            ops.extend([
                "BT",
                "/F1 14 Tf 0.07 0.09 0.15 rg",
                _tj_center(center_x, brand_top - 16, "JOD", 8.4),
                "/F2 7 Tf 0.20 0.22 0.26 rg",
                _tj_center(center_x, brand_top - 28, "E V E N T S", 4.0),
                "ET",
            ])
            tagline_y = brand_top - 40

        ops.extend([
            "BT",
            "/F2 6 Tf 0.35 0.38 0.42 rg",
            _tj_center(center_x, tagline_y, _ADMIN_TAGLINE, 3.35),
            "ET",
        ])

        name_max_chars = 18
        name_lines = _wrap_text(guest_name, name_max_chars, 2)
        name_font = 15 if max(len(line) for line in name_lines) <= 16 else 12
        name_char_w = 8.6 if name_font >= 15 else 6.8
        name_gap = 16 if name_font >= 15 else 14
        # Keep dashed line close under the tagline, and pin the name low so
        # there is a clear white gap between the rule and the name.
        name_rule_y = tagline_y - 8.0
        ascent = name_font * 0.78
        gap_below_rule = 26.0
        gap_above_shape = 6.0
        low_baseline = card_y + shape_h + gap_above_shape
        high_limit = name_rule_y - gap_below_rule - ascent
        if len(name_lines) == 1:
            name_top = min(low_baseline, high_limit)
        else:
            block = name_gap * (len(name_lines) - 1)
            name_top = min(low_baseline + block, high_limit + block)
            last_baseline = name_top - block
            if last_baseline < low_baseline:
                name_top = low_baseline + block

        ops.extend([
            "[4 3] 0 d 0.80 0.83 0.86 RG 0.9 w",
            f"{inner_x:.1f} {name_rule_y:.1f} m {inner_right:.1f} {name_rule_y:.1f} l S",
            "[] 0 d",
        ])
        ops.append("BT")
        ops.append(f"/F1 {name_font} Tf 0.07 0.09 0.15 rg")
        for i, line in enumerate(name_lines):
            ops.append(_tj_center(center_x, name_top - i * name_gap, line, name_char_w))
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


def build_admin_mticket_pdf_from_booking(
    booking,
    *,
    attendee_name: str = "",
    qr_token: str = "",
    db=None,
) -> Optional[bytes]:
    """Build the host/admin ticket PDF using the **host-designed layout** (same M-ticket
    renderer as the user-facing download).  Falls back to the legacy 85x130mm admin card
    only when no host design exists for the event.
    """
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
    event_date = None
    public_start = getattr(event, "start_date", None) if event is not None else None
    if db is not None:
        try:
            from APIs.bookings import _event_schedule_display
            start_display, _, _, _ = _event_schedule_display(
                db,
                getattr(booking, "event_id", None),
                public_start,
                getattr(event, "end_date", None) if event is not None else None,
            )
            event_date = start_display
        except Exception:
            event_date = None
    if not event_date:
        try:
            from Utils.datetimes import format_utc_naive_as_ist_when
            event_date = format_utc_naive_as_ist_when(public_start) or public_start
        except Exception:
            event_date = public_start

    form_name, form_email, form_phone = _form_identity_for_booking(booking, db)
    guest, guest_email, guest_phone = registration_contact(
        form_name or attendee_name,
        form_email,
        form_phone,
        getattr(booking, "receiver_name", None),
        getattr(booking, "receiver_email", None),
        getattr(booking, "receiver_phone", None),
    )

    # ── Load this event's published ticket layout only ─────────────────────────
    event_id = getattr(booking, "event_id", None)
    ticket_layout = _published_ticket_layout_for_event(db, event_id)
    if ticket_layout and not layout_belongs_to_event(ticket_layout, event_id):
        ticket_layout = None
    has_host_design = bool(ticket_layout)

    # ── Use host-designed M-ticket renderer when a design is available ─────────
    if has_host_design:
        return build_mticket_pdf_bytes(
            booking_id=getattr(booking, "booking_id", ""),
            event_name=getattr(event, "title", None) if event is not None else "JOD Events",
            event_date=event_date,
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
            include_qr=bool(token),
            ticket_layout=ticket_layout,
            attendee_name=guest,
            attendee_email=guest_email,
            attendee_phone=guest_phone,
        )

    # ── Fallback: legacy 85x130mm admin card (no host design configured) ──────
    return build_admin_mticket_pdf_bytes(
        booking_id=getattr(booking, "booking_id", ""),
        event_name=getattr(event, "title", None) if event is not None else "JOD Events",
        event_date=event_date,
        venue=(getattr(event, "venue", None) or getattr(event, "location", None) or "") if event is not None else "",
        language=getattr(event, "language", None) if event is not None else "English",
        event_format=getattr(event, "event_format", None) if event is not None else "Live Event",
        ticket_type=getattr(booking, "ticket_type", None) or "General Admission",
        quantity=qty,
        qr_token=token,
        poster_url=poster,
        seat_number=getattr(booking, "seat_number", None) or "General Admission",
        attendee_name=guest,
    )


def admin_ticket_pdf_filename(booking_id) -> str:
    short = _short_booking_id(booking_id)
    return f"JOD-Admin-Ticket-{short}.pdf"


def host_ticket_pdf_filename(booking_id) -> str:
    short = _short_booking_id(booking_id)
    return f"JOD-Host-Ticket-{short}.pdf"


# Shared staff layout alias (admin + host): name + logo, no prices.
build_staff_mticket_pdf_from_booking = build_admin_mticket_pdf_from_booking
build_staff_mticket_pdf_bytes = build_admin_mticket_pdf_bytes
