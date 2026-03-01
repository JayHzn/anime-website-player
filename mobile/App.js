import { registerRootComponent } from "expo";
import React, { useRef, useCallback } from "react";
import { SafeAreaView, StatusBar, StyleSheet, BackHandler } from "react-native";
import { WebView } from "react-native-webview";
import * as ScreenOrientation from "expo-screen-orientation";
import { BRIDGE_SCRIPT } from "./bridge";
import { VoiranimeSource } from "./sources/voiranime";
import { VoirdramaSource } from "./sources/voirdrama";

// ── Sources (same as extension/background.js) ───────────────
const sources = {
  voiranime: new VoiranimeSource(),
  voirdrama: new VoirdramaSource(),
};

// ── Search cache (same as extension/background.js) ──────────
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
  searchCache.set(getSearchCacheKey(source, query), {
    results: [...results],
    at: Date.now(),
  });
}

// ── Image proxy (same as extension/background.js) ───────────
async function proxyImageToDataUrl(url, referer) {
  if (!url) return "";
  try {
    const headers = { Referer: referer || new URL(url).origin + "/" };
    const resp = await fetch(url, { headers });
    if (!resp.ok) return "";
    const buf = await resp.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    const contentType = resp.headers.get("content-type") || "image/jpeg";
    return `data:${contentType};base64,${btoa(binary)}`;
  } catch {
    return "";
  }
}

// ── Site URL ────────────────────────────────────────────────
const SITE_URL = "https://anime-website-player.onrender.com";

export default function App() {
  const webViewRef = useRef(null);

  // Send a message to the WebView (site)
  const sendToWebView = useCallback((data) => {
    if (!webViewRef.current) return;
    const json = JSON.stringify(data);
    webViewRef.current.injectJavaScript(
      `window.postMessage(${json}, '*'); true;`
    );
  }, []);

  // Send cover updates to the WebView (push, no request ID)
  const sendCoversUpdate = useCallback(
    (patches, sourceName) => {
      for (const p of patches) p.source = sourceName;
      sendToWebView({ type: "ANIME_EXT_COVERS_UPDATE", data: patches });
    },
    [sendToWebView]
  );

  // ── Action handler (mirrors extension/background.js) ─────
  const handleAction = useCallback(
    async (action, payload) => {
      if (action === "ping") {
        return { version: "1.0.0-mobile", sources: Object.keys(sources) };
      }

      const sourceName = payload?.source || "voiranime";
      const source = sources[sourceName];
      if (!source) throw new Error(`Source inconnue: ${sourceName}`);

      switch (action) {
        case "search": {
          const query = payload.query ?? "";
          const cached = getCachedSearch(sourceName, query);
          if (cached) {
            console.log(`[mobile] search cache HIT (${sourceName}:${query})`);
            return cached;
          }

          const results = await source.search(query);
          for (const r of results) r.source = sourceName;
          setSearchCache(sourceName, query, results);

          // Enrich covers in background
          if (source.enrichCoversAsync) {
            source.enrichCoversAsync([...results], (patches) => {
              sendCoversUpdate(patches, sourceName);
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
          if (source.enrichCoversAsync) {
            source.enrichCoversAsync([...latest], (patches) => {
              sendCoversUpdate(patches, sourceName);
            });
          }
          return latest;
        }
        case "retryCovers": {
          const items = payload.items || [];
          if (items.length === 0) return [];
          for (const r of items) r.source = r.source || sourceName;
          if (source.enrichCoversAsync) {
            source.enrichCoversAsync(items, (patches) => {
              sendCoversUpdate(patches, sourceName);
            });
          }
          return { status: "retrying", count: items.length };
        }
        case "getSeasonAnime": {
          const season = await source.getSeasonAnime();
          if (source.enrichCoversAsync) {
            source.enrichCoversAsync([...season], (patches) => {
              sendCoversUpdate(patches, sourceName);
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
    },
    [sendCoversUpdate]
  );

  // ── WebView message handler ───────────────────────────────
  const onMessage = useCallback(
    async (event) => {
      let msg;
      try {
        msg = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }

      if (msg.type !== "ANIME_EXT_REQUEST") return;

      const { id, action, payload } = msg;
      console.log(`[mobile] → ${action}`, payload);

      try {
        const result = await handleAction(action, payload);
        console.log(`[mobile] ← ${action} OK`);
        sendToWebView({
          type: "ANIME_EXT_RESPONSE",
          id,
          success: true,
          data: result,
        });
      } catch (err) {
        console.error(`[mobile] ← ${action} ERROR`, err.message);
        sendToWebView({
          type: "ANIME_EXT_RESPONSE",
          id,
          success: false,
          error: err.message,
        });
      }
    },
    [handleAction, sendToWebView]
  );

  // ── Intercept navigations — keep SPA routing client-side ──
  const handleNavigationRequest = useCallback((request) => {
    const url = request.url;
    // Allow initial page load
    if (url === SITE_URL || url === SITE_URL + "/") return true;
    // Allow static assets (JS chunks, CSS, images, etc.)
    if (url.startsWith(SITE_URL + "/assets/")) return true;
    // For SPA routes, prevent full-page reload — handle via React Router
    if (url.startsWith(SITE_URL)) {
      const path = url.replace(SITE_URL, "") || "/";
      webViewRef.current?.injectJavaScript(`
        if (window.location.pathname + window.location.search !== '${path}') {
          window.history.pushState({}, '', '${path}');
          window.dispatchEvent(new PopStateEvent('popstate'));
        }
        true;
      `);
      return false;
    }
    // Block external navigations (stay in the app)
    return false;
  }, []);

  // ── Auto-rotate on watch page ──────────────────────────────
  const isOnWatchPage = useRef(false);

  const onNavigationStateChange = useCallback((navState) => {
    const url = navState.url || "";
    const watching = url.includes("/watch/");

    if (watching && !isOnWatchPage.current) {
      isOnWatchPage.current = true;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.LANDSCAPE);
      StatusBar.setHidden(true);
    } else if (!watching && isOnWatchPage.current) {
      isOnWatchPage.current = false;
      ScreenOrientation.lockAsync(ScreenOrientation.OrientationLock.PORTRAIT_UP);
      StatusBar.setHidden(false);
    }
  }, []);

  // ── Android back button → WebView back ────────────────────
  const onAndroidBackPress = useCallback(() => {
    if (webViewRef.current) {
      webViewRef.current.goBack();
      return true; // prevent app exit
    }
    return false;
  }, []);

  React.useEffect(() => {
    const sub = BackHandler.addEventListener(
      "hardwareBackPress",
      onAndroidBackPress
    );
    return () => sub.remove();
  }, [onAndroidBackPress]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" translucent={false} />
      <WebView
        ref={webViewRef}
        source={{ uri: SITE_URL }}
        style={styles.webview}
        injectedJavaScript={BRIDGE_SCRIPT}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={handleNavigationRequest}
        javaScriptEnabled={true}
        domStorageEnabled={true}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback={true}
        mixedContentMode="compatibility"
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        userAgent="Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36"
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  webview: {
    flex: 1,
  },
});

registerRootComponent(App);
