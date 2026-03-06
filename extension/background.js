import { VoiranimeSource } from "./sources/voiranime.js";
import { VoirdramaSource } from "./sources/voirdrama.js";

// ── Cloudflare bypass ────────────────────────────────────────
// v6.voiranime.com uses Cloudflare managed challenge.
// Service worker fetch() cannot share CF cookies, so we keep ONE background
// tab open per domain and run all fetches inside it via executeScript.
// The tab auto-closes after 2 min of inactivity.

const _solverTabs = {}; // domain -> { tabId }
let _solverCreating = {}; // domain -> Promise (prevents concurrent tab opens)
const SOLVER_IDLE_MS = 2 * 60 * 1000; // 2 min idle → close tab
let _solverTimers = {};

function _getDomain(url) {
  try { return new URL(url).hostname; } catch { return null; }
}

function _resetSolverTimer(domain) {
  if (_solverTimers[domain]) clearTimeout(_solverTimers[domain]);
  _solverTimers[domain] = setTimeout(() => _closeSolverTab(domain), SOLVER_IDLE_MS);
}

function _closeSolverTab(domain) {
  const solver = _solverTabs[domain];
  if (solver) {
    chrome.tabs.remove(solver.tabId).catch(() => {});
    delete _solverTabs[domain];
  }
  delete _solverTimers[domain];
  delete _solverCreating[domain];
}

chrome.tabs.onRemoved.addListener((tabId) => {
  for (const [domain, solver] of Object.entries(_solverTabs)) {
    if (solver.tabId === tabId) {
      delete _solverTabs[domain];
      delete _solverCreating[domain];
      if (_solverTimers[domain]) {
        clearTimeout(_solverTimers[domain]);
        delete _solverTimers[domain];
      }
    }
  }
});

/** Open a background tab and wait for CF challenge to be solved */
async function _openSolverTab(domain) {
  if (_solverCreating[domain]) {
    await _solverCreating[domain];
    return _solverTabs[domain]?.tabId || null;
  }

  _solverCreating[domain] = (async () => {
    const tab = await chrome.tabs.create({
      url: `https://${domain}/`,
      active: false,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        reject(new Error("Solver tab load timeout"));
      }, 30000);

      const listener = (tabId, changeInfo) => {
        if (tabId === tab.id && changeInfo.status === "complete") {
          clearTimeout(timeout);
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });

    _solverTabs[domain] = { tabId: tab.id };
    console.log(`[ext] CF solved for ${domain} (tab ${tab.id})`);
    return tab.id;
  })();

  try {
    await _solverCreating[domain];
    return _solverTabs[domain]?.tabId || null;
  } catch (e) {
    console.error(`[ext] Failed to solve CF for ${domain}:`, e);
    delete _solverCreating[domain];
    return null;
  }
}

/** Run fetch inside a tab's page context via executeScript */
async function _fetchViaTab(tabId, url, options) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async (fetchUrl, fetchOptions) => {
      try {
        const resp = await fetch(fetchUrl, fetchOptions);
        const text = await resp.text();
        return { ok: resp.ok, status: resp.status, statusText: resp.statusText, body: text };
      } catch (e) {
        return { error: e.message };
      }
    },
    args: [url, { method: options.method, headers: options.headers, body: options.body }],
  });

  const result = results?.[0]?.result;
  if (!result || result.error) {
    throw new Error(result?.error || "Tab fetch failed");
  }
  return new Response(result.body, { status: result.status, statusText: result.statusText });
}

/**
 * Cloudflare-aware fetch.
 * Tries direct fetch first. If CF blocks, opens ONE solver tab and uses
 * executeScript to run fetches in the tab's page context.
 */
export async function cfFetch(url, options = {}) {
  const domain = _getDomain(url);
  if (!domain) return fetch(url, options);

  // 1. Try direct fetch — if CF isn't blocking, no tab needed
  try {
    const resp = await fetch(url, options);
    if (resp.ok || (resp.status !== 403 && resp.status !== 503)) {
      return resp;
    }
  } catch { /* blocked */ }

  // 2. If we already have a solver tab open, use it
  if (_solverTabs[domain]) {
    try {
      await chrome.tabs.get(_solverTabs[domain].tabId);
      _resetSolverTimer(domain);
      return await _fetchViaTab(_solverTabs[domain].tabId, url, options);
    } catch {
      delete _solverTabs[domain];
      delete _solverCreating[domain];
    }
  }

  // 3. Open solver tab, solve CF, use executeScript
  const tabId = await _openSolverTab(domain);
  if (!tabId) throw new Error(`Cannot solve Cloudflare for ${domain}`);
  _resetSolverTimer(domain);
  return await _fetchViaTab(tabId, url, options);
}

// ── Sources ──────────────────────────────────────────────────

const sources = {
  voiranime: new VoiranimeSource(),
  voirdrama: new VoirdramaSource(),
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
      // Enrich covers in background for voirdrama (hotlink-protected)
      if (sender?.tab?.id && source.enrichCoversAsync) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync([...latest], (patches) => {
          for (const p of patches) p.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: "ANIME_EXT_COVERS_UPDATE",
            data: patches,
          }).catch(() => {});
        });
      }
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
    case "getSeasonAnime": {
      const season = await source.getSeasonAnime();
      if (sender?.tab?.id && source.enrichCoversAsync) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync([...season], (patches) => {
          for (const p of patches) p.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: "ANIME_EXT_COVERS_UPDATE",
            data: patches,
          }).catch(() => {});
        });
      }
      return season;
    }
    case "getVideoUrl":
      return await source.getVideoUrl(payload.episodeId);
    case "proxyImage":
      return await proxyImageToDataUrl(payload.url, payload.referer);
    default:
      throw new Error(`Action inconnue: ${action}`);
  }
}

/** Fetch an image via the extension (bypasses hotlink protection) and return as data URL */
async function proxyImageToDataUrl(url, referer) {
  if (!url) return "";
  const headers = { "Referer": referer || new URL(url).origin + "/" };
  const resp = await fetch(url, { headers });
  if (!resp.ok) return "";
  const blob = await resp.blob();
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}
