"""
VoirDrama.tv source plugin for AnimeHub.

Site: voirdrama.tv
Stack: WordPress + Madara theme + WP-Manga plugin + Ajax Search Pro
Same platform as voiranime, adapted for dramas.
"""

import re
import httpx
from bs4 import BeautifulSoup
from urllib.parse import urljoin

from sources.base import AnimeSource

BASE = "https://voirdrama.tv"
TIMEOUT = 15

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
    name = "voirdrama"
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
        client = self._get_client()
        results = []
        seen_ids = set()

        # Ajax Search Pro: VOSTFR id=6, VF id=7
        for search_id in [6, 7]:
            try:
                data = {
                    "action": "ajaxsearchpro_search",
                    "aspp": query,
                    "asid": str(search_id),
                    "asp_inst_id": f"{search_id}_1",
                    "options": "current_page_id=0&qtranslate_lang=0&filters_changed=0&filters_initial=1&asp_gen%5B%5D=title&asp_gen%5B%5D=content&asp_gen%5B%5D=excerpt",
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
                print(f"[voirdrama] Search error (id={search_id}): {e}")

        if not results:
            results = await self._search_wp_fallback(query)

        return results

    def _parse_search_results(self, html: str, seen_ids: set) -> list[dict]:
        soup = BeautifulSoup(html, "lxml")
        results = []

        for item in soup.select(".item, .asp_r_item, a[href]"):
            link = None
            title = None
            cover = None

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

            if not link or "/drama/" not in link:
                continue

            slug = self._slug_from_url(link)
            if not slug or slug in seen_ids:
                continue
            seen_ids.add(slug)

            results.append({
                "id": slug,
                "title": title or slug.replace("-", " ").title(),
                "cover": cover or "",
                "type": "Drama",
                "year": None,
            })

        return results

    async def _search_wp_fallback(self, query: str) -> list[dict]:
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
                a_tag = item.select_one("a[href*='/drama/']")
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
                    "type": "Drama",
                    "year": None,
                })

            return results
        except Exception as e:
            print(f"[voirdrama] WP search fallback error: {e}")
            return []

    # ── Episodes ──────────────────────────────────────────────

    async def get_episodes(self, drama_id: str) -> list[dict]:
        client = self._get_client()
        url = f"{BASE}/drama/{drama_id}/"

        resp = await client.get(url)
        if resp.status_code != 200:
            raise Exception(f"Failed to fetch drama page: HTTP {resp.status_code}")

        soup = BeautifulSoup(resp.text, "lxml")
        episodes = []

        for li in soup.select("ul.main.version-chap li.wp-manga-chapter"):
            a_tag = li.select_one("a")
            if not a_tag:
                continue

            href = a_tag["href"]
            ep_text = a_tag.get_text(strip=True)
            ep_number = self._extract_episode_number(ep_text, href)
            ep_id = self._episode_id_from_url(href)

            episodes.append({
                "id": ep_id,
                "number": ep_number,
                "title": ep_text,
            })

        episodes.reverse()
        return episodes

    # ── Drama Info ─────────────────────────────────────────────

    async def get_anime_info(self, drama_id: str) -> dict | None:
        client = self._get_client()
        url = f"{BASE}/drama/{drama_id}/"

        try:
            resp = await client.get(url)
            if resp.status_code != 200:
                return None

            soup = BeautifulSoup(resp.text, "lxml")

            title = drama_id.replace("-", " ").title()
            title_el = soup.select_one(".post-title h1, .post-title h3")
            if title_el:
                for span in title_el.select("span"):
                    span.decompose()
                title = title_el.get_text(strip=True)

            # Get cover from the page directly (no Jikan for dramas)
            cover = ""
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

            drama_type = "Drama"
            year = None
            for item in soup.select(".post-content_item, .post-status .summary-content"):
                heading = item.select_one(".summary-heading, h5")
                content = item.select_one(".summary-content, .artist-content")
                if not heading or not content:
                    continue
                label = heading.get_text(strip=True).lower()
                value = content.get_text(strip=True)
                if "type" in label:
                    drama_type = value
                elif "année" in label or "year" in label or "date" in label:
                    year_match = re.search(r"\d{4}", value)
                    if year_match:
                        year = int(year_match.group())

            return {
                "id": drama_id,
                "title": title,
                "cover": cover,
                "type": drama_type,
                "year": year,
            }
        except Exception as e:
            print(f"[voirdrama] Error getting drama info for {drama_id}: {e}")
            return None

    # ── Video URL ─────────────────────────────────────────────

    async def get_video_url(self, episode_id: str) -> dict:
        client = self._get_client()
        url = f"{BASE}/drama/{episode_id}/"

        resp = await client.get(url)
        if resp.status_code != 200:
            raise Exception(f"Failed to fetch episode page: HTTP {resp.status_code}")

        html = resp.text
        soup = BeautifulSoup(html, "lxml")

        sources = self._parse_chapter_sources(html)
        if sources:
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

            best = sources[0]
            return {
                "url": best["url"],
                "type": "iframe",
                "referer": url,
                "headers": {"Referer": url},
                "subtitles": [],
                "sources": sources,
            }

        video_url = self._find_iframe_video(soup)
        if video_url:
            return {
                "url": video_url,
                "referer": url,
                "headers": {"Referer": url},
                "subtitles": [],
            }

        video_url = await self._try_ajax_reading_content(client, episode_id, html)
        if video_url:
            return {
                "url": video_url,
                "referer": url,
                "headers": {"Referer": url},
                "subtitles": [],
            }

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

    _HOST_PRIORITY = ["vidmoly", "voe", "f16px", "streamtape", "mail.ru"]

    async def _resolve_embed_url(self, embed_url: str) -> str | None:
        client = self._get_client()
        try:
            resp = await client.get(
                embed_url,
                headers={**HEADERS, "Referer": BASE + "/"},
            )
            if resp.status_code != 200:
                return None

            html = resp.text
            url_lower = embed_url.lower()

            if "vidmoly" in url_lower:
                return self._extract_vidmoly(html)
            if "voe" in url_lower:
                return self._extract_voe(html)
            return self._extract_generic_video_url(html)
        except Exception as e:
            print(f"[voirdrama] Error resolving embed {embed_url}: {e}")
            return None

    def _extract_vidmoly(self, html: str) -> str | None:
        patterns = [
            r'sources\s*:\s*\[\s*\{\s*file\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'source\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'file\s*:\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
        ]
        for pattern in patterns:
            match = re.search(pattern, html, re.IGNORECASE)
            if match:
                return match.group(1)
        return self._extract_generic_video_url(html)

    def _extract_voe(self, html: str) -> str | None:
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
        patterns = [
            r'(?:file|source|src|video_url|videoUrl)\s*[:=]\s*["\']([^"\']+\.m3u8[^"\']*)["\']',
            r'(?:file|source|src|video_url|videoUrl)\s*[:=]\s*["\']([^"\']+\.mp4[^"\']*)["\']',
            r'(https?://[^\s"\'<>\\]+\.m3u8[^\s"\'<>\\]*)',
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
        match = re.search(
            r"var\s+thisChapterSources\s*=\s*\{(.+?)\}\s*;",
            html,
            re.DOTALL,
        )
        if not match:
            return []

        raw = match.group(1)
        sources = []

        for entry in re.finditer(r'"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"', raw):
            name = entry.group(1)
            value = entry.group(2)
            value = (
                value.replace("\\/", "/")
                .replace('\\"', '"')
                .replace("\\n", "\n")
                .replace("\\t", "\t")
            )

            if "recaptcha" in value.lower() or "captcha" in value.lower():
                continue

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

        def sort_key(s):
            url_lower = s["url"].lower()
            for i, host in enumerate(self._HOST_PRIORITY):
                if host in url_lower:
                    return i
            return len(self._HOST_PRIORITY)

        sources.sort(key=sort_key)
        return sources

    def _find_iframe_video(self, soup: BeautifulSoup) -> str | None:
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
                if src.startswith("//"):
                    src = "https:" + src
                elif not src.startswith("http"):
                    src = urljoin(BASE, src)
                return src

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
        match = re.search(r'"manga_id"\s*:\s*"?(\d+)"?', page_html)
        if not match:
            return None
        manga_id = match.group(1)

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
        match = re.search(r"/drama/([^/]+)/?$", url)
        return match.group(1) if match else None

    @staticmethod
    def _episode_id_from_url(url: str) -> str:
        match = re.search(r"/drama/(.+?)/?$", url)
        return match.group(1).rstrip("/") if match else url

    @staticmethod
    def _extract_episode_number(text: str, href: str) -> int:
        num_match = re.search(
            r"[\-–]\s*(\d{1,4})(?:x\d+)*\s*(?:VOSTFR|VF|vostfr|vf)",
            text,
        )
        if num_match:
            return int(num_match.group(1))

        ep_match = re.search(r"[Ee]pisode\s*(\d{1,4})", text)
        if ep_match:
            return int(ep_match.group(1))

        url_match = re.search(r"-(\d{1,4})(?:x\d+)*-(?:vostfr|vf)", href, re.IGNORECASE)
        if url_match:
            return int(url_match.group(1))

        url_ep_match = re.search(r"episode-(\d{1,4})", href, re.IGNORECASE)
        if url_ep_match:
            return int(url_ep_match.group(1))

        nums = re.findall(r"\d+", text)
        if nums:
            return int(nums[-1])

        return 0
