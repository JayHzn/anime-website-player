"""
Cover image fetcher using Jikan API (MyAnimeList).

Provides reliable anime cover images with in-memory cache.
Jikan API: https://jikan.moe/ — free, no API key needed.
Rate limit: 3 requests/second, 60 requests/minute.
"""

import asyncio
import re
import time
import httpx

JIKAN_BASE = "https://api.jikan.moe/v4"
JIKAN_TIMEOUT = 10

# In-memory cache: { "clean_title" -> { "cover": url, "fetched_at": timestamp } }
_cache: dict[str, dict] = {}
CACHE_TTL = 86400  # 24 hours

# Rate limiting — sequential processing to respect Jikan limits
_lock = asyncio.Lock()
_last_request_time = 0.0
_MIN_DELAY = 0.5  # 500ms between requests (2 req/s, safe under 3/s limit)
_MAX_RETRIES = 2


async def _rate_limited_get(client: httpx.AsyncClient, clean_title: str) -> str:
    """Single rate-limited Jikan API call. Returns cover URL or empty string."""
    global _last_request_time

    for attempt in range(_MAX_RETRIES):
        # Always go through rate limiter (including retries)
        async with _lock:
            now = time.time()
            wait = _MIN_DELAY - (now - _last_request_time)
            if wait > 0:
                await asyncio.sleep(wait)
            _last_request_time = time.time()

        try:
            resp = await client.get(
                f"{JIKAN_BASE}/anime",
                params={"q": clean_title, "limit": 1, "sfw": "true"},
            )

            if resp.status_code == 429:
                print(f"[cover_fetcher] 429 rate limited for '{clean_title}', retry {attempt + 1}")
                # Back off before retrying (will also wait _MIN_DELAY via lock)
                await asyncio.sleep(2.0 * (attempt + 1))
                continue

            if resp.status_code != 200:
                print(f"[cover_fetcher] HTTP {resp.status_code} for '{clean_title}'")
                return ""

            data = resp.json()
            results = data.get("data", [])
            if not results:
                print(f"[cover_fetcher] No results for '{clean_title}'")
                return ""

            cover = results[0].get("images", {}).get("jpg", {}).get("large_image_url", "")
            if cover:
                print(f"[cover_fetcher] Found cover for '{clean_title}'")
            return cover

        except Exception as e:
            print(f"[cover_fetcher] Error for '{clean_title}': {e}")
            return ""

    print(f"[cover_fetcher] Max retries reached for '{clean_title}'")
    return ""


async def fetch_cover(title: str) -> str:
    """
    Fetch a single anime cover image URL from Jikan API.
    Results are cached for 24 hours.
    """
    if not title or not title.strip():
        return ""

    cache_key = _clean_title(title).lower()
    if not cache_key:
        return ""

    # Check cache
    if cache_key in _cache:
        entry = _cache[cache_key]
        if time.time() - entry["fetched_at"] < CACHE_TTL:
            return entry["cover"]

    async with httpx.AsyncClient(timeout=JIKAN_TIMEOUT) as client:
        cover = await _rate_limited_get(client, cache_key)

    # Cache even empty results to avoid re-fetching
    _cache[cache_key] = {"cover": cover, "fetched_at": time.time()}
    return cover


async def fetch_covers_batch(titles: list[str]) -> dict[str, str]:
    """
    Fetch covers for multiple anime titles sequentially (respecting rate limits).
    Returns a dict { title -> cover_url }.
    Cached titles are returned instantly, only uncached ones hit the API.
    """
    result = {}
    to_fetch = []  # (original_title, clean_key)

    for title in titles:
        if not title or not title.strip():
            result[title] = ""
            continue

        cache_key = _clean_title(title).lower()
        if not cache_key:
            result[title] = ""
            continue

        if cache_key in _cache:
            entry = _cache[cache_key]
            if time.time() - entry["fetched_at"] < CACHE_TTL:
                result[title] = entry["cover"]
                continue

        # Deduplicate: if same clean key already queued, skip
        if any(key == cache_key for _, key in to_fetch):
            to_fetch.append((title, cache_key))
            continue

        to_fetch.append((title, cache_key))

    if not to_fetch:
        return result

    # Fetch uncached covers sequentially to avoid overwhelming Jikan
    async with httpx.AsyncClient(timeout=JIKAN_TIMEOUT) as client:
        # Get unique keys to fetch
        unique_keys = list(dict.fromkeys(key for _, key in to_fetch))
        fetched = {}
        for key in unique_keys:
            cover = await _rate_limited_get(client, key)
            fetched[key] = cover
            _cache[key] = {"cover": cover, "fetched_at": time.time()}

    for title, cache_key in to_fetch:
        result[title] = fetched.get(cache_key, "")

    return result


def _clean_title(title: str) -> str:
    """Remove common suffixes/patterns that hurt Jikan search accuracy."""
    # Remove VOSTFR/VF suffixes (with or without dash)
    title = re.sub(r'\s*[-–]\s*(VOSTFR|VF|vostfr|vf)\s*$', '', title)
    title = re.sub(r'\s+(VOSTFR|VF|vostfr|vf)\s*$', '', title)
    # Remove season indicators like "Saison 2", "S2", "Season 2"
    title = re.sub(r'\s*(Saison|Season|S)\s*\d+\s*$', '', title, flags=re.IGNORECASE)
    # Remove "Part X", "Partie X", "Cour X"
    title = re.sub(r'\s*(Part|Partie|Cour)\s*\d+\s*$', '', title, flags=re.IGNORECASE)
    # Remove year in parentheses like "(2024)"
    title = re.sub(r'\s*\(\d{4}\)\s*$', '', title)
    # Remove trailing episode info like "- 001" or "Episode 1"
    title = re.sub(r'\s*[-–]\s*\d+\s*$', '', title)
    title = re.sub(r'\s*Episode\s*\d+\s*$', '', title, flags=re.IGNORECASE)
    # Remove trailing dashes/spaces/special chars
    title = title.strip(' -–—:')
    return title
