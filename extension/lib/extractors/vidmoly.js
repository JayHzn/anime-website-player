// VidMoly — jwplayer `sources: [{ file: "…m3u8" }]` inside an inline script.
// Modelled on Aniyomi's VidMolyExtractor.
//
// Like Aniyomi we retry on the canonical domain: anime-sama still hands out
// vidmoly.to links long after the host moved, and the embed id stays valid.

import { httpGetText } from '../http.js';
import { extractFromHls } from '../playlist-utils.js';
import { buildHeaders } from '../video.js';

const CANONICAL = 'https://vidmoly.biz';
const HOST_RE = /^https?:\/\/(?:www\.)?[^/]+\//;

const SOURCES_RE = /sources\s*:\s*(\[[\s\S]*?\])/;
const FILE_RE = /file\s*:\s*["']([^"']+)["']/g;

export const vidmoly = {
  name: 'VidMoly',
  host: 'vidmoly',
  match: (url) => /vidmoly|ansembed/i.test(url),

  async extract(url, { prefix = '' } = {}) {
    const candidates = [url];
    const canonical = url.replace(HOST_RE, `${CANONICAL}/`);
    if (canonical !== url) candidates.push(canonical);

    for (const candidate of candidates) {
      const referer = `${CANONICAL}/`;
      const html = await httpGetText(candidate, { referer, headers: buildHeaders(referer) });
      if (!html) continue;

      const sources = SOURCES_RE.exec(html)?.[1];
      if (!sources) continue;

      FILE_RE.lastIndex = 0;
      const files = [...sources.matchAll(FILE_RE)].map((m) => m[1]).filter(Boolean);
      if (files.length === 0) continue;

      const videos = (await Promise.all(files.map((file) =>
        extractFromHls(file, {
          referer,
          host: 'vidmoly',
          videoNameGen: (q) => `${prefix}VidMoly - ${q}`,
        }).catch(() => [])
      ))).flat();

      if (videos.length > 0) return videos;
    }
    return [];
  },
};
