// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// ── Video model ──────────────────────────────────────────────
// Inspired by Aniyomi's `Video` (source-api/.../animesource/model/Video.kt).
//
// A Video is ONE resolved, playable stream: the URL plus everything the player
// needs to actually play it (headers, tracks, quality metadata). The key idea we
// borrow from Aniyomi: an embed doesn't resolve to "a URL", it resolves to a
// LIST of Videos — one per quality variant of an HLS master playlist — and the
// player picks (or lets the user pick) among them instead of guessing.

export const STANDARD_QUALITIES = [144, 240, 360, 480, 720, 1080, 1440, 2160];

/** Snap an arbitrary pixel height to the nearest standard quality label. */
export function standardQuality(height) {
  const h = typeof height === 'number' ? height : Number.parseInt(height, 10);
  if (!Number.isFinite(h)) return null;
  let best = STANDARD_QUALITIES[0];
  for (const q of STANDARD_QUALITIES) {
    if (Math.abs(q - h) < Math.abs(best - h)) best = q;
  }
  return `${best}p`;
}

/** Human-readable bandwidth, e.g. 2150000 → "2.15 Mbps". */
export function formatBandwidth(bps) {
  if (!Number.isFinite(bps) || bps <= 0) return null;
  if (bps >= 1_000_000) return `${(bps / 1_000_000).toFixed(2)} Mbps`;
  return `${Math.round(bps / 1000)} kbps`;
}

/**
 * Build the header set a host expects when serving its stream.
 * Mirrors PlaylistUtils.generateMasterHeaders: Referer + matching Origin.
 */
export function buildHeaders(referer, extra = {}) {
  const headers = { Accept: '*/*', ...extra };
  if (referer) {
    headers.Referer = referer;
    try {
      headers.Origin = new URL(referer).origin;
    } catch { /* referer isn't a full URL — skip Origin */ }
  }
  return headers;
}

/**
 * @param {object} v
 * @param {string} v.url        direct, playable URL (m3u8 / mp4 / webm)
 * @param {string} v.quality    display label, e.g. "VidMoly - 1080p (1920x1080)"
 * @param {string} [v.host]     host key from the extractor registry ("vidmoly", …)
 * @param {object} [v.headers]  headers required to fetch url (Referer/Origin/UA)
 * @param {string} [v.referer]  page the stream was extracted from
 * @param {number} [v.resolution] pixel height, used for sorting
 * @param {number} [v.bandwidth]  bits/s from the master playlist, used for sorting
 * @param {Array}  [v.subtitles]  [{ url, lang }]
 * @param {Array}  [v.audio]      [{ url, lang }]
 */
export function createVideo({
  url,
  quality = 'Video',
  host = null,
  headers = {},
  referer = null,
  resolution = null,
  bandwidth = null,
  subtitles = [],
  audio = [],
}) {
  return {
    url,
    quality,
    host,
    headers,
    referer,
    resolution,
    bandwidth,
    subtitles,
    audio,
  };
}

/** True when the URL points at media we can hand straight to the player. */
export function isDirectUrl(url) {
  if (!url || typeof url !== 'string') return false;
  return /\.(m3u8|mp4|webm|mpd)(\?|$)/i.test(url);
}

/**
 * Drop duplicates. Aniyomi dedupes on `videoTitle to videoUrl.substringBefore("?")`
 * — the query string often carries a per-request token, so two entries that differ
 * only there are the same stream.
 */
export function dedupeVideos(videos) {
  const seen = new Set();
  const out = [];
  for (const v of videos) {
    if (!v?.url) continue;
    const key = `${v.quality}|${v.url.split('?')[0]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

/**
 * Order videos the way the user wants to watch them — Aniyomi's `sortVideos()`.
 * Ranked by, in order: preferred host, then closeness to the preferred quality
 * (never upgrading past it), then raw bandwidth as the tie-break.
 *
 * @param {Array}  videos
 * @param {object} [prefs]
 * @param {number} [prefs.quality=1080] preferred pixel height
 * @param {string[]} [prefs.hosts]      host keys, best first
 */
export function sortVideos(videos, prefs = {}) {
  const target = prefs.quality ?? 1080;
  const hosts = prefs.hosts ?? [];

  const hostRank = (v) => {
    const i = hosts.indexOf(v.host);
    return i === -1 ? hosts.length : i;
  };

  // Prefer the highest quality that does NOT exceed the target; if everything
  // exceeds it, take the smallest overshoot.
  const qualityRank = (v) => {
    const r = v.resolution;
    if (!Number.isFinite(r)) return Number.MAX_SAFE_INTEGER;
    return r <= target ? target - r : (target - r) * -10;
  };

  return [...videos].sort((a, b) =>
    hostRank(a) - hostRank(b) ||
    qualityRank(a) - qualityRank(b) ||
    (b.bandwidth ?? 0) - (a.bandwidth ?? 0)
  );
}
