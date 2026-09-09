"""Host ticket design templates for canvas preview + PDF accents.

Free hosts always keep the JOD Events logo. Premium hosts may hide it.
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
        "tagline": "Dark navy card for nightlife & concerts",
        "preview": {"bg": "#0b1220", "card": "#111827", "accent": "#38bdf8", "text": "#f8fafc", "muted": "#94a3b8"},
        "pdf": {"page_rgb": (0.05, 0.07, 0.12), "card_rgb": (0.07, 0.09, 0.15), "accent_rgb": (0.22, 0.74, 0.97), "text_rgb": (0.96, 0.97, 0.98), "muted_rgb": (0.58, 0.64, 0.72), "style": "midnight"},
    },
    {
        "id": "sunset",
        "name": "Sunset Glow",
        "tagline": "Warm coral strip for festivals & parties",
        "preview": {"bg": "#fff7ed", "card": "#fffbeb", "accent": "#ea580c", "text": "#1c1917", "muted": "#78716c"},
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
        "tagline": "Charcoal + gold for premium seating",
        "preview": {"bg": "#1c1917", "card": "#292524", "accent": "#d4a017", "text": "#fafaf9", "muted": "#a8a29e"},
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
}


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
    base["custom_footer"] = footer
    base["headline_override"] = headline

    elements = raw.get("canvas_elements")
    cleaned_elements = []
    if isinstance(elements, list):
        seen = set()
        for item in elements:
            if not isinstance(item, dict):
                continue
            etype = str(item.get("type") or "").strip().lower()
            if not etype or etype in seen:
                continue
            seen.add(etype)
            try:
                x = float(item.get("x", 4))
                y = float(item.get("y", 4))
                w = float(item.get("w", 40))
                h = float(item.get("h", 6))
            except (TypeError, ValueError):
                continue
            cleaned_elements.append({
                "type": etype,
                "x": max(0.0, min(92.0, x)),
                "y": max(0.0, min(94.0, y)),
                "w": max(10.0, min(96.0, w)),
                "h": max(3.0, min(40.0, h)),
            })
    if cleaned_elements:
        base["canvas_elements"] = cleaned_elements

    if not is_premium:
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
