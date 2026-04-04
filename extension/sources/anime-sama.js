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
    const results = [];
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

    const results = [];
    const seen = new Set();
    // anime-card-premium cards on the homepage
    const cardRe = /<div[^>]*class="[^"]*anime-card-premium[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/a>\s*<\/div>/gi;

    for (const m of matchAll(html, cardRe)) {
      const card = m[0];

      const linkM = card.match(/<a[^>]*href="([^"]*)"[^>]*/i);
      const href = linkM ? linkM[1] : '';
      const slug = slugFromUrl(href);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      const titleM = card.match(/<h2[^>]*class="card-title[^"]*"[^>]*>([\s\S]*?)<\/h2>/i);
      const title = titleM ? decodeEntities(stripTags(titleM[1])) : slug;

      const imgM = card.match(/<img[^>]*class="card-image[^"]*"[^>]*src="([^"]*)"[^>]*/i);
      const cover = imgM ? imgM[1] : `${COVER_BASE}/${slug}.jpg`;

      const epM = card.match(/Ep\.\s*(\d+)/i);
      const latestEpisode = epM ? parseInt(epM[1]) : null;

      results.push({
        id: slug,
        title,
        cover,
        type: 'Anime',
        latestEpisode,
        latestEpisodeId: null, // will be resolved when user clicks
        source: 'anime-sama',
      });
    }
    return results;
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

  async getEpisodes(animeId) {
    // animeId = slug (e.g. "naruto")
    // First, get anime info to find available seasons
    const info = await this.getAnimeInfo(animeId);
    const seasons = info.seasons || [];

    if (seasons.length === 0) {
      // Try to guess default season
      seasons.push({ name: 'Saison 1 VOSTFR', url: 'saison1/vostfr' });
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

        // Parse eps1 = [...] to count episodes
        const epsM = js.match(/var\s+eps1\s*=\s*\[([\s\S]*?)\];/);
        if (!epsM) continue;

        // Count URLs in eps1 array
        const urlMatches = epsM[1].match(/'[^']+'/g) || epsM[1].match(/"[^"]+"/g) || [];
        const count = urlMatches.length;

        for (let i = 0; i < count; i++) {
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
        const url = forceHttps(urls[epNum - 1]);
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

    // Try each source in order — return the first that resolves to a direct video URL
    for (const src of finalSources) {
      const resolved = await this._resolveVideoUrl(src.url);
      if (this._isDirectUrl(resolved.url)) {
        return {
          url: resolved.url,
          sourceUrl: src.url,
          referer: `${BASE}/`,
          headers: { Referer: `${BASE}/` },
          subtitles: [],
          sources: finalSources,
        };
      }
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

    // vidmoly: CF Turnstile blocks fetch → iframe only
    if (url.includes('vidmoly')) return 5;
    return 10;
  }

  async _resolveVideoUrl(embedUrl) {
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
