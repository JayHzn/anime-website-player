// ── Anime-sama.to source ─────────────────────────────────────
// Scrapes anime-sama.to from the user's browser via the extension.

const BASE = 'https://anime-sama.to';
const SEARCH_URL = `${BASE}/template-php/defaut/fetch.php`;
const COVER_BASE = 'https://raw.githubusercontent.com/Anime-Sama/IMG/img/contenu';

// ── Helpers ──────────────────────────────────────────────────

function forceHttps(url) {
  if (!url) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return url.replace(/^http:\/\//i, 'https://');
}

function matchAll(html, regex) {
  const results = [];
  let m;
  while ((m = regex.exec(html)) !== null) results.push(m);
  return results;
}


function stripTags(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'");
}

function slugFromUrl(url) {
  // /catalogue/naruto/ → naruto
  const m = url.match(/\/catalogue\/([^/]+)/);
  return m ? m[1] : '';
}

// ── AnimeSamaSource ──────────────────────────────────────────

// Hosts that build the stream URL at runtime (jwplayer/hls.js): it's never in the static
// HTML, so a server-side fetch+regex can't find it — go straight to iframe extraction
// (player-extractor handles all of these in-context). Hosts that DO expose a direct URL —
// sendvid, f16px, myvi, sibnet… — are deliberately absent so they're still resolved.
const JS_GATED_HOSTS = /vidmoly|voe|streamtape|uqload|vudeo|sbfull|streamsb|streamz|vidhide|earnvids|fitus|lulu|secured|filemoon/i;

export class AnimeSamaSource {

  // ── Search ───────────────────────────────────────────────

  async search(query) {
    if (!query || !query.trim()) {
      return this._getCatalogue();
    }

    const res = await fetch(SEARCH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `query=${encodeURIComponent(query)}`,
    });
    if (!res.ok) return [];
    const html = await res.text();

    // Parse search results: <a href="..." class="asn-search-result">
    const allResults = [];
    const cardRe = /<a[^>]*class="asn-search-result"[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of matchAll(html, cardRe)) {
      const tag = m[0];
      const inner = m[1];
      const hrefM = tag.match(/<a[^>]*href="([^"]*)"[^>]*/i);
      const href = hrefM ? hrefM[1] : '';
      const slug = slugFromUrl(href);
      if (!slug) continue;

      const titleM = inner.match(/<h3[^>]*class="asn-search-result-title"[^>]*>([\s\S]*?)<\/h3>/i);
      const title = titleM ? decodeEntities(stripTags(titleM[1])) : slug;

      const imgM = inner.match(/<img[^>]*src="([^"]*)"[^>]*/i);
      const cover = imgM ? imgM[1] : `${COVER_BASE}/${slug}.jpg`;

      allResults.push({
        id: slug,
        title,
        cover,
        type: 'Anime',
        year: null,
        source: 'anime-sama',
      });
    }

    // Filter out scan-only results: fetch each catalogue page in parallel
    // and check if it has at least one real panneauAnime/panneauFilm call.
    const checks = await Promise.all(
      allResults.map((r) => this._isAnime(r.id).catch(() => false))
    );
    return allResults.filter((_, i) => checks[i]);
  }

  // Returns true if the catalogue page has a real (quoted) panneauAnime/panneauFilm call.
  async _isAnime(slug) {
    const res = await fetch(`${BASE}/catalogue/${slug}/`, {
      headers: { 'User-Agent': navigator.userAgent },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return false;
    const html = await res.text();
    return /panneau(?:Anime|Film)\s*\(\s*["'][^"']+["']\s*,\s*["'][^"']+["']\s*\)/i.test(html);
  }

  // ── Catalogue (empty search = browse) ────────────────────

  async _getCatalogue() {
    const res = await fetch(`${BASE}/catalogue/`, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const cardRe = /<div[^>]*class="[^"]*catalog-card[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
    const linkRe = /<a[^>]*href="([^"]*)"[^>]*/i;
    const titleRe = /<h2[^>]*class="card-title"[^>]*>([\s\S]*?)<\/h2>/i;
    const imgRe = /<img[^>]*class="card-image"[^>]*src="([^"]*)"[^>]*/i;

    for (const m of matchAll(html, cardRe)) {
      const card = m[0];
      const linkM = card.match(linkRe);
      const href = linkM ? linkM[1] : '';
      const slug = slugFromUrl(href);
      if (!slug) continue;

      // Filter: only keep Anime and Film types, skip Scans/Manga
      const typeM = card.match(/<span[^>]*class="info-label"[^>]*>Types<\/span>\s*<p[^>]*class="info-value"[^>]*>([^<]*)<\/p>/i);
      const typeVal = typeM ? typeM[1].trim().toLowerCase() : '';
      if (typeVal && typeVal !== 'anime' && typeVal !== 'film') continue;

      const titleM = card.match(titleRe);
      const title = titleM ? decodeEntities(stripTags(titleM[1])) : slug;

      const imgM = card.match(imgRe);
      const cover = imgM ? imgM[1] : `${COVER_BASE}/${slug}.jpg`;

      results.push({
        id: slug,
        title,
        cover,
        type: 'Anime',
        year: null,
        source: 'anime-sama',
      });
    }
    return results;
  }

  // ── Latest episodes (homepage daily releases) ────────────

  async getLatestEpisodes() {
    const res = await fetch(`${BASE}/`, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) return [];
    const html = await res.text();

    // anime-sama orders sections by weekday (Sun→Sat), not chronologically.
    // We extract every "Sorties du [Day] - DD/MM" section, filter to past+today,
    // sort by date descending, and concatenate cards (newest first).
    const sections = this._collectDaySections(html);

    const results = [];
    const seen = new Set();
    const cardRe = /<div[^>]*class="[^"]*anime-card-premium[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/a>\s*<\/div>/gi;

    for (const section of sections) {
      for (const m of matchAll(section, cardRe)) {
        const card = m[0];

        const linkM = card.match(/<a[^>]*href="([^"]*)"[^>]*/i);
        const href = linkM ? linkM[1] : '';
        const slug = slugFromUrl(href);
        if (!slug) continue;

        // De-duplicate per anime+language
        const langM = card.match(/anime-card-premium[^"]*\s+Anime\s+(VF|VOSTFR)/i);
        const lang = langM ? langM[1].toUpperCase() : '';
        const dedupKey = `${slug}|${lang}`;
        if (seen.has(dedupKey)) continue;
        seen.add(dedupKey);

        const titleM = card.match(/<h2[^>]*class="card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i);
        const baseTitle = titleM ? decodeEntities(stripTags(titleM[1])) : slug;
        const title = lang ? `${baseTitle} (${lang})` : baseTitle;

        const imgM = card.match(/<img[^>]*class="card-image[^"]*"[^>]*src="([^"]*)"[^>]*/i);
        const cover = imgM ? imgM[1] : `${COVER_BASE}/${slug}.jpg`;

        const seasonM = card.match(/<span[^>]*class="info-text"[^>]*>Saison\s*(\d+)/i);
        const seasonNum = seasonM ? parseInt(seasonM[1]) : null;

        results.push({
          id: slug,
          title,
          cover,
          type: 'Anime',
          latestEpisode: seasonNum,
          latestEpisodeId: null,
          source: 'anime-sama',
        });
      }
    }
    return results;
  }

  // Returns the HTML of each "Sorties du [Day] - DD/MM" section that is today or in the past,
  // sorted newest-first. Future-dated sections (tomorrow's scheduled) are skipped.
  _collectDaySections(html) {
    const sectionStarts = [];
    const headerRe = /Sorties du [A-Za-zé]+ - (\d{2})\/(\d{2})/g;
    let m;
    while ((m = headerRe.exec(html)) !== null) {
      sectionStarts.push({ idx: m.index, day: parseInt(m[1]), month: parseInt(m[2]) });
    }
    if (sectionStarts.length === 0) return [];

    const today = new Date();
    const todayKey = today.getMonth() * 31 + today.getDate(); // simple ordinal for comparison

    // Compute a sortable date for each section. Anime-sama only shows DD/MM.
    // Assume current year; if the date would be more than ~7 days in the future,
    // it's likely from last year (past rollover edge case).
    const sections = sectionStarts.map((s, i) => {
      const next = sectionStarts[i + 1];
      const sectionHtml = next ? html.slice(s.idx, next.idx) : html.slice(s.idx);
      const ordinal = (s.month - 1) * 31 + s.day;
      let isFuture = ordinal > todayKey;
      // Tolerate 1-day timezone drift (e.g. day 09 vs day 10 near midnight)
      if (ordinal === todayKey + 1 && (today.getHours() >= 22)) isFuture = false;
      return { sectionHtml, ordinal, isFuture };
    });

    // Keep past + today only, then sort descending (newest first)
    return sections
      .filter((s) => !s.isFuture)
      .sort((a, b) => b.ordinal - a.ordinal)
      .map((s) => s.sectionHtml);
  }

  // ── Season anime (catalogue) ─────────────────────────────

  async getSeasonAnime() {
    return this._getCatalogue();
  }

  // ── Anime info ───────────────────────────────────────────

  async getAnimeInfo(animeId) {
    const slug = animeId;
    const res = await fetch(`${BASE}/catalogue/${slug}/`, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) throw new Error(`Anime not found: ${slug}`);
    const html = await res.text();

    // Title
    const titleM = html.match(/<h4[^>]*id="titreOeuvre"[^>]*>([\s\S]*?)<\/h4>/i);
    const title = titleM ? decodeEntities(stripTags(titleM[1])) : slug;

    // Alt title
    const altM = html.match(/<h2[^>]*id="titreAlter"[^>]*>([\s\S]*?)<\/h2>/i);
    const altTitle = altM ? decodeEntities(stripTags(altM[1])) : '';

    // Cover
    const coverM = html.match(/<img[^>]*id="coverOeuvre"[^>]*src="([^"]*)"[^>]*/i);
    const cover = coverM ? coverM[1] : `${COVER_BASE}/${slug}.jpg`;

    // Synopsis
    const synopsisM = html.match(/Synopsis\s*<\/h[^>]*>([\s\S]*?)<(?:h\d|div|section)/i);
    const synopsis = synopsisM ? decodeEntities(stripTags(synopsisM[1])).trim() : '';

    // Genres
    const genresM = html.match(/Genres?\s*<\/h[^>]*>([\s\S]*?)<(?:h\d|div|section)/i);
    const genres = genresM ? decodeEntities(stripTags(genresM[1])).trim() : '';

    // Seasons: extract panneauAnime/panneauScan calls to list available seasons
    const seasons = [];
    const panelRe = /panneau(?:Anime|Film)\s*\(\s*["']([^"']*)["']\s*,\s*["']([^"']*)["']\s*\)/gi;
    for (const pm of matchAll(html, panelRe)) {
      seasons.push({ name: pm[1], url: pm[2] });
    }

    return {
      id: slug,
      title: altTitle || title,
      cover,
      type: 'Anime',
      year: null,
      source: 'anime-sama',
      synopsis,
      genres,
      seasons,
    };
  }

  // ── Episodes list ────────────────────────────────────────

  // Detects placeholder URLs like:
  //   https://video.sibnet.ru/shell.php?videoid=
  //   https://vidmoly.to/embed-.html
  //   https://sendvid.com/embed/
  //   https://lpayer.embed4me.com/#
  // These are template entries left in the eps array but contain no real ID.
  _isValidEpUrl(url) {
    if (!url || typeof url !== 'string') return false;
    // Strip the trailing ".html" / ".php" so we can compare the meaningful tail
    const u = url.replace(/\.(html|php)$/i, '');
    // Find the last segment after =, /, # or - and check it has 3+ alphanumeric chars
    const idx = Math.max(u.lastIndexOf('='), u.lastIndexOf('#'), u.lastIndexOf('/'), u.lastIndexOf('-'));
    if (idx < 0) return false;
    const id = u.slice(idx + 1);
    return /[a-zA-Z0-9]{3,}/.test(id);
  }

  // Parses every "var epsN = [...]" array in the JS source.
  _parseAllEpsArrays(js) {
    const arrays = [];
    const epsArrRe = /var\s+eps\d+\s*=\s*\[([\s\S]*?)\];/g;
    let m;
    while ((m = epsArrRe.exec(js)) !== null) {
      const urls = [...m[1].matchAll(/['"]([^'"]+)['"]/g)].map((x) => x[1]);
      arrays.push(urls);
    }
    return arrays;
  }

  async getEpisodes(animeId) {
    const info = await this.getAnimeInfo(animeId);
    const seasons = info.seasons || [];

    if (seasons.length === 0) {
      throw new Error('Aucun épisode disponible (contenu manga/scan uniquement).');
    }

    const episodes = [];

    for (const season of seasons) {
      const seasonUrl = season.url.replace(/^\/+|\/+$/g, '');
      const episodesJsUrl = `${BASE}/catalogue/${animeId}/${seasonUrl}/episodes.js`;

      try {
        const res = await fetch(episodesJsUrl, {
          headers: { 'User-Agent': navigator.userAgent },
        });
        if (!res.ok) continue;
        const js = await res.text();

        const arrays = this._parseAllEpsArrays(js);
        if (arrays.length === 0) continue;

        // For each episode index i, only count it if at least one host has a real (non-placeholder) URL.
        const maxLen = Math.max(...arrays.map((a) => a.length));
        for (let i = 0; i < maxLen; i++) {
          const hasValid = arrays.some((arr) => this._isValidEpUrl(arr[i]));
          if (!hasValid) continue;
          const epNum = i + 1;
          episodes.push({
            id: `${animeId}/${seasonUrl}/${epNum}`,
            number: epNum,
            title: `${season.name} - Episode ${epNum}`,
            season: season.name,
          });
        }
      } catch (e) {
        console.warn(`[anime-sama] Failed to load episodes for ${seasonUrl}:`, e.message);
      }
    }

    return episodes;
  }

  // ── Video URL ────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    // episodeId = "slug/saison1/vostfr/3"
    const parts = episodeId.split('/');
    const epNum = parseInt(parts.pop());
    const seasonPath = parts.join('/');

    const episodesJsUrl = `${BASE}/catalogue/${seasonPath}/episodes.js`;
    const res = await fetch(episodesJsUrl, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) throw new Error('Failed to load episodes.js');
    const js = await res.text();

    // Parse all epsN arrays
    const sources = [];
    const epsVarRe = /var\s+(eps\d+)\s*=\s*\[([\s\S]*?)\];/g;
    for (const m of matchAll(js, epsVarRe)) {
      const varName = m[1];
      const arrayContent = m[2];

      // Extract URLs from the array
      const urls = [];
      const urlRe = /['"]([^'"]+)['"]/g;
      let um;
      while ((um = urlRe.exec(arrayContent)) !== null) {
        urls.push(um[1]);
      }

      if (urls.length >= epNum) {
        const rawUrl = urls[epNum - 1];
        // Skip placeholder/empty URLs (e.g. "https://vidmoly.to/embed-.html")
        if (!this._isValidEpUrl(rawUrl)) continue;
        const url = forceHttps(rawUrl);
        const hostName = this._getHostName(url);
        sources.push({ name: `${hostName} (${varName})`, url });
      }
    }

    // Filter out sibnet (dropped — CDN requires session cookies)
    const filtered = sources.filter(s => !s.url.includes('sibnet'));
    const finalSources = filtered.length > 0 ? filtered : sources;
    finalSources.sort((a, b) => this._hostPriority(a.url) - this._hostPriority(b.url));

    if (finalSources.length === 0) {
      throw new Error(`No video URL found for episode ${epNum}`);
    }

    // Resolve every embed concurrently, then keep the first (highest-priority, since
    // finalSources is already sorted) that yields a direct video URL. Promise.all
    // preserves order, so .find() returns the same pick as a sequential loop —
    // but the wall-clock cost is one timeout instead of the sum of all of them.
    const resolvedAll = await Promise.all(
      finalSources.map((src) =>
        this._resolveVideoUrl(src.url)
          .then((r) => ({ src, url: r.url }))
          .catch(() => ({ src, url: src.url }))
      )
    );
    const direct = resolvedAll.find((r) => this._isDirectUrl(r.url));
    if (direct) {
      return {
        url: direct.url,
        sourceUrl: direct.src.url,
        referer: `${BASE}/`,
        headers: { Referer: `${BASE}/` },
        subtitles: [],
        sources: finalSources,
      };
    }

    // No direct URL found — fall back to best embed URL in iframe mode
    const best = finalSources[0];
    return {
      type: 'iframe',
      url: forceHttps(best.url),
      referer: `${BASE}/`,
      headers: { Referer: `${BASE}/` },
      subtitles: [],
      sources: finalSources,
    };
  }

  // ── Video host helpers ───────────────────────────────────

  _getHostName(url) {
    try {
      const host = new URL(url).hostname;
      if (host.includes('vidmoly')) return 'Vidmoly';
      if (host.includes('voe')) return 'Voe';
      if (host.includes('sendvid')) return 'SendVid';
      if (host.includes('streamtape')) return 'Streamtape';
      if (host.includes('f16px') || host.includes('fmoonh')) return 'F16px';
      if (host.includes('embed4me') || host.includes('lpayer')) return 'Embed4me';
      if (host.includes('minochinos')) return 'Minochinos';
      return host;
    } catch {
      return 'Unknown';
    }
  }

  _isDirectUrl(url) {
    if (!url) return false;
    return /\.(m3u8|mp4|webm)(\?|$)/i.test(url);
  }

  _hostPriority(url) {
    // f16px/fmoonh: direct HLS/mp4 link extractable from page
    if (url.includes('f16px') || url.includes('fmoonh')) return 0;
    // sendvid: direct video link when file exists
    if (url.includes('sendvid')) return 1;
    // voe: obfuscated JS, sometimes extractable
    if (url.includes('voe')) return 2;
    // streamtape: obfuscated token URL
    if (url.includes('streamtape')) return 3;
    // embed4me / lpayer: lightweight player
    if (url.includes('embed4me') || url.includes('lpayer')) return 4;
    // minochinos: similar
    if (url.includes('minochinos')) return 5;
    // vidmoly: known unreliable (frequent ww1.vidmoly.to outages, CF Turnstile) → last resort
    if (url.includes('vidmoly')) return 99;
    return 10;
  }

  async _resolveVideoUrl(embedUrl) {
    if (JS_GATED_HOSTS.test(embedUrl)) return { url: forceHttps(embedUrl) };
    try {
      const res = await fetch(embedUrl, {
        headers: {
          Referer: `${BASE}/`,
          'User-Agent': navigator.userAgent,
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return { url: forceHttps(embedUrl) };
      const html = await res.text();

      // m3u8 (Vidmoly, LuluStream, etc.)
      const m3u8M = /(?:file|src)\s*[:=]\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i.exec(html);
      if (m3u8M) return { url: forceHttps(m3u8M[1]) };

      // Voe: look for mp4/m3u8 in script
      const voeM = /(?:source|video_link)\s*[:=]\s*["'](https?:\/\/[^"']*(?:\.mp4|\.m3u8)[^"']*)["']/i.exec(html);
      if (voeM) return { url: forceHttps(voeM[1]) };

      // Generic: any direct video URL
      const genericM = /["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm)[^"']*)["']/i.exec(html);
      if (genericM) return { url: forceHttps(genericM[1]) };

      return { url: forceHttps(embedUrl) };
    } catch {
      return { url: embedUrl };
    }
  }

  // ── Cover enrichment (anime-sama covers are on GitHub, no enrichment needed)

  async enrichCoversAsync(_items, _callback) {
    // Anime-sama covers are directly available from GitHub, no async enrichment needed
  }
}
