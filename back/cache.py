"""
Simple TTL in-memory cache for API responses.

Caches scraping results to avoid hitting source sites on every page load.
Each entry expires after a configurable TTL (default 10 minutes).
"""

import time
from typing import Any

_store: dict[str, tuple[float, Any]] = {}

# Default TTLs per category (in seconds)
TTLS = {
    "episodes": 600,     # 10 min — episode list rarely changes
    "anime_info": 600,   # 10 min
    "search": 120,       # 2 min — searches can vary
    "video_url": 300,    # 5 min — embed URLs can expire
}


def get(key: str) -> Any | None:
    """Get a cached value if it exists and hasn't expired."""
    entry = _store.get(key)
    if entry is None:
        return None
    expires_at, value = entry
    if time.monotonic() > expires_at:
        del _store[key]
        return None
    return value


def set(key: str, value: Any, category: str = "episodes") -> None:
    """Cache a value with a TTL based on category."""
    ttl = TTLS.get(category, 300)
    _store[key] = (time.monotonic() + ttl, value)


def invalidate(prefix: str) -> None:
    """Remove all cache entries matching a prefix."""
    keys = [k for k in _store if k.startswith(prefix)]
    for k in keys:
        del _store[k]


def clear() -> None:
    """Clear the entire cache."""
    _store.clear()
