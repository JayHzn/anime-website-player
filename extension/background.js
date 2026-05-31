import { AnimeSamaSource } from './sources/anime-sama.js';
import { VostfreeSource } from './sources/vostfree.js';
import { JetAnimesSource } from './sources/jetanimes.js';
import { FRAnimeSource } from './sources/franime.js';

// ── Available sources ────────────────────────────────────────

export const AVAILABLE_SOURCES = ['anime-sama', 'vostfree', 'jetanimes', 'franime'];

const sourceInstances = {
  'anime-sama': new AnimeSamaSource(),
  'vostfree': new VostfreeSource(),
  'jetanimes': new JetAnimesSource(),
  'franime': new FRAnimeSource(),
};

function getSource(name) {
  return sourceInstances[name] || null;
}

// ── Source storage ───────────────────────────────────────────

export async function getSelectedSource() {
  const result = await chrome.storage.local.get('selectedSource');
  return result.selectedSource || null;
}

// ── Search cache ─────────────────────────────────────────────

export const searchCache = new Map();
export const SEARCH_CACHE_TTL = 120000; // 2 min

export function getCachedSearch(source, query) {
  const key = `${source}:${query}`;
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return entry.results;
}

export function setSearchCache(source, query, results) {
  searchCache.set(`${source}:${query}`, { results: [...results], at: Date.now() });
}

// ── Result cache (episodes / anime info) ─────────────────────
// Stable, navigation-heavy data (anime page → watch → back) re-fetched often.
// Short TTL keeps it fresh enough while making back-and-forth instant.
// NOTE: getVideoUrl is intentionally NOT cached — its resolved URLs can carry
// short-lived tokens that would 403 if replayed later.

export const resultCache = new Map();
export const RESULT_CACHE_TTL = 300000; // 5 min

export function getCachedResult(key) {
  const entry = resultCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > RESULT_CACHE_TTL) {
    resultCache.delete(key);
    return null;
  }
  // Return a structured copy so callers can't mutate the cached value.
  return structuredClone(entry.value);
}

export function setCachedResult(key, value) {
  resultCache.set(key, { value: structuredClone(value), at: Date.now() });
}

// ── Helpers ──────────────────────────────────────────────────

function tagSource(items, sourceName) {
  for (const r of items) r.source = sourceName;
}

function enrichCovers(source, sourceName, items, sender) {
  if (!sender?.tab?.id || !source.enrichCoversAsync) return;
  const tabId = sender.tab.id;
  source.enrichCoversAsync(items, (patches) => {
    tagSource(patches, sourceName);
    chrome.tabs.sendMessage(tabId, {
      type: 'ANIME_EXT_COVERS_UPDATE',
      data: patches,
    }).catch(() => {});
  });
}

function resolveSource(payload) {
  const sourceName = payload?.source;
  if (!sourceName || !AVAILABLE_SOURCES.includes(sourceName)) {
    throw new Error(`Source non configurée: ${sourceName || 'aucune'}. Sélectionnez une source dans l'extension.`);
  }
  const source = getSource(sourceName);
  if (!source) {
    throw new Error(`La source "${sourceName}" n'est pas encore implémentée.`);
  }
  return { sourceName, source };
}

// ── Source action dispatch ───────────────────────────────────

async function handleSourceAction(action, payload, sender, sourceName, source) {
  switch (action) {
    case 'search': {
      const query = payload.query ?? '';
      const cached = getCachedSearch(sourceName, query);
      if (cached) {
        console.log(`[ext] search cache HIT (${sourceName}:${query})`);
        return cached;
      }
      const results = await source.search(query);
      tagSource(results, sourceName);
      setSearchCache(sourceName, query, results);
      enrichCovers(source, sourceName, results, sender);
      return results;
    }
    case 'getEpisodes': {
      const key = `episodes:${sourceName}:${payload.animeId}`;
      const cached = getCachedResult(key);
      if (cached) {
        console.log(`[ext] episodes cache HIT (${sourceName}:${payload.animeId})`);
        return cached;
      }
      const episodes = await source.getEpisodes(payload.animeId);
      setCachedResult(key, episodes);
      return episodes;
    }
    case 'getAnimeInfo': {
      const key = `info:${sourceName}:${payload.animeId}`;
      const cached = getCachedResult(key);
      if (cached) {
        console.log(`[ext] animeInfo cache HIT (${sourceName}:${payload.animeId})`);
        return cached;
      }
      const info = await source.getAnimeInfo(payload.animeId);
      if (info) info.source = sourceName;
      setCachedResult(key, info);
      return info;
    }
    case 'getLatestEpisodes': {
      const latest = await source.getLatestEpisodes();
      tagSource(latest, sourceName);
      enrichCovers(source, sourceName, [...latest], sender);
      return latest;
    }
    case 'retryCovers': {
      const items = payload.items || [];
      if (items.length === 0) return [];
      for (const r of items) r.source = r.source || sourceName;
      enrichCovers(source, sourceName, items, sender);
      return { status: 'retrying', count: items.length };
    }
    case 'getSeasonAnime': {
      const season = await source.getSeasonAnime();
      tagSource(season, sourceName);
      return season;
    }
    case 'getVideoUrl':
      return await source.getVideoUrl(payload.episodeId);
    case 'proxyImage':
      return await proxyImageToDataUrl(payload.url, payload.referer);
    default:
      throw new Error(`Action inconnue: ${action}`);
  }
}

// ── Message handler ──────────────────────────────────────────

export async function handleAction(action, payload, sender) {
  if (action === 'keepalive') return {};
  if (action === 'ping') {
    return {
      version: chrome.runtime.getManifest().version,
      sources: AVAILABLE_SOURCES,
      selectedSource: await getSelectedSource(),
    };
  }
  if (action === 'getSelectedSource') {
    return { selectedSource: await getSelectedSource() };
  }
  const { sourceName, source } = resolveSource(payload);
  return handleSourceAction(action, payload, sender, sourceName, source);
}

// ── Image proxy ──────────────────────────────────────────────

export async function proxyImageToDataUrl(url, referer) {
  if (!url) return '';
  const headers = { 'Referer': referer || new URL(url).origin + '/' };
  const resp = await fetch(url, { headers });
  if (!resp.ok) return '';
  const blob = await resp.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// ── Wire up Chrome message listener ──────────────────────────

if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const { action, payload } = message;

    console.log(`[ext] → ${action}`, payload);

    handleAction(action, payload, sender)
      .then((result) => {
        console.log(`[ext] ← ${action} OK`, result);
        sendResponse(result);
      })
      .catch((err) => {
        console.error(`[ext] ← ${action} ERROR`, err.message);
        sendResponse({ error: err.message });
      });

    return true;
  });
}
