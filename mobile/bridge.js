/**
 * Bridge script injected into the WebView.
 * Replaces extension/content.js — same protocol, different transport.
 *
 * Extension: window.postMessage ↔ chrome.runtime.sendMessage
 * Mobile:    window.postMessage ↔ window.ReactNativeWebView.postMessage
 */

// ── Video URL extractor — runs inside third-party embed iframes ──
// Mirrors extension/player-extractor.js but for React Native WebView.
// No isolated-world issue here (injected JS already runs in page context),
// so no <script> tag injection needed.
// Detected URL is sent to the parent frame which relays it to VideoPlayer.jsx.
const IFRAME_EXTRACTOR_SCRIPT = `
(function() {
  if (window.__ANIMEHUB_EXTRACTOR__) return;
  window.__ANIMEHUB_EXTRACTOR__ = true;

  var _sent = false;
  function send(url) {
    if (_sent || !url) return;
    // Resolve relative / protocol-relative URLs
    if (url.startsWith('/') && !url.startsWith('//')) url = location.origin + url;
    else if (url.startsWith('//')) url = location.protocol + url;
    // Only relay direct video file URLs
    if (!/\\.(m3u8|mp4|webm)(\\?|$)/i.test(url)) return;
    _sent = true;
    // Post to parent frame — VideoPlayer.jsx listens for this
    window.parent.postMessage({ type: 'ANIME_EXT_VIDEO_URL', url: url }, '*');
  }

  // ── XHR interception ──────────────────────────────────────
  var origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function(method, url) {
    if (typeof url === 'string') send(url);
    return origOpen.apply(this, arguments);
  };

  // ── Fetch interception ────────────────────────────────────
  var origFetch = window.fetch;
  window.fetch = function(resource) {
    var url = typeof resource === 'string' ? resource : (resource && resource.url);
    if (url) send(url);
    return origFetch.apply(this, arguments);
  };

  // ── JWPlayer static config ────────────────────────────────
  function tryJWPlayer() {
    if (typeof jwplayer === 'undefined') return false;
    try {
      var p = jwplayer();
      if (!p || typeof p.getPlaylist !== 'function') return false;
      var playlist = p.getPlaylist();
      if (!playlist || !playlist[0]) return false;
      var sources = playlist[0].sources || [];
      var m3u8 = sources.find(function(s) { return s.file && /\\.m3u8/.test(s.file); });
      var mp4  = sources.find(function(s) { return s.file && /\\.mp4/.test(s.file); });
      var url  = (m3u8 || mp4 || sources[0] || {}).file;
      if (url) { send(url); return true; }
    } catch(e) {}
    return false;
  }

  // ── VideoJS static config ─────────────────────────────────
  function tryVideoJS() {
    if (typeof videojs === 'undefined') return false;
    try {
      var players = Object.values(videojs.getPlayers() || {});
      for (var i = 0; i < players.length; i++) {
        var p = players[i];
        if (!p) continue;
        var src = p.currentSrc && p.currentSrc();
        if (src && !/^blob:/.test(src)) { send(src); return true; }
        var srcs = p.currentSources && p.currentSources();
        if (srcs && srcs[0] && srcs[0].src) { send(srcs[0].src); return true; }
      }
    } catch(e) {}
    return false;
  }

  // ── Video element src property ────────────────────────────
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

  // ── Force video.load() for preload:none players ───────────
  function forceLoadAndListen() {
    var video = document.querySelector('video');
    if (!video) return;
    video.muted = true;
    video.addEventListener('loadstart', function() {
      var src = video.currentSrc || video.src;
      if (src && !/^blob:/.test(src)) send(src);
    }, { once: true });
    try { video.load(); } catch(e) {}
  }

  if (!tryStatic()) {
    forceLoadAndListen();
    setTimeout(function() { if (!tryStatic()) setTimeout(tryStatic, 3000); }, 1500);
  }
})();
`;

export const BRIDGE_SCRIPT = `
(function() {
  // Branch: main frame runs the bridge, iframes run the video extractor
  var isMainFrame = window === window.top;

  if (!isMainFrame) {
    ${IFRAME_EXTRACTOR_SCRIPT.trim()}
    return;
  }

  // Prevent double-injection on the main frame
  if (window.__ANIMEHUB_BRIDGE__) return;
  window.__ANIMEHUB_BRIDGE__ = true;
  window.__ANIMEHUB_MOBILE__ = true;

  // Inject mobile-specific CSS
  var style = document.createElement('style');
  style.textContent = \`
    /* Navbar stays at top:0 but has internal padding for status bar */
    nav[class*="fixed"][class*="top-0"] {
      top: 0 !important;
      padding-top: env(safe-area-inset-top, 28px) !important;
      transition: transform 0.3s ease !important;
    }
    /* Page content offset for navbar + status bar */
    body {
      padding-top: env(safe-area-inset-top, 28px) !important;
    }
    /* Bottom safe area for gesture navigation */
    body {
      padding-bottom: env(safe-area-inset-bottom, 0px) !important;
    }
    /* Navbar hidden state — slides up completely including status bar area */
    nav.navbar-hidden {
      transform: translateY(-100%) !important;
    }
    /* Hide scrollbar — native app feel */
    ::-webkit-scrollbar { display: none !important; }
    * { scrollbar-width: none !important; }
    /* Disable pinch-to-zoom on the video player */
    video, .video-container, .video-overlay, [class*="player"], [class*="video"] {
      touch-action: manipulation !important;
    }
  \`;
  document.head.appendChild(style);

  // Disable zoom via viewport meta tag
  var viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) {
    viewport.setAttribute('content', viewport.content.replace(/user-scalable\\s*=\\s*\\w+/i, '') + ', user-scalable=no, maximum-scale=1.0');
  } else {
    viewport = document.createElement('meta');
    viewport.name = 'viewport';
    viewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no';
    document.head.appendChild(viewport);
  }

  // Auto-hide navbar on scroll (like YouTube)
  var lastScrollY = 0;
  var navbar = null;

  function getNavbar() {
    if (!navbar || !navbar.isConnected) {
      navbar = document.querySelector('nav[class*="fixed"][class*="top-0"]');
    }
    return navbar;
  }

  window.addEventListener('scroll', function() {
    var nav = getNavbar();
    if (!nav) return;

    var currentY = window.scrollY;
    if (currentY > lastScrollY && currentY > 60) {
      // Scrolling down — hide navbar
      nav.classList.add('navbar-hidden');
    } else {
      // Scrolling up — show navbar
      nav.classList.remove('navbar-hidden');
    }
    lastScrollY = currentY;
  }, { passive: true });

  // Listen for requests from the site (api.js sends ANIME_EXT_REQUEST)
  window.addEventListener('message', function(event) {
    if (event.source !== window) return;
    if (!event.data || event.data.type !== 'ANIME_EXT_REQUEST') return;

    // Forward to React Native
    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify(event.data));
    }
  });

  // Announce "extension" presence — site detects via ANIME_EXT_READY
  function announceReady() {
    window.postMessage({ type: 'ANIME_EXT_READY', version: '1.0.0-mobile' }, '*');
  }

  announceReady();
  setTimeout(announceReady, 500);
  setTimeout(announceReady, 2000);
})();
true; // Required for injectedJavaScript
`;
