// ── French-anime.com source — Mobile (React Native) version ──
// Adapted from extension/sources/french-anime.js
// Change: navigator.userAgent → hardcoded UA string

const BASE = 'https://french-anime.com';

const UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36';

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

function idFromUrl(url) {
  const m = url.match(/french-anime\.com\/([^?#]+)\.html/);
  return m ? m[1] : '';
}

// ── FrenchAnimeSource ────────────────────────────────────────

export class FrenchAnimeSource {

  // ── Parse a .mov card ────────────────────────────────────

  _parseMovCard(cardHtml) {
    const linkM = cardHtml.match(/<a[^>]*class="mov-t[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    if (!linkM) return null;

    const href = linkM[1];
    const title = decodeEntities(stripTags(linkM[2]));
    const id = idFromUrl(href);
    if (!id) return null;

    const imgM = cardHtml.match(/<img[^>]*src="([^"]*)"[^>]*/i);
    const coverPath = imgM ? imgM[1] : '';
    const cover = coverPath.startsWith('http') ? coverPath : `${BASE}${coverPath}`;

    const epM = cardHtml.match(/<div[^>]*class="mov-m"[^>]*>([\s\S]*?)<\/div>/i);
    const epText = epM ? stripTags(epM[1]).trim() : '';
    const epNum = parseInt(epText) || null;

    const saiM = cardHtml.match(/<span[^>]*class="block-sai"[^>]*>([\s\S]*?)<\/span>/i);
    const saiText = saiM ? stripTags(saiM[1]).replace(/\s+/g, ' ').trim() : '';

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
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return [];
    const html = await res.text();

    return this._parseMovCards(html);
  }

  _parseMovCards(html) {
    const results = [];
    const seen = new Set();

    const parts = html.split('<div class="mov clearfix">');
    for (let i = 1; i < parts.length; i++) {
      const chunk = '<div class="mov clearfix">' + parts[i];
      const card = this._parseMovCard(chunk);
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
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) return [];
    const html = await res.text();

    return this._parseMovCards(html);
  }

  // ── Season anime ─────────────────────────────────────────

  async getSeasonAnime() {
    return this.search('');
  }

  // ── Anime info ───────────────────────────────────────────

  async getAnimeInfo(animeId) {
    const res = await fetch(`${BASE}/${animeId}.html`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`Anime not found: ${animeId}`);
    const html = await res.text();

    const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleM ? decodeEntities(stripTags(titleM[1])).trim() : animeId;

    const coverM = html.match(/<img[^>]*id="posterimg"[^>]*src="([^"]*)"[^>]*/i);
    const coverPath = coverM ? coverM[1] : '';
    const cover = coverPath.startsWith('http') ? coverPath : `${BASE}${coverPath}`;

    const yearM = html.match(/Date de sortie:<\/div>\s*<div[^>]*class="mov-desc"[^>]*>\s*(\d{4})/i);
    const year = yearM ? parseInt(yearM[1]) : null;

    const synM = html.match(/Synopsis:<\/div>\s*<div[^>]*class="mov-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const synopsis = synM ? decodeEntities(stripTags(synM[1])).trim() : '';

    const genreM = html.match(/GENRE:<\/div>\s*<div[^>]*class="mov-desc"[^>]*>([\s\S]*?)<\/div>/i);
    const genres = genreM ? decodeEntities(stripTags(genreM[1])).trim() : '';

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
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`Failed to load anime page: ${animeId}`);
    const html = await res.text();

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
        id: `${animeId}/${epNum}`,
        number: epNum,
        title: `Episode ${epNum}`,
      });
    }

    return episodes;
  }

  // ── Video URL ────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    const lastSlash = episodeId.lastIndexOf('/');
    const animeId = episodeId.slice(0, lastSlash);
    const epNum = parseInt(episodeId.slice(lastSlash + 1));

    const res = await fetch(`${BASE}/${animeId}.html`, {
      headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error('Failed to load anime page');
    const html = await res.text();

    const epsM = html.match(/<div[^>]*class="eps"[^>]*>([\s\S]*?)<\/div>/i);
    if (!epsM) throw new Error('No episodes found on page');

    const epsText = epsM[1].trim();
    const lines = epsText.split('\n').filter((l) => l.trim());

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

    const allSources = urls
      .filter(url => !url.includes('sibnet'))
      .map((url) => ({ name: this._getHostName(url), url: forceHttps(url) }));
    const sources = allSources.length > 0 ? allSources : urls.map(url => ({ name: this._getHostName(url), url: forceHttps(url) }));

    sources.sort((a, b) => this._hostPriority(a.url) - this._hostPriority(b.url));

    const referer = `${BASE}/${animeId}.html`;

    for (const src of sources) {
      const resolved = await this._resolveVideoUrl(src.url);
      if (this._isDirectUrl(resolved.url)) {
        return {
          url: resolved.url,
          sourceUrl: src.url,
          referer,
          headers: { Referer: referer },
          subtitles: [],
          sources,
        };
      }
    }

    const best = sources[0];
    return {
      type: 'iframe',
      url: forceHttps(best.url),
      referer,
      headers: { Referer: referer },
      subtitles: [],
      sources,
    };
  }

  // ── Video host helpers ───────────────────────────────────

  _isDirectUrl(url) {
    if (!url) return false;
    return /\.(m3u8|mp4|webm)(\?|$)/i.test(url);
  }

  _getHostName(url) {
    try {
      const host = new URL(url).hostname;
      if (host.includes('vidmoly')) return 'Vidmoly';
      if (host.includes('voe') || host.includes('dianaavoidthey') || host.includes('delivery-node')) return 'Voe';
      if (host.includes('luluvid') || host.includes('lulustream')) return 'LuluStream';
      if (host.includes('savefiles')) return 'SaveFiles';
      if (host.includes('up4fun')) return 'Up4Fun';
      if (host.includes('sendvid')) return 'SendVid';
      if (host.includes('streamtape')) return 'Streamtape';
      return host;
    } catch {
      return 'Unknown';
    }
  }

  _hostPriority(url) {
    if (url.includes('luluvid') || url.includes('lulustream')) return 0;
    if (url.includes('sendvid')) return 1;
    if (url.includes('vidmoly')) return 2;
    if (url.includes('voe') || url.includes('dianaavoidthey')) return 4;
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
          'User-Agent': UA,
        },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return { url: embedUrl };
      const html = await res.text();

      const m3u8M = html.match(/(?:file|src)\s*[:=]\s*["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
      if (m3u8M) return { url: forceHttps(m3u8M[1]) };

      const voeM = html.match(/(?:source|video_link)\s*[:=]\s*["'](https?:\/\/[^"']*(?:\.mp4|\.m3u8)[^"']*)["']/i);
      if (voeM) return { url: forceHttps(voeM[1]) };

      const genericM = html.match(/["'](https?:\/\/[^"']*\.(?:mp4|m3u8|webm)[^"']*)["']/i);
      if (genericM) return { url: forceHttps(genericM[1]) };

      return { url: forceHttps(embedUrl) };
    } catch {
      return { url: forceHttps(embedUrl) };
    }
  }

  // ── Cover enrichment (covers on same domain, no enrichment needed)

  async enrichCoversAsync(_items, _callback) {
    // french-anime.com covers are direct relative URLs, no enrichment needed
  }
}
