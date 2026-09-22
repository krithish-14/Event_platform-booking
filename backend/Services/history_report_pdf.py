"""Professional A4 PDF for a host's past-event history report."""

from __future__ import annotations

import zlib
from datetime import datetime
from typing import Any, Dict, List, Optional, Tuple

from Services.ticket_pdf import (
    _ascii_text,
    _assemble_pdf,
    _draw_image,
    _image_xobject,
    _load_jod_logo_image,
    _pdf_escape,
)


PAGE_W = 595.0
PAGE_H = 842.0
LEFT = 50.0
RIGHT = 545.0
MID = 297.5
GUTTER = 22.0
COL1_RIGHT = MID - GUTTER / 2.0
COL2_LEFT = MID + GUTTER / 2.0
NAVY = (0.09, 0.16, 0.29)
BLUE = (0.13, 0.35, 0.82)
MUTED = (0.40, 0.44, 0.50)
INK = (0.08, 0.10, 0.16)
RULE = (0.86, 0.89, 0.93)
RED = (0.72, 0.12, 0.12)
GREEN = (0.08, 0.38, 0.20)

# WinAnsi Helvetica widths (thousandths of an em) for true right-edge alignment.
_HELV = {
    " ": 278, "!": 278, "%": 889, "(": 333, ")": 333, ",": 278, "-": 333, ".": 278,
    "/": 278, "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556,
    "7": 556, "8": 556, "9": 556, ":": 278, "@": 1015, "A": 667, "B": 667, "C": 722,
    "D": 722, "E": 667, "F": 611, "G": 778, "H": 722, "I": 278, "J": 500, "K": 667,
    "L": 556, "M": 833, "N": 722, "O": 778, "P": 667, "Q": 778, "R": 722, "S": 667,
    "T": 611, "U": 722, "V": 667, "W": 944, "X": 667, "Y": 667, "Z": 611, "a": 556,
    "b": 556, "c": 500, "d": 556, "e": 556, "f": 278, "g": 556, "h": 556, "i": 222,
    "j": 222, "k": 500, "l": 222, "m": 833, "n": 556, "o": 556, "p": 556, "q": 556,
    "r": 333, "s": 500, "t": 278, "u": 556, "v": 500, "w": 722, "x": 500, "y": 500,
    "z": 500, "_": 500,
}
_HELV_BOLD = dict(_HELV)
_HELV_BOLD.update({
    " ": 278, "A": 722, "B": 722, "C": 722, "E": 667, "G": 778, "L": 611, "P": 667,
    "R": 722, "S": 667, "a": 556, "e": 556, "i": 278, "l": 278, "n": 611, "o": 611,
    "r": 389, "s": 556, "t": 333,
})


def _inr(value) -> str:
    try:
        amount = float(value or 0)
    except (TypeError, ValueError):
        amount = 0.0
    return f"Rs. {amount:,.2f}"


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


def _text_width(text: str, size: float, bold: bool = False) -> float:
    table = _HELV_BOLD if bold else _HELV
    default = 610 if bold else 556
    width = sum(table.get(ch, default) for ch in text) * size / 1000.0
    return width + text.count(" ") * 2.4


def _text(x: float, y: float, text: str, size: float = 10, bold: bool = False, rgb=INK) -> str:
    r, g, b = rgb
    body = _ascii_text(text, "")[:120]
    return "\n".join((
        "BT",
        f"/{'F1' if bold else 'F2'} {int(size)} Tf",
        "2.4 Tw",
        f"{r:.2f} {g:.2f} {b:.2f} rg",
        f"1 0 0 1 {x:.1f} {y:.1f} Tm",
        f"({_pdf_escape(body)}) Tj",
        "ET",
    ))


def _text_right(right_x: float, y: float, text: str, size: float = 10, bold: bool = False, rgb=INK) -> str:
    body = _ascii_text(text, "")[:120]
    x = right_x - _text_width(body, size, bold)
    return _text(x, y, body, size, bold, rgb)


def _rule(x: float, y: float, w: float, rgb=RULE, weight: float = 0.6) -> str:
    r, g, b = rgb
    return f"{r:.2f} {g:.2f} {b:.2f} rg {x:.1f} {y:.1f} {w:.1f} {weight:.1f} re f"


def _rect(x: float, y: float, w: float, h: float, rgb) -> str:
    r, g, b = rgb
    return f"{r:.2f} {g:.2f} {b:.2f} rg {x:.1f} {y:.1f} {w:.1f} {h:.1f} re f"


def _is_paper(r: int, g: int, b: int) -> bool:
    """Treat white and pale blue/lavender wash as empty page, not logo ink."""
    if r >= 236 and g >= 236 and b >= 236:
        return True
    if min(r, g, b) >= 184 and b >= r + 6 and b >= g + 3:
        return True
    return False


def _prepare_watermark() -> Optional[Tuple[bytes, float, float]]:
    """Crop to logo ink, wipe the pale box, and fade onto white — no ExtGState."""
    logo = _load_jod_logo_image()
    if not logo:
        return None
    filt, payload, width, height = logo
    if filt != "FlateDecode":
        return None
    try:
        rgb = zlib.decompress(payload)
    except Exception:
        return None
    if width < 8 or height < 8 or len(rgb) != width * height * 3:
        return None

    faded = bytearray(len(rgb))
    strength = 0.18
    for i in range(0, len(rgb), 3):
        r, g, b = rgb[i], rgb[i + 1], rgb[i + 2]
        if _is_paper(r, g, b):
            faded[i : i + 3] = b"\xff\xff\xff"
            continue
        faded[i] = 255 - int((255 - r) * strength)
        faded[i + 1] = 255 - int((255 - g) * strength)
        faded[i + 2] = 255 - int((255 - b) * strength)
    rgb = bytes(faded)

    min_x, min_y, max_x, max_y = width, height, -1, -1
    for y in range(height):
        row = y * width * 3
        for x in range(width):
            i = row + x * 3
            if rgb[i] < 252 or rgb[i + 1] < 252 or rgb[i + 2] < 252:
                if x < min_x:
                    min_x = x
                if y < min_y:
                    min_y = y
                if x > max_x:
                    max_x = x
                if y > max_y:
                    max_y = y
    if max_x < min_x:
        return None

    pad = 2
    min_x = max(0, min_x - pad)
    min_y = max(0, min_y - pad)
    max_x = min(width - 1, max_x + pad)
    max_y = min(height - 1, max_y + pad)
    new_w = max_x - min_x + 1
    new_h = max_y - min_y + 1
    cropped = bytearray(new_w * new_h * 3)
    for y in range(new_h):
        src = ((min_y + y) * width + min_x) * 3
        dst = y * new_w * 3
        cropped[dst : dst + new_w * 3] = rgb[src : src + new_w * 3]

    return _image_xobject(zlib.compress(bytes(cropped), 9), new_w, new_h, "FlateDecode"), float(new_w), float(new_h)


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

    title = _clip(report.get("event_title") or "Untitled event", 52)
    venue = _clip(report.get("venue") or "Venue TBD", 28)
    lifecycle = _ascii_text(str(report.get("lifecycle") or "ended").replace("_", " ").title(), "Ended")
    event_id = _clip(report.get("event_id") or "-", 26)
    start = _format_when(report.get("event_start_date"))
    end = _format_when(report.get("event_end_date"))
    host = _clip((host_email or "").strip() or "Host dashboard", 28)
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
    gross = _inr(report.get("gross_revenue"))
    platform = _inr(report.get("platform_fee"))
    gst = _inr(report.get("gst_fee"))
    net = _inr(report.get("net_earnings"))
    platform_pct = int(report.get("platform_fee_pct") or 5)
    gst_pct = int(report.get("gst_fee_pct") or 18)
    cities = [c for c in (report.get("top_cities") or []) if isinstance(c, dict)][:4]
    generated = datetime.utcnow().strftime("%d %b %Y, %H:%M UTC")

    ops: List[str] = []
    image_obj: Optional[bytes] = None
    watermark = _prepare_watermark()
    if watermark:
        image_obj, iw, ih = watermark
        wm_w = 300.0
        wm_h = wm_w * (ih / max(iw, 1.0))
        ops.append(_draw_image("Wm", (PAGE_W - wm_w) / 2.0, (PAGE_H - wm_h) / 2.0 - 10.0, wm_w, wm_h))

    ops.append(_rect(0, PAGE_H - 48, PAGE_W, 48, NAVY))
    ops.append(_rect(0, PAGE_H - 51, PAGE_W, 3, (0.98, 0.52, 0.12)))
    ops.append(_text(LEFT, PAGE_H - 30, "JOD EVENTS", 13, True, (1, 1, 1)))
    ops.append(_text_right(RIGHT, PAGE_H - 30, "CONFIDENTIAL HOST REPORT", 8, True, (0.85, 0.90, 0.97)))

    y = PAGE_H - 78
    ops.append(_text(LEFT, y, "EVENT HISTORY REPORT", 8, True, BLUE))
    y -= 22
    ops.append(_text(LEFT, y, title, 18, True, INK))
    y -= 16
    ops.append(_text(LEFT, y, f"{start}   |   {venue}   |   {lifecycle}", 9, False, MUTED))
    y -= 12
    ops.append(_rule(LEFT, y, RIGHT - LEFT, BLUE, 1.0))

    def section(label: str) -> None:
        nonlocal y
        y -= 26
        ops.append(_text(LEFT, y, label, 8, True, BLUE))
        y -= 7
        ops.append(_rule(LEFT, y, RIGHT - LEFT, RULE, 0.6))
        y -= 16

    def pair(left_label, left_value, right_label, right_value) -> None:
        nonlocal y
        ops.append(_text(LEFT, y, left_label, 8, False, MUTED))
        ops.append(_text_right(COL1_RIGHT, y, str(left_value), 10, True, INK))
        ops.append(_text(COL2_LEFT, y, right_label, 8, False, MUTED))
        ops.append(_text_right(RIGHT, y, str(right_value), 10, True, INK))
        y -= 18

    def money_row(label: str, value: str, *, rgb=INK, size: int = 10, bold: bool = True) -> None:
        nonlocal y
        ops.append(_text(LEFT + 12, y, label, 8, False, MUTED))
        ops.append(_text_right(RIGHT - 12, y, value, size, bold, rgb))
        y -= 17

    section("1.  EVENT DETAILS")
    pair("Event ID", event_id, "Status", lifecycle)
    pair("Start date", start, "End date", end)
    pair("Venue", venue, "Prepared for", host)
    pair("Messages sent", f"{comms:,}", "Exhibitors", f"{exhibitors:,}")

    section("2.  REGISTRATIONS AND ATTENDANCE")
    pair("Registrations", f"{regs:,}", "Tickets sold", f"{sold:,}")
    pair("Ticket capacity", f"{capacity:,}", "Pending registrations", f"{pending:,}")
    pair("Checked in", f"{checked:,}", "Tickets remaining", f"{available:,}")
    pair("Attendance rate", att_rate, "Conversion rate", conv_rate)

    section("3.  REVENUE AND PAYOUT")
    box_top = y + 10
    box_h = 86
    ops.append(_rect(LEFT, box_top - box_h, RIGHT - LEFT, box_h, (0.96, 0.97, 0.99)))
    y = box_top - 16
    money_row("Gross ticket sales", gross)
    money_row(f"Platform service fee ({platform_pct}%)", f"- {platform}", rgb=RED)
    money_row(f"Taxes and statutory GST ({gst_pct}%)", f"- {gst}", rgb=RED)
    ops.append(_rule(LEFT + 12, y + 8, RIGHT - LEFT - 24, (0.80, 0.84, 0.89), 0.6))
    y -= 4
    money_row("Net host payout", net, rgb=GREEN, size=12, bold=True)
    y = box_top - box_h - 8

    if cities:
        section("4.  AUDIENCE TOP CITIES")
        for city in cities:
            name = _clip(city.get("city") or "Unknown", 28)
            count = int(city.get("count") or 0)
            percent = float(city.get("percent") or 0)
            ops.append(_text(LEFT, y, name, 9, False, INK))
            ops.append(_text_right(RIGHT, y, f"{count:,}   ({percent:.0f}%)", 9, True, INK))
            y -= 16

    ops.append(_rule(LEFT, 46, RIGHT - LEFT, RULE, 0.6))
    ops.append(_text(LEFT, 32, "Generated by JOD Events host dashboard", 8, False, MUTED))
    ops.append(_text_right(RIGHT, 32, "For organizer records only", 8, False, MUTED))
    ops.append(_text(LEFT, 20, generated, 8, False, MUTED))
    ops.append(_text_right(RIGHT, 20, "Page 1 of 1", 8, False, MUTED))

    stream = "\n".join(ops).encode("latin-1", "replace")
    contents = f"<< /Length {len(stream)} >>\nstream\n".encode("ascii") + stream + b"\nendstream"
    xobject_ref = ""
    objects: List[bytes] = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
        contents,
    ]
    if image_obj:
        objects.append(image_obj)
        xobject_ref = "/XObject << /Wm 7 0 R >>"
    resources = (
        f"<< /Font << /F1 4 0 R /F2 5 0 R >> {xobject_ref} >>"
    ).encode("ascii")
    objects[2] = (
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources "
        + resources
        + b" /Contents 6 0 R >>"
    )
    return _assemble_pdf(objects)
