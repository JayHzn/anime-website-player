// ── JetAnimes source (on.jetanimes.com) ──────────────────────
// WordPress + DooPlay 2.4.1 theme
// Episodes via paginated search, video via admin-ajax doo_player_ajax

const BASE = 'https://on.jetanimes.com';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

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

function stripTags(html) { return html.replace(/<[^>]*>/g, '').trim(); }

function decodeEntities(str) {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&apos;/g, "'")
    .replace(/&rsquo;/g, "'").replace(/&lsquo;/g, "'").replace(/&hellip;/g, '…');
}

function slugFromUrl(url) {
  const m = url.match(/\/serie\/([^/?#]+)/);
  return m ? m[1] : '';
}

function episodeSlugFromUrl(url) {
  const m = url.match(/\/episodes\/([^/?#]+)/);
  return m ? m[1] : '';
}

function episodeNumberFromSlug(slug) {
  const m = slug.match(/-episode-(\d+)(?:-|$)/i);
  return m ? parseInt(m[1]) : null;
}

function seasonNumberFromSlug(slug) {
  const m = slug.match(/-saison-(\d+)-episode/i);
  return m ? parseInt(m[1]) : 1;
}

/** Slugify a title for use as anime URL slug (e.g. "Go For It, Nakamura-kun!!" → "go-for-it-nakamura-kun"). */
function slugifyTitle(title) {
  return title
    .toLowerCase()
    .normalize('NFD').replace(/\p{M}+/gu, '')   // strip combining diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function get(url) {
  return fetch(url, { headers: { 'User-Agent': UA } });
}

// ── JetAnimesSource ──────────────────────────────────────────

export class JetAnimesSource {

  // ── Parse tvshows cards (catalogue + search) ─────────────

  _parseShowCards(html) {
    const results = [];
    const seen = new Set();

    // Catalogue: article.item.tvshows
    const tvRe = /class="item tvshows[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
    for (const m of matchAll(html, tvRe)) {
      const card = m[0];
      const hrefM = card.match(/href="([^"]*\/serie\/[^"]+)"/i);
      if (!hrefM) continue;
      const slug = slugFromUrl(hrefM[1]);
      if (!slug || seen.has(slug)) continue;
      seen.add(slug);

      const imgM = card.match(/src="([^"]*upload[^"]*)"[^>]*/i);
      const cover = imgM ? imgM[1] : '';

      const titleM = card.match(/alt="([^"]*)"/i);
      const title = titleM ? decodeEntities(titleM[1]) : slug;

      const yearM = card.match(/<span class="wdate">(\d{4})/i);
      const year = yearM ? parseInt(yearM[1]) : null;

      results.push({ id: slug, title, cover, type: 'Anime', year, source: 'jetanimes' });
    }

    // Search results: <div class="result-item"> with nested <article>
    if (results.length === 0) {
      const srRe = /<div\s+class="result-item">[\s\S]*?<\/article>\s*<\/div>/gi;
      for (const m of matchAll(html, srRe)) {
        const card = m[0];
        const hrefM = card.match(/href="([^"]*\/serie\/[^"]+)"/i);
        if (!hrefM) continue;
        const slug = slugFromUrl(hrefM[1]);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);

        const imgM = card.match(/src="([^"]*)"[^>]*alt="([^"]*)"/i);
        const cover = imgM ? imgM[1] : '';
        const title = imgM ? decodeEntities(imgM[2]) : slug;

        const yearM = card.match(/<span class="year">(\d{4})/i);
        const year = yearM ? parseInt(yearM[1]) : null;

        results.push({ id: slug, title, cover, type: 'Anime', year, source: 'jetanimes' });
      }
    }

    // Legacy fallback: w_item_b
    if (results.length === 0) {
      const wRe = /class="w_item_b"[^>]*>([\s\S]*?)<\/article>/gi;
      for (const m of matchAll(html, wRe)) {
        const card = m[0];
        const hrefM = card.match(/href="([^"]*\/serie\/[^"]+)"/i);
        if (!hrefM) continue;
        const slug = slugFromUrl(hrefM[1]);
        if (!slug || seen.has(slug)) continue;
        seen.add(slug);

        const imgM = card.match(/src="([^"]*)"[^>]*alt="([^"]*)"/i);
        const cover = imgM ? imgM[1] : '';
        const title = imgM ? decodeEntities(imgM[2]) : slug;

        results.push({ id: slug, title, cover, type: 'Anime', year: null, source: 'jetanimes' });
      }
    }

    return results;
  }

  // ── Parse episode poster cards (/episodes/ listing) ──────

  _parseEpisodeCards(html, animeId) {
    const episodes = [];
    const seen = new Set();

    const re = /class="poster"[^>]*>([\s\S]*?)<\/article>/gi;
    for (const m of matchAll(html, re)) {
      const card = m[0];
      const hrefM = card.match(/href="([^"]*\/episodes\/[^"]+)"/i);
      if (!hrefM) continue;
      const epSlug = episodeSlugFromUrl(hrefM[1]);
      if (!epSlug || seen.has(epSlug)) continue;

      // Filter to only episodes belonging to this series
      if (animeId && !epSlug.startsWith(animeId)) continue;
      seen.add(epSlug);

      const epNum = episodeNumberFromSlug(epSlug);
      const season = seasonNumberFromSlug(epSlug);
      const imgM = card.match(/alt="([^"]*)"/i);
      const title = imgM ? decodeEntities(imgM[1]) : epSlug;

      episodes.push({
        id: epSlug,
        number: epNum ?? episodes.length + 1,
        season,
        title,
      });
    }
    return episodes;
  }

  // ── Search ───────────────────────────────────────────────

  async search(query) {
    if (!query?.trim()) return this.getSeasonAnime();
    const res = await get(`${BASE}/?s=${encodeURIComponent(query)}&post_type=tvshows`);
    if (!res.ok) return [];
    return this._parseShowCards(await res.text());
  }

  // ── Latest episodes ──────────────────────────────────────

  async getLatestEpisodes() {
    const res = await get(`${BASE}/episodes/`);
    if (!res.ok) return [];
    const html = await res.text();

    const results = [];
    const seen = new Set();
    // Cards: <article class="item se episodes" id="post-N">
    //          <div class="poster">...<img alt="Anime: Saison X Episode Y" src="..."/></div>
    //          <div class="data"><h3><a href=".../episodes/...">Épisode N</a></h3>
    //                            <span class="serie">ANIME TITLE</span></div>
    //        </article>
    const articleRe = /<article[^>]*class="[^"]*item[^"]*episodes[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;

    for (const m of matchAll(html, articleRe)) {
      const card = m[1];

      const hrefM = card.match(/href="([^"]*\/episodes\/[^"]+)"/i);
      if (!hrefM) continue;
      const epSlug = episodeSlugFromUrl(hrefM[1]);
      if (!epSlug) continue;

      const imgM = card.match(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"/i);
      const cover = imgM ? imgM[1] : '';

      // Prefer the explicit series title from <span class="serie">…</span>
      const serieM = card.match(/<span\s+class="serie">([^<]+)<\/span>/i);
      const animeTitle = serieM
        ? decodeEntities(serieM[1]).trim()
        : (imgM ? decodeEntities(imgM[2]).replace(/\s*:\s*Saison.*$/i, '').trim() : epSlug);

      // Derive the anime slug from the title — used by AnimePage and the watch-page back button
      const animeSlug = slugifyTitle(animeTitle);
      // Per anime, keep only the most-recent episode in the carousel
      if (!animeSlug || seen.has(animeSlug)) continue;
      seen.add(animeSlug);

      const epNum = episodeNumberFromSlug(epSlug);

      results.push({
        id: animeSlug,           // anime slug for /anime/SOURCE/SLUG and back-button
        title: animeTitle,
        cover,
        type: 'Anime',
        latestEpisode: epNum,
        latestEpisodeId: epSlug, // episode slug for /watch/SOURCE/EPSLUG
        source: 'jetanimes',
      });
    }
    return results;
  }

  // ── Season anime (series catalogue) ─────────────────────

  async getSeasonAnime() {
    const res = await get(`${BASE}/serie/`);
    if (!res.ok) return [];
    return this._parseShowCards(await res.text());
  }

  // ── Anime info ───────────────────────────────────────────

  async getAnimeInfo(animeId) {
    const res = await get(`${BASE}/serie/${animeId}/`);
    if (!res.ok) throw new Error(`Anime not found: ${animeId}`);
    const html = await res.text();

    const titleM = html.match(/<h1[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/h1>/i)
                || html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    const title = titleM ? decodeEntities(stripTags(titleM[1])) : animeId;

    const imgM = html.match(/<img[^>]*class="[^"]*poster[^"]*"[^>]*src="([^"]*)"[^>]*/i)
              || html.match(/<img[^>]*src="([^"]*upload[^"]*)"[^>]*/i);
    const cover = imgM ? imgM[1] : '';

    const yearM = html.match(/<span[^>]*>\s*(\d{4})\s*<\/span>/);
    const year = yearM ? parseInt(yearM[1]) : null;

    return { id: animeId, title, cover, type: 'Anime', year, source: 'jetanimes' };
  }

  // ── Episodes list ────────────────────────────────────────

  async getEpisodes(animeId) {
    const episodes = [];
    const seen = new Set();
    let page = 1;

    while (page <= 30) {
      const url = page === 1
        ? `${BASE}/episodes/?s=${encodeURIComponent(animeId)}`
        : `${BASE}/episodes/page/${page}/?s=${encodeURIComponent(animeId)}`;

      const res = await get(url);
      if (!res.ok) break;
      const html = await res.text();

      const found = this._parseEpisodeCards(html, animeId);
      if (found.length === 0) break;

      for (const ep of found) {
        if (!seen.has(ep.id)) { seen.add(ep.id); episodes.push(ep); }
      }
      page++;
    }

    if (episodes.length === 0) throw new Error(`Aucun épisode trouvé pour ${animeId}`);

    // Sort by season then episode number
    episodes.sort((a, b) => (a.season - b.season) || (a.number - b.number));
    return episodes;
  }

  // ── Video URL ────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    const epUrl = `${BASE}/episodes/${episodeId}/`;
    const res = await get(epUrl);
    if (!res.ok) throw new Error(`Episode not found: ${episodeId}`);
    const html = await res.text();

    // Extract post ID and nonce from page
    const postIdM = html.match(/postid-(\d+)/);
    if (!postIdM) throw new Error('Could not find episode post ID');
    const postId = postIdM[1];

    const nonceM = html.match(/"nonce"\s*:\s*"([^"]+)"/);
    const nonce = nonceM ? nonceM[1] : '';

    // Get all available player options (servers)
    // HTML: <li id='player-option-N' class='dooplay_player_option' data-nume='N'>
    //         <span class='title'>PLAYER N</span>
    const sources = [];
    const serverRe = /data-nume=['"](\d+)['"][^>]*>[\s\S]*?<span\s+class=['"]title['"]>([^<]*)</gi;
    for (const m of matchAll(html, serverRe)) {
      sources.push({ num: m[1], name: m[2].trim() });
    }
    if (sources.length === 0) sources.push({ num: '1', name: 'Server 1' });

    // Try each server to find a direct URL
    for (const srv of sources) {
      const body = new URLSearchParams({
        action: 'doo_player_ajax',
        post: postId,
        nonce,
        nume: srv.num,
        type: 'tv',
      });

      try {
        const ajaxRes = await fetch(`${BASE}/wp-admin/admin-ajax.php`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': UA,
            'Referer': epUrl,
            'X-Requested-With': 'XMLHttpRequest',
          },
          body: body.toString(),
          signal: AbortSignal.timeout(8000),
        });
        if (!ajaxRes.ok) continue;
        const data = await ajaxRes.json();
        if (!data.embed_url) continue;

        const embedUrl = forceHttps(data.embed_url);
        const resolved = await this._resolveVideoUrl(embedUrl, epUrl);
        if (this._isDirectUrl(resolved.url)) {
          return {
            url: resolved.url,
            sourceUrl: embedUrl,
            referer: epUrl,
            headers: { Referer: epUrl },
            subtitles: [],
            sources: sources.map(s => ({ name: s.name, url: embedUrl })),
          };
        }
      } catch {
        continue;
      }
    }

    // No direct URL found — fall back to iframe
    const fallbackBody = new URLSearchParams({ action: 'doo_player_ajax', post: postId, nonce, nume: '1', type: 'tv' });
    const fallbackRes = await fetch(`${BASE}/wp-admin/admin-ajax.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA, 'Referer': epUrl },
      body: fallbackBody.toString(),
    }).catch(() => null);

    if (fallbackRes?.ok) {
      const data = await fallbackRes.json().catch(() => null);
      if (data?.embed_url) {
        return {
          type: 'iframe',
          url: forceHttps(data.embed_url),
          referer: epUrl,
          headers: { Referer: epUrl },
          subtitles: [],
          sources: [{ name: 'Server 1', url: forceHttps(data.embed_url) }],
        };
      }
    }

    throw new Error(`Aucune source vidéo trouvée pour ${episodeId}`);
  }

  // ── Helpers ──────────────────────────────────────────────

  _isDirectUrl(url) {
    return /\.(m3u8|mp4|webm)(\?|$)/i.test(url || '');
  }

  async _resolveVideoUrl(embedUrl, referer) {
    try {
      const res = await fetch(embedUrl, {
        headers: { Referer: referer, 'User-Agent': UA },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) return { url: embedUrl };
      const html = await res.text();
      const m3u8M = html.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)["']/i);
      if (m3u8M) return { url: forceHttps(m3u8M[1]) };
      const mp4M = html.match(/["'](https?:\/\/[^"']*\.mp4[^"']*)["']/i);
      if (mp4M) return { url: forceHttps(mp4M[1]) };
      return { url: embedUrl };
    } catch {
      return { url: embedUrl };
    }
  }

  async enrichCoversAsync(_items, _callback) {}
}
