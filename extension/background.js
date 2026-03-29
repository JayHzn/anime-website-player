// ── Available sources (will be populated with actual implementations) ──

export const AVAILABLE_SOURCES = ['anime-sama', 'french-anime', 'vostfree'];

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

export async function handleAction(action, payload, _sender) {
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

  // Source implementations will be added here as they are developed
  // For now, throw a clear error
  throw new Error(`La source "${sourceName}" n'est pas encore implémentée.`);
}

// ── Image proxy (kept for future sources) ────────────────────

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

    return true; // keep channel open for async sendResponse
  });
}
