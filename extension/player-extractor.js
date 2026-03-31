// player-extractor.js
// Runs inside third-party video embed iframes (all_frames: true).
// Extracts the direct video URL from the page's JS player and posts it to
// the parent frame (VideoPlayer.jsx), which then plays it with the custom player.
//
// Two extraction strategies:
//   1. Static: read jwplayer / videojs configuration after init
//   2. Dynamic: intercept XHR / fetch requests for video files (catches players
//      that load the URL asynchronously, e.g. sibnet, wasm-obfuscated players)

(function () {
  // Only act when inside an iframe (self/top are page globals, unambiguous in content scripts)
  if (self === top) return; // NOSONAR(javascript:S3403)

  function injectPageScript() {
    const script = document.createElement('script');
    script.textContent = `(function () {
      var _sent = false;
      function send(url) {
        if (_sent || !url) return;
        // Resolve relative URLs to absolute
        if (url.startsWith('/')) url = location.origin + url;
        else if (url.startsWith('//')) url = location.protocol + url;
        // Only relay direct video file URLs, not embed page URLs
        if (!/\\.(m3u8|mp4|webm)(\\?|$)/i.test(url)) return;
        _sent = true;
        window.postMessage({ __animeExtUrl: url }, '*');
      }

      // ── Strategy 1: XHR interception ──────────────────────────────────────
      // Catches players that fetch the video URL dynamically (sibnet, etc.)
      (function patchXHR() {
        var orig = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url) {
          if (typeof url === 'string') send(url);
          return orig.apply(this, arguments);
        };
      })();

      // ── Strategy 2: fetch interception ────────────────────────────────────
      (function patchFetch() {
        var orig = window.fetch;
        window.fetch = function (resource) {
          var url = typeof resource === 'string' ? resource : (resource && resource.url);
          if (url) send(url);
          return orig.apply(this, arguments);
        };
      })();

      // ── Strategy 3: JWPlayer static config ────────────────────────────────
      function tryJWPlayer() {
        if (typeof jwplayer === 'undefined') return false;
        try {
          var p = jwplayer();
          if (!p || typeof p.getPlaylist !== 'function') return false;
          var playlist = p.getPlaylist();
          if (!playlist || !playlist[0]) return false;
          var sources = playlist[0].sources || [];
          var m3u8 = sources.find(function(s){ return s.file && /\\.m3u8/.test(s.file); });
          var mp4  = sources.find(function(s){ return s.file && /\\.mp4/.test(s.file); });
          var url  = (m3u8 || mp4 || sources[0] || {}).file;
          if (url) { send(url); return true; }
        } catch(e) {}
        return false;
      }

      // ── Strategy 4: VideoJS static config ─────────────────────────────────
      function tryVideoJS() {
        if (typeof videojs === 'undefined') return false;
        try {
          var players = Object.values(videojs.getPlayers() || {});
          for (var i = 0; i < players.length; i++) {
            var p = players[i];
            if (!p) continue;
            // currentSrc() — available after load starts
            var src = p.currentSrc && p.currentSrc();
            if (src && !/^blob:/.test(src)) { send(src); return true; }
            // currentSources() — available immediately after player.src() call
            var srcs = p.currentSources && p.currentSources();
            if (srcs && srcs[0] && srcs[0].src) { send(srcs[0].src); return true; }
          }
        } catch(e) {}
        return false;
      }

      // ── Strategy 5: video element src / currentSrc property ───────────────
      function tryVideoElement() {
        var video = document.querySelector('video');
        if (video) {
          var src = video.currentSrc || video.src;
          if (src && !/^blob:/.test(src)) { send(src); return true; }
        }
        var source = document.querySelector('video source[src]');
        if (source && source.src) { send(source.src); return true; }
        return false;
      }

      function tryStatic() {
        return tryJWPlayer() || tryVideoJS() || tryVideoElement();
      }

      // ── Strategy 6: force video.load() to resolve preload:none players ────
      // (VideoJS with preload:none only sets src on the <video> element after load)
      function forceLoadAndListen() {
        var video = document.querySelector('video');
        if (!video) return;
        video.muted = true;
        video.addEventListener('loadstart', function () {
          var src = video.currentSrc || video.src;
          if (src && !/^blob:/.test(src)) send(src);
        }, { once: true });
        try { video.load(); } catch(e) {}
      }

      // Try static strategies after player init (XHR/fetch interception is already active)
      if (!tryStatic()) {
        forceLoadAndListen();
        setTimeout(function(){ if (!tryStatic()) setTimeout(tryStatic, 3000); }, 1500);
      }
    })();`;
    (document.head || document.documentElement).appendChild(script);
    script.remove();

    // Relay the result from the page's JS context back to our parent frame
    // Only accept messages from the same origin as this iframe (our injected script)
    globalThis.addEventListener('message', function (e) {
      if (e.origin !== location.origin) return;
      if (e.data?.__animeExtUrl) {
        // NOSONAR(javascript:S2819): parent origin is unknown in a cross-origin iframe
        globalThis.parent.postMessage(
          { type: 'ANIME_EXT_VIDEO_URL', url: e.data.__animeExtUrl },
          '*'
        );
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectPageScript);
  } else {
    injectPageScript();
  }
})();
