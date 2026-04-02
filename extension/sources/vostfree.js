// ── vostfree.ws source ───────────────────────────────────────
// DLE-based French anime streaming site.
//
// Episode player structure (per episode N, 1-indexed):
//   buttons_N div → player_{(N-1)*5+1} Sibnet
//                 → player_{(N-1)*5+2} Uqload
//                 → player_{(N-1)*5+3} VOE  (full URL)
//                 → player_{(N-1)*5+4} Vudeo (full URL)
//   content_player_{K} → the raw URL or ID for player K

const BASE = 'https://vostfree.ws';

// ── Helpers ──────────────────────────────────────────────────

function forceHttps(url) {
  if (!url) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return url.replace(/^http:\/\//i, 'https://');
}

function matchAll(str, re) {
  const results = [];
  let m;
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  while ((m = g.exec(str)) !== null) results.push(m);
  return results;
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, '').trim();
}

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'");
}

function idFromUrl(url) {
  // https://vostfree.ws/1404-helck-ddl-streaming.html  →  1404-helck-ddl-streaming
  const m = url.match(/vostfree\.ws\/([^/?#]+)\.html/);
  return m ? m[1] : '';
}

// ── VostfreeSource ───────────────────────────────────────────

export class VostfreeSource {

  // ── Parse anime cards (.post divs) ───────────────────────

  _parseCards(html) {
    const results = [];
    const seen = new Set();
    const parts = html.split('<div class="post"');
    for (let i = 1; i < parts.length; i++) {
      const chunk = parts[i];

      const linkM = chunk.match(/href="([^"]*vostfree\.ws\/[^"]+\.html)"/i);
      if (!linkM) continue;
      const id = idFromUrl(linkM[1]);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const titleM = chunk.match(/<h3[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
      const title = titleM ? decodeEntities(stripTags(titleM[1])) : id;

      const imgM = chunk.match(/<img[^>]+src="([^"]+)"/i);
      const rawCover = imgM ? imgM[1] : '';
      const cover = rawCover.startsWith('http') ? rawCover : `${BASE}${rawCover}`;

      const epM = chunk.match(/<span[^>]*class="episodes"[^>]*>Ep\s*(\d+)/i);
      const latestEpisode = epM ? parseInt(epM[1]) : null;

      const yearM = chunk.match(/\/year\/(\d{4})\//);
      const year = yearM ? parseInt(yearM[1]) : null;

      results.push({
        id,
        title,
        cover,
        type: 'Anime',
        year,
        latestEpisode,
        latestEpisodeId: null,
        source: 'vostfree',
      });
    }
    return results;
  }

  // ── Search ───────────────────────────────────────────────

  async search(query) {
    if (!query?.trim()) return this.getSeasonAnime();
    const url = `${BASE}/?do=search&subaction=search&story=${encodeURIComponent(query)}`;
    const res = await fetch(url, { headers: { 'User-Agent': navigator.userAgent } });
    if (!res.ok) return [];
    const html = await res.text();
    return this._parseCards(html);
  }

  // ── Latest episodes (homepage) ───────────────────────────

  async getLatestEpisodes() {
    const res = await fetch(`${BASE}/`, { headers: { 'User-Agent': navigator.userAgent } });
    if (!res.ok) return [];
    const html = await res.text();
    return this._parseCards(html);
  }

  // ── Season anime (VOSTFR catalogue) ─────────────────────

  async getSeasonAnime() {
    const res = await fetch(`${BASE}/animes-vostfr/`, { headers: { 'User-Agent': navigator.userAgent } });
    if (!res.ok) return [];
    const html = await res.text();
    return this._parseCards(html);
  }

  // ── Anime info ───────────────────────────────────────────

  async getAnimeInfo(animeId) {
    const res = await fetch(`${BASE}/${animeId}.html`, { headers: { 'User-Agent': navigator.userAgent } });
    if (!res.ok) throw new Error(`Anime not found: ${animeId}`);
    const html = await res.text();

    const titleM = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleM ? decodeEntities(stripTags(titleM[1])) : animeId;

    const imgM = html.match(/<img[^>]+src="(\/uploads\/[^"]+)"[^>]*>/i);
    const rawCover = imgM ? imgM[1] : '';
    const cover = rawCover ? `${BASE}${rawCover}` : '';

    const yearM = html.match(/\/year\/(\d{4})\//);
    const year = yearM ? parseInt(yearM[1]) : null;

    const synM = html.match(/<div[^>]*class="[^"]*full-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const synopsis = synM ? decodeEntities(stripTags(synM[1])).trim() : '';

    return { id: animeId, title, cover, type: 'Anime', year, synopsis, source: 'vostfree' };
  }

  // ── Episodes list ────────────────────────────────────────

  async getEpisodes(animeId) {
    const res = await fetch(`${BASE}/${animeId}.html`, { headers: { 'User-Agent': navigator.userAgent } });
    if (!res.ok) throw new Error(`Failed to load anime page: ${animeId}`);
    const html = await res.text();

    // Count episodes from select options: <option value="buttons_N">Episode N</option>
    const episodes = [];
    const optRe = /<option\s+value="buttons_(\d+)"[^>]*>([^<]*)<\/option>/gi;
    for (const m of matchAll(html, optRe)) {
      const epN = parseInt(m[1]);
      const label = m[2].trim();
      const numM = label.match(/\d+/);
      const epNum = numM ? parseInt(numM[0]) : epN;
      episodes.push({
        id: `${animeId}/${epN}`,
        number: epNum,
        title: label || `Episode ${epNum}`,
      });
    }

    // Fallback: count buttons_N divs
    if (episodes.length === 0) {
      const btnCount = (html.match(/id="buttons_\d+"/g) || []).length;
      for (let n = 1; n <= btnCount; n++) {
        episodes.push({ id: `${animeId}/${n}`, number: n, title: `Episode ${n}` });
      }
    }

    return episodes;
  }

  // ── Video URL ────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    // episodeId = "1404-helck-ddl-streaming/3"  (slug / episode index N, 1-based)
    const lastSlash = episodeId.lastIndexOf('/');
    const animeId = episodeId.slice(0, lastSlash);
    const epN = parseInt(episodeId.slice(lastSlash + 1));

    const res = await fetch(`${BASE}/${animeId}.html`, { headers: { 'User-Agent': navigator.userAgent } });
    if (!res.ok) throw new Error('Failed to load anime page');
    const html = await res.text();

    // Per episode N: player indices (N-1)*5+1 … (N-1)*5+4
    // [+1]=Sibnet(skip), [+2]=Uqload(id), [+3]=VOE(url), [+4]=Vudeo(url)
    const base = (epN - 1) * 5;
    const uqloadIdx = base + 2;
    const voeIdx    = base + 3;
    const vudeoIdx  = base + 4;

    function getContent(idx) {
      const re = new RegExp(`id="content_player_${idx}"[^>]*>([^<]*)<`, 'i');
      const m = html.match(re);
      return m ? m[1].trim() : '';
    }

    const uqloadId = getContent(uqloadIdx);
    const voeUrl   = getContent(voeIdx);
    const vudeoUrl = getContent(vudeoIdx);

    const sources = [];

    if (voeUrl && voeUrl.startsWith('http')) {
      sources.push({ name: 'VOE', url: forceHttps(voeUrl) });
    }
    if (uqloadId && !uqloadId.includes(')') && uqloadId.length > 4) {
      sources.push({ name: 'Uqload', url: `https://uqload.co/embed-${uqloadId}.html` });
    }
    if (vudeoUrl && vudeoUrl.startsWith('http')) {
      sources.push({ name: 'Vudeo', url: forceHttps(vudeoUrl) });
    }

    if (sources.length === 0) throw new Error(`No video URLs found for episode ${epN}`);

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

  // ── Helpers ──────────────────────────────────────────────

  _isDirectUrl(url) {
    return /\.(m3u8|mp4|webm)(\?|$)/i.test(url || '');
  }

  _hostPriority(url) {
    if (url.includes('voe')) return 0;
    if (url.includes('uqload')) return 1;
    if (url.includes('vudeo')) return 2;
    return 10;
  }

  async _resolveVideoUrl(embedUrl) {
    try {
      const res = await fetch(embedUrl, {
        headers: { Referer: `${BASE}/`, 'User-Agent': navigator.userAgent },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return { url: forceHttps(embedUrl) };
      const html = await res.text();

      const m3u8M = html.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
      if (m3u8M) return { url: forceHttps(m3u8M[1]) };

      const mp4M = html.match(/["'](https?:\/\/[^"']*\.mp4[^"']*)["']/i);
      if (mp4M) return { url: forceHttps(mp4M[1]) };

      return { url: forceHttps(embedUrl) };
    } catch {
      return { url: forceHttps(embedUrl) };
    }
  }

  async enrichCoversAsync(_items, _callback) {}
}
