import { VoiranimeSource } from "./sources/voiranime.js";
import { VoirdramaSource } from "./sources/voirdrama.js";

// ── Cloudflare-aware fetch (single solver tab) ───────────────
// v6.voiranime.com uses Cloudflare managed challenge.
// Service worker fetch() can't solve it — we open ONE background tab
// per domain, let the browser solve the challenge, then run all fetches
// inside that tab's page context via chrome.scripting.executeScript.

const _solverTabs = {}; // domain -> { tabId, ready }
let _solverCreating = {}; // domain -> Promise (prevents concurrent tab opens)
const SOLVER_IDLE_MS = 5 * 60 * 1000; // close tab after 5 min idle
let _solverTimers = {}; // domain -> timeout id

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
    // Close the entire minimized window
    if (solver.windowId) {
      chrome.windows.remove(solver.windowId).catch(() => {});
    } else {
      chrome.tabs.remove(solver.tabId).catch(() => {});
    }
    delete _solverTabs[domain];
  }
  delete _solverTimers[domain];
  delete _solverCreating[domain];
}

// Listen for solver tab being closed by the user
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

async function _ensureSolverTab(domain) {
  // Already have a ready tab
  if (_solverTabs[domain]) {
    // Verify it still exists
    try {
      await chrome.tabs.get(_solverTabs[domain].tabId);
      _resetSolverTimer(domain);
      return _solverTabs[domain].tabId;
    } catch {
      delete _solverTabs[domain];
      delete _solverCreating[domain];
    }
  }

  // Another call is already creating the tab — wait for it
  if (_solverCreating[domain]) {
    await _solverCreating[domain];
    if (_solverTabs[domain]) return _solverTabs[domain].tabId;
    // Creation failed, fall through to retry
  }

  // Create a minimized popup window (invisible to the user)
  _solverCreating[domain] = (async () => {
    try {
      const win = await chrome.windows.create({
        url: `https://${domain}/`,
        type: "popup",
        state: "minimized",
        width: 400,
        height: 300,
        focused: false,
      });

      const tab = win.tabs[0];

      // Wait for tab to finish loading (CF challenge solved)
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

      _solverTabs[domain] = { tabId: tab.id, windowId: win.id, ready: true };
      _resetSolverTimer(domain);
      console.log(`[ext] Solver window opened for ${domain} (tab ${tab.id}, window ${win.id})`);
    } catch (e) {
      console.error(`[ext] Failed to create solver window for ${domain}:`, e);
      delete _solverCreating[domain];
      throw e;
    }
  })();

  await _solverCreating[domain];
  return _solverTabs[domain]?.tabId;
}

/**
 * Fetch a URL via the solver tab's page context.
 * Uses chrome.scripting.executeScript with world:"MAIN" so the fetch
 * runs with the page's cookies (including cf_clearance).
 */
export async function cfFetch(url, options = {}) {
  const domain = _getDomain(url);
  if (!domain) return fetch(url, options);

  // First try a normal fetch — if CF isn't blocking, no need for solver tab
  try {
    const directResp = await fetch(url, options);
    if (directResp.ok || (directResp.status !== 403 && directResp.status !== 503)) {
      return directResp;
    }
  } catch { /* blocked — use solver tab */ }

  // Get or create the solver tab
  const tabId = await _ensureSolverTab(domain);
  if (!tabId) throw new Error(`Cannot create solver tab for ${domain}`);

  // Execute fetch inside the tab's page context
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
    throw new Error(result?.error || "Solver tab fetch failed");
  }

  // Wrap in a Response-like object for compatibility
  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
  });
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
