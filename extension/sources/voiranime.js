/**
 * Voiranime.com source plugin — JS port of back/sources/voiranime.py
 *
 * IMPORTANT: This runs in a Chrome extension SERVICE WORKER.
 * No DOM APIs (DOMParser, document, etc.) — all HTML parsing is regex-based.
 */

const BASE = "https://v6.voiranime.com";
const JIKAN_BASE = "https://api.jikan.moe/v4";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: BASE + "/",
};

const HOST_PRIORITY = ["vidmoly", "voe", "f16px", "streamtape", "mail.ru"];

// In-memory cover cache
const _coverCache = {};
const COVER_TTL = 86400000; // 24h
const COVER_ERROR_TTL = 60000; // 1min for errors (retry sooner)

// Jikan: max 2 concurrent, 400ms between batch starts
const JIKAN_CONCURRENCY = 2;
const JIKAN_DELAY_MS = 400;
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

/** Extract all matches of a regex, returning array of match arrays */
function matchAll(html, regex) {
  const results = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

/** Extract attribute value from an HTML tag string */
function getAttr(tag, attr) {
  const m = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
}

/** Strip HTML tags, return text content */
function stripTags(html) {
  return html.replace(/<[^>]*>/g, "").trim();
}

/** Decode common HTML entities */
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

    // Run both Ajax Search Pro requests in parallel (VOSTFR id=3, VF id=2)
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

    // Return results immediately — covers will be fetched by enrichCoversAsync
    return results;
  }

  /**
   * Enrich covers from Jikan (always — consistent quality).
   * Runs in parallel (max 2 concurrent) for faster display.
   * Throttles UI updates to every 200ms.
   */
  async enrichCoversAsync(results, onUpdate) {
    let scheduled = null;
    const scheduleNotify = () => {
      if (!onUpdate) return;
      if (scheduled) return;
      scheduled = setTimeout(() => {
        scheduled = null;
        onUpdate(results);
      }, 200);
    };

    // Fetch all covers in parallel (semaphore limits to 2 concurrent)
    await Promise.all(
      results.map(async (r) => {
        const cover = await this._fetchCover(r.title);
        if (cover) {
          r.cover = cover;
          scheduleNotify();
        }
      })
    );
    if (scheduled) clearTimeout(scheduled);
    if (onUpdate) onUpdate(results);
  }

  _parseSearchResults(html, seenIds, results) {
    // Find all <a> tags with href containing /anime/
    const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']*\/anime\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = linkRegex.exec(html)) !== null) {
      const link = decodeEntities(m[1]);
      const innerHtml = m[2];

      const slug = this._slugFromUrl(link);
      if (!slug || seenIds.has(slug)) continue;
      seenIds.add(slug);

      // Try to get title from <h3> inside, or from link text
      let title = null;
      const h3Match = innerHtml.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (h3Match) {
        title = stripTags(h3Match[1]);
      }
      if (!title) {
        title = stripTags(innerHtml);
      }

      // Cover always from Jikan (enrichCoversAsync) for consistent quality
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

      // Look for links to /anime/ pages
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

  // ── Episodes ──────────────────────────────────────────────

  async getEpisodes(animeId) {
    const url = `${BASE}/anime/${animeId}/`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok)
      throw new Error(`Failed to fetch anime page: HTTP ${resp.status}`);

    const html = await resp.text();
    const episodes = [];

    // Match <li class="wp-manga-chapter"> ... <a href="...">text</a> ... </li>
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

      // Title from <div class="post-title"><h1>...</h1></div>
      let title = animeId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const titleMatch = html.match(
        /class\s*=\s*["'][^"']*post-title[^"']*["'][^>]*>\s*<h[13][^>]*>([\s\S]*?)<\/h[13]>/i
      );
      if (titleMatch) {
        // Remove <span> tags (badges like "VOSTFR")
        let titleHtml = titleMatch[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "");
        title = stripTags(titleHtml) || title;
      }

      // Cover from Jikan
      let cover = await this._fetchCover(title);

      // Fallback to scraped cover
      if (!cover) {
        const imgMatch = html.match(
          /(?:summary_image|tab-summary|manga-thumb)[^>]*>[\s\S]*?<img\s([^>]+)>/i
        );
        if (imgMatch) {
          cover =
            getAttr(imgMatch[0], "data-src") ||
            getAttr(imgMatch[0], "src") ||
            getAttr(imgMatch[0], "data-lazy-src") ||
            "";
        }
      }

      // Type & year from post-content items
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
        // Get the content after the heading
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
    if (!resp.ok)
      throw new Error(`Failed to fetch episode page: HTTP ${resp.status}`);

    const html = await resp.text();

    // Strategy 1: Parse thisChapterSources
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

    // Strategy 2: iframe in page
    const iframeUrl = this._findIframeVideo(html);
    if (iframeUrl) {
      return { url: iframeUrl, referer: url, headers: { Referer: url }, subtitles: [] };
    }

    // Strategy 3: AJAX reading content
    const ajaxUrl = await this._tryAjaxReadingContent(episodeId, html);
    if (ajaxUrl) {
      return { url: ajaxUrl, referer: url, headers: { Referer: url }, subtitles: [] };
    }

    // Strategy 4: Direct video tags or URLs in scripts
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
    // Find iframes with src — prioritize those in reading/video areas
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

  async _enrichCovers(results) {
    // Sequential with rate limiting to avoid Jikan 429s
    for (const r of results) {
      const cover = await this._fetchCover(r.title);
      if (cover) r.cover = cover;
    }
  }

  async _fetchCover(title) {
    if (!title?.trim()) return "";
    const key = this._cleanTitle(title).toLowerCase();
    if (!key) return "";

    const cached = _coverCache[key];
    if (cached) {
      const ttl = cached.cover ? COVER_TTL : COVER_ERROR_TTL;
      if (Date.now() - cached.at < ttl) return cached.cover;
    }

    await _jikanAcquire();
    try {
      const resp = await fetch(
        `${JIKAN_BASE}/anime?q=${encodeURIComponent(key)}&limit=1&sfw=true`
      );
      if (resp.status === 429) {
        console.warn(`[voiranime] Jikan 429 for '${key}', will retry later`);
        return "";
      }
      if (!resp.ok) {
        _coverCache[key] = { cover: "", at: Date.now() };
        return "";
      }
      const data = await resp.json();
      const cover = data.data?.[0]?.images?.jpg?.large_image_url || "";
      _coverCache[key] = { cover, at: Date.now() };
      return cover;
    } catch (e) {
      console.warn(`[voiranime] Cover fetch error for '${key}':`, e.message);
      _coverCache[key] = { cover: "", at: Date.now() };
      return "";
    } finally {
      _jikanRelease();
    }
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
