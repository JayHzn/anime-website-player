// Content script: relays messages between the web page and the extension background
// Injected into the Shinani website

// Returns true if our (old) content script's link to the (potentially-reloaded)
// extension is still valid. After an extension reload, chrome.runtime.id is undefined
// and any chrome.runtime.* call throws "Extension context invalidated".
function isExtensionAlive() {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

// Wraps a chrome.runtime.* call so it never throws — returns null on invalidated context.
function safeCall(fn) {
  if (!isExtensionAlive()) return null;
  try {
    return fn();
  } catch (e) {
    // Extension was reloaded mid-call. Page needs a refresh; surface a hint exactly once.
    if (!globalThis.__ANIMEHUB_EXT_DEAD__) {
      globalThis.__ANIMEHUB_EXT_DEAD__ = true;
      console.warn('[Shinani] Extension reloaded — refresh the page to reconnect.', e);
    }
    return null;
  }
}

// Announce extension presence — repeat to ensure the site catches it
function announceReady() {
  window.postMessage({ type: "ANIME_EXT_READY", version: "1.0.0" }, "*");
}

announceReady();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", announceReady);
}
window.addEventListener("load", announceReady);
setTimeout(announceReady, 500);
setTimeout(announceReady, 2000);

// Keep the background service worker alive (MV3 workers get killed after ~30s idle).
// Stop the interval if the extension context is invalidated.
const keepaliveTimer = setInterval(() => {
  if (!isExtensionAlive()) { clearInterval(keepaliveTimer); return; }
  safeCall(() => chrome.runtime.sendMessage({ action: 'keepalive' }, () => {
    if (chrome.runtime.lastError) { /* suppress "port closed" warning */ }
  }));
}, 25000);

// Relay background -> page messages (cover updates). Wrapped so a stale listener
// from a previously-reloaded extension doesn't blow up the page.
if (isExtensionAlive()) {
  try {
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === "ANIME_EXT_COVERS_UPDATE") {
        window.postMessage({
          type: "ANIME_EXT_COVERS_UPDATE",
          data: message.data,
        }, "*");
      }
    });
  } catch (e) {
    console.debug('[Shinani] onMessage listener attach failed:', e);
  }
}

// Relay requests from page -> background service worker
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "ANIME_EXT_REQUEST") return;

  const { id, action, payload } = event.data;

  // If the extension has been reloaded, fail fast with a clear message instead of throwing.
  if (!isExtensionAlive()) {
    window.postMessage(
      {
        type: "ANIME_EXT_RESPONSE",
        id,
        success: false,
        error: "Extension rechargée — rafraîchissez la page pour reconnecter.",
      },
      "*"
    );
    return;
  }

  const sent = safeCall(() => chrome.runtime.sendMessage({ action, payload }, (response) => {
    if (chrome.runtime.lastError) {
      window.postMessage(
        {
          type: "ANIME_EXT_RESPONSE",
          id,
          success: false,
          error: chrome.runtime.lastError.message,
        },
        "*"
      );
      return;
    }

    window.postMessage(
      {
        type: "ANIME_EXT_RESPONSE",
        id,
        success: !response?.error,
        data: response?.error ? undefined : response,
        error: response?.error || undefined,
      },
      "*"
    );
  }));

  if (sent === null) {
    window.postMessage(
      {
        type: "ANIME_EXT_RESPONSE",
        id,
        success: false,
        error: "Extension rechargée — rafraîchissez la page pour reconnecter.",
      },
      "*"
    );
  }
});
