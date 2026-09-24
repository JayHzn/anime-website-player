// The "packed script" family — one extractor covering every host that hides its
// jwplayer config inside a Dean Edwards packed script.
//
// Aniyomi ships a separate extractor module per host (VidHideExtractor,
// FilemoonExtractor, StreamWishExtractor…), but they all do the same three
// things: GET the embed, unpack, read `file:` / `sources:`. One extractor with a
// host table covers them and keeps new hosts to a one-line change.

import { httpGetText } from '../http.js';
import { extractFromHls } from '../playlist-utils.js';
import { unpackIfNeeded } from '../unpacker.js';
import { buildHeaders, createVideo } from '../video.js';

// host key → display name. Matching is a substring test on the embed URL.
const HOSTS = {
  vidhide: 'VidHide',
  filemoon: 'Filemoon',
  lulustream: 'LuluStream',
  luluvid: 'LuluStream',
  lulucdn: 'LuluStream',
  earnvids: 'EarnVids',
  streamwish: 'StreamWish',
  smoothpre: 'VidHide',
  movearnpre: 'VidHide',
  minochinos: 'VidHide',
  morencius: 'VidHide',
  vidhidepre: 'VidHide',
  fitus: 'Fitus',
  uqload: 'Uqload',
  vudeo: 'Vudeo',
  sbfull: 'StreamSB',
  streamsb: 'StreamSB',
};

const FILE_RE = /(?:file|src)\s*:\s*["'](https?:\/\/[^"']+?\.(?:m3u8|mp4)[^"']*)["']/gi;
const SOURCES_ARRAY_RE = /sources\s*:\s*\[\s*\{?\s*(?:file|src)\s*:\s*["']([^"']+)["']/i;

function hostKeyFor(url) {
  const lower = url.toLowerCase();
  return Object.keys(HOSTS).find((key) => lower.includes(key)) ?? null;
}

export const packed = {
  name: 'Packed player',
  host: 'packed',
  match: (url) => hostKeyFor(url) !== null,

  async extract(url, { prefix = '' } = {}) {
    const key = hostKeyFor(url);
    const display = HOSTS[key] ?? 'Player';
    const referer = `${new URL(url).origin}/`;

    const html = await httpGetText(url, { referer, headers: buildHeaders(referer) });
    if (!html) return [];

    // Unpack every packed <script> on the page, then search the lot at once.
    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const haystack = [html, ...scripts.map(unpackIfNeeded)].join('\n');

    FILE_RE.lastIndex = 0;
    const urls = [...haystack.matchAll(FILE_RE)].map((m) => m[1]);
    const fallback = SOURCES_ARRAY_RE.exec(haystack)?.[1];
    if (fallback && !urls.includes(fallback)) urls.push(fallback);

    const unique = [...new Set(urls)];
    if (unique.length === 0) return [];

    const videos = [];
    for (const target of unique) {
      if (/\.m3u8/i.test(target)) {
        videos.push(...await extractFromHls(target, {
          referer: url,
          host: key,
          videoNameGen: (q) => `${prefix}${display} - ${q}`,
        }).catch(() => []));
      } else {
        videos.push(createVideo({
          url: target,
          quality: `${prefix}${display} - mp4`,
          host: key,
          referer: url,
          headers: buildHeaders(referer),
        }));
      }
    }
    return videos;
  },
};
