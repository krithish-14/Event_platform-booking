"""Host ticket design templates for canvas preview + PDF accents.

Custom canvas layouts (canvas_mode=custom) always keep the JOD Events logo,
on every plan. Older preset layouts keep their saved logo flag so a premium
ticket that hid the logo is not changed until the host publishes a new design.
"""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional


DEFAULT_TEMPLATE_ID = "classic"

TEMPLATES: List[Dict[str, Any]] = [
    {
        "id": "classic",
        "name": "Classic Clean",
        "tagline": "Bright white card — familiar M-ticket look",
        "preview": {"bg": "#f4f6f8", "card": "#ffffff", "accent": "#2563eb", "text": "#111827", "muted": "#6b7280"},
        "pdf": {"page_rgb": (0.97, 0.97, 0.98), "card_rgb": (1, 1, 1), "accent_rgb": (0.15, 0.39, 0.92), "text_rgb": (0.07, 0.09, 0.15), "muted_rgb": (0.42, 0.45, 0.50), "style": "classic"},
    },
    {
        "id": "midnight",
        "name": "Midnight Stage",
        "tagline": "Purple concert stub — JOD logo, no barcode",
        "preview": {"bg": "#1a1033", "card": "#5b21b6", "accent": "#c4b5fd", "text": "#ffffff", "muted": "#ddd6fe"},
        "pdf": {"page_rgb": (0.07, 0.03, 0.12), "card_rgb": (0.36, 0.16, 0.71), "accent_rgb": (0.77, 0.71, 0.99), "text_rgb": (1, 1, 1), "muted_rgb": (0.87, 0.84, 0.99), "style": "midnight"},
    },
    {
        "id": "sunset",
        "name": "Sunset Glow",
        "tagline": "Sunset concert ticket — QR on the stub",
        "preview": {"bg": "#2a120c", "card": "#ff7a1a", "accent": "#e10600", "text": "#ffffff", "muted": "#fff7ed"},
        "pdf": {"page_rgb": (1.0, 0.97, 0.93), "card_rgb": (1.0, 0.98, 0.95), "accent_rgb": (0.92, 0.35, 0.05), "text_rgb": (0.11, 0.10, 0.09), "muted_rgb": (0.47, 0.44, 0.42), "style": "sunset"},
    },
    {
        "id": "concert",
        "name": "Concert Stripe",
        "tagline": "Bold side stripe — high-energy shows",
        "preview": {"bg": "#fafafa", "card": "#ffffff", "accent": "#dc2626", "text": "#0f172a", "muted": "#64748b"},
        "pdf": {"page_rgb": (0.98, 0.98, 0.98), "card_rgb": (1, 1, 1), "accent_rgb": (0.86, 0.15, 0.15), "text_rgb": (0.06, 0.09, 0.16), "muted_rgb": (0.39, 0.45, 0.55), "style": "concert"},
    },
    {
        "id": "minimal",
        "name": "Paper Minimal",
        "tagline": "Quiet editorial layout for conferences",
        "preview": {"bg": "#f8fafc", "card": "#ffffff", "accent": "#0f172a", "text": "#0f172a", "muted": "#64748b"},
        "pdf": {"page_rgb": (0.97, 0.98, 0.99), "card_rgb": (1, 1, 1), "accent_rgb": (0.06, 0.09, 0.16), "text_rgb": (0.06, 0.09, 0.16), "muted_rgb": (0.39, 0.45, 0.55), "style": "minimal"},
    },
    {
        "id": "festival",
        "name": "Festival Teal",
        "tagline": "Fresh teal frame for outdoor & culture",
        "preview": {"bg": "#ecfdf5", "card": "#ffffff", "accent": "#0d9488", "text": "#134e4a", "muted": "#5eead4"},
        "pdf": {"page_rgb": (0.93, 0.99, 0.96), "card_rgb": (1, 1, 1), "accent_rgb": (0.05, 0.58, 0.53), "text_rgb": (0.07, 0.31, 0.29), "muted_rgb": (0.13, 0.55, 0.50), "style": "festival"},
    },
    {
        "id": "vip_gold",
        "name": "VIP Gold",
        "tagline": "Gold details, QR on the black side",
        "preview": {"bg": "#1c1917", "card": "#e6c15a", "accent": "#d4a017", "text": "#111111", "muted": "#f6e27a"},
        "pdf": {"page_rgb": (0.11, 0.10, 0.09), "card_rgb": (0.16, 0.15, 0.14), "accent_rgb": (0.83, 0.63, 0.09), "text_rgb": (0.98, 0.98, 0.96), "muted_rgb": (0.66, 0.64, 0.62), "style": "vip_gold"},
    },
    {
        "id": "neon_night",
        "name": "Neon Night",
        "tagline": "Electric cyan on deep black",
        "preview": {"bg": "#020617", "card": "#0f172a", "accent": "#22d3ee", "text": "#e2e8f0", "muted": "#64748b"},
        "pdf": {"page_rgb": (0.01, 0.02, 0.09), "card_rgb": (0.06, 0.09, 0.16), "accent_rgb": (0.13, 0.83, 0.93), "text_rgb": (0.89, 0.91, 0.94), "muted_rgb": (0.39, 0.45, 0.55), "style": "neon_night"},
    },
]

_TEMPLATE_BY_ID = {t["id"]: t for t in TEMPLATES}

DEFAULT_LAYOUT: Dict[str, Any] = {
    "template_id": DEFAULT_TEMPLATE_ID,
    "accent_color": "#2563eb",
    "card_color": "",
    "text_color": "",
    "show_jod_logo": True,
    "show_venue": True,
    "show_date": True,
    "show_price": True,
    "show_seat": True,
    "show_qr": True,
    "show_ticket_type": True,
    "show_attendee_name": True,
    "show_attendee_email": True,
    "show_attendee_phone": True,
    "custom_footer": "",
    "headline_override": "",
    "ticket_type_override": "",
    "canvas_mode": "",
    "orientation": "",
    "background_image": "",
}


def relative_luminance(hex_color: str) -> float:
    """sRGB relative luminance, 0 (black) to 1 (white)."""
    r, g, b = hex_to_rgb01(hex_color or "#ffffff")

    def _channel(c: float) -> float:
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


def logo_variant_for_color(hex_color: str) -> str:
    """Light backgrounds use the black wordmark. Dark backgrounds use white."""
    return "black" if relative_luminance(hex_color) > 0.179 else "white"


def _is_custom_layout(raw: Dict[str, Any]) -> bool:
    return str(raw.get("canvas_mode") or "").strip().lower() == "custom"


def _clamp_custom_box(entry: Dict[str, Any]) -> None:
    """Keep a percentage box inside the ticket, including the logo and QR."""
    entry["w"] = max(4.0, min(100.0, float(entry["w"])))
    entry["h"] = max(2.0, min(100.0, float(entry["h"])))
    if entry["x"] + entry["w"] > 100.0:
        entry["x"] = max(0.0, 100.0 - entry["w"])
    if entry["y"] + entry["h"] > 100.0:
        entry["y"] = max(0.0, 100.0 - entry["h"])
    entry["x"] = max(0.0, min(100.0, float(entry["x"])))
    entry["y"] = max(0.0, min(100.0, float(entry["y"])))


def _ensure_custom_logo(elements: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if any(str(el.get("type") or "") == "jod_logo" for el in elements):
        for el in elements:
            if str(el.get("type") or "") == "jod_logo":
                el["w"] = max(12.0, min(80.0, float(el.get("w") or 32)))
                el["h"] = max(6.0, min(28.0, float(el.get("h") or 14)))
                _clamp_custom_box(el)
        return elements
    logo = {
        "id": "jod_logo",
        "type": "jod_logo",
        "x": 4.0,
        "y": 78.0,
        "w": 32.0,
        "h": 14.0,
    }
    _clamp_custom_box(logo)
    return elements + [logo]


def ticket_layout_publish_error(layout: Optional[Dict[str, Any]]) -> Optional[str]:
    """Block a custom publish that drops the logo or clips the QR / logo."""
    raw = layout if isinstance(layout, dict) else {}
    if not _is_custom_layout(raw):
        return None
    elements = raw.get("canvas_elements") if isinstance(raw.get("canvas_elements"), list) else []
    logo = next((el for el in elements if isinstance(el, dict) and el.get("type") == "jod_logo"), None)
    if not logo or not bool(raw.get("show_jod_logo", True)):
        return "The JOD Events logo must stay on the ticket."
    for el in elements:
        if not isinstance(el, dict) or el.get("type") not in {"jod_logo", "qr"}:
            continue
        try:
            x = float(el.get("x", 0))
            y = float(el.get("y", 0))
            w = float(el.get("w", 0))
            h = float(el.get("h", 0))
        except (TypeError, ValueError):
            return "The QR code and JOD Events logo must stay inside the ticket."
        if x < -0.5 or y < -0.5 or x + w > 100.5 or y + h > 100.5 or w < 4 or h < 2:
            return "The QR code and JOD Events logo must stay inside the ticket."
    return None


def list_templates_public() -> List[Dict[str, Any]]:
    return [
        {
            "id": t["id"],
            "name": t["name"],
            "tagline": t["tagline"],
            "preview": t["preview"],
        }
        for t in TEMPLATES
    ]


def get_template(template_id: Optional[str]) -> Dict[str, Any]:
    tid = (template_id or DEFAULT_TEMPLATE_ID).strip().lower()
    return _TEMPLATE_BY_ID.get(tid) or _TEMPLATE_BY_ID[DEFAULT_TEMPLATE_ID]


def is_premium_tier(tier: Optional[str]) -> bool:
    return str(tier or "free").strip().lower() in {"premium", "pro", "enterprise"}


def normalize_ticket_layout(
    layout: Optional[Dict[str, Any]],
    *,
    template_id: Optional[str] = None,
    is_premium: bool = False,
) -> Dict[str, Any]:
    """Sanitize layout for storage. Non-premium hosts cannot hide the JOD logo."""
    base = deepcopy(DEFAULT_LAYOUT)
    raw = layout if isinstance(layout, dict) else {}
    tid = (
        str(template_id or raw.get("template_id") or base["template_id"]).strip().lower()
        or DEFAULT_TEMPLATE_ID
    )
    if tid not in _TEMPLATE_BY_ID:
        tid = DEFAULT_TEMPLATE_ID
    base["template_id"] = tid

    accent = str(raw.get("accent_color") or get_template(tid)["preview"]["accent"] or "#2563eb").strip()
    if not accent.startswith("#") or len(accent) not in (4, 7):
        accent = get_template(tid)["preview"]["accent"]
    base["accent_color"] = accent

    def _hex(value: Any, fallback: str = "") -> str:
        color = str(value or "").strip()
        if color.startswith("#") and len(color) in (4, 7):
            return color
        return fallback

    base["card_color"] = _hex(raw.get("card_color"), "")
    base["text_color"] = _hex(raw.get("text_color"), "")

    for key in (
        "show_jod_logo",
        "show_venue",
        "show_date",
        "show_price",
        "show_seat",
        "show_qr",
        "show_ticket_type",
        "show_attendee_name",
        "show_attendee_email",
        "show_attendee_phone",
    ):
        if key in raw:
            base[key] = bool(raw.get(key))

    footer = str(raw.get("custom_footer") or "").strip()[:120]
    headline = str(raw.get("headline_override") or "").strip()[:80]
    ticket_name = str(raw.get("ticket_type_override") or "").strip()[:80]
    base["custom_footer"] = footer
    base["headline_override"] = headline
    base["ticket_type_override"] = ticket_name
    hero_src = str(raw.get("sunset_hero_src") or "").strip()
    if hero_src.startswith(("https://", "http://", "/")) and len(hero_src) <= 800:
        base["sunset_hero_src"] = hero_src
    bg_image = str(raw.get("background_image") or "").strip()
    if bg_image.startswith(("https://", "http://", "/")) and len(bg_image) <= 800:
        base["background_image"] = bg_image
    custom = _is_custom_layout(raw)
    if custom:
        base["canvas_mode"] = "custom"
        orient = str(raw.get("orientation") or "landscape").strip().lower()
        base["orientation"] = "portrait" if orient == "portrait" else "landscape"
        frame = str(raw.get("frame") or "").strip().lower()
        if frame in {"reference", "edited"}:
            base["frame"] = frame
        if str(raw.get("card_style") or "").strip().lower() == "eticket":
            base["card_style"] = "eticket"
    elif str(raw.get("canvas_mode") or "").strip().lower() == "legacy":
        base["canvas_mode"] = "legacy"

    elements = raw.get("canvas_elements")
    cleaned_elements = []
    repeatable_types = {"line", "dashed_line", "rectangle", "circle", "text", "image"}
    text_types = {
        "title", "date", "venue", "qty", "ticket_type", "seat", "name", "phone",
        "email", "booking_id", "price", "footer", "badge", "text", "stub",
        "time", "organizer", "ticket_id",
    }
    font_families = {"Arial", "Georgia", "Courier New", "Times New Roman", "Verdana"}
    if isinstance(elements, list):
        seen_data = set()
        seen_ids = set()
        for item in elements:
            if not isinstance(item, dict):
                continue
            etype = str(item.get("type") or "").strip().lower()
            if not etype:
                continue
            is_repeatable = etype in repeatable_types
            eid = str(item.get("id") or "").strip()
            if not is_repeatable:
                eid = etype
                if etype in seen_data:
                    continue
                seen_data.add(etype)
            else:
                if not eid:
                    eid = f"{etype}_{len(cleaned_elements)+1}"
                if eid in seen_ids:
                    continue
                seen_ids.add(eid)
            try:
                x = float(item.get("x", 4))
                y = float(item.get("y", 4))
                w = float(item.get("w", 40))
                h = float(item.get("h", 6))
            except (TypeError, ValueError):
                continue
            entry = {
                "id": eid[:80],
                "type": etype,
                "x": max(0.0, min(98.0, x)),
                "y": max(0.0, min(98.0, y)),
                "w": max(4.0, min(100.0, w)),
                "h": max(1.0 if etype in {"line", "dashed_line"} else 2.0, min(100.0, h)),
            }
            color = _hex(item.get("color"), "")
            if color:
                entry["color"] = color
            align = str(item.get("align") or "").strip().lower()
            if etype in text_types and align in {"left", "center", "right"}:
                entry["align"] = align
            if etype == "text":
                entry["text"] = str(item.get("text") or "Your text").strip()[:120] or "Your text"
            if etype == "stub":
                entry["text"] = str(item.get("text") or "").strip()[:120]
            if etype in {"image", "organizer_logo"}:
                src = str(item.get("src") or "").strip()
                if src.startswith(("https://", "http://", "/")) and len(src) <= 800:
                    entry["src"] = src
            family = str(item.get("fontFamily") or "").strip()
            if family in font_families:
                entry["fontFamily"] = family
            weight = str(item.get("fontWeight") or "").strip()
            if weight in {"400", "500", "600", "700", "800"}:
                entry["fontWeight"] = weight
            fill = _hex(item.get("fill"), "")
            if fill:
                entry["fill"] = fill
            border = _hex(item.get("borderColor"), "")
            if border:
                entry["borderColor"] = border
            try:
                border_width = float(item.get("borderWidth", 0))
            except (TypeError, ValueError):
                border_width = 0
            if 0 < border_width <= 12:
                entry["borderWidth"] = round(border_width, 1)
            try:
                rotation = float(item.get("rotation", 0))
            except (TypeError, ValueError):
                rotation = 0
            if -180 <= rotation <= 180 and abs(rotation) >= 0.5:
                entry["rotation"] = round(rotation, 1)
            font_steps = {6, 8, 10, 12, 14, 16, 18, 21, 24, 28, 32, 36, 42, 48, 56, 64, 72, 80, 96}
            try:
                font_size = int(round(float(item.get("fontSize", 0))))
            except (TypeError, ValueError):
                font_size = 0
            if font_size in font_steps:
                entry["fontSize"] = font_size
            try:
                font_scale = float(item.get("fontScale", 1))
            except (TypeError, ValueError):
                font_scale = 1.0
            if 0.4 <= font_scale <= 8 and abs(font_scale - 1.0) > 0.01:
                entry["fontScale"] = round(font_scale, 2)
            if custom:
                _clamp_custom_box(entry)
            cleaned_elements.append(entry)
    if custom:
        cleaned_elements = _ensure_custom_logo(cleaned_elements)
    if cleaned_elements:
        base["canvas_elements"] = cleaned_elements
    try:
        version = int(raw.get("layout_version") or 0)
    except (TypeError, ValueError):
        version = 0
    if version > 0:
        base["layout_version"] = version

    if custom:
        base["show_jod_logo"] = True
        base["layout_version"] = max(11, int(base.get("layout_version") or 0))
    elif not is_premium:
        base["show_jod_logo"] = True

    return base


def hex_to_rgb01(hex_color: str) -> tuple[float, float, float]:
    c = (hex_color or "#2563eb").lstrip("#")
    if len(c) == 3:
        c = "".join(ch * 2 for ch in c)
    try:
        r = int(c[0:2], 16) / 255.0
        g = int(c[2:4], 16) / 255.0
        b = int(c[4:6], 16) / 255.0
        return (r, g, b)
    except Exception:
        return (0.15, 0.39, 0.92)
