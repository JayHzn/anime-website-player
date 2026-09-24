// Sibnet — `player.src([{ src: "/v/…/…mp4" }])`, relative to the sibnet origin.
// The CDN checks Referer on the file itself, so the Video carries it (see
// lib/http.js for how that header survives on each platform).

import { httpGetText } from '../http.js';
import { fixUrl } from '../playlist-utils.js';
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

    // The src is a site-relative path ("/v/…/…mp4"), resolved against the embed
    // page so a mirror domain keeps working.
    const videoUrl = fixUrl(src, url) ?? fixUrl(src, 'https://video.sibnet.ru/');
    if (!videoUrl) return [];

    return [createVideo({
      url: videoUrl,
      quality: `${prefix}Sibnet - mp4`,
      host: 'sibnet',
      referer,
      headers: buildHeaders(referer),
    })];
  },
};
