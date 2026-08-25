"""One-page ticket PDF: event name, date, booking id, and QR image. Stdlib + httpx only."""

from __future__ import annotations

from datetime import datetime
from typing import Optional
from urllib.parse import quote

import httpx


def _pdf_escape(text: str) -> str:
    cleaned = (text or "").encode("latin-1", "replace").decode("latin-1")
    return cleaned.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")


def _format_event_date(value) -> str:
    if not value:
        return "Date TBA"
    if isinstance(value, datetime):
        return value.strftime("%d %b %Y, %I:%M %p")
    text = str(value).strip()
    if not text:
        return "Date TBA"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%d %b %Y, %I:%M %p")
    except Exception:
        return text[:48]


def _short_booking_id(booking_id) -> str:
    raw = str(booking_id or "00000000").replace("-", "")
    return (raw[:8] or "00000000").upper()


def _fetch_qr_jpeg(qr_token: str) -> bytes:
    token = (qr_token or "").strip()
    if not token:
        return b""
    url = (
        "https://api.qrserver.com/v1/create-qr-code/"
        f"?size=280x280&format=jpeg&margin=8&data={quote(token)}"
    )
    try:
        with httpx.Client(timeout=12.0, follow_redirects=True) as client:
            res = client.get(url)
        if res.status_code != 200 or not res.content:
            return b""
        if res.content[:2] != b"\xff\xd8":
            return b""
        return res.content
    except Exception:
        return b""


def _assemble_pdf(object_bodies: list[bytes]) -> bytes:
    header = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n"
    chunks = [header]
    offsets = [0]
    pos = len(header)
    for index, body in enumerate(object_bodies, start=1):
        offsets.append(pos)
        chunk = f"{index} 0 obj\n".encode("ascii") + body + b"\nendobj\n"
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


def build_ticket_pdf_bytes(
    *,
    booking_id,
    event_name: str,
    event_date=None,
    qr_token: str,
) -> Optional[bytes]:
    """Return a PDF byte string, or None if generation fails."""
    try:
        title = (event_name or "JOD Events").strip() or "JOD Events"
        date_label = _format_event_date(event_date)
        booking_label = f"JOD-{_short_booking_id(booking_id)}"
        jpeg = _fetch_qr_jpeg(qr_token)

        content_lines = [
            "BT",
            "/F1 20 Tf",
            "1 0 0 1 72 770 Tm",
            f"({_pdf_escape('JOD Events Ticket')}) Tj",
            "/F1 14 Tf",
            "0 -28 Td",
            f"({_pdf_escape(title[:80])}) Tj",
            "/F2 11 Tf",
            "0 -22 Td",
            f"({_pdf_escape('Event date: ' + date_label)}) Tj",
            "0 -18 Td",
            f"({_pdf_escape('Booking ID: ' + booking_label)}) Tj",
            "0 -18 Td",
            f"({_pdf_escape('Show this QR at the gate. Do not share it.')}) Tj",
            "ET",
        ]
        if jpeg:
            content_lines.extend([
                "q",
                "180 0 0 180 207 420 cm",
                "/Im1 Do",
                "Q",
            ])
            resources = b"<< /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Im1 7 0 R >> >>"
        else:
            resources = b"<< /Font << /F1 4 0 R /F2 5 0 R >> >>"

        stream = "\n".join(content_lines).encode("latin-1", "replace")
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
        if jpeg:
            objects.append(
                b"<< /Type /XObject /Subtype /Image /Width 280 /Height 280 "
                b"/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
                + f"/Length {len(jpeg)} >>\nstream\n".encode("ascii")
                + jpeg
                + b"\nendstream"
            )
        return _assemble_pdf(objects)
    except Exception:
        return None
