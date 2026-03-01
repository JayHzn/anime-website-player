/**
 * VoirDrama.tv source plugin
 *
 * Same WP-Manga platform as voiranime, adapted for dramas.
 * Runs in a Chrome extension SERVICE WORKER — no DOM APIs.
 */

const BASE = "https://voirdrama.tv";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
  Referer: BASE + "/",
};

const HOST_PRIORITY = ["vidmoly", "voe", "f16px", "streamtape", "mail.ru"];

// ── Regex HTML helpers ──────────────────────────────────────

function matchAll(html, regex) {
  const results = [];
  let m;
  const re = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : regex.flags + "g");
  while ((m = re.exec(html)) !== null) results.push(m);
  return results;
}

function getAttr(tag, attr) {
  const m = tag.match(new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`, "i"));
  return m ? m[1] : null;
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

/** Extract best (largest) cover URL from an img tag HTML string */
function bestCover(imgTag) {
  if (!imgTag) return "";
  // Try srcset first — pick the largest variant (350x476)
  const srcsetMatch = imgTag.match(/srcset\s*=\s*["']([^"']+)["']/i);
  if (srcsetMatch) {
    const parts = srcsetMatch[1].split(",").map((s) => s.trim());
    let best = "";
    let bestW = 0;
    for (const part of parts) {
      const [url, w] = part.split(/\s+/);
      const width = parseInt(w) || 0;
      if (width > bestW) { bestW = width; best = url; }
    }
    if (best) return best;
  }
  // Fallback: src attribute, remove thumbnail suffix for full-size
  const srcMatch = imgTag.match(/src\s*=\s*["']([^"']+)["']/i);
  if (srcMatch) {
    return srcMatch[1].replace(/-\d+x\d+\./, ".");
  }
  return "";
}

export class VoirdramaSource {
  name = "voirdrama";

  // ── Search ────────────────────────────────────────────────

  async search(query) {
    const results = [];
    const seenIds = new Set();

    // Ajax Search Pro: VOSTFR id=6, VF id=7
    const searchPromises = [6, 7].map(async (searchId) => {
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
        console.warn(`[voirdrama] Search error (id=${searchId}):`, e);
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

  // Convert hotlink-protected covers to data URLs via extension fetch
  async enrichCoversAsync(results, onUpdate) {
    const needsProxy = results.filter((r) => r.cover?.includes("voirdrama.tv/wp-content/"));
    if (needsProxy.length === 0) return;

    const BATCH = 5;
    for (let i = 0; i < needsProxy.length; i += BATCH) {
      const batch = needsProxy.slice(i, i + BATCH);
      const patches = [];
      await Promise.all(
        batch.map(async (r) => {
          try {
            const resp = await fetch(r.cover, { headers: { Referer: BASE + "/" } });
            if (!resp.ok) return;
            const buf = await resp.arrayBuffer();
            const bytes = new Uint8Array(buf);
            let binary = "";
            for (let j = 0; j < bytes.length; j++) binary += String.fromCharCode(bytes[j]);
            const contentType = resp.headers.get("content-type") || "image/jpeg";
            const dataUrl = `data:${contentType};base64,${btoa(binary)}`;
            r.cover = dataUrl;
            patches.push({ id: r.id, source: r.source, cover: dataUrl });
          } catch { /* ignore */ }
        })
      );
      if (patches.length > 0 && onUpdate) onUpdate(patches);
    }
  }

  _parseSearchResults(html, seenIds, results) {
    const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']*\/drama\/[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
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

      // Try to extract cover from search results (best quality)
      let cover = "";
      const imgTag = innerHtml.match(/<img[^>]*>/i);
      if (imgTag) cover = bestCover(imgTag[0]);

      results.push({
        id: slug,
        title: decodeEntities(title),
        cover,
        type: "Drama",
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

      const linkRegex = /<a\s[^>]*href\s*=\s*["']([^"']*\/drama\/[^"']*)["'][^>]*>/gi;
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
          type: "Drama",
          year: null,
        });
      }

      return results;
    } catch (e) {
      console.warn("[voirdrama] WP search fallback error:", e);
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

        const dramaUrl = decodeEntities(titleMatch[1]);
        const title = decodeEntities(stripTags(titleMatch[2]));
        const slug = this._slugFromUrl(dramaUrl);
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

        // Try to get cover image (best quality from srcset)
        let cover = "";
        const imgTag = card.match(/<img[^>]*class\s*=\s*["'][^"']*img-responsive[^"']*["'][^>]*>/i);
        if (imgTag) cover = bestCover(imgTag[0]);

        results.push({
          id: slug,
          title,
          cover,
          type: "Drama",
          year: null,
          rating: null,
          latestEpisode: latestEpNumber,
          latestEpisodeId: latestEpId,
        });
      }

      return results;
    } catch (e) {
      console.error("[voirdrama] Error fetching latest episodes:", e);
      return [];
    }
  }

  // ── Drama catalogue (currently airing — from homepage) ────

  async getSeasonAnime() {
    try {
      // The homepage shows dramas with recent episode updates = currently airing
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

        const dramaUrl = decodeEntities(titleMatch[1]);
        const title = decodeEntities(stripTags(titleMatch[2]));
        const slug = this._slugFromUrl(dramaUrl);
        if (!slug || seenIds.has(slug)) continue;
        seenIds.add(slug);

        // Cover image (best quality from srcset)
        let cover = "";
        const imgTag = card.match(/<img[^>]*class\s*=\s*["'][^"']*img-responsive[^"']*["'][^>]*>/i);
        if (imgTag) cover = bestCover(imgTag[0]);

        // Latest episode info
        let latestEpNumber = null;
        const chapterMatch = card.match(/class\s*=\s*["'][^"']*(?:list-chapter|chapter)[^"']*["'][\s\S]*?<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
        if (chapterMatch) {
          const epText = stripTags(chapterMatch[2]);
          latestEpNumber = this._extractEpisodeNumber(epText, chapterMatch[1]);
        }

        results.push({
          id: slug,
          title,
          cover,
          source: "voirdrama",
          score: null,
          episodes: null,
          airedEpisodes: latestEpNumber,
          status: "",
          synopsis: "",
        });
      }

      return results;
    } catch (e) {
      console.error("[voirdrama] Error fetching drama catalogue:", e);
      return [];
    }
  }

  // ── Episodes ──────────────────────────────────────────────

  async getEpisodes(dramaId) {
    const url = `${BASE}/drama/${dramaId}/`;
    const resp = await fetch(url, { headers: HEADERS });
    if (!resp.ok)
      throw new Error(`Failed to fetch drama page: HTTP ${resp.status}`);

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

  // ── Drama Info ─────────────────────────────────────────────

  async getAnimeInfo(dramaId) {
    try {
      const url = `${BASE}/drama/${dramaId}/`;
      const resp = await fetch(url, { headers: HEADERS });
      if (!resp.ok) return null;

      const html = await resp.text();

      let title = dramaId.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
      const titleMatch = html.match(
        /class\s*=\s*["'][^"']*post-title[^"']*["'][^>]*>\s*<h[13][^>]*>([\s\S]*?)<\/h[13]>/i
      );
      if (titleMatch) {
        let titleHtml = titleMatch[1].replace(/<span[^>]*>[\s\S]*?<\/span>/gi, "");
        title = stripTags(titleHtml) || title;
      }

      // Get cover from page (best quality from srcset)
      let cover = "";
      const coverImgTag = html.match(/class\s*=\s*["'][^"']*summary_image[^"']*["'][^>]*>[\s\S]*?(<img[^>]*>)/i);
      if (coverImgTag) cover = bestCover(coverImgTag[1]);

      let dramaType = "Drama";
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
          dramaType = value;
        } else if (label.includes("année") || label.includes("year") || label.includes("date")) {
          const ym = value.match(/\d{4}/);
          if (ym) year = parseInt(ym[0], 10);
        }
      }

      return { id: dramaId, title: decodeEntities(title), cover, type: dramaType, year };
    } catch (e) {
      console.error(`[voirdrama] Error getting drama info for ${dramaId}:`, e);
      return null;
    }
  }

  // ── Video URL ─────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    const url = `${BASE}/drama/${episodeId}/`;
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

    // Strategy 4: Direct video tags
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
      console.warn(`[voirdrama] Error resolving embed ${embedUrl}:`, e);
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

  // ── URL helpers ───────────────────────────────────────────

  _slugFromUrl(url) {
    const m = url.match(/\/drama\/([^/]+)\/?$/);
    return m ? m[1] : null;
  }

  _episodeIdFromUrl(url) {
    const m = url.match(/\/drama\/(.+?)\/?$/);
    return m ? m[1].replace(/\/+$/, "") : url;
  }

  _extractEpisodeNumber(text, href) {
    let m = text.match(/[-–]\s*(\d{1,4})(?:x\d+)*\s*(?:VOSTFR|VF|vostfr|vf)/);
    if (m) return parseInt(m[1], 10);

    m = text.match(/[Ee]pisode\s*(\d{1,4})/i);
    if (m) return parseInt(m[1], 10);

    m = href.match(/-(\d{1,4})(?:x\d+)*-(?:vostfr|vf)/i);
    if (m) return parseInt(m[1], 10);

    m = href.match(/episode-(\d{1,4})/i);
    if (m) return parseInt(m[1], 10);

    const nums = text.match(/\d+/g);
    if (nums) return parseInt(nums[nums.length - 1], 10);
    return 0;
  }
}
