"""
Cast, crew and YouTube trailers for theatre movies.

Trailers stay on YouTube; we store only the 11-character video ID and play it
through the youtube-nocookie.com embed. When a theatre adds a link, YouTube's
public oEmbed endpoint (no API key) confirms the video exists and allows
embedding, so customers never get a "Video unavailable" player.
"""

import re
from typing import Iterable, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

import httpx

MAX_CAST = 30
MAX_CREW = 30
MAX_TRAILERS = 5
TRAILER_LABELS = ("Trailer", "Teaser", "Glimpse", "Song", "Promo", "Making")

_VIDEO_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
_YOUTUBE_HOSTS = {"youtube.com", "youtube-nocookie.com"}
_PATH_PREFIXES = ("shorts", "embed", "live", "v", "e")
OEMBED_URL = "https://www.youtube.com/oembed"


class DetailError(ValueError):
    pass


def youtube_id(text) -> Optional[str]:
    """Video ID from a YouTube link (watch, youtu.be, shorts, embed, live) or a bare ID."""
    raw = str(text or "").strip()
    if not raw:
        return None
    if _VIDEO_ID_RE.match(raw):
        return raw
    if "://" not in raw:
        raw = "https://" + raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        return None
    if parsed.scheme not in ("http", "https"):
        return None
    host = (parsed.hostname or "").lower()
    for prefix in ("www.", "m.", "music."):
        if host.startswith(prefix):
            host = host[len(prefix):]
    parts = [p for p in parsed.path.split("/") if p]
    candidate = None
    if host == "youtu.be":
        candidate = parts[0] if parts else None
    elif host in _YOUTUBE_HOSTS:
        if parts and parts[0] == "watch":
            candidate = (parse_qs(parsed.query).get("v") or [None])[0]
        elif len(parts) >= 2 and parts[0] in _PATH_PREFIXES:
            candidate = parts[1]
    return candidate if candidate and _VIDEO_ID_RE.match(candidate) else None


def check_youtube(video_id: str, timeout: float = 5.0) -> Tuple[str, Optional[str]]:
    """("ok", title) | ("no_embed", None) | ("missing", None) | ("unknown", None) when YouTube can't be reached."""
    try:
        resp = httpx.get(OEMBED_URL, params={"url": f"https://www.youtube.com/watch?v={video_id}", "format": "json"}, timeout=timeout)
    except Exception:
        return "unknown", None
    if resp.status_code == 200:
        try:
            return "ok", (resp.json() or {}).get("title")
        except ValueError:
            return "ok", None
    if resp.status_code in (401, 403):
        return "no_embed", None
    if resp.status_code in (400, 404):
        return "missing", None
    return "unknown", None


def _text(value, limit: int) -> str:
    return " ".join(str(value or "").split())[:limit]


def clean_people(rows: Iterable[dict], kind: str) -> List[dict]:
    """Drop blank rows, trim text, keep only photos uploaded through our media store."""
    limit = MAX_CAST if kind == "cast" else MAX_CREW
    out = []
    for row in rows or []:
        name = _text(row.get("name"), 80)
        if not name:
            continue
        photo = str(row.get("photo_url") or "").strip() or None
        if photo and not photo.startswith("/api/media/"):
            raise DetailError(f"Upload {kind} photos from the dashboard.")
        out.append({"name": name, "role": _text(row.get("role"), 80) or None, "photo_url": photo})
    if len(out) > limit:
        raise DetailError(f"Add up to {limit} {kind} members.")
    return out


def clean_trailers(rows: Iterable[dict], known_ids: Iterable[str] = (), checker=None) -> List[dict]:
    """Validate YouTube links; only links not already saved on the movie are checked with YouTube."""
    checker = checker or check_youtube
    known = set(known_ids or ())
    out, seen = [], set()
    for row in rows or []:
        link = str(row.get("url") or row.get("youtube_id") or "").strip()
        if not link:
            continue
        vid = youtube_id(link)
        if not vid:
            raise DetailError(f"\"{link[:60]}\" is not a YouTube video link. Copy the link from YouTube's Share button.")
        if vid in seen:
            continue
        seen.add(vid)
        label = _text(row.get("label"), 20) or "Trailer"
        if label not in TRAILER_LABELS:
            label = "Trailer"
        if vid not in known:
            status, _ = checker(vid)
            if status == "missing":
                raise DetailError(f"YouTube can't find the video {vid}. It may be private or deleted.")
            if status == "no_embed":
                raise DetailError(f"The video {vid} doesn't allow playing on other websites. Use the official trailer, or ask its owner to allow embedding.")
        out.append({"youtube_id": vid, "label": label})
    if len(out) > MAX_TRAILERS:
        raise DetailError(f"Add up to {MAX_TRAILERS} YouTube videos.")
    return out
