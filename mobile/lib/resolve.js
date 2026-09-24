// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// ── Episode → playable response ──────────────────────────────
// The single place that turns "the embeds this episode has" into the object the
// player consumes. Every source calls this instead of rolling its own
// resolve-then-guess logic.
//
// Shape kept backward-compatible with what VideoPlayer already reads
// (`type` / `url` / `referer` / `headers` / `sources`); `videos` is the new
// Aniyomi-style list — every playable variant, sorted, with its own headers.

import { resolveEmbeds } from './extractors/index.js';
import { ensureRefererRule, IS_EXTENSION } from './http.js';
import { fixSubtitles } from './subtitles.js';

// How many resolved variants get a playback Referer rule installed up front.
// Covers the default pick plus the first couple of fallbacks without flooding
// the session rule table.
const PREWARM_COUNT = 3;

/**
 * @param {Array<{name?: string, url: string}>} embeds  embed URLs for the episode
 * @param {object} [opts]
 * @param {string} [opts.referer]   referer for the iframe fallback (the site itself)
 * @param {number} [opts.quality=1080]
 * @param {string[]} [opts.hosts]
 * @param {(src) => string} [opts.prefix]
 */
export async function buildVideoResponse(embeds, opts = {}) {
  const list = (embeds || []).filter((e) => e?.url);
  if (list.length === 0) throw new Error('Aucune source vidéo pour cet épisode.');

  const { videos, unresolved } = await resolveEmbeds(list, opts);

  // Fallback: nothing resolved server-side. Hand the embeds to the player, which
  // loads them in hidden iframes and hooks the host's own player — the same role
  // Aniyomi's WebView-based UniversalExtractor plays, as a last resort.
  if (videos.length === 0) {
    return {
      type: 'iframe',
      url: list[0].url,
      sourceUrl: list[0].url,
      referer: opts.referer ?? list[0].url,
      headers: opts.referer ? { Referer: opts.referer } : {},
      videos: [],
      subtitles: [],
      sources: list,
    };
  }

  const best = videos[0];

  // Inlining is for a browser `<track>`, which can't load a cross-origin file
  // (see lib/subtitles.js). The app's native player reads the tracks embedded in
  // the HLS stream instead, so downloading them here would be wasted bandwidth.
  const inlineSubtitles = opts.inlineSubtitles ?? IS_EXTENSION;

  const [subtitles] = await Promise.all([
    inlineSubtitles
      ? fixSubtitles(best.subtitles, { referer: best.referer })
      : Promise.resolve(best.subtitles ?? []),
    // Make sure the segments hls.js is about to request carry the host's Referer.
    ...videos.slice(0, PREWARM_COUNT).map((v) => ensureRefererRule(v.url, v.referer)),
  ]);

  return {
    type: 'video',
    url: best.url,
    quality: best.quality,
    sourceUrl: best.referer,
    referer: best.referer,
    headers: best.headers,
    videos,
    subtitles,
    // Embeds that produced nothing stay available for the iframe fallback, so a
    // host we can't parse yet is still watchable.
    sources: unresolved.length > 0 ? unresolved : list,
  };
}
