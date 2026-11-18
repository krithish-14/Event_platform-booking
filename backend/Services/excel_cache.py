"""In-process TTL cache for processed Excel workbooks.

Not shared across workers — each process keeps its own cache. Prefer Redis
when the API runs on multiple EC2 instances.
"""

from __future__ import annotations

import os
import threading
import time
from typing import Any, Optional

_DEFAULT_TTL = int(os.getenv("DATA_MAPPING_CACHE_TTL_SECONDS", "600") or "600")
_LOCK = threading.RLock()
_CACHE: dict[str, tuple[float, Any]] = {}


def cache_get(key: str) -> Optional[Any]:
	now = time.time()
	with _LOCK:
		item = _CACHE.get(key)
		if not item:
			return None
		expires, value = item
		if expires < now:
			_CACHE.pop(key, None)
			return None
		return value


def cache_set(key: str, value: Any, ttl: Optional[int] = None) -> None:
	seconds = _DEFAULT_TTL if ttl is None else max(1, int(ttl))
	with _LOCK:
		_CACHE[key] = (time.time() + seconds, value)


def cache_invalidate(prefix: Optional[str] = None) -> None:
	with _LOCK:
		if not prefix:
			_CACHE.clear()
			return
		for key in list(_CACHE.keys()):
			if key.startswith(prefix):
				_CACHE.pop(key, None)


def cache_key_for_source(source_id: str, file_hash: str, sheet_name: str) -> str:
	return f"sdm:{source_id}:{file_hash}:{sheet_name or ''}"
