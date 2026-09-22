"""Professional A4 PDF for a host's past-event history report."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from Services.ticket_pdf import (
    _ascii_text,
    _assemble_pdf,
    _draw_image,
    _image_xobject,
    _load_jod_logo_image,
    _money,
    _pdf_escape,
)


PAGE_W = 595.0
PAGE_H = 842.0
MARGIN = 54.0


def _tf(size: float, bold: bool = False) -> str:
    return f"/{'F1' if bold else 'F2'} {size:.1f} Tf"


def _text(x: float, y: float, text: str, size: float = 10, bold: bool = False, rgb=(0.07, 0.09, 0.15)) -> str:
    r, g, b = rgb
    body = _ascii_text(text, "")[:120]
    return (
        f"{r:.2f} {g:.2f} {b:.2f} rg BT {_tf(size, bold)} 1 0 0 1 {x:.1f} {y:.1f} Tm "
        f"({_pdf_escape(body)}) Tj ET"
    )


def _rule(x: float, y: float, w: float, rgb=(0.86, 0.89, 0.93)) -> str:
    r, g, b = rgb
    return f"{r:.2f} {g:.2f} {b:.2f} rg {x:.1f} {y:.1f} {w:.1f} 0.7 re f"


def _rect(x: float, y: float, w: float, h: float, rgb) -> str:
    r, g, b = rgb
    return f"{r:.2f} {g:.2f} {b:.2f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f"


def _clip(value, width: int = 40) -> str:
    text = _ascii_text(value, "")
    if len(text) <= width:
        return text or "-"
    return text[: width - 1] + "."


def _format_when(value) -> str:
    if not value:
        return "Date TBA"
    text = str(value).strip()
    if not text:
        return "Date TBA"
    try:
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return parsed.strftime("%d %b %Y")
    except Exception:
        return _ascii_text(text[:40], "Date TBA")


def history_report_pdf_filename(event_title: str) -> str:
    safe = "".join(ch if ch.isalnum() or ch in "-_" else "-" for ch in (event_title or "event"))
    safe = "-".join(part for part in safe.split("-") if part)[:48] or "event"
    return f"JOD-Event-History-{safe}.pdf"


def build_history_report_pdf_bytes(
    report: Dict[str, Any],
    *,
    host_email: str = "",
) -> Optional[bytes]:
    """One-page letter-style report with a faded JOD logo watermark."""
    if not isinstance(report, dict):
        return None

    title = _clip(report.get("event_title") or "Untitled event", 56)
    venue = _clip(report.get("venue") or "Venue TBD", 42)
    lifecycle = _ascii_text(str(report.get("lifecycle") or "ended").replace("_", " ").title(), "Ended")
    event_id = _clip(report.get("event_id") or "", 36)
    start = _format_when(report.get("event_start_date"))
    end = _format_when(report.get("event_end_date"))
    host = _clip((host_email or "").strip() or "Host dashboard", 42)
    comms = int(report.get("communications_count") or 0)
    exhibitors = int(report.get("exhibitors_count") or 0)

    regs = int(report.get("registrations_count") or 0)
    sold = int(report.get("tickets_sold") or 0)
    capacity = int(report.get("ticket_capacity") or 0)
    checked = int(report.get("checkins_count") or report.get("checked_in") or 0)
    pending = int(report.get("pending_registrations") or 0)
    available = int(report.get("tickets_available") or 0)
    att_rate = f"{float(report.get('attendance_rate') or 0):.1f}%"
    conv_rate = f"{float(report.get('conversion_rate') or 0):.1f}%"
    gross = _money(report.get("gross_revenue"))
    platform = _money(report.get("platform_fee"))
    gst = _money(report.get("gst_fee"))
    net = _money(report.get("net_earnings"))
    platform_pct = int(report.get("platform_fee_pct") or 5)
    gst_pct = int(report.get("gst_fee_pct") or 18)
    cities = [c for c in (report.get("top_cities") or []) if isinstance(c, dict)][:4]
    generated = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")

    ops: List[str] = []
    image_obj: Optional[bytes] = None

    logo = _load_jod_logo_image()
    if logo:
        filt, payload, iw, ih = logo
        image_obj = _image_xobject(payload, iw, ih, filt)
        wm_w = 320.0
        wm_h = wm_w * (ih / max(iw, 1))
        wm_x = (PAGE_W - wm_w) / 2.0
        wm_y = (PAGE_H - wm_h) / 2.0 - 20
        ops.append("q /GS1 gs")
        ops.append(_draw_image("Wm", wm_x, wm_y, wm_w, wm_h))
        ops.append("Q")
    else:
        ops.append("q /GS1 gs")
        ops.append(_text(148, PAGE_H / 2.0, "JOD EVENTS", 48, True, (0.15, 0.39, 0.92)))
        ops.append("Q")

    # Letterhead bar + brand accent
    ops.append(_rect(0, PAGE_H - 52, PAGE_W, 52, (0.09, 0.16, 0.29)))
    ops.append(_rect(0, PAGE_H - 56, PAGE_W, 4, (0.98, 0.52, 0.12)))
    ops.append(_text(MARGIN, PAGE_H - 32, "JOD EVENTS", 13, True, (1, 1, 1)))
    ops.append(_text(PAGE_W - MARGIN - 168, PAGE_H - 32, "CONFIDENTIAL HOST REPORT", 8, True, (0.85, 0.90, 0.97)))

    y = PAGE_H - 88
    ops.append(_text(MARGIN, y, "EVENT HISTORY REPORT", 9, True, (0.15, 0.39, 0.92)))
    y -= 26
    ops.append(_text(MARGIN, y, title, 20, True, (0.07, 0.09, 0.15)))
    y -= 16
    ops.append(_text(MARGIN, y, f"{start}  |  {venue}  |  {lifecycle}", 10, False, (0.42, 0.45, 0.50)))
    y -= 14
    ops.append(_rule(MARGIN, y, PAGE_W - MARGIN * 2, (0.15, 0.39, 0.92)))

    def section(label: str) -> None:
        nonlocal y
        y -= 28
        ops.append(_text(MARGIN, y, label, 9, True, (0.15, 0.39, 0.92)))
        y -= 8
        ops.append(_rule(MARGIN, y, PAGE_W - MARGIN * 2, (0.86, 0.89, 0.93)))
        y -= 18

    def pair(left_label, left_value, right_label, right_value) -> None:
        nonlocal y
        mid = PAGE_W / 2.0 + 8
        ops.append(_text(MARGIN, y, left_label, 8, False, (0.42, 0.45, 0.50)))
        ops.append(_text(mid, y, right_label, 8, False, (0.42, 0.45, 0.50)))
        y -= 14
        ops.append(_text(MARGIN, y, str(left_value), 11, True, (0.07, 0.09, 0.15)))
        ops.append(_text(mid, y, str(right_value), 11, True, (0.07, 0.09, 0.15)))
        y -= 18

    section("1.  EVENT DETAILS")
    pair("Event ID", event_id or "-", "Status", lifecycle)
    pair("Start date", start, "End date", end)
    pair("Venue", venue, "Prepared for", host)
    pair("Messages sent", f"{comms:,}", "Exhibitors", f"{exhibitors:,}")

    section("2.  REGISTRATIONS AND ATTENDANCE")
    pair("Registrations", f"{regs:,}", "Tickets sold", f"{sold:,}")
    pair("Ticket capacity", f"{capacity:,}", "Pending registrations", f"{pending:,}")
    pair("Checked in", f"{checked:,}", "Tickets remaining", f"{available:,}")
    pair("Attendance rate", att_rate, "Conversion rate", conv_rate)

    section("3.  REVENUE AND PAYOUT")
    box_h = 92
    box_y = y - box_h + 8
    ops.append(_rect(MARGIN, box_y, PAGE_W - MARGIN * 2, box_h, (0.96, 0.97, 0.99)))
    inner = y - 6
    ops.append(_text(MARGIN + 14, inner, "Gross ticket sales", 8, False, (0.42, 0.45, 0.50)))
    ops.append(_text(PAGE_W / 2 + 8, inner, gross, 12, True, (0.07, 0.09, 0.15)))
    inner -= 18
    ops.append(_text(MARGIN + 14, inner, f"Platform service fee ({platform_pct}%)", 8, False, (0.42, 0.45, 0.50)))
    ops.append(_text(PAGE_W / 2 + 8, inner, f"- {platform}", 11, True, (0.72, 0.11, 0.11)))
    inner -= 18
    ops.append(_text(MARGIN + 14, inner, f"Taxes and statutory GST ({gst_pct}%)", 8, False, (0.42, 0.45, 0.50)))
    ops.append(_text(PAGE_W / 2 + 8, inner, f"- {gst}", 11, True, (0.72, 0.11, 0.11)))
    inner -= 20
    ops.append(_rule(MARGIN + 14, inner + 8, PAGE_W - MARGIN * 2 - 28, (0.80, 0.84, 0.89)))
    ops.append(_text(MARGIN + 14, inner - 6, "Net host payout", 9, True, (0.09, 0.40, 0.20)))
    ops.append(_text(PAGE_W / 2 + 8, inner - 6, net, 13, True, (0.09, 0.40, 0.20)))
    y = box_y - 8

    if cities:
        section("4.  AUDIENCE TOP CITIES")
        for city in cities:
            name = _ascii_text(city.get("city") or "Unknown", "Unknown")
            count = int(city.get("count") or 0)
            percent = float(city.get("percent") or 0)
            ops.append(_text(MARGIN, y, name, 10, False, (0.07, 0.09, 0.15)))
            ops.append(_text(PAGE_W / 2 + 8, y, f"{count:,}  ({percent:.0f}%)", 10, True, (0.07, 0.09, 0.15)))
            y -= 16

    ops.append(_rule(MARGIN, 48, PAGE_W - MARGIN * 2, (0.86, 0.89, 0.93)))
    ops.append(_text(MARGIN, 34, "Generated by JOD Events host dashboard", 8, False, (0.42, 0.45, 0.50)))
    ops.append(_text(MARGIN, 22, generated, 8, False, (0.42, 0.45, 0.50)))
    ops.append(_text(PAGE_W - MARGIN - 150, 34, "For organizer records only", 8, False, (0.42, 0.45, 0.50)))
    ops.append(_text(PAGE_W - MARGIN - 70, 22, "Page 1 of 1", 8, False, (0.42, 0.45, 0.50)))

    stream = "\n".join(ops).encode("latin-1", "replace")
    contents = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
    ext_gstate = b"<< /Type /ExtGState /ca 0.10 /CA 0.10 >>"

    xobject_ref = ""
    objects: List[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"",  # page filled below
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        contents,
        ext_gstate,
    ]
    if image_obj:
        objects.append(image_obj)
        xobject_ref = "/XObject << /Wm 8 0 R >>"
    resources = (
        f"<< /Font << /F1 4 0 R /F2 5 0 R >> /ExtGState << /GS1 7 0 R >> {xobject_ref} >>"
    ).encode("ascii")
    objects[2] = (
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources "
        + resources
        + b" /Contents 6 0 R >>"
    )
    return _assemble_pdf(objects)
