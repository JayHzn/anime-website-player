// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// ── Playlist utils ───────────────────────────────────────────
// Port of Aniyomi's PlaylistUtils (lib/playlistutils/.../PlaylistUtils.kt).
//
// A host almost never gives you "the video URL" — it gives you an HLS *master*
// playlist that lists one variant per quality, plus subtitle and audio renditions.
// Aniyomi expands that into one `Video` per variant so the user can pick a
// quality; we do the same, which also means a failing variant can fall back to a
// lower one instead of killing the whole episode.

import { httpGetText } from './http.js';
import {
  buildHeaders, createVideo, formatBandwidth, standardQuality,
} from './video.js';

const PLAYLIST_SEPARATOR = '#EXT-X-STREAM-INF:';

const SUBTITLE_RE = /#EXT-X-MEDIA:TYPE=SUBTITLES.*?NAME="(.*?)".*?URI="(.*?)"/g;
const AUDIO_RE = /#EXT-X-MEDIA:TYPE=AUDIO.*?NAME="(.*?)".*?URI="(.*?)"/g;
const CODECS_RE = /CODECS="([^"]+)"/;
const RESOLUTION_RE = /RESOLUTION=(\d+)[xX](\d+)/;
const BANDWIDTH_RE = /BANDWIDTH=(\d+)/;

/** Resolve a possibly-relative playlist URI against the playlist it came from. */
export function fixUrl(url, baseUrl) {
  if (!url) return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  try {
    return new URL(trimmed, baseUrl).href;
  } catch {
    return null;
  }
}

/**
 * Parse an already-fetched master playlist. Split out from extractFromHls so it
 * can be unit-tested without touching the network.
 *
 * @param {string} masterPlaylist raw .m3u8 text
 * @param {string} playlistUrl    the URL it was fetched from (for relative URIs)
 * @param {object} [opts]
 * @returns {Array} Videos, highest bandwidth first
 */
export function parseMasterPlaylist(masterPlaylist, playlistUrl, opts = {}) {
  const {
    referer = null,
    headers = {},
    host = null,
    videoNameGen = (quality) => quality,
    subtitles: extraSubtitles = [],
    audio: extraAudio = [],
  } = opts;

  const base = { headers, referer, host };

  // Single-variant playlist: nothing to expand, hand it over as-is.
  if (!masterPlaylist.includes(PLAYLIST_SEPARATOR)) {
    return [createVideo({
      ...base,
      url: playlistUrl,
      quality: videoNameGen('Auto'),
      subtitles: extraSubtitles,
      audio: extraAudio,
    })];
  }

  const collectTracks = (re) => {
    const out = [];
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(masterPlaylist)) !== null) {
      const url = fixUrl(m[2], playlistUrl);
      if (url) out.push({ url, lang: m[1] });
    }
    return out;
  };

  const subtitles = [...extraSubtitles, ...collectTracks(SUBTITLE_RE)];
  const audio = [...extraAudio, ...collectTracks(AUDIO_RE)];

  const streams = masterPlaylist.split(PLAYLIST_SEPARATOR).slice(1);
  const videos = [];

  for (const stream of streams) {
    // Audio-only renditions also carry a #EXT-X-STREAM-INF line — skip them,
    // they'd show up as a bogus "quality" with no picture.
    const codecs = CODECS_RE.exec(stream)?.[1];
    if (codecs && codecs.split(',').every((c) => c.trim().startsWith('mp4a'))) continue;

    const url = fixUrl(stream.split('\n').slice(1).find((l) => l.trim() && !l.startsWith('#')), playlistUrl);
    if (!url) continue;

    const resMatch = RESOLUTION_RE.exec(stream);
    const width = resMatch ? Number.parseInt(resMatch[1], 10) : null;
    const height = resMatch ? Number.parseInt(resMatch[2], 10) : null;
    const bandwidth = Number.parseInt(BANDWIDTH_RE.exec(stream)?.[1] ?? '', 10);

    const label = [
      height ? `${standardQuality(height)} (${width}x${height})` : null,
      formatBandwidth(bandwidth),
    ].filter(Boolean).join(' - ') || 'Video';

    videos.push(createVideo({
      ...base,
      url,
      quality: videoNameGen(label),
      resolution: height,
      bandwidth: Number.isFinite(bandwidth) ? bandwidth : null,
      subtitles,
      audio,
    }));
  }

  return videos.sort((a, b) => (b.bandwidth ?? 0) - (a.bandwidth ?? 0));
}

/**
 * Fetch an HLS playlist and expand it into one Video per quality variant.
 *
 * @param {string} playlistUrl
 * @param {object} [opts]
 * @param {string} [opts.referer]     defaults to the playlist's own origin
 * @param {object} [opts.headers]     extra headers merged into every Video
 * @param {string} [opts.host]        host key, carried onto each Video
 * @param {function} [opts.videoNameGen] quality label → display label
 * @param {Array} [opts.subtitles]    tracks to append to the ones in the playlist
 * @param {Array} [opts.audio]
 * @returns {Promise<Array>} Videos (empty if the playlist couldn't be fetched)
 */
export async function extractFromHls(playlistUrl, opts = {}) {
  let referer = opts.referer;
  if (referer === undefined) {
    try {
      referer = `${new URL(playlistUrl).origin}/`;
    } catch {
      referer = null;
    }
  }

  const headers = buildHeaders(referer, opts.headers);
  const text = await httpGetText(playlistUrl, { referer, headers, timeout: opts.timeout ?? 8000 });

  // Couldn't read the master (CORS, 403, timeout). The URL itself is still very
  // likely playable — hls.js will fetch it again from the page context — so hand
  // back a single Auto entry rather than losing the source entirely.
  if (!text) {
    return [createVideo({
      url: playlistUrl,
      quality: (opts.videoNameGen ?? ((q) => q))('Auto'),
      host: opts.host ?? null,
      headers,
      referer,
      subtitles: opts.subtitles ?? [],
      audio: opts.audio ?? [],
    })];
  }

  return parseMasterPlaylist(text, playlistUrl, { ...opts, referer, headers });
}
