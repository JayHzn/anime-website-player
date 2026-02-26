"""
Voiranime.com source plugin for AnimeHub.

Site: v6.voiranime.com
Stack: WordPress + Madara theme + WP-Manga plugin + Ajax Search Pro
Episodes are "chapters" in WP-Manga terminology.

Search: POST /wp-admin/admin-ajax.php  (Ajax Search Pro plugin)
Anime page: /anime/{slug}/  → episode list in HTML
Episode page: /anime/{slug}/{ep-slug}/ → iframe(s) with video players
"""

import re
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin, quote

from sources.base import AnimeSource
from cover_fetcher import fetch_cover, fetch_covers_batch

BASE = "https://v6.voiranime.com"
TIMEOUT = 15

# Common headers to look like a real browser
HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
    "Referer": BASE + "/",
}


class Source(AnimeSource):
    name = "voiranime"
    language = "fr"
    base_url = BASE

    def __init__(self):
        self._client = None

    def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                headers=HEADERS,
                follow_redirects=True,
                timeout=TIMEOUT,
            )
        return self._client

    # ── Search ────────────────────────────────────────────────

    async def search(self, query: str) -> list[dict]:
        """
        Uses the Ajax Search Pro plugin (instance id=3 for VOSTFR).
        POST to admin-ajax.php with action=ajaxsearchpro_search.
        Returns HTML snippets which we parse for results.
        """
        client = self._get_client()

        # Try VOSTFR search first (id=3), then VF (id=2)
        results = []
        seen_ids = set()

        for search_id in [3, 2]:
            try:
                data = {
                    "action": "ajaxsearchpro_search",
                    "aspp": query,
                    "asid": str(search_id),
                    "asp_inst_id": f"{search_id}_1",
                    "options": f"current_page_id=0&qtranslate_lang=0&filters_changed=0&filters_initial=1&asp_gen%5B%5D=title&asp_gen%5B%5D=content&asp_gen%5B%5D=excerpt",
                }
                resp = await client.post(
                    f"{BASE}/wp-admin/admin-ajax.php",
                    data=data,
                    headers={
                        **HEADERS,
                        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                        "X-Requested-With": "XMLHttpRequest",
                        "Origin": BASE,
                    },
                )
                if resp.status_code != 200:
                    continue

                html = resp.text
                if not html.strip():
                    continue

                items = self._parse_search_results(html, seen_ids)
                results.extend(items)
            except Exception as e:
                print(f"[voiranime] Search error (id={search_id}): {e}")

        # Fallback: if AJAX search fails (Cloudflare), try direct WP search
        if not results:
            results = await self._search_wp_fallback(query)

        # Enrich all results with Jikan covers in parallel (more reliable than scraped ones)
        titles = [r.get("title", "") for r in results]
        covers = await fetch_covers_batch(titles)
        for r in results:
            jikan_cover = covers.get(r.get("title", ""), "")
            if jikan_cover:
                r["cover"] = jikan_cover

        return results

    def _parse_search_results(self, html: str, seen_ids: set) -> list[dict]:
        """Parse Ajax Search Pro HTML response."""
        soup = BeautifulSoup(html, "lxml")
        results = []

        for item in soup.select(".item, .asp_r_item, a[href]"):
            link = None
            title = None
            cover = None

            # Try different structures the plugin might return
            a_tag = item if item.name == "a" else item.select_one("a")
            if a_tag and a_tag.get("href"):
                link = a_tag["href"]

            h3 = item.select_one("h3")
            if h3:
                title = h3.get_text(strip=True)
                if not link and h3.select_one("a"):
                    link = h3.select_one("a")["href"]

            if not title and a_tag:
                title = a_tag.get_text(strip=True)

            img = item.select_one("img")
            if img:
                cover = img.get("src", "") or img.get("data-src", "")

            if not link or "/anime/" not in link:
                continue

            # Extract slug from URL
            slug = self._slug_from_url(link)
            if not slug or slug in seen_ids:
                continue
            seen_ids.add(slug)

            results.append({
                "id": slug,
                "title": title or slug.replace("-", " ").title(),
                "cover": cover or "",
                "type": "TV",
                "year": None,
            })

        return results

    async def _search_wp_fallback(self, query: str) -> list[dict]:
        """Fallback: WordPress native search page."""
        client = self._get_client()
        try:
            resp = await client.get(
                f"{BASE}/",
                params={"s": query, "post_type": "wp-manga"},
            )
            if resp.status_code != 200:
                return []

            soup = BeautifulSoup(resp.text, "lxml")
            results = []

            for item in soup.select(".c-tabs-item .c-tabs-item__content, .page-listing-item"):
                a_tag = item.select_one("a[href*='/anime/']")
                if not a_tag:
                    continue

                link = a_tag["href"]
                slug = self._slug_from_url(link)
                if not slug:
                    continue

                title_el = item.select_one(".post-title a, h3 a, h4 a")
                title = title_el.get_text(strip=True) if title_el else slug.replace("-", " ").title()

                img = item.select_one("img")
                cover = ""
                if img:
                    cover = img.get("data-src", "") or img.get("src", "")

                results.append({
                    "id": slug,
                    "title": title,
                    "cover": cover,
                    "type": "TV",
                    "year": None,
                })

            return results
        except Exception as e:
            print(f"[voiranime] WP search fallback error: {e}")
            return []

    # ── Episodes ──────────────────────────────────────────────

    async def get_episodes(self, anime_id: str) -> list[dict]:
        """
        Fetch the anime page and parse the chapter/episode list.
        anime_id = slug (e.g. "naruto")
        """
        client = self._get_client()
        url = f"{BASE}/anime/{anime_id}/"

        resp = await client.get(url)
        if resp.status_code != 200:
            raise Exception(f"Failed to fetch anime page: HTTP {resp.status_code}")

        soup = BeautifulSoup(resp.text, "lxml")
        episodes = []

        # Episodes are in <ul class="main version-chap"> <li class="wp-manga-chapter">
        for li in soup.select("ul.main.version-chap li.wp-manga-chapter"):
            a_tag = li.select_one("a")
            if not a_tag:
                continue

            href = a_tag["href"]
            ep_text = a_tag.get_text(strip=True)

            # Extract episode number from the text or URL
            ep_number = self._extract_episode_number(ep_text, href)

            # Build episode ID from the URL path
            # e.g. /anime/naruto/naruto-001-vostfr/ → naruto/naruto-001-vostfr
            ep_id = self._episode_id_from_url(href)

            episodes.append({
                "id": ep_id,
                "number": ep_number,
                "title": ep_text,
            })

        # Episodes come in reverse order (newest first), reverse to get 1→N
        episodes.reverse()

        return episodes

    # ── Anime Info ─────────────────────────────────────────────

    async def get_anime_info(self, anime_id: str) -> dict | None:
        """
        Scrape the anime page to get title, cover image, type, year, etc.
        """
        client = self._get_client()
        url = f"{BASE}/anime/{anime_id}/"

        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None

            soup = BeautifulSoup(resp.text, "lxml")

            # Title: <div class="post-title"><h1>...</h1></div>
            title = anime_id.replace("-", " ").title()
            title_el = soup.select_one(".post-title h1, .post-title h3")
            if title_el:
                # Remove inner <span> badges (e.g. "VOSTFR")
                for span in title_el.select("span"):
                    span.decompose()
                title = title_el.get_text(strip=True)

            # Always use Jikan API (MyAnimeList) for cover — scraped ones are unreliable
            cover = await fetch_cover(title)

            # Fallback to scraped cover if Jikan returns nothing
            if not cover:
                img = soup.select_one(
                    ".summary_image img, "
                    ".tab-summary img, "
                    ".manga-thumb img"
                )
                if img:
                    cover = (
                        img.get("data-src", "")
                        or img.get("src", "")
                        or img.get("data-lazy-src", "")
                        or ""
                    )

            # Type & year from info table
            anime_type = "TV"
            year = None
            for item in soup.select(".post-content_item, .post-status .summary-content"):
                heading = item.select_one(".summary-heading, h5")
                content = item.select_one(".summary-content, .artist-content")
                if not heading or not content:
                    continue
                label = heading.get_text(strip=True).lower()
                value = content.get_text(strip=True)
                if "type" in label:
                    anime_type = value
                elif "année" in label or "year" in label or "date" in label:
                    # Extract 4-digit year
                    year_match = re.search(r"\d{4}", value)
                    if year_match:
                        year = int(year_match.group())

            return {
                "id": anime_id,
                "title": title,
                "cover": cover,
                "type": anime_type,
                "year": year,
            }
        except Exception as e:
            print(f"[voiranime] Error getting anime info for {anime_id}: {e}")
            return None

    # ── Video URL ─────────────────────────────────────────────

    async def get_video_url(self, episode_id: str) -> dict:
        """
        Fetch the episode page and extract video player URLs.
        episode_id = "naruto/naruto-001-vostfr"
        
        The episode page contains:
        1. A default iframe in .chapter-video-frame (e.g. vidmoly.biz)
        2. A JS object `thisChapterSources` with ALL available players:
           { "LECTEUR myTV": "<iframe src='vidmoly.biz/...'/>",
             "LECTEUR MOON": "<iframe src='f16px.com/...'/>",
             "LECTEUR VOE": "<iframe src='voe.sx/...'/>", ... }
        3. A <select class="host-select"> to switch between them.
        
        We parse thisChapterSources to get all embed URLs and return
        them sorted by reliability (prefer vidmoly/voe/streamtape).
        """
        client = self._get_client()
        url = f"{BASE}/anime/{episode_id}/"

        resp = await client.get(url)
        if resp.status_code != 200:
            raise Exception(f"Failed to fetch episode page: HTTP {resp.status_code}")

        html = resp.text
        soup = BeautifulSoup(html, "lxml")

        # ── Strategy 1: Parse thisChapterSources JS object ──
        sources = self._parse_chapter_sources(html)
        if sources:
            # Try to resolve each embed URL to a direct video stream
            for src in sources:
                direct_url = await self._resolve_embed_url(src["url"])
                if direct_url:
                    return {
                        "url": direct_url,
                        "referer": src["url"],
                        "headers": {"Referer": src["url"]},
                        "subtitles": [],
                        "sources": sources,
                    }

            # No direct URL found — return embed URL with iframe flag
            best = sources[0]
            return {
                "url": best["url"],
                "type": "iframe",
                "referer": url,
                "headers": {"Referer": url},
                "subtitles": [],
                "sources": sources,
            }

        # ── Strategy 2: Fallback — iframe in .chapter-video-frame ──
        video_url = self._find_iframe_video(soup)
        if video_url:
            return {
                "url": video_url,
                "referer": url,
                "headers": {"Referer": url},
                "subtitles": [],
            }

        # ── Strategy 3: AJAX-loaded reading content ──
        video_url = await self._try_ajax_reading_content(client, episode_id, html)
        if video_url:
            return {
                "url": video_url,
                "referer": url,
                "headers": {"Referer": url},
                "subtitles": [],
            }

        # ── Strategy 4: Direct video tags or .m3u8/.mp4 in scripts ──
        video_tag = soup.select_one("video source[src], video[src]")
        if video_tag:
            src = video_tag.get("src", "")
            if src:
                return {
                    "url": src,
                    "referer": url,
                    "headers": {"Referer": url},
                    "subtitles": [],
                }

        video_url = self._find_video_in_scripts(soup, html)
        if video_url:
            return {
                "url": video_url,
                "referer": url,
                "headers": {"Referer": url},
                "subtitles": [],
            }

        raise Exception("Could not find video URL on episode page")

    # Preferred hosts in order of reliability for embed playback
    _HOST_PRIORITY = [
        "vidmoly",   # Usually most reliable, HLS streams
        "voe",       # Good quality
        "f16px",     # MOON player
        "streamtape",
        "mail.ru",   # FHD1
    ]

    async def _resolve_embed_url(self, embed_url: str) -> str | None:
        """
        Fetch an embed page (e.g. vidmoly, voe) and extract the actual
        video stream URL (.m3u8 or .mp4) from the page source.
        Returns the direct URL, or None if extraction fails.
        """
        client = self._get_client()
        try:
            resp = await client.get(
                embed_url,
                headers={
                    **HEADERS,
                    "Referer": BASE + "/",
                },
            )
            if resp.status_code != 200:
                return None

            html = resp.text

            # ── Host-specific extraction ──

            url_lower = embed_url.lower()

            # Vidmoly: looks for sources[{file:"...m3u8"}] or similar patterns
            if "vidmoly" in url_lower:
                return self._extract_vidmoly(html)

            # Voe: looks for HLS/MP4 in page source
            if "voe" in url_lower:
                return self._extract_voe(html)

            # Generic: try common patterns
            return self._extract_generic_video_url(html)

        except Exception as e:
            print(f"[voiranime] Error resolving embed {embed_url}: {e}")
            return None

    def _extract_vidmoly(self, html: str) -> str | None:
        """Extract video URL from a vidmoly embed page."""
        # Pattern: sources: [{file:"URL"}] or source: "URL"
        patterns = [
            r'sources\s*:\s*\[\s*\{\s*file\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'source\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'file\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                return match.group(1)
        # Fallback: any .m3u8 URL
        return self._extract_generic_video_url(html)

    def _extract_voe(self, html: str) -> str | None:
        """Extract video URL from a voe embed page."""
        # Voe patterns: 'hls': 'URL' or 'mp4': 'URL' or prompt("Node","URL")
        patterns = [
            r"'hls'\s*:\s*'([^']+)'",
            r'"hls"\s*:\s*"([^"]+)"',
            r"'mp4'\s*:\s*'([^']+)'",
            r'"mp4"\s*:\s*"([^"]+)"',
            r'prompt\s*\(\s*"Node"\s*,\s*"([^"]+)"',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                url = match.group(1)
                if url.startswith("//"):
                    url = "https:" + url
                return url
        return self._extract_generic_video_url(html)

    @staticmethod
    def _extract_generic_video_url(html: str) -> str | None:
        """Try generic patterns to find a video stream URL in HTML."""
        patterns = [
            # Explicit source/file assignments
            r'(?:file|source|src|video_url|videoUrl)\s*[:=]\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'(?:file|source|src|video_url|videoUrl)\s*[:=]\s*["\']([^"\']+\.mp4[^"\']*)["\']',
            # Any .m3u8 URL in the page
            r'(https?://[^\s"\'<>\\]+\.m3u8[^\s"\'<>\\]*)',
            # Any .mp4 URL in the page (but not thumbnails/posters)
            r'(https?://[^\s"\'<>\\]+\.mp4[^\s"\'<>\\]*)',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                url = match.group(1)
                if url.startswith("//"):
                    url = "https:" + url
                return url
        return None

    def _parse_chapter_sources(self, html: str) -> list[dict]:
        """
        Parse the `var thisChapterSources = { ... };` JS object
        from the episode page to extract all available embed URLs.
        Returns a sorted list of {name, url} dicts.
        """
        # Match the JS object — it's a simple string-keyed dict of HTML strings
        match = re.search(
            r"var\s+thisChapterSources\s*=\s*\{(.+?)\}\s*;",
            html,
            re.DOTALL,
        )
        if not match:
            return []

        raw = match.group(1)
        sources = []

        # Extract each "KEY": "VALUE" pair
        # Keys are like "LECTEUR myTV", values contain iframe HTML or captcha forms
        for entry in re.finditer(
            r'"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"',
            raw,
        ):
            name = entry.group(1)
            value = entry.group(2)

            # Unescape JS string
            value = (
                value.replace("\\/", "/")
                .replace('\\"', '"')
                .replace("\\n", "\n")
                .replace("\\t", "\t")
            )

            # Skip captcha-protected sources (contain g-recaptcha)
            if "recaptcha" in value.lower() or "captcha" in value.lower():
                continue

            # Extract iframe src from the HTML snippet
            iframe_match = re.search(
                r'<iframe[^>]+src=["\']([^"\']+)["\']',
                value,
                re.IGNORECASE,
            )
            if not iframe_match:
                continue

            embed_url = iframe_match.group(1)
            if embed_url.startswith("//"):
                embed_url = "https:" + embed_url

            sources.append({"name": name, "url": embed_url})

        # Sort by host priority
        def sort_key(s):
            url_lower = s["url"].lower()
            for i, host in enumerate(self._HOST_PRIORITY):
                if host in url_lower:
                    return i
            return len(self._HOST_PRIORITY)

        sources.sort(key=sort_key)
        return sources

    def _find_iframe_video(self, soup: BeautifulSoup) -> str | None:
        """Extract video player URL from iframes on the page."""
        # Look in reading-content area first, then entire page
        containers = soup.select(
            ".reading-content iframe, "
            ".entry-content iframe, "
            ".text-left iframe, "
            "#readerarea iframe, "
            ".chapter-video-frame iframe, "
            "iframe[src*='player'], "
            "iframe[src*='embed'], "
            "iframe[src*='video'], "
            "iframe[data-src]"
        )

        for iframe in containers:
            src = iframe.get("src", "") or iframe.get("data-src", "")
            if src and src != "about:blank" and not src.startswith("//www.google"):
                # Return absolute URL
                if src.startswith("//"):
                    src = "https:" + src
                elif not src.startswith("http"):
                    src = urljoin(BASE, src)
                return src

        # Also check for all iframes on page as fallback
        for iframe in soup.select("iframe"):
            src = iframe.get("src", "") or iframe.get("data-src", "")
            if src and "google" not in src and "facebook" not in src and src != "about:blank":
                if src.startswith("//"):
                    src = "https:" + src
                elif not src.startswith("http"):
                    src = urljoin(BASE, src)
                return src

        return None

    async def _try_ajax_reading_content(
        self, client: httpx.AsyncClient, episode_id: str, page_html: str
    ) -> str | None:
        """
        WP-Manga sometimes loads reading content via AJAX.
        The page JS calls: action=wp_manga_get_reading_content
        """
        # Extract manga_id and chapter_slug from the page
        match = re.search(r'"manga_id"\s*:\s*"?(\d+)"?', page_html)
        if not match:
            return None

        manga_id = match.group(1)

        # Extract chapter ID
        ch_match = re.search(r'"chapter_id"\s*:\s*"?(\d+)"?', page_html)
        if not ch_match:
            return None

        chapter_id = ch_match.group(1)

        try:
            data = {
                "action": "wp_manga_get_reading_content",
                "manga": manga_id,
                "chapter": chapter_id,
            }
            resp = await client.post(
                f"{BASE}/wp-admin/admin-ajax.php",
                data=data,
                headers={
                    **HEADERS,
                    "X-Requested-With": "XMLHttpRequest",
                    "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
                },
            )
            if resp.status_code == 200 and resp.text.strip():
                content_soup = BeautifulSoup(resp.text, "lxml")
                return self._find_iframe_video(content_soup)
        except Exception:
            pass

        return None

    def _find_video_in_scripts(self, soup: BeautifulSoup, html: str) -> str | None:
        """Look for video URLs in script tags or raw HTML."""
        # Common patterns for video URLs
        patterns = [
            r'(?:file|source|src|url|video_url)\s*[:=]\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'(?:file|source|src|url|video_url)\s*[:=]\s*["\']([^"\']+\.mp4[^"\']*)["\']',
            r'(https?://[^\s"\'<>]+\.m3u8[^\s"\'<>]*)',
            r'(https?://[^\s"\'<>]+\.mp4[^\s"\'<>]*)',
        ]

        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                url = match.group(1)
                if url.startswith("//"):
                    url = "https:" + url
                return url

        return None

    # ── Helpers ────────────────────────────────────────────────

    @staticmethod
    def _slug_from_url(url: str) -> str | None:
        """Extract anime slug from URL like /anime/naruto/ → naruto"""
        match = re.search(r"/anime/([^/]+)/?$", url)
        return match.group(1) if match else None

    @staticmethod
    def _episode_id_from_url(url: str) -> str:
        """
        Extract episode path from full URL.
        /anime/naruto/naruto-001-vostfr/ → naruto/naruto-001-vostfr
        """
        match = re.search(r"/anime/(.+?)/?$", url)
        return match.group(1).rstrip("/") if match else url

    @staticmethod
    def _extract_episode_number(text: str, href: str) -> int:
        """Extract episode number from text or URL."""
        # Try from text: "Naruto - 001 VOSTFR - 001" or "Naruto - 220 VOSTFR"
        # Handle multi-episode: "203x204x205"
        num_match = re.search(
            r"[\-–]\s*(\d{1,4})(?:x\d+)*\s*(?:VOSTFR|VF|vostfr|vf)",
            text,
        )
        if num_match:
            return int(num_match.group(1))

        # Try from URL: /naruto-001-vostfr/
        url_match = re.search(r"-(\d{1,4})(?:x\d+)*-(?:vostfr|vf)", href, re.IGNORECASE)
        if url_match:
            return int(url_match.group(1))

        # Last resort: any number in the text
        nums = re.findall(r"\d+", text)
        if nums:
            return int(nums[-1])

        return 0