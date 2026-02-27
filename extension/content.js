// Content script: relays messages between the web page and the extension background
// Injected into the AnimeHub website

// Announce extension presence — repeat to ensure the site catches it
function announceReady() {
  window.postMessage({ type: "ANIME_EXT_READY", version: "1.0.0" }, "*");
}

// Send immediately, on DOMContentLoaded, and on load
announceReady();
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", announceReady);
}
window.addEventListener("load", announceReady);
// Also re-announce after a short delay (React hydration)
setTimeout(announceReady, 500);
setTimeout(announceReady, 2000);

// Relay requests from page -> background service worker
window.addEventListener("message", (event) => {
  if (event.source !== window) return;
  if (event.data?.type !== "ANIME_EXT_REQUEST") return;

  const { id, action, payload } = event.data;

  chrome.runtime.sendMessage({ action, payload }, (response) => {
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
  });
});
