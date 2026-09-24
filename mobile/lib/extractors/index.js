// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// ── Extractor registry ───────────────────────────────────────
// The seam Aniyomi's sources use (see AnimeSama.getVideoList): a source scrapes
// the site down to a list of embed URLs, then hands each one to the extractor
// that knows that host. The source stays about the site; the host quirks stay in
// one place and are shared by every source that links to that host.
//
// Adding a host = adding a file here, and all four of our sources get it.

import { generic } from './generic.js';
import { packed } from './packed.js';
import { sendvid } from './sendvid.js';
import { sibnet } from './sibnet.js';
import { streamtape } from './streamtape.js';
import { vidmoly } from './vidmoly.js';
import { voe } from './voe.js';
import { dedupeVideos, sortVideos } from '../video.js';

// Order matters: first match wins, and `generic` matches everything.
export const EXTRACTORS = [sendvid, vidmoly, voe, streamtape, sibnet, packed, generic];

/**
 * Host preference, best first. Drives sortVideos() so the player's default pick
 * is the host that behaves best in a browser <video>/hls.js pipeline.
 */
export const DEFAULT_HOST_PRIORITY = [
  'sendvid',    // plain file, no JS, no token
  'vidmoly',    // clean HLS master with real quality variants
  'voe',        // HLS + mp4 + subtitles
  'filemoon',
  'vidhide',
  'streamwish',
  'lulustream',
  'streamtape',
  'uqload',
  'vudeo',
  'sibnet',
  'generic',
];

/** The extractor that claims `url` (never null — `generic` is the catch-all). */
export function findExtractor(url) {
  return EXTRACTORS.find((e) => {
    try {
      return e.match(url);
    } catch {
      return false;
    }
  }) ?? generic;
}

/**
 * Resolve ONE embed URL to playable Videos.
 * @returns {Promise<Array>} empty when the host couldn't be resolved server-side
 */
export async function extractVideos(embedUrl, ctx = {}) {
  if (!embedUrl) return [];
  const extractor = findExtractor(embedUrl);
  try {
    const videos = await extractor.extract(embedUrl, ctx);
    return Array.isArray(videos) ? videos.filter((v) => v?.url) : [];
  } catch (e) {
    console.warn(`[extractors] ${extractor.name} failed on ${embedUrl}:`, e.message);
    return [];
  }
}

/**
 * Resolve every embed of an episode, in parallel, and return one flat, sorted,
 * deduped list of Videos — Aniyomi's `getVideoList()` + `sortVideos()`.
 *
 * Embeds that resolve to nothing are reported back in `unresolved` so the caller
 * can hand them to the iframe fallback instead of dropping them.
 *
 * @param {Array<{name?: string, url: string}>} sources
 * @param {object} [opts]
 * @param {number} [opts.quality=1080]     preferred pixel height
 * @param {string[]} [opts.hosts]          host priority, best first
 * @param {(src) => string} [opts.prefix]  label prefix per source (e.g. "VOSTFR ")
 * @returns {Promise<{ videos: Array, unresolved: Array }>}
 */
export async function resolveEmbeds(sources, opts = {}) {
  const {
    quality = 1080,
    hosts = DEFAULT_HOST_PRIORITY,
    prefix = () => '',
  } = opts;

  const results = await Promise.all(
    sources.map(async (src) => ({
      src,
      videos: await extractVideos(src.url, { prefix: prefix(src) }),
    }))
  );

  const videos = sortVideos(
    dedupeVideos(results.flatMap((r) => r.videos)),
    { quality, hosts }
  );
  const unresolved = results.filter((r) => r.videos.length === 0).map((r) => r.src);

  return { videos, unresolved };
}
