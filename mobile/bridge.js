/**
 * Bridge script injected into the WebView.
 * Replaces extension/content.js — same protocol, different transport.
 *
 * Extension: window.postMessage ↔ chrome.runtime.sendMessage
 * Mobile:    window.postMessage ↔ window.ReactNativeWebView.postMessage
 */

export const BRIDGE_SCRIPT = `
(function() {
  // Prevent double-injection
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
  \`;
  document.head.appendChild(style);

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
