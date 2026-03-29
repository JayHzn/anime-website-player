// ── French-anime.com source ──────────────────────────────────
// Scrapes french-anime.com from the user's browser via the extension.

const BASE = 'https://french-anime.com';

// ── Helpers ──────────────────────────────────────────────────

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

/**
 * Extract slug from URL like /exclue/1862-one-punch-man.html → exclue/1862-one-punch-man
 */
function idFromUrl(url) {
  const m = url.match(/french-anime\.com\/([^?#]+)\.html/);
  return m ? m[1] : '';
}

// ── FrenchAnimeSource ────────────────────────────────────────

export class FrenchAnimeSource {

  // ── Parse a .mov card (used on homepage and search) ──────

  _parseMovCard(cardHtml) {
    // Link and title: <a class="mov-t nowrap" href="...">Title</a>
    const linkM = cardHtml.match(/<a[^>]*class="mov-t[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkM) return null;

    const href = linkM[1];
    const title = decodeEntities(stripTags(linkM[2]));
    const id = idFromUrl(href);
    if (!id) return null;

    // Cover: <img src="..." alt="..." />
    const imgM = cardHtml.match(/<img[^>]*src="([^"]*)"[^>]*/i);
    const coverPath = imgM ? imgM[1] : '';
    const cover = coverPath.startsWith('http') ? coverPath : `${BASE}${coverPath}`;

    // Episode count: <div class="mov-m">12</div>
    const epM = cardHtml.match(/<div[^>]*class="mov-m"[^>]*>([\s\S]*?)<\/div>/i);
    const epText = epM ? stripTags(epM[1]).trim() : '';
    const epNum = parseInt(epText) || null;

    // Season/language: <span class="block-sai">Saison 01 VOSTFR</span>
    const saiM = cardHtml.match(/<span[^>]*class="block-sai"[^>]*>([\s\S]*?)<\/span>/i);
    const saiText = saiM ? stripTags(saiM[1]).replace(/\s+/g, ' ').trim() : '';

    // Year: from movie-lines "Date de sortie"
    const yearM = cardHtml.match(/Date de sortie:<\/div>\s*<div[^>]*class="ml-desc"[^>]*>\s*(\d{4})/i);
    const year = yearM ? parseInt(yearM[1]) : null;

    return {
      id,
      title,
      cover,
      type: 'Anime',
      year,
      latestEpisode: epNum,
      latestEpisodeId: null,
      seasonInfo: saiText,
      source: 'french-anime',
    };
  }

  // ── Search ───────────────────────────────────────────────

  async search(query) {
    const url = query?.trim()
      ? `${BASE}/?s=${encodeURIComponent(query)}`
      : `${BASE}/`;

    const res = await fetch(url, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) return [];
    const html = await res.text();

    return this._parseMovCards(html);
  }

  _parseMovCards(html) {
    const results = [];
    const seen = new Set();

    // Match each <div class="mov clearfix"> block
    const cardRe = /<div class="mov clearfix">([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;

    for (const m of matchAll(html, cardRe)) {
      const card = this._parseMovCard(m[0]);
      if (card && !seen.has(card.id)) {
        seen.add(card.id);
        results.push(card);
      }
    }
    return results;
  }

  // ── Latest episodes ──────────────────────────────────────

  async getLatestEpisodes() {
    const res = await fetch(`${BASE}/`, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) return [];
    const html = await res.text();

    return this._parseMovCards(html);
  }

  // ── Season anime (catalogue) ─────────────────────────────

  async getSeasonAnime() {
    return this.search('');
  }

  // ── Anime info ───────────────────────────────────────────

  async getAnimeInfo(animeId) {
    const res = await fetch(`${BASE}/${animeId}.html`, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) throw new Error(`Anime not found: ${animeId}`);
    const html = await res.text();

    // Title: <h1 itemprop="name">Title</h1>
    const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleM ? decodeEntities(stripTags(titleM[1])).trim() : animeId;

    // Cover: <img id="posterimg" src="...">
    const coverM = html.match(/<img[^>]*id="posterimg"[^>]*src="([^"]*)"[^>]*/i);
    const coverPath = coverM ? coverM[1] : '';
    const cover = coverPath.startsWith('http') ? coverPath : `${BASE}${coverPath}`;

    // Year
    const yearM = html.match(/Date de sortie:<\/div>\s*<div[^>]*class="mov-desc"[^>]*>\s*(\d{4})/i);
    const year = yearM ? parseInt(yearM[1]) : null;

    // Synopsis
    const synM = html.match(/Synopsis:<\/div>\s*<div[^>]*class="mov-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const synopsis = synM ? decodeEntities(stripTags(synM[1])).trim() : '';

    // Genres
    const genreM = html.match(/GENRE:<\/div>\s*<div[^>]*class="mov-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const genres = genreM ? decodeEntities(stripTags(genreM[1])).trim() : '';

    // Version (VF/VOSTFR)
    const versionM = html.match(/Version:<\/div>\s*<div[^>]*class="mov-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const version = versionM ? stripTags(versionM[1]).trim() : '';

    return {
      id: animeId,
      title,
      cover,
      type: 'Anime',
      year,
      source: 'french-anime',
      synopsis,
      genres,
      version,
    };
  }

  // ── Episodes list ────────────────────────────────────────

  async getEpisodes(animeId) {
    const res = await fetch(`${BASE}/${animeId}.html`, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) throw new Error(`Failed to load anime page: ${animeId}`);
    const html = await res.text();

    // Episodes are in <div class="eps" style="display: none">
    // Format: 1!url1,url2,url3\n2!url1,url2\n...
    const epsM = html.match(/<div[^>]*class="eps"[^>]*>([\s\S]*?)<\/div>/i);
    if (!epsM) return [];

    const epsText = epsM[1].trim();
    const lines = epsText.split('\n').filter((l) => l.trim());
    const episodes = [];

    for (const line of lines) {
      const parts = line.split('!');
      if (parts.length < 2) continue;
      const epNum = parseInt(parts[0].trim());
      if (isNaN(epNum)) continue;

      episodes.push({
        id: `${animeId}#${epNum}`,
        number: epNum,
        title: `Episode ${epNum}`,
      });
    }

    return episodes;
  }

  // ── Video URL ────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    // episodeId = "exclue/1862-one-punch-man#3"
    const [animeId, epStr] = episodeId.split('#');
    const epNum = parseInt(epStr);

    const res = await fetch(`${BASE}/${animeId}.html`, {
      headers: { 'User-Agent': navigator.userAgent },
    });
    if (!res.ok) throw new Error('Failed to load anime page');
    const html = await res.text();

    const epsM = html.match(/<div[^>]*class="eps"[^>]*>([\s\S]*?)<\/div>/i);
    if (!epsM) throw new Error('No episodes found on page');

    const epsText = epsM[1].trim();
    const lines = epsText.split('\n').filter((l) => l.trim());

    // Find the line for this episode
    let urls = [];
    for (const line of lines) {
      const parts = line.split('!');
      if (parts.length < 2) continue;
      if (parseInt(parts[0].trim()) === epNum) {
        urls = parts[1].split(',').map((u) => u.trim()).filter(Boolean);
        break;
      }
    }

    if (urls.length === 0) {
      throw new Error(`No video URLs found for episode ${epNum}`);
    }

    const sources = urls.map((url) => ({
      name: this._getHostName(url),
      url,
    }));

    // Sort by host priority
    sources.sort((a, b) => this._hostPriority(a.url) - this._hostPriority(b.url));

    const best = sources[0];
    const resolved = await this._resolveVideoUrl(best.url);

    return {
      url: resolved.url || best.url,
      referer: `${BASE}/${animeId}.html`,
      headers: { Referer: `${BASE}/${animeId}.html` },
      subtitles: [],
      sources,
    };
  }

  // ── Video host helpers ───────────────────────────────────

  _getHostName(url) {
    try {
      const host = new URL(url).hostname;
      if (host.includes('vidmoly')) return 'Vidmoly';
      if (host.includes('voe') || host.includes('dianaavoidthey') || host.includes('delivery-node')) return 'Voe';
      if (host.includes('luluvid')) return 'Luluvid';
      if (host.includes('savefiles')) return 'SaveFiles';
      if (host.includes('up4fun')) return 'Up4Fun';
      if (host.includes('sendvid')) return 'SendVid';
      if (host.includes('sibnet')) return 'Sibnet';
      if (host.includes('streamtape')) return 'Streamtape';
      return host;
    } catch {
      return 'Unknown';
    }
  }

  _hostPriority(url) {
    if (url.includes('vidmoly')) return 0;
    if (url.includes('voe') || url.includes('dianaavoidthey')) return 1;
    if (url.includes('luluvid')) return 2;
    if (url.includes('sendvid')) return 3;
    if (url.includes('sibnet')) return 4;
    if (url.includes('savefiles')) return 5;
    if (url.includes('up4fun')) return 6;
    if (url.includes('streamtape')) return 7;
    return 10;
  }

  async _resolveVideoUrl(embedUrl) {
    try {
      const res = await fetch(embedUrl, {
        headers: {
          Referer: `${BASE}/`,
          'User-Agent': navigator.userAgent,
        },
      });
      if (!res.ok) return { url: embedUrl };
      const html = await res.text();

      // Vidmoly: look for m3u8
      const m3u8M = html.match(/(?:file|src)\s*[:=]\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
      if (m3u8M) return { url: m3u8M[1] };

      // Voe: look for mp4/m3u8
      const voeM = html.match(/(?:source|video_link)\s*[:=]\s*["'](https?:\/\/[^"']*(?:\.mp4|\.m3u8)[^"']*)["']/i);
      if (voeM) return { url: voeM[1] };

      // Generic video URL
      const genericM = html.match(/["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm)[^"']*)["']/i);
      if (genericM) return { url: genericM[1] };

      return { url: embedUrl };
    } catch {
      return { url: embedUrl };
    }
  }

  // ── Cover enrichment (not needed, covers are on the same domain)

  async enrichCoversAsync(_items, _callback) {
    // french-anime.com covers are direct relative URLs, no enrichment needed
  }
}
