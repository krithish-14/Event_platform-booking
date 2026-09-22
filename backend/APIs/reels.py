"""Public view/like counters for home-page event highlight reels."""

from __future__ import annotations

import json
import os
import threading
from typing import Dict

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

ALLOWED_REELS = ("rotary", "marathon", "marathon2", "sandd", "rotaract")
_LOCK = threading.Lock()
_STATS_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "data", "reel_stats.json")
)


class LikeBody(BaseModel):
    liked: bool = Field(..., description="True to like, false to unlike")


def _empty_reel() -> Dict[str, int]:
    return {"views": 0, "likes": 0}


def _default_stats() -> Dict[str, Dict[str, int]]:
    return {reel_id: _empty_reel() for reel_id in ALLOWED_REELS}


def _load() -> Dict[str, Dict[str, int]]:
    stats = _default_stats()
    if not os.path.isfile(_STATS_PATH):
        return stats
    try:
        with open(_STATS_PATH, "r", encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, json.JSONDecodeError, TypeError):
        return stats
    if not isinstance(raw, dict):
        return stats
    for reel_id in ALLOWED_REELS:
        row = raw.get(reel_id) or {}
        if not isinstance(row, dict):
            continue
        stats[reel_id] = {
            "views": max(0, int(row.get("views") or 0)),
            "likes": max(0, int(row.get("likes") or 0)),
        }
    return stats


def _save(stats: Dict[str, Dict[str, int]]) -> None:
    folder = os.path.dirname(_STATS_PATH)
    os.makedirs(folder, exist_ok=True)
    tmp_path = _STATS_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as handle:
        json.dump(stats, handle, indent=2)
    os.replace(tmp_path, _STATS_PATH)


def _require_id(reel_id: str) -> str:
    key = str(reel_id or "").strip().lower()
    if key not in ALLOWED_REELS:
        raise HTTPException(status_code=404, detail="Unknown reel")
    return key


@router.get("/stats")
def get_reel_stats():
    with _LOCK:
        return _load()


@router.post("/{reel_id}/view")
def increment_reel_view(reel_id: str):
    key = _require_id(reel_id)
    with _LOCK:
        stats = _load()
        stats[key]["views"] += 1
        _save(stats)
        return stats[key]


@router.post("/{reel_id}/like")
def toggle_reel_like(reel_id: str, body: LikeBody):
    key = _require_id(reel_id)
    with _LOCK:
        stats = _load()
        if body.liked:
            stats[key]["likes"] += 1
        else:
            stats[key]["likes"] = max(0, stats[key]["likes"] - 1)
        _save(stats)
        return {"liked": body.liked, **stats[key]}
