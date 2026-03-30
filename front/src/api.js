const BASE = import.meta.env.DEV ? '/api' : '';

// ── Extension bridge ────────────────────────────────────────

// Minimum extension version required by this frontend build.
// Bump this when a breaking change requires a new extension.
export const MIN_EXTENSION_VERSION = '2.0.5';

let _extReady = null; // null = unknown, true/false = detected
let _extSources = null; // available source names from extension
let _selectedSource = null; // currently selected source in extension
let _extVersion = null; // version string returned by the extension ping

/**
 * Send a request to the Chrome extension via postMessage.
 */
function extRequest(action, payload = {}, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();

    const timer = setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error('Extension non détectée. Installez l\'extension AnimeHub pour utiliser le site.'));
    }, timeoutMs);

    function handler(event) {
      if (event.data?.type !== 'ANIME_EXT_RESPONSE') return;
      if (event.data.id !== id) return;
      window.removeEventListener('message', handler);
      clearTimeout(timer);
      if (event.data.success) {
        console.log(`%c[EXT] ✓ ${action}`, 'color:#4ade80', event.data.data);
        resolve(event.data.data);
      } else {
        console.warn(`%c[EXT] ✗ ${action}`, 'color:#f87171', event.data.error);
        reject(new Error(event.data.error || 'Extension error'));
      }
    }

    window.addEventListener('message', handler);
    console.log(`%c[EXT] → ${action}`, 'color:#60a5fa', payload);
    window.postMessage({ type: 'ANIME_EXT_REQUEST', id, action, payload }, '*');
  });
}

/**
 * Detect extension availability via ping (cached).
 * Also retrieves available sources and currently selected source.
 */
export async function isExtensionAvailable() {
  if (_extReady !== null) return _extReady;
  try {
    const pingData = await extRequest('ping', {}, 2000);
    _extReady = true;
    _extSources = pingData?.sources || [];
    _selectedSource = pingData?.selectedSource || null;
    _extVersion = pingData?.version || null;
    console.log('%c[EXT] Extension détectée', 'color:#4ade80;font-weight:bold', { sources: _extSources, selected: _selectedSource });
  } catch {
    _extReady = false;
    console.log('%c[EXT] Extension non détectée', 'color:#fbbf24');
  }
  return _extReady;
}

/** Get the currently selected source from the extension. */
export function getSelectedSource() {
  return _selectedSource;
}

/** Get the version string reported by the extension. */
export function getExtensionVersion() {
  return _extVersion;
}

/** Compare semver strings. Returns true if `a` >= `b`. */
function semverGte(a, b) {
  const pa = (a || '0.0.0').split('.').map(Number);
  const pb = (b || '0.0.0').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) > (pb[i] || 0)) return true;
    if ((pa[i] || 0) < (pb[i] || 0)) return false;
  }
  return true;
}

/** Returns true when the detected extension is older than MIN_EXTENSION_VERSION. */
export function isExtensionOutdated() {
  if (!_extVersion) return false;
  return !semverGte(_extVersion, MIN_EXTENSION_VERSION);
}

/** Force a fresh ping on next isExtensionAvailable() call. */
export function resetExtensionCache() {
  _extReady = null;
  _extSources = null;
  _selectedSource = null;
  _extVersion = null;
}

/** Get the list of available sources. */
export function getAvailableSources() {
  return _extSources || [];
}

// Reset detection when extension announces itself
window.addEventListener('message', (e) => {
  if (e.data?.type === 'ANIME_EXT_READY') {
    _extReady = true;
    console.log('%c[EXT] Extension READY reçu', 'color:#4ade80;font-weight:bold');
  }
});

// ── Cover updates listener ──────────────────────────────────

const _coverListeners = new Set();

/** Subscribe to cover updates from the extension. Returns unsubscribe fn. */
export function onCoversUpdate(callback) {
  _coverListeners.add(callback);
  return () => _coverListeners.delete(callback);
}

window.addEventListener('message', (e) => {
  if (e.data?.type === 'ANIME_EXT_COVERS_UPDATE') {
    console.log('%c[EXT] Covers updated', 'color:#4ade80', e.data.data);
    for (const cb of _coverListeners) cb(e.data.data);
  }
});

// ── User ID (per-browser, persisted in localStorage) ────────

function getUserId() {
  let id = localStorage.getItem('animehub_user_id');
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem('animehub_user_id', id);
  }
  return id;
}

const USER_HEADERS = { 'X-User-Id': getUserId() };

// ── Backend helpers ─────────────────────────────────────────

async function fetchJSON(path) {
  const res = await fetch(`${BASE}${path}`, { headers: USER_HEADERS });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

// ── Public API ──────────────────────────────────────────────

export const api = {
  // Scraping operations → extension ONLY
  search: (query, source) =>
    extRequest('search', { query, source }),

  getAnimeInfo: (source, animeId) =>
    extRequest('getAnimeInfo', { animeId, source }),

  getEpisodes: (source, animeId) =>
    extRequest('getEpisodes', { animeId, source }),

  getVideoUrl: (source, episodeId) =>
    extRequest('getVideoUrl', { episodeId, source }),

  getLatestEpisodes: (source) =>
    extRequest('getLatestEpisodes', { source }),

  getSeasonAnime: (source) =>
    extRequest('getSeasonAnime', { source }),

  retryCovers: (items, source) =>
    extRequest('retryCovers', { items, source }),

  // Storage operations → always backend
  getSources: async () => {
    if (_extSources && _extSources.length > 0) {
      return _extSources.map((name) => ({ name, language: 'fr', base_url: '' }));
    }
    try {
      const pingData = await extRequest('ping', {}, 2000);
      _extSources = pingData?.sources || [];
      _selectedSource = pingData?.selectedSource || null;
      return _extSources.map((name) => ({ name, language: 'fr', base_url: '' }));
    } catch {
      return [];
    }
  },
  getProgress: () => fetchJSON('/progress'),
  getAnimeProgress: (animeId) => fetchJSON(`/progress/${encodeURIComponent(animeId)}`),
  updateProgress: (data) =>
    fetch(`${BASE}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...USER_HEADERS },
      body: JSON.stringify(data),
    }),
  deleteProgress: (animeId) =>
    fetch(`${BASE}/progress/${encodeURIComponent(animeId)}`, { method: 'DELETE', headers: USER_HEADERS }),
  getSkipSegments: (source, episodeId, episodeNumber) => {
    const params = episodeNumber ? `?ep=${episodeNumber}` : '';
    return fetchJSON(`/episode/${source}/${episodeId}/skip-segments${params}`);
  },
  triggerSkipAnalysis: (source, animeId) =>
    fetch(`${BASE}/anime/${source}/${encodeURIComponent(animeId)}/analyze-skip`, { method: 'POST' }),
  correctSkipSegment: (source, animeId, episodeNumber, data) =>
    fetch(`${BASE}/anime/${source}/${encodeURIComponent(animeId)}/skip-segments/${episodeNumber}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),
  deleteSkipSegments: (source, animeId, episodeNumber) =>
    fetch(`${BASE}/anime/${source}/${encodeURIComponent(animeId)}/skip-segments/${episodeNumber}`, { method: 'DELETE' }),
};
