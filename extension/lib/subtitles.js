// ── Subtitle tracks ──────────────────────────────────────────
// Port of PlaylistUtils.fixSubtitles / toWebVtt.
//
// Aniyomi downloads each subtitle, normalises it and writes it to a temp file
// before handing the player a file:// URI. We need that indirection even more
// than it does: a cross-origin <track> is blocked outright by the browser, so a
// subtitle URL straight from the host would never load. Fetching it here (where
// host permissions apply, and CORS doesn't) and inlining it as a data: URL is
// what makes subtitles work at all in the page.
//
// The normalisation is the same fix Aniyomi makes: several hosts serve SubRip
// content from a .vtt URL, which a strict parser refuses.

import { utf8ToBase64 } from './base64.js';
import { httpGet } from './http.js';

const SRT_TIMECODE_RE =
  /((?:\d{1,3}:)?\d{1,3}:\d{2})[,.](\d{1,3})[ \t]*-->[ \t]*((?:\d{1,3}:)?\d{1,3}:\d{2})[,.](\d{1,3})/g;
const SRT_CUE_INDEX_RE = /^\d+[ \t]*\r?\n(?=(?:\d{1,3}:)?\d{1,3}:\d{2}\.\d{1,3}[ \t]*-->)/gm;

/**
 * Convert SubRip to WebVTT, leaving anything else (real WebVTT, ASS/SSA) alone.
 * WebVTT needs the header and a dot as the decimal separator; SubRip's numeric
 * cue indexes are dropped because a WebVTT cue identifier is optional.
 */
export function toWebVtt(data) {
  const text = data.replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n').trimStart();
  SRT_TIMECODE_RE.lastIndex = 0;
  if (text.startsWith('WEBVTT') || !SRT_TIMECODE_RE.test(text)) return text;

  SRT_TIMECODE_RE.lastIndex = 0;
  const cues = text.replace(SRT_TIMECODE_RE, '$1.$2 --> $3.$4');
  return `WEBVTT\n\n${cues.replace(SRT_CUE_INDEX_RE, '')}`;
}

// Subtitles are small (tens of KB); anything larger is not a subtitle file and
// would only bloat the message we post back to the page.
const MAX_SUBTITLE_BYTES = 2 * 1024 * 1024;

function toDataUrl(vtt) {
  return `data:text/vtt;base64,${utf8ToBase64(vtt)}`;
}

/**
 * Download, normalise and inline a list of `{ url, lang }` tracks.
 * Tracks that fail to download are dropped rather than failing the episode.
 *
 * @returns {Promise<Array<{url: string, lang: string}>>} url is a data: URL
 */
export async function fixSubtitles(tracks, opts = {}) {
  if (!Array.isArray(tracks) || tracks.length === 0) return [];

  const results = await Promise.all(tracks.map(async (track) => {
    try {
      const res = await httpGet(track.url, { referer: opts.referer, timeout: 6000 });
      if (!res.ok) return null;
      const text = await res.text();
      if (!text || text.length > MAX_SUBTITLE_BYTES) return null;
      return { url: toDataUrl(toWebVtt(text)), lang: track.lang || 'Subtitle' };
    } catch {
      return null;
    }
  }));

  return results.filter(Boolean);
}
