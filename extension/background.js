import { VoiranimeSource } from "./sources/voiranime.js";

const sources = {
  voiranime: new VoiranimeSource(),
};

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

async function handleAction(action, payload, sender) {
  if (action === "ping") {
    return { version: "1.0.0", sources: Object.keys(sources) };
  }

  const sourceName = payload?.source || "voiranime";
  const source = sources[sourceName];
  if (!source) {
    throw new Error(`Source inconnue: ${sourceName}`);
  }

  switch (action) {
    case "search": {
      const results = await source.search(payload.query);
      for (const r of results) r.source = sourceName;

      // Enrich covers in background — send update via content script
      if (sender?.tab?.id) {
        const tabId = sender.tab.id;
        source.enrichCoversAsync(results, (updated) => {
          for (const r of updated) r.source = sourceName;
          chrome.tabs.sendMessage(tabId, {
            type: "ANIME_EXT_COVERS_UPDATE",
            data: updated,
          }).catch(() => {});
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
    case "getVideoUrl":
      return await source.getVideoUrl(payload.episodeId);
    default:
      throw new Error(`Action inconnue: ${action}`);
  }
}
