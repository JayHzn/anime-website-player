import { AnimeSamaSource } from './sources/anime-sama.js';

// ── Available sources ────────────────────────────────────────

export const AVAILABLE_SOURCES = ['anime-sama', 'french-anime', 'vostfree'];

const sourceInstances = {
  'anime-sama': new AnimeSamaSource(),
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

// ── Message handler ──────────────────────────────────────────

export async function handleAction(action, payload, sender) {
  if (action === 'ping') {
    const selected = await getSelectedSource();
    return {
      version: '2.0.0',
      sources: AVAILABLE_SOURCES,
      selectedSource: selected,
    };
  }

  if (action === 'getSelectedSource') {
    return { selectedSource: await getSelectedSource() };
  }

  const sourceName = payload?.source;
  if (!sourceName || !AVAILABLE_SOURCES.includes(sourceName)) {
    throw new Error(`Source non configurée: ${sourceName || 'aucune'}. Sélectionnez une source dans l'extension.`);
  }

  const source = getSource(sourceName);
  if (!source) {
    throw new Error(`La source "${sourceName}" n'est pas encore implémentée.`);
  }

  switch (action) {
    case 'search': {
      const query = payload.query ?? '';
      const cached = getCachedSearch(sourceName, query);
      if (cached) {
        console.log(`[ext] search cache HIT (${sourceName}:${query})`);
        return cached;
      }
      const results = await source.search(query);
      for (const r of results) r.source = sourceName;
      setSearchCache(sourceName, query, results);

      // Enrich covers in background if the source supports it
      if (sender?.tab?.id && source.enrichCoversAsync) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync(results, (patches) => {
          for (const p of patches) p.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: 'ANIME_EXT_COVERS_UPDATE',
            data: patches,
          }).catch(() => {});
        });
      }
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
      for (const r of latest) r.source = sourceName;
      if (sender?.tab?.id && source.enrichCoversAsync) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync([...latest], (patches) => {
          for (const p of patches) p.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: 'ANIME_EXT_COVERS_UPDATE',
            data: patches,
          }).catch(() => {});
        });
      }
      return latest;
    }
    case 'retryCovers': {
      const items = payload.items || [];
      if (items.length === 0) return [];
      for (const r of items) r.source = r.source || sourceName;
      if (sender?.tab?.id && source.enrichCoversAsync) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync(items, (patches) => {
          for (const p of patches) p.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: 'ANIME_EXT_COVERS_UPDATE',
            data: patches,
          }).catch(() => {});
        });
      }
      return { status: 'retrying', count: items.length };
    }
    case 'getSeasonAnime': {
      const season = await source.getSeasonAnime();
      for (const r of season) r.source = sourceName;
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
