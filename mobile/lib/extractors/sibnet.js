// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// Sibnet — `player.src([{ src: "/v/…/…mp4" }])`, relative to the sibnet origin.
// The CDN checks Referer on the file itself, so the Video carries it (see
// lib/http.js for how that header survives on each platform).

import { httpGetText } from '../http.js';
import { buildHeaders, createVideo } from '../video.js';

const SRC_RE = /player\.src\(\s*\[\s*\{\s*src\s*:\s*["']([^"']+)["']/i;

export const sibnet = {
  name: 'Sibnet',
  host: 'sibnet',
  match: (url) => /sibnet\.ru/i.test(url),

  async extract(url, { prefix = '' } = {}) {
    const referer = url;
    const html = await httpGetText(url, { referer, headers: buildHeaders(referer) });
    if (!html) return [];

    const src = SRC_RE.exec(html)?.[1];
    if (!src) return [];

    return [createVideo({
      url: new URL(src, 'https://video.sibnet.ru').href,
      quality: `${prefix}Sibnet - mp4`,
      host: 'sibnet',
      referer,
      headers: buildHeaders(referer),
    })];
  },
};
