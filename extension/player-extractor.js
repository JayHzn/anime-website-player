// player-extractor.js
// Runs inside third-party video embed iframes (all_frames: true, world: MAIN).
//
// "world": "MAIN" means this script runs directly in the page's JS context —
// no isolated world, no <script> tag injection, no CSP issue.
// It can access jwplayer/videojs/XHR/fetch directly.
//
// Detected URL → parent.postMessage({ type: 'ANIME_EXT_VIDEO_URL', url }) → VideoPlayer.jsx

(function () {
  // Only act when inside an iframe
  if (self === top) return; // NOSONAR(javascript:S3403)

  let _sent = false;

  function isVideoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/\.(m3u8|mp4|webm|ts)(\?|$)/i.test(url)) return true;
    if (/\/hls\//i.test(url)) return true;
    if (/[?&](type=hls|format=hls|manifest=m3u8)/i.test(url)) return true;
    if (/\/(manifest|playlist|index)(\.m3u8)?(\?|$)/i.test(url)) return true;
    return false;
  }

  function send(url) {
    if (_sent || !url || typeof url !== 'string') return;
    if (url.startsWith('/') && !url.startsWith('//')) url = location.origin + url;
    else if (url.startsWith('//')) url = location.protocol + url;
    if (!isVideoUrl(url)) return;
    _sent = true;
    parent.postMessage({ type: 'ANIME_EXT_VIDEO_URL', url }, '*'); // NOSONAR(javascript:S2819)
  }

  // ── Strategy 1: XHR interception ─────────────────────────
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string') send(url);
    return origXHROpen.apply(this, arguments);
  };

  // ── Strategy 2: fetch interception ───────────────────────
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (resource) {
    const url = typeof resource === 'string' ? resource : resource?.url;
    if (url) send(url);
    return origFetch.apply(this, arguments);
  };

  // ── Strategy 3: JWPlayer setup hook ──────────────────────
  // Extracts playlist URL from the jwplayer config at call time —
  // more reliable than XHR interception (fires before HLS requests).

  function extractFromConfig(config) {
    if (!config) return;
    if (config.file) send(config.file);
    const rawPlaylist = config.playlist;
    let playlist;
    if (Array.isArray(rawPlaylist)) playlist = rawPlaylist;
    else if (rawPlaylist) playlist = [rawPlaylist];
    else playlist = [];
    for (const item of playlist) {
      if (item?.file) send(item.file);
      for (const src of (item?.sources || [])) {
        if (src?.file) send(src.file);
      }
    }
  }

  function hookJWSetup(jw) {
    if (jw && typeof jw === 'function') {
      const origJW = jw;
      globalThis.jwplayer = function (...args) {
        const inst = origJW.apply(this, args);
        if (inst && typeof inst.setup === 'function') {
          const origSetup = inst.setup.bind(inst);
          inst.setup = function (config) {
            try { extractFromConfig(config); } catch (e) { console.debug('[anime-ext] extractFromConfig error', e); }
            return origSetup(config);
          };
        }
        return inst;
      };
      Object.assign(globalThis.jwplayer, origJW);
    }
  }

  if (typeof jwplayer === 'undefined') {
    Object.defineProperty(globalThis, 'jwplayer', {
      configurable: true,
      set(value) {
        Object.defineProperty(globalThis, 'jwplayer', { configurable: true, writable: true, value });
        hookJWSetup(value);
      },
      get() { return undefined; },
    });
  } else {
    hookJWSetup(jwplayer);
  }

  // ── Strategy 4: VideoJS static config ────────────────────
  function tryVideoJS() {
    if (typeof videojs === 'undefined') return false;
    try {
      const players = Object.values(videojs.getPlayers() || {});
      for (const p of players) {
        if (!p) continue;
        const src = p.currentSrc?.();
        if (src && !src.startsWith('blob:')) { send(src); return true; }
        const srcs = p.currentSources?.();
        if (srcs?.[0]?.src) { send(srcs[0].src); return true; }
      }
    } catch (e) { console.debug('[anime-ext] VideoJS error', e); }
    return false;
  }

  // ── Strategy 5: video element src property ───────────────
  function tryVideoElement() {
    const video = document.querySelector('video');
    if (video) {
      const src = video.currentSrc || video.src;
      if (src && !src.startsWith('blob:')) { send(src); return true; }
    }
    const source = document.querySelector('video source[src]');
    if (source?.src) { send(source.src); return true; }
    return false;
  }

  // ── Strategy 6: JWPlayer getPlaylist (after setup) ───────
  function tryJWPlayer() {
    try {
      const jw = globalThis.jwplayer?.();
      if (!jw || typeof jw.getPlaylist !== 'function') return false;
      const playlist = jw.getPlaylist();
      if (!playlist?.[0]) return false;
      const sources = playlist[0].sources || [];
      const m3u8 = sources.find(s => s.file && /\.m3u8/i.test(s.file));
      const mp4  = sources.find(s => s.file && /\.mp4/i.test(s.file));
      const url  = (m3u8 ?? mp4 ?? sources[0])?.file;
      if (url) { send(url); return true; }
    } catch (e) { console.debug('[anime-ext] JWPlayer error', e); }
    return false;
  }

  function tryStatic() {
    return tryJWPlayer() || tryVideoJS() || tryVideoElement();
  }

  // ── Strategy 7: force video.load() for preload:none ──────
  function forceLoadAndListen() {
    const video = document.querySelector('video');
    if (!video) return;
    video.muted = true;
    video.addEventListener('loadstart', () => {
      const src = video.currentSrc || video.src;
      if (src && !src.startsWith('blob:')) send(src);
    }, { once: true });
    try { video.load(); } catch (e) { console.debug('[anime-ext] video.load error', e); }
  }

  if (tryStatic()) return;
  forceLoadAndListen();
  setTimeout(() => { if (!_sent && !tryStatic()) setTimeout(tryStatic, 3000); }, 1500);
})();
