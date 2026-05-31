// player-extractor.js
// Runs inside third-party video embed iframes (all_frames: true, world: MAIN).
//
// "world": "MAIN" means this script runs directly in the page's JS context —
// no isolated world, no <script> tag injection, no CSP issue.
// It can access jwplayer/videojs/XHR/fetch directly.
//
// Strategy: instead of relaying the FIRST URL that looks like a video (which is
// often a low-quality variant, an ad/analytics beacon, or a URL that 403s), we
// collect every candidate, score them, and within a short window send the best
// one back to VideoPlayer.jsx — together with the embed page URL (Referer).
//
// Best candidate → parent.postMessage({ type, url, referer }) → VideoPlayer.jsx

(function () {
  // Only act when inside an iframe
  if (self === top) return; // NOSONAR(javascript:S3403)

  let _locked = false;       // a URL has been sent — stop considering further candidates
  let _best = null;
  let _bestScore = -1;
  let _flushTimer = null;
  const FLUSH_WINDOW = 350;  // ms to wait for a higher-quality candidate before sending

  function isVideoUrl(url) {
    if (!url || typeof url !== 'string') return false;
    if (/\.(m3u8|mp4|webm|ts)(\?|$)/i.test(url)) return true;
    if (/\/hls\//i.test(url)) return true;
    if (/[?&](type=hls|format=hls|manifest=m3u8)/i.test(url)) return true;
    if (/\/(manifest|playlist|index)(\.m3u8)?(\?|$)/i.test(url)) return true;
    return false;
  }

  // Reject obvious non-content URLs (subtitles, thumbnail sprites, storyboards).
  function isJunk(url) {
    if (/\.(vtt|srt|jpg|jpeg|png|gif|webp)(\?|$)/i.test(url)) return true;
    if (/(thumbnails?|sprite|storyboard)/i.test(url)) return true;
    return false;
  }

  // Higher = more likely to be the real, highest-quality stream.
  function scoreUrl(url) {
    if (isJunk(url)) return -1;
    if (/\.m3u8(\?|$)/i.test(url)) return /(master|playlist|index)\.m3u8/i.test(url) ? 100 : 90;
    if (/\.mp4(\?|$)/i.test(url)) return 70;
    if (/\.webm(\?|$)/i.test(url)) return 60;
    if (/\/hls\//i.test(url) || /[?&](type=hls|format=hls|manifest=m3u8)/i.test(url)) return 50;
    if (/\.ts(\?|$)/i.test(url)) return 20;
    return 10;
  }

  function normalize(url) {
    if (!url || typeof url !== 'string') return null;
    if (url.startsWith('/') && !url.startsWith('//')) return location.origin + url;
    if (url.startsWith('//')) return location.protocol + url;
    return url;
  }

  function flush() {
    clearTimeout(_flushTimer);
    _flushTimer = null;
    if (_locked || !_best) return;
    _locked = true;
    parent.postMessage(
      { type: 'ANIME_EXT_VIDEO_URL', url: _best, referer: location.href }, // NOSONAR(javascript:S2819)
      '*'
    );
  }

  // Consider a candidate URL: keep the best-scoring one seen within a short window,
  // then send it. A master playlist (or any .m3u8) is sent promptly; weaker
  // candidates (mp4/ts) wait briefly in case a better stream shows up.
  function consider(raw) {
    if (_locked) return;
    const url = normalize(raw);
    if (!url || !isVideoUrl(url)) return;
    const s = scoreUrl(url);
    if (s < 0) return;
    if (s > _bestScore) { _best = url; _bestScore = s; }
    if (s >= 90) { flush(); return; }
    if (!_flushTimer) _flushTimer = setTimeout(flush, FLUSH_WINDOW);
  }

  // ── Strategy 1: XHR interception ─────────────────────────
  const origXHROpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    if (typeof url === 'string') consider(url);
    return origXHROpen.apply(this, arguments);
  };

  // ── Strategy 2: fetch interception ───────────────────────
  const origFetch = globalThis.fetch;
  globalThis.fetch = function (resource) {
    const url = typeof resource === 'string' ? resource : resource?.url;
    if (url) consider(url);
    return origFetch.apply(this, arguments);
  };

  // ── Strategy 3: JWPlayer setup hook ──────────────────────
  // Extracts playlist URL from the jwplayer config at call time —
  // more reliable than XHR interception (fires before HLS requests).

  function extractFromConfig(config) {
    if (!config) return;
    if (config.file) consider(config.file);
    const rawPlaylist = config.playlist;
    let playlist;
    if (Array.isArray(rawPlaylist)) playlist = rawPlaylist;
    else if (rawPlaylist) playlist = [rawPlaylist];
    else playlist = [];
    for (const item of playlist) {
      if (item?.file) consider(item.file);
      for (const src of (item?.sources || [])) {
        if (src?.file) consider(src.file);
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
        if (src && !src.startsWith('blob:')) { consider(src); return true; }
        const srcs = p.currentSources?.();
        if (srcs?.[0]?.src) { consider(srcs[0].src); return true; }
      }
    } catch (e) { console.debug('[anime-ext] VideoJS error', e); }
    return false;
  }

  // ── Strategy 5: video element src property ───────────────
  function tryVideoElement() {
    const video = document.querySelector('video');
    if (video) {
      const src = video.currentSrc || video.src;
      if (src && !src.startsWith('blob:')) { consider(src); return true; }
    }
    const source = document.querySelector('video source[src]');
    if (source?.src) { consider(source.src); return true; }
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
      if (url) { consider(url); return true; }
    } catch (e) { console.debug('[anime-ext] JWPlayer error', e); }
    return false;
  }

  function tryStatic() {
    // Run all static probes (each feeds the scorer) and report whether any matched.
    const a = tryJWPlayer();
    const b = tryVideoJS();
    const c = tryVideoElement();
    return a || b || c;
  }

  // ── Strategy 7: force video.load() for preload:none ──────
  function forceLoadAndListen() {
    const video = document.querySelector('video');
    if (!video) return;
    video.muted = true;
    video.addEventListener('loadstart', () => {
      const src = video.currentSrc || video.src;
      if (src && !src.startsWith('blob:')) consider(src);
    }, { once: true });
    try { video.load(); } catch (e) { console.debug('[anime-ext] video.load error', e); }
  }

  // Probe immediately, then a couple more times for players that mount late.
  // XHR/fetch hooks keep feeding the scorer in the meantime.
  tryStatic();
  forceLoadAndListen();
  setTimeout(() => { if (!_locked) tryStatic(); }, 1500);
  setTimeout(() => { if (!_locked) tryStatic(); }, 4500);
})();
