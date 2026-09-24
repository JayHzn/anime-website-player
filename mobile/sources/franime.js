// ── FRAnime source (franime.fr) — Mobile (React Native) version ──
// Same logic as extension/sources/franime.js, but every fetch sets an explicit browser
// User-Agent and Referer. React Native honours those headers (no forbidden-header
// stripping like a service worker), so we don't need the declarativeNetRequest rule —
// the franime API + Cloudflare both require a real browser UA + franime.fr Referer.

import { buildVideoResponse } from '../lib/resolve.js';

const API = 'https://api.franime.fr/api';
const SITE = 'https://franime.fr';
// Desktop Chrome UA: this exact UA + the franime.fr Referer is what makes the GET_LECTEUR
// endpoint return the embed (verified). A mobile UA may behave differently with Cloudflare.
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

function forceHttps(url) {
  if (!url) return url;
  if (url.startsWith('//')) return 'https:' + url;
  return url.replace(/^http:\/\//i, 'https://');
}

// ── In-memory caches ───────────────────────────────────────────
const CATALOG_TTL = 15 * 60 * 1000; // 15 min
const CALENDAR_TTL = 5 * 60 * 1000; // 5 min
let _catalog = null;
let _catalogAt = 0;
let _catalogPromise = null;
let _calendar = null;
let _calendarAt = 0;
let _calendarPromise = null;

function makeFetch(endpoint) {
  return fetch(`${API}/${endpoint}`, {
    headers: { Referer: `${SITE}/`, Origin: SITE, 'User-Agent': UA },
    credentials: 'include',
  });
}

async function getCatalog() {
  if (_catalog && (Date.now() - _catalogAt) < CATALOG_TTL) return _catalog;
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = (async () => {
    const res = await makeFetch('animes');
    if (!res.ok) throw new Error(`FRAnime catalogue HTTP ${res.status}`);
    _catalog = await res.json();
    _catalogAt = Date.now();
    return _catalog;
  })();
  try {
    return await _catalogPromise;
  } finally {
    _catalogPromise = null;
  }
}

async function getCalendar() {
  if (_calendar && (Date.now() - _calendarAt) < CALENDAR_TTL) return _calendar;
  if (_calendarPromise) return _calendarPromise;
  _calendarPromise = (async () => {
    const res = await makeFetch('calendrier_data');
    if (!res.ok) throw new Error(`FRAnime calendar HTTP ${res.status}`);
    const json = await res.json();
    _calendar = Array.isArray(json?.data) ? json.data : [];
    _calendarAt = Date.now();
    return _calendar;
  })();
  try {
    return await _calendarPromise;
  } finally {
    _calendarPromise = null;
  }
}

// Today's day-of-week name as franime stores it (lowercase French)
function todayJourFR() {
  const days = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];
  return days[new Date().getDay()];
}

// ── Helpers ────────────────────────────────────────────────────

function slugifyTitle(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalize(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function pickTitle(a) {
  return a.titleO || a.title || (a.titles && (a.titles.en_jp || a.titles.en_us)) || `#${a.id}`;
}

function toCard(a, lang = 'vo') {
  const langLabel = lang === 'vf' ? 'VF' : 'VOSTFR';
  return {
    id: makeId(a.id, lang),
    title: `${pickTitle(a)} (${langLabel})`,
    cover: a.affiche_small || a.affiche || '',
    type: a.format || 'Anime',
    year: a.startDate ? parseInt(String(a.startDate).slice(0, 4)) : null,
    source: 'franime',
  };
}

// Expand one anime into one card per available language (VO and/or VF)
function expandCardsByLang(a) {
  const cards = [];
  if (hasLang(a, 'vo')) cards.push(toCard(a, 'vo'));
  if (hasLang(a, 'vf')) cards.push(toCard(a, 'vf'));
  return cards;
}

// Total episode count across all seasons for a given lang
function countEpisodes(a, lang) {
  if (!Array.isArray(a.saisons)) return 0;
  return a.saisons.reduce((sum, s) => {
    if (!Array.isArray(s.episodes)) return sum;
    return sum + s.episodes.filter((ep) => (ep.lang?.[lang]?.lecteurs?.length || 0) > 0).length;
  }, 0);
}

// Most recent updatedDate for a given lang (falls back to the other lang / start/end dates)
function updatedTs(a, lang) {
  let d;
  if (lang === 'vf') d = a.updatedDateVF || a.updatedDate;
  else d = a.updatedDate || a.updatedDateVF;
  d = d || a.endDate || a.startDate;
  return d ? new Date(d).getTime() : 0;
}

// Does this anime have at least one episode with lecteurs for the given lang?
function hasLang(a, lang) {
  if (!Array.isArray(a.saisons)) return false;
  return a.saisons.some((s) =>
    Array.isArray(s.episodes) && s.episodes.some((ep) => (ep.lang?.[lang]?.lecteurs?.length || 0) > 0)
  );
}

// animeId convention: "{id}" → VOSTFR (default), "{id}-vf" → VF
function parseAnimeId(animeId) {
  const s = String(animeId);
  if (s.endsWith('-vf')) return { baseId: s.slice(0, -3), lang: 'vf' };
  return { baseId: s, lang: 'vo' };
}

function makeId(baseId, lang) {
  return lang === 'vf' ? `${baseId}-vf` : String(baseId);
}

// The GET_LECTEUR endpoint returns a "watch2/?…&b=…" URL whose `b` param hides the
// real host embed URL: base64-decode → hex-decode to bytes → XOR every byte with a
// per-response key. The key isn't sent, but the URL always starts with "h" (https://),
// so we recover it from the first byte. Returns "" if it doesn't decode to an http URL.
export function decodeFranimeEmbed(bParam) {
  let hex;
  try {
    hex = atob(decodeURIComponent(bParam));
  } catch {
    return '';
  }
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) bytes.push(Number.parseInt(hex.slice(i, i + 2), 16));
  if (bytes.length === 0) return '';
  const key = bytes[0] ^ 0x68; // 'h'
  let out = '';
  for (const b of bytes) out += String.fromCodePoint((b ^ key) & 0xff);
  return /^https?:\/\//i.test(out) ? out : '';
}

// ── FRAnimeSource ──────────────────────────────────────────────

export class FRAnimeSource {

  // ── Search ───────────────────────────────────────────────

  async search(query) {
    const all = await getCatalog();
    if (!query?.trim()) {
      const sorted = [...all].sort((a, b) => updatedTs(b, 'vo') - updatedTs(a, 'vo'));
      const out = [];
      for (const a of sorted) {
        if (out.length >= 60) break;
        for (const card of expandCardsByLang(a)) {
          out.push(card);
          if (out.length >= 60) break;
        }
      }
      return out;
    }
    const q = normalize(query.trim());
    const matches = all.filter((a) => {
      const t1 = normalize(a.titleO);
      const t2 = normalize(a.title);
      const t3 = normalize(a.titles?.en_jp);
      const t4 = normalize(a.titles?.en_us);
      return t1.includes(q) || t2.includes(q) || t3.includes(q) || t4.includes(q);
    }).slice(0, 60);
    const out = [];
    for (const a of matches) {
      for (const card of expandCardsByLang(a)) out.push(card);
    }
    return out;
  }

  // ── Catalogue (used as "anime de saison" / browse) ───────

  async getSeasonAnime() {
    let topVoted = [];
    try {
      const res = await makeFetch('discord/voted/render-top-15-of-bestanimes');
      if (res.ok) topVoted = await res.json();
    } catch (err) {
      console.warn('[franime] top-voted fetch failed:', err.message);
    }

    const all = await getCatalog();
    const catalogById = new Map(all.map((a) => [String(a.id), a]));
    const seen = new Set();
    const out = [];

    const pushCardsFor = (a) => {
      const id = String(a.id);
      if (seen.has(id)) return;
      seen.add(id);
      for (const card of expandCardsByLang(a)) {
        out.push(card);
        if (out.length >= 60) return;
      }
    };

    for (const t of topVoted) {
      if (out.length >= 60) break;
      const full = catalogById.get(String(t.id)) || t;
      pushCardsFor(full);
    }

    const sortedAll = [...all].sort((a, b) => updatedTs(b, 'vo') - updatedTs(a, 'vo'));
    for (const a of sortedAll) {
      if (out.length >= 60) break;
      pushCardsFor(a);
    }
    return out;
  }

  // ── Latest episodes ──────────────────────────────────────

  async getLatestEpisodes() {
    try {
      const cal = await getCalendar();
      const today = todayJourFR();
      const todaysEntries = cal.filter((e) => e.jour === today);
      if (todaysEntries.length > 0) {
        todaysEntries.sort((a, b) => {
          const ta = (a.heures ?? 0) * 60 + (a.minutes ?? 0);
          const tb = (b.heures ?? 0) * 60 + (b.minutes ?? 0);
          return ta - tb;
        });
        return todaysEntries.map((e) => {
          const lang = (e.lang || 'vo').toLowerCase();
          const langLabel = lang === 'vf' ? 'VF' : 'VOSTFR';
          return {
            id: makeId(e.id_anime, lang),
            title: `${e.title_anime} (${langLabel})`,
            cover: e.affiche || '',
            type: 'Anime',
            year: null,
            latestEpisode: e.prochain_ep || null,
            latestEpisodeId: null,
            source: 'franime',
          };
        });
      }
    } catch (err) {
      console.warn('[franime] calendar fallback to catalogue:', err.message);
    }

    const all = await getCatalog();
    const out = [];
    for (const a of [...all].sort((x, y) => updatedTs(y, 'vo') - updatedTs(x, 'vo'))) {
      if (out.length >= 30) break;
      for (const lang of ['vo', 'vf']) {
        if (!hasLang(a, lang)) continue;
        out.push({
          ...toCard(a, lang),
          latestEpisode: countEpisodes(a, lang) || null,
          latestEpisodeId: null,
        });
        if (out.length >= 30) break;
      }
    }
    return out;
  }

  // ── Anime info ───────────────────────────────────────────

  async getAnimeInfo(animeId) {
    const { baseId, lang } = parseAnimeId(animeId);
    const all = await getCatalog();
    const a = all.find((x) => String(x.id) === baseId);
    if (!a) throw new Error(`FRAnime anime not found: ${animeId}`);
    if (!hasLang(a, lang)) {
      throw new Error(`FRAnime: aucun épisode en ${lang.toUpperCase()} pour cet anime.`);
    }
    const langLabel = lang === 'vf' ? 'VF' : 'VOSTFR';
    return {
      id: animeId,
      title: `${pickTitle(a)} (${langLabel})`,
      cover: a.affiche || a.affiche_small || '',
      type: a.format || 'Anime',
      year: a.startDate ? parseInt(String(a.startDate).slice(0, 4)) : null,
      source: 'franime',
      synopsis: a.description || '',
      genres: Array.isArray(a.themes) ? a.themes.join(', ') : '',
    };
  }

  // ── Episodes list ────────────────────────────────────────

  async getEpisodes(animeId) {
    const { baseId, lang } = parseAnimeId(animeId);
    const all = await getCatalog();
    const a = all.find((x) => String(x.id) === baseId);
    if (!a) throw new Error(`FRAnime anime not found: ${animeId}`);
    if (!Array.isArray(a.saisons) || a.saisons.length === 0) {
      throw new Error('Aucun épisode disponible.');
    }

    const episodes = [];
    a.saisons.forEach((season, sIdx) => {
      const sNum = sIdx + 1;
      const seasonName = season.title || `Saison ${sNum}`;
      (season.episodes || []).forEach((ep, eIdx) => {
        const eNum = eIdx + 1;
        const lecteurs = ep.lang?.[lang]?.lecteurs || [];
        if (lecteurs.length === 0) return;
        episodes.push({
          // episodeId encodes everything needed by getVideoUrl: {baseId}/{season}/{episode}/{lang}
          id: `${baseId}/${sNum}/${eNum}/${lang}`,
          number: eNum,
          title: `${seasonName} - ${ep.title || `Épisode ${eNum}`}`,
          season: seasonName,
        });
      });
    });
    if (episodes.length === 0) {
      throw new Error(`Aucun épisode ${lang.toUpperCase()} disponible.`);
    }
    return episodes;
  }

  // ── Video URL ────────────────────────────────────────────

  async getVideoUrl(episodeId) {
    // episodeId = "{baseId}/{season}/{episode}/{lang}"
    const parts = episodeId.split('/');
    if (parts.length < 4) throw new Error(`Invalid FRAnime episodeId: ${episodeId}`);
    const [baseId, seasonStr, epStr, lang] = parts;
    const sNum = parseInt(seasonStr);
    const eNum = parseInt(epStr);

    const all = await getCatalog();
    const a = all.find((x) => String(x.id) === String(baseId));
    if (!a) throw new Error(`FRAnime anime not found: ${baseId}`);
    const season = a.saisons?.[sNum - 1];
    const episode = season?.episodes?.[eNum - 1];
    if (!episode) throw new Error(`Episode introuvable: S${sNum} E${eNum}`);

    const lecteurs = episode.lang?.[lang]?.lecteurs || [];
    if (lecteurs.length === 0) {
      throw new Error(`Aucun lecteur ${lang.toUpperCase()} disponible pour S${sNum} E${eNum}`);
    }

    // Resolve every lecteur to its real host embed URL via the franime API:
    //   GET /api/anime/{id}/{season0}/{episode0}/{lang}/{lecteur}
    //     → a "watch2/?…&b=…" URL whose `b` decodes to the embed (sibnet/vidmoly/…).
    const apiS = sNum - 1;
    const apiE = eNum - 1;
    const resolved = await Promise.all(lecteurs.map((name, idx) =>
      this._resolveLecteurEmbed(baseId, apiS, apiE, lang, idx, name)
    ));
    const embeds = resolved.filter((r) => r?.url);
    if (embeds.length === 0) {
      // Surface the per-lecteur failure reason in the error (visible on-screen, no logs needed).
      const diag = resolved.filter(Boolean).map((r) => `${r.name}=${r.fail}`).join(' · ');
      throw new Error(`franime S${sNum}E${eNum} — aucune source résolue [${diag}]`);
    }

    // Shared extractor registry (lib/extractors) — same code as the extension.
    return buildVideoResponse(embeds, {
      referer: `${SITE}/`,
      prefix: (src) => (src.name ? `${src.name} ` : ''),
    });
  }

  // ── Video host helpers ───────────────────────────────────

  // Resolve one lecteur index to { name, url } (decoded embed), or null on failure.
  // Returns { name, url } on success, or { name, fail } with a short reason — the reason
  // is surfaced in getVideoUrl's error so we can see WHY it failed on a release build
  // (no console access). The API only returns the embed (watch2 + `b`) when the request
  // carries a franime.fr Referer + a browser UA; RN honours both headers directly.
  async _resolveLecteurEmbed(baseId, apiS, apiE, lang, idx, name) {
    try {
      // Use the SAME fetch config as makeFetch (which works for the catalogue on mobile)
      // — notably WITHOUT AbortSignal.timeout, which may be missing/broken in Hermes and
      // is the only difference from the working call.
      const res = await fetch(`${API}/anime/${baseId}/${apiS}/${apiE}/${lang}/${idx}`, {
        headers: { Referer: `${SITE}/`, Origin: SITE, 'User-Agent': UA },
        credentials: 'include',
      });
      let text = '';
      try { text = (await res.text()).trim(); } catch { text = ''; }
      if (!res.ok) return { name, fail: `HTTP${res.status}` };
      const m = text.match(/[?&]b=([^&]+)/);
      if (!m) return { name, fail: `noB:${text.slice(0, 30) || 'empty'}` };
      const url = decodeFranimeEmbed(m[1]);
      if (!url) return { name, fail: 'decode' };
      return { name: `${name} (${lang.toUpperCase()})`, url: forceHttps(url) };
    } catch (e) {
      return { name, fail: `err:${(e && (e.message || e.name)) || String(e)}` };
    }
  }

  // ── Covers ───────────────────────────────────────────────
  async enrichCoversAsync(_items, _callback) {}
}
