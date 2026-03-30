import { AnimeSamaSource } from './sources/anime-sama.js';
import { FrenchAnimeSource } from './sources/french-anime.js';

// ── Available sources ────────────────────────────────────────

export const AVAILABLE_SOURCES = ['anime-sama', 'french-anime', 'vostfree'];

const sourceInstances = {
  'anime-sama': new AnimeSamaSource(),
  'french-anime': new FrenchAnimeSource(),
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
    case 'getEpisodes':
      return await source.getEpisodes(payload.animeId);
    case 'getAnimeInfo': {
      const info = await source.getAnimeInfo(payload.animeId);
      if (info) info.source = sourceName;
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
