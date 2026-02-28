import { VoiranimeSource } from "./sources/voiranime.js";

const sources = {
  voiranime: new VoiranimeSource(),
};

// In-memory search cache: { key: { results, at } }
const searchCache = new Map();
const SEARCH_CACHE_TTL = 120000; // 2 min

function getSearchCacheKey(source, query) {
  return `${source}:${query}`;
}

function getCachedSearch(source, query) {
  const key = getSearchCacheKey(source, query);
  const entry = searchCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > SEARCH_CACHE_TTL) {
    searchCache.delete(key);
    return null;
  }
  return entry.results;
}

function setSearchCache(source, query, results) {
  searchCache.set(getSearchCacheKey(source, query), { results: [...results], at: Date.now() });
}

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

  return true; // keep channel open for async sendResponse
});

async function handleAction(action, payload, sender) {
  if (action === "ping") {
    return { version: "1.0.0", sources: Object.keys(sources) };
  }

  const sourceName = payload?.source || "voiranime";
  const source = sources[sourceName];
  if (!source) {
    throw new Error(`Source inconnue: ${sourceName}`);
  }

  switch (action) {
    case "search": {
      const query = payload.query ?? "";
      const cached = getCachedSearch(sourceName, query);
      if (cached) {
        console.log(`[ext] search cache HIT (${sourceName}:${query})`);
        return cached;
      }

      const results = await source.search(query);
      for (const r of results) r.source = sourceName;
      setSearchCache(sourceName, query, results);

      // Enrich covers in background — envoie uniquement les covers mises à jour (merge côté frontend)
      if (sender?.tab?.id) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync(results, (patches) => {
          for (const p of patches) p.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: "ANIME_EXT_COVERS_UPDATE",
            data: patches,
          }).catch(() => {});
        });
      }

      return results;
    }
    case "getEpisodes":
      return await source.getEpisodes(payload.animeId);
    case "getAnimeInfo": {
      const info = await source.getAnimeInfo(payload.animeId);
      if (info) info.source = sourceName;
      return info;
    }
    case "getLatestEpisodes": {
      const latest = await source.getLatestEpisodes();
      for (const r of latest) r.source = sourceName;
      return latest;
    }
    case "retryCovers": {
      // Receive a list of {id, title, source} and re-enrich covers for them
      const items = payload.items || [];
      if (items.length === 0) return [];
      for (const r of items) r.source = r.source || sourceName;

      if (sender?.tab?.id) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync(items, (patches) => {
          for (const p of patches) p.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: "ANIME_EXT_COVERS_UPDATE",
            data: patches,
          }).catch(() => {});
        });
      }
      return { status: "retrying", count: items.length };
    }
    case "getVideoUrl":
      return await source.getVideoUrl(payload.episodeId);
    default:
      throw new Error(`Action inconnue: ${action}`);
  }
}
