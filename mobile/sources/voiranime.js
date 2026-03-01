/**
 * Voiranime.com source plugin — Mobile (React Native) version
 *
 * Adapted from extension/sources/voiranime.js
 * Changes: IndexedDB → AsyncStorage for persistent cover cache
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const BASE = "https://v6.voiranime.com";
const JIKAN_BASE = "https://api.jikan.moe/v4";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: BASE + "/",
};

const HOST_PRIORITY = ["vidmoly", "voe", "f16px", "streamtape", "mail.ru"];

// Cover cache: in-memory (fast) + AsyncStorage (persistent)
const _memCache = {};
const COVER_TTL = 86400000 * 7; // 7 days
const COVER_ERROR_TTL = 10000; // 10s

async function _cacheGet(key) {
  // 1. In-memory
  const mem = _memCache[key];
  if (mem) {
    const ttl = mem.cover ? COVER_TTL : COVER_ERROR_TTL;
    if (Date.now() - mem.at < ttl) return mem;
  }
  // 2. AsyncStorage
  try {
    const raw = await AsyncStorage.getItem(`cover:${key}`);
    if (raw) {
      const stored = JSON.parse(raw);
      const ttl = stored.cover ? COVER_TTL : COVER_ERROR_TTL;
      if (Date.now() - stored.at < ttl) {
        _memCache[key] = stored;
        return stored;
      }
    }
  } catch { /* ignore */ }
  return null;
}

function _cacheSet(key, cover) {
  const entry = { key, cover, at: Date.now() };
  _memCache[key] = entry;
  if (cover) {
    AsyncStorage.setItem(`cover:${key}`, JSON.stringify(entry)).catch(() => {});
  }
}

// Jikan rate limiting
const JIKAN_CONCURRENCY = 3;
const JIKAN_DELAY_MS = 200;
let _jikanInFlight = 0;
let _jikanLastStart = 0;

async function _jikanAcquire() {
  while (_jikanInFlight >= JIKAN_CONCURRENCY) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const elapsed = Date.now() - _jikanLastStart;
  if (elapsed < JIKAN_DELAY_MS) {
    await new Promise((r) => setTimeout(r, JIKAN_DELAY_MS - elapsed));
  }
  _jikanInFlight++;
  _jikanLastStart = Date.now();
}

function _jikanRelease() {
  _jikanInFlight--;
}

// ── Regex HTML helpers ──────────────────────────────────────

function matchAll(html, regex) {
  const results = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n));
}

export class VoiranimeSource {
  name = "voiranime";

  // ── Search ────────────────────────────────────────────────

  async search(query) {
    const results = [];
    const seenIds = new Set();

    const searchPromises = [3, 2].map(async (searchId) => {
      try {
        const body = new URLSearchParams({
          action: "ajaxsearchpro_search",
          aspp: query,
          asid: String(searchId),
          asp_inst_id: `${searchId}_1`,
          options:
            "current_page_id=0&qtranslate_lang=0&filters_changed=0&filters_initial=1&asp_gen%5B%5D=title&asp_gen%5B%5D=content&asp_gen%5B%5D=excerpt",
        });

        const resp = await fetch(`${BASE}/wp-admin/admin-ajax.php`, {
          method: "POST",
          headers: {
            ...HEADERS,
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Origin: BASE,
          },
          body: body.toString(),
        });

        if (!resp.ok) return "";
        const html = await resp.text();
        return html.trim() || "";
      } catch (e) {
        console.warn(`[voiranime] Search error (id=${searchId}):`, e);
        return "";
      }
    });

    const htmls = await Promise.all(searchPromises);
    for (const html of htmls) {
      if (html) this._parseSearchResults(html, seenIds, results);
    }

    if (results.length === 0) {
      const fallback = await this._searchWpFallback(query);
      results.push(...fallback);
    }

    return results;
  }

  async enrichCoversAsync(results, onUpdate) {
    const pending = [];
    let scheduled = null;

    const scheduleNotify = () => {
      if (!onUpdate || pending.length === 0) return;
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        const batch = pending.splice(0, pending.length);
        onUpdate(batch);
      }, 50);
    };

    await Promise.all(
      results.map(async (r) => {
        const jikanCover = await this._fetchCoverForAnime(r);
        if (jikanCover) {
          r.cover = jikanCover;
          pending.push({ id: r.id, source: r.source, cover: jikanCover });
          scheduleNotify();
        }
      })
    );
    if (scheduled) clearTimeout(scheduled);
    if (pending.length > 0 && onUpdate) onUpdate(pending);
  }

  _parseSearchResults(html, seenIds, results) {
    const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']*\/anime\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const link = decodeEntities(m[1]);
      const innerHtml = m[2];

      const slug = this._slugFromUrl(link);
      if (!slug || seenIds.has(slug)) continue;
      seenIds.add(slug);

      let title = null;
      const h3Match = innerHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (h3Match) title = stripTags(h3Match[1]);
      if (!title) title = stripTags(innerHtml);
      if (!title) title = slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

      results.push({
        id: slug,
        title: decodeEntities(title),
        cover: "",
        type: "TV",
        year: null,
      });
    }
  }

  async _searchWpFallback(query) {
    try {
      const url = `${BASE}/?s=${encodeURIComponent(query)}&post_type=wp-manga`;
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) return [];

      const html = await resp.text();
      const results = [];
      const seenIds = new Set();

      const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']*\/anime\/[^"']*)["'][^>]*>/gi;
      let m;
      while ((m = linkRegex.exec(html)) !== null) {
        const link = decodeEntities(m[1]);
        const slug = this._slugFromUrl(link);
        if (!slug || seenIds.has(slug)) continue;
        seenIds.add(slug);

        results.push({
          id: slug,
          title: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
          cover: "",
          type: "TV",
          year: null,
        });
      }

      return results;
    } catch (e) {
      console.warn("[voiranime] WP search fallback error:", e);
      return [];
    }
  }

  // ── Latest episodes (homepage scrape) ─────────────────────

  async getLatestEpisodes() {
    try {
      const resp = await fetch(BASE + "/", { headers: HEADERS });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();

      const results = [];
      const seenIds = new Set();

      const cardRegex = /class\s*=\s*["'][^"']*page-item-detail[^"']*["'][^>]*>([\s\S]*?)(?=<div[^>]*class\s*=\s*["'][^"']*page-item-detail|$)/gi;
      let cardMatch;
      while ((cardMatch = cardRegex.exec(html)) !== null) {
        const card = cardMatch[1];

        const titleMatch = card.match(/class\s*=\s*["'][^"']*post-title[^"']*["'][^>]*>[\s\S]*?<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        if (!titleMatch) continue;

        const animeUrl = decodeEntities(titleMatch[1]);
        const title = decodeEntities(stripTags(titleMatch[2]));
        const slug = this._slugFromUrl(animeUrl);
        if (!slug || seenIds.has(slug)) continue;
        seenIds.add(slug);

        let latestEpNumber = null;
        let latestEpId = null;
        const chapterMatch = card.match(/class\s*=\s*["'][^"']*(?:list-chapter|chapter)[^"']*["'][\s\S]*?<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        if (chapterMatch) {
          const epHref = decodeEntities(chapterMatch[1]);
          const epText = stripTags(chapterMatch[2]);
          latestEpNumber = this._extractEpisodeNumber(epText, epHref);
          latestEpId = this._episodeIdFromUrl(epHref);
        }

        let rating = null;
        const ratingMatch = card.match(/class\s*=\s*["'][^"']*(?:total_votes|score|rating)[^"']*["'][^>]*>([\s\S]*?)<\//i);
        if (ratingMatch) {
          const num = parseFloat(stripTags(ratingMatch[1]));
          if (!isNaN(num)) rating = num;
        }

        results.push({
          id: slug,
          title,
          cover: "",
          type: "TV",
          year: null,
          rating,
          latestEpisode: latestEpNumber,
          latestEpisodeId: latestEpId,
        });
      }

      return results;
    } catch (e) {
      console.error("[voiranime] Error fetching latest episodes:", e);
      return [];
    }
  }

  // ── Current season anime (Jikan) ─────────────────────────

  async getSeasonAnime() {
    try {
      const allAnime = [];
      const MAX_PAGES = 4;

      for (let page = 1; page <= MAX_PAGES; page++) {
        const resp = await fetch(`${JIKAN_BASE}/seasons/now?limit=25&sfw=true&page=${page}`);
        if (!resp.ok) break;
        const data = await resp.json();
        const items = data.data || [];
        if (items.length === 0) break;

        for (const a of items) {
          allAnime.push({
            id: `jikan-${a.mal_id}`,
            title: a.title || a.title_english || '',
            titleEnglish: a.title_english || '',
            cover: a.images?.jpg?.large_image_url || '',
            source: 'jikan',
            score: a.score || null,
            episodes: a.episodes || null,
            airedEpisodes: a.episodes_aired || null,
            status: a.status || '',
            synopsis: a.synopsis || '',
          });
        }

        if (!data.pagination?.has_next_page) break;
        if (page < MAX_PAGES) await new Promise((r) => setTimeout(r, 350));
      }

      return allAnime;
    } catch (e) {
      console.error("[voiranime] Error fetching season anime:", e);
      return [];
    }
  }

  // ── Episodes ──────────────────────────────────────────────

  async getEpisodes(animeId) {
    const url = `${BASE}/anime/${animeId}/`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`Failed to fetch anime page: HTTP ${resp.status}`);

    const html = await resp.text();
    const episodes = [];

    const liRegex = /<li\s[^>]*class\s*=\s*["'][^"']*wp-manga-chapter[^"']*["'][^>]*>([\s\S]*?)<\/li>/gi;
    let liMatch;
    while ((liMatch = liRegex.exec(html)) !== null) {
      const liHtml = liMatch[1];
      const aMatch = liHtml.match(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
      if (!aMatch) continue;

      const href = decodeEntities(aMatch[1]);
      const epText = stripTags(aMatch[2]);
      const epNumber = this._extractEpisodeNumber(epText, href);
      const epId = this._episodeIdFromUrl(href);

      episodes.push({ id: epId, number: epNumber, title: epText });
    }

    episodes.reverse();
    return episodes;
  }

  // ── Anime Info ─────────────────────────────────────────────

  async getAnimeInfo(animeId) {
    try {
      const url = `${BASE}/anime/${animeId}/`;
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) return null;

      const html = await resp.text();

      let title = animeId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const titleMatch = html.match(
        /class\s*=\s*["'][^"']*post-title[^"']*["'][^>]*>\s*<h[13][^>]*>([\s\S]*?)<\/h[13]>/i
      );
      if (titleMatch) {
        let titleHtml = titleMatch[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "");
        title = stripTags(titleHtml) || title;
      }

      const cover = await this._fetchCoverForAnime({ id: animeId, title });

      let animeType = "TV";
      let year = null;

      const contentItems = matchAll(
        html,
        /class\s*=\s*["'][^"']*(?:post-content_item|summary-content)[^"']*["'][^>]*>([\s\S]*?)(?=<div\s|$)/gi
      );
      for (const item of contentItems) {
        const text = item[1];
        const headingMatch = text.match(/(?:summary-heading|<h5)[^>]*>([\s\S]*?)<\//i);
        if (!headingMatch) continue;

        const label = stripTags(headingMatch[1]).toLowerCase();
        const contentMatch = text.match(/summary-content[^>]*>([\s\S]*?)<\//i);
        if (!contentMatch) continue;
        const value = stripTags(contentMatch[1]);

        if (label.includes("type")) {
          animeType = value;
        } else if (label.includes("année") || label.includes("year") || label.includes("date")) {
          const ym = value.match(/\d{4}/);
          if (ym) year = parseInt(ym[0], 10);
        }
      }

      return { id: animeId, title: decodeEntities(title), cover: cover || "", type: animeType, year };
    } catch (e) {
      console.error(`[voiranime] Error getting anime info for ${animeId}:`, e);
      return null;
    }
  }

  // ── Video URL ─────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    const url = `${BASE}/anime/${episodeId}/`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok) throw new Error(`Failed to fetch episode page: HTTP ${resp.status}`);

    const html = await resp.text();

    const sources = this._parseChapterSources(html);
    if (sources.length > 0) {
      for (const src of sources) {
        const directUrl = await this._resolveEmbedUrl(src.url);
        if (directUrl) {
          return {
            url: directUrl,
            referer: src.url,
            headers: { Referer: src.url },
            subtitles: [],
            sources,
          };
        }
      }
      return {
        url: sources[0].url,
        type: "iframe",
        referer: url,
        headers: { Referer: url },
        subtitles: [],
        sources,
      };
    }

    const iframeUrl = this._findIframeVideo(html);
    if (iframeUrl) {
      return { url: iframeUrl, referer: url, headers: { Referer: url }, subtitles: [] };
    }

    const ajaxUrl = await this._tryAjaxReadingContent(episodeId, html);
    if (ajaxUrl) {
      return { url: ajaxUrl, referer: url, headers: { Referer: url }, subtitles: [] };
    }

    const videoMatch = html.match(/<video[^>]*>[\s\S]*?<source\s[^>]*src\s*=\s*["']([^"']+)["']/i)
      || html.match(/<video\s[^>]*src\s*=\s*["']([^"']+)["']/i);
    if (videoMatch) {
      return { url: videoMatch[1], referer: url, headers: { Referer: url }, subtitles: [] };
    }

    const scriptUrl = this._findVideoInScripts(html);
    if (scriptUrl) {
      return { url: scriptUrl, referer: url, headers: { Referer: url }, subtitles: [] };
    }

    throw new Error("Could not find video URL on episode page");
  }

  // ── Embed resolution ──────────────────────────────────────

  async _resolveEmbedUrl(embedUrl) {
    try {
      const resp = await fetch(embedUrl, {
        headers: { ...HEADERS, Referer: BASE + "/" },
      });
      if (!resp.ok) return null;

      const html = await resp.text();
      const urlLower = embedUrl.toLowerCase();

      if (urlLower.includes("vidmoly")) return this._extractVidmoly(html);
      if (urlLower.includes("voe")) return this._extractVoe(html);
      return this._extractGenericVideoUrl(html);
    } catch (e) {
      console.warn(`[voiranime] Error resolving embed ${embedUrl}:`, e);
      return null;
    }
  }

  _extractVidmoly(html) {
    const patterns = [
      /sources\s*:\s*\[\s*\{\s*file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /source\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /file\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) return m[1];
    }
    return this._extractGenericVideoUrl(html);
  }

  _extractVoe(html) {
    const patterns = [
      /'hls'\s*:\s*'([^']+)'/i,
      /"hls"\s*:\s*"([^"]+)"/i,
      /'mp4'\s*:\s*'([^']+)'/i,
      /"mp4"\s*:\s*"([^"]+)"/i,
      /prompt\s*\(\s*"Node"\s*,\s*"([^"]+)"/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        let u = m[1];
        if (u.startsWith("//")) u = "https:" + u;
        return u;
      }
    }
    return this._extractGenericVideoUrl(html);
  }

  _extractGenericVideoUrl(html) {
    const patterns = [
      /(?:file|source|src|video_url|videoUrl)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /(?:file|source|src|video_url|videoUrl)\s*[:=]\s*["']([^"']+\.mp4[^"']*)["']/i,
      /(https?:\/\/[^\s"'<>\\]+\.m3u8[^\s"'<>\\]*)/i,
      /(https?:\/\/[^\s"'<>\\]+\.mp4[^\s"'<>\\]*)/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        let u = m[1];
        if (u.startsWith("//")) u = "https:" + u;
        return u;
      }
    }
    return null;
  }

  _parseChapterSources(html) {
    const match = html.match(/var\s+thisChapterSources\s*=\s*\{(.+?)\}\s*;/s);
    if (!match) return [];

    const raw = match[1];
    const sources = [];
    const entryRegex = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
    let entry;

    while ((entry = entryRegex.exec(raw)) !== null) {
      const name = entry[1];
      let value = entry[2]
        .replace(/\\\//g, "/")
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t");

      if (/recaptcha|captcha/i.test(value)) continue;

      const iframeMatch = value.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (!iframeMatch) continue;

      let embedUrl = iframeMatch[1];
      if (embedUrl.startsWith("//")) embedUrl = "https:" + embedUrl;

      sources.push({ name, url: embedUrl });
    }

    sources.sort((a, b) => {
      const aIdx = HOST_PRIORITY.findIndex((h) => a.url.toLowerCase().includes(h));
      const bIdx = HOST_PRIORITY.findIndex((h) => b.url.toLowerCase().includes(h));
      return (aIdx === -1 ? HOST_PRIORITY.length : aIdx) - (bIdx === -1 ? HOST_PRIORITY.length : bIdx);
    });

    return sources;
  }

  _findIframeVideo(html) {
    const iframeRegex = /<iframe\s[^>]*(?:src|data-src)\s*=\s*["']([^"']+)["'][^>]*>/gi;
    let m;
    while ((m = iframeRegex.exec(html)) !== null) {
      let src = m[1];
      if (!src || src === "about:blank" || src.includes("google.com") || src.includes("facebook.com")) continue;
      if (src.startsWith("//")) src = "https:" + src;
      return src;
    }
    return null;
  }

  async _tryAjaxReadingContent(episodeId, pageHtml) {
    const mangaMatch = pageHtml.match(/"manga_id"\s*:\s*"?(\d+)"?/);
    if (!mangaMatch) return null;
    const chMatch = pageHtml.match(/"chapter_id"\s*:\s*"?(\d+)"?/);
    if (!chMatch) return null;

    try {
      const body = new URLSearchParams({
        action: "wp_manga_get_reading_content",
        manga: mangaMatch[1],
        chapter: chMatch[1],
      });

      const resp = await fetch(`${BASE}/wp-admin/admin-ajax.php`, {
        method: "POST",
        headers: {
          ...HEADERS,
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        },
        body: body.toString(),
      });

      if (resp.ok) {
        const html = await resp.text();
        if (html.trim()) return this._findIframeVideo(html);
      }
    } catch {
      // ignore
    }
    return null;
  }

  _findVideoInScripts(html) {
    const patterns = [
      /(?:file|source|src|url|video_url)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i,
      /(?:file|source|src|url|video_url)\s*[:=]\s*["']([^"']+\.mp4[^"']*)["']/i,
      /(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i,
      /(https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*)/i,
    ];
    for (const pat of patterns) {
      const m = html.match(pat);
      if (m) {
        let u = m[1];
        if (u.startsWith("//")) u = "https:" + u;
        return u;
      }
    }
    return null;
  }

  // ── Jikan cover helpers ───────────────────────────────────

  _getJikanSearchTerms(anime) {
    const terms = new Set();
    const title = anime.title?.trim() || "";
    const slug = anime.id || "";

    const cleaned = this._cleanTitle(title).trim();
    if (cleaned) terms.add(cleaned);

    const slugQuery = slug.replace(/-/g, " ").trim();
    if (slugQuery && slugQuery.length >= 2) terms.add(slugQuery);

    const parenMatch = title.match(/\(\s*([^)]{2,80})\s*\)/);
    if (parenMatch) {
      const alt = parenMatch[1].trim();
      if (alt.length >= 2 && !/^\d+$/.test(alt)) terms.add(alt);
    }
    const dashMatch = title.match(/[-–—]\s*([^-–—]{2,80})$/);
    if (dashMatch) {
      const alt = dashMatch[1].trim();
      if (alt.length >= 2) terms.add(alt);
    }

    return [...terms];
  }

  async _fetchCoverForAnime(anime) {
    const cacheKey = `anime:${anime.id}`;
    const cached = await _cacheGet(cacheKey);
    if (cached) return cached.cover;

    const terms = this._getJikanSearchTerms(anime);
    for (const q of terms) {
      const cover = await this._fetchCoverByQuery(q);
      if (cover) {
        _cacheSet(cacheKey, cover);
        return cover;
      }
    }
    _cacheSet(cacheKey, "");
    return "";
  }

  async _fetchCoverByQuery(query) {
    const key = query.toLowerCase().trim();
    if (!key) return "";

    const cached = await _cacheGet(key);
    if (cached) return cached.cover;

    await _jikanAcquire();
    try {
      const resp = await fetch(
        `${JIKAN_BASE}/anime?q=${encodeURIComponent(key)}&limit=5&sfw=true`
      );
      if (resp.status === 429) return "";
      if (!resp.ok) {
        _cacheSet(key, "");
        return "";
      }
      const data = await resp.json();
      const items = data.data || [];
      if (items.length === 0) {
        _cacheSet(key, "");
        return "";
      }
      const best = this._bestJikanMatch(key, items);
      const cover = best?.images?.jpg?.large_image_url || "";
      _cacheSet(key, cover);
      return cover;
    } catch (e) {
      _cacheSet(key, "");
      return "";
    } finally {
      _jikanRelease();
    }
  }

  _bestJikanMatch(query, items) {
    const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
    const q = norm(query);
    let bestItem = items[0];
    let bestScore = -1;

    for (const item of items) {
      const candidates = [
        item.title,
        item.title_english,
        item.title_japanese,
        ...(item.title_synonyms || []),
      ].filter(Boolean);

      for (const t of candidates) {
        const n = norm(t);
        if (n === q) return item;
        let score = 0;
        const shorter = q.length <= n.length ? q : n;
        const longer = q.length > n.length ? q : n;
        if (longer.includes(shorter)) {
          score = shorter.length / longer.length;
        } else {
          let cp = 0;
          while (cp < shorter.length && shorter[cp] === longer[cp]) cp++;
          score = cp / longer.length * 0.5;
        }
        if (score > bestScore) {
          bestScore = score;
          bestItem = item;
        }
      }
    }
    return bestItem;
  }

  _cleanTitle(title) {
    title = title.replace(/\s*[-–]\s*(VOSTFR|VF|vostfr|vf)\s*$/, "");
    title = title.replace(/\s+(VOSTFR|VF|vostfr|vf)\s*$/, "");
    title = title.replace(/\s*(Saison|Season|S)\s*\d+\s*$/i, "");
    title = title.replace(/\s*(Part|Partie|Cour)\s*\d+\s*$/i, "");
    title = title.replace(/\s*\(\d{4}\)\s*$/, "");
    title = title.replace(/\s*[-–]\s*\d+\s*$/, "");
    title = title.replace(/\s*Episode\s*\d+\s*$/i, "");
    title = title.replace(/^[\s\-–—:]+|[\s\-–—:]+$/g, "");
    return title;
  }

  // ── URL helpers ───────────────────────────────────────────

  _slugFromUrl(url) {
    const m = url.match(/\/anime\/([^/]+)\/?$/);
    return m ? m[1] : null;
  }

  _episodeIdFromUrl(url) {
    const m = url.match(/\/anime\/(.+?)\/?$/);
    return m ? m[1].replace(/\/+$/, "") : url;
  }

  _extractEpisodeNumber(text, href) {
    let m = text.match(/[-–]\s*(\d{1,4})(?:x\d+)*\s*(?:VOSTFR|VF|vostfr|vf)/);
    if (m) return parseInt(m[1], 10);

    m = href.match(/-(\d{1,4})(?:x\d+)*-(?:vostfr|vf)/i);
    if (m) return parseInt(m[1], 10);

    const nums = text.match(/\d+/g);
    if (nums) return parseInt(nums[nums.length - 1], 10);
    return 0;
  }
}
