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

  // ── Parse anime cards ────────────────────────────────────
  // Vostfree was redesigned and now uses two card layouts:
  //  - <div class="movie-poster"> (main grid on /animes-vostfr/, /animes-vf/, homepage)
  //  - <ul class="movie-small"><li>...</li></ul> (sidebar lists, "top noté", etc.)

  _parseCards(html) {
    const results = [];
    const seen = new Set();

    const pushResult = (id, title, cover, latestEpisode = null) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      results.push({
        id,
        title,
        cover,
        type: 'Anime',
        year: null,
        latestEpisode,
        latestEpisodeId: null,
        source: 'vostfree',
      });
    };

    // --- Layout 1: <div class="movie-poster"> (main grid)
    // Inside: <div class="play"><a href="..." alt="TITLE"><span>TITLE</span></a></div>
    //         <span class="image"><img src="..." alt="TITLE"/></span>
    //         <div class="alt"><div class="kp"><b>SS</b></div><div class="year"><b>EE</b></div></div>
    const posterRe = /<div\s+class="movie-poster">([\s\S]*?)<\/div>\s*(?=<div\s+class="movie-poster">|<\/div>\s*<\/div>\s*<\/div>)/gi;
    for (const m of matchAll(html, posterRe)) {
      const chunk = m[1];

      const linkM = chunk.match(/<a[^>]*class="fa\s+fa-play\s+link"[^>]*href="([^"]+)"[^>]*alt="([^"]*)"/i)
                 || chunk.match(/<a[^>]*href="(https:\/\/vostfree\.ws\/[^"]+\.html)"[^>]*(?:title|alt)="([^"]*)"/i);
      if (!linkM) continue;
      const id = idFromUrl(linkM[1]);
      const title = decodeEntities(linkM[2]).replace(/\s*(VOSTFR|VF|FRENCH)\s*$/i, '').trim();

      const imgM = chunk.match(/<img[^>]+src="([^"]+)"/i);
      const rawCover = imgM ? imgM[1] : '';
      const cover = rawCover.startsWith('http') ? rawCover : `${BASE}${rawCover}`;

      // Episode count: <div class="year"><span>...</span><b>NN</b></div>
      const epM = chunk.match(/<div\s+class="year">[\s\S]*?<b>(\d+)<\/b>/i);
      const latestEpisode = epM ? parseInt(epM[1]) : null;

      pushResult(id, title, cover, latestEpisode);
    }

    // --- Layout 2: <ul class="movie-small"><li> items
    const listRe = /<ul\s+class="movie-small"[^>]*>([\s\S]*?)<\/ul>/gi;
    for (const listM of matchAll(html, listRe)) {
      const list = listM[1];
      const liRe = /<li>([\s\S]*?)<\/li>/gi;
      for (const liM of matchAll(list, liRe)) {
        const chunk = liM[1];
        const linkM = chunk.match(/<a[^>]+href="(https:\/\/vostfree\.ws\/[^"]+\.html)"[^>]*title="([^"]*)"/i);
        if (!linkM) continue;
        const id = idFromUrl(linkM[1]);
        const title = decodeEntities(linkM[2]).replace(/\s*(VOSTFR|VF|FRENCH)\s*$/i, '').trim();

        const imgM = chunk.match(/<img[^>]+src="([^"]+)"/i);
        const rawCover = imgM ? imgM[1] : '';
        const cover = rawCover.startsWith('http') ? rawCover : `${BASE}${rawCover}`;

        // Episode count: <div class="year"><span>...</span><b>NN</b></div>
        const epM = chunk.match(/<div\s+class="year">[\s\S]*?<b>(\d+)<\/b>/i);
        const latestEpisode = epM ? parseInt(epM[1]) : null;

        pushResult(id, title, cover, latestEpisode);
      }
    }

    return results;
  }

  // ── Search ───────────────────────────────────────────────

  async search(query) {
    if (!query?.trim()) return this.getSeasonAnime();
    // DLE search requires POST. Returns a search results page with <div class="search-result"> cards.
    const body = `do=search&subaction=search&story=${encodeURIComponent(query)}`;
    const res = await fetch(`${BASE}/index.php?do=search`, {
      method: 'POST',
      redirect: 'follow',
      headers: {
        'User-Agent': navigator.userAgent,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!res.ok) return [];
    const html = await res.text();
    return this._parseSearchResults(html);
  }

  // Parses search-result divs returned by DLE search (different layout from catalogue cards)
  _parseSearchResults(html) {
    const results = [];
    const seen = new Set();

    const cardRe = /<div\s+class="search-result">([\s\S]*?)<div\s+class="alt">/gi;
    for (const m of matchAll(html, cardRe)) {
      const chunk = m[1];

      const linkM = chunk.match(/<div\s+class="title">\s*<a[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/i);
      if (!linkM) continue;
      const id = idFromUrl(linkM[1]);
      if (!id || seen.has(id)) continue;
      seen.add(id);

      const title = decodeEntities(linkM[2]).replace(/\s*(VOSTFR|VF|FRENCH)\s*$/i, '').trim();

      const imgM = chunk.match(/<span\s+class="image"><img[^>]+src="([^"]+)"/i);
      const rawCover = imgM ? imgM[1] : '';
      const cover = rawCover.startsWith('http') ? rawCover : `${BASE}${rawCover}`;

      const yearM = chunk.match(/\/year\/(\d{4})\//);
      const year = yearM ? parseInt(yearM[1]) : null;

      results.push({
        id,
        title,
        cover,
        type: 'Anime',
        year,
        latestEpisode: null,
        latestEpisodeId: null,
        source: 'vostfree',
      });
    }
    return results;
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

    // Each episode has 5 player slots, mapped from the page JS:
    //   slot 1 (new_player_sibnet)   → Sibnet ID (skip — session cookies required)
    //   slot 2 (new_player_uqload)   → Uqload ID    → https://uqload.io/embed-${id}.html
    //   slot 3 (new_player_vip)      → Full URL     (Streamsb/SbFull etc.)
    //   slot 4 (new_player_vip)      → Full URL     (Vudeo)
    //   slot 5 (new_player_mytv)     → Mytv ID      → https://www.myvi.tv/embed/${id}
    const base = (epN - 1) * 5;

    function getContent(idx) {
      const re = new RegExp(`id="content_player_${idx}"[^>]*>([^<]*)<`, 'i');
      const m = html.match(re);
      return m ? m[1].trim() : '';
    }

    const uqloadId = getContent(base + 2);
    const vipUrl1  = getContent(base + 3); // Streamsb/SbFull
    const vipUrl2  = getContent(base + 4); // Vudeo
    const mytvId   = getContent(base + 5);

    const sources = [];

    if (uqloadId && !uqloadId.includes(')') && uqloadId.length > 4) {
      sources.push({ name: 'Uqload', url: `https://uqload.io/embed-${uqloadId}.html` });
    }
    if (vipUrl1 && vipUrl1.startsWith('http')) {
      sources.push({ name: this._hostName(vipUrl1), url: forceHttps(vipUrl1) });
    }
    if (vipUrl2 && vipUrl2.startsWith('http')) {
      sources.push({ name: this._hostName(vipUrl2), url: forceHttps(vipUrl2) });
    }
    if (mytvId && !mytvId.includes(')') && mytvId.length > 4 && !mytvId.startsWith('http')) {
      sources.push({ name: 'Mytv', url: `https://www.myvi.tv/embed/${mytvId}` });
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

  _hostName(url) {
    try {
      const host = new URL(url).hostname.toLowerCase();
      if (host.includes('uqload')) return 'Uqload';
      if (host.includes('vudeo')) return 'Vudeo';
      if (host.includes('sbfull') || host.includes('streamsb') || host.includes('streamz')) return 'Streamsb';
      if (host.includes('myvi')) return 'Mytv';
      if (host.includes('voe')) return 'Voe';
      return host;
    } catch {
      return 'Unknown';
    }
  }

  _hostPriority(url) {
    // Uqload extracts cleanly via player-extractor
    if (url.includes('uqload')) return 0;
    // Streamsb / SbFull: m3u8 in JWPlayer config
    if (url.includes('sbfull') || url.includes('streamsb') || url.includes('streamz')) return 1;
    // Vudeo: HLS.js
    if (url.includes('vudeo')) return 2;
    // Mytv (myvi): often direct mp4
    if (url.includes('myvi')) return 3;
    if (url.includes('voe')) return 4;
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
