// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// Generic extractor — last server-side attempt before falling back to the
// hidden-iframe player (our equivalent of Aniyomi's WebView UniversalExtractor).
//
// Fetch the embed, unpack any packed scripts, and scan the result for a media
// URL. Weaker than a dedicated extractor (it can pick up a trailer or a preview
// clip), so it runs only for hosts nothing else claims, and it never overrides a
// video a real extractor produced.

import { httpGetText } from '../http.js';
import { extractFromHls } from '../playlist-utils.js';
import { unpackIfNeeded } from '../unpacker.js';
import { buildHeaders, createVideo } from '../video.js';

const MEDIA_RE = /["'](https?:\/\/[^"'\s]+?\.(?:m3u8|mp4|webm)(?:\?[^"'\s]*)?)["']/gi;
const JUNK_RE = /(thumbnail|sprite|storyboard|preview|trailer|\/ads?\/)/i;

export const generic = {
  name: 'Generic',
  host: 'generic',
  match: () => true, // registry tries this only after every other extractor

  async extract(url, { prefix = '' } = {}) {
    const referer = `${new URL(url).origin}/`;
    const html = await httpGetText(url, { referer, headers: buildHeaders(referer) });
    if (!html) return [];

    const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
    const haystack = [html, ...scripts.map(unpackIfNeeded)].join('\n');

    MEDIA_RE.lastIndex = 0;
    const candidates = [...new Set([...haystack.matchAll(MEDIA_RE)].map((m) => m[1]))]
      .filter((u) => !JUNK_RE.test(u));
    if (candidates.length === 0) return [];

    // Prefer HLS: it carries the quality variants.
    const hls = candidates.find((u) => /\.m3u8/i.test(u));
    const hostName = new URL(url).hostname.replace(/^www\./, '');

    if (hls) {
      return extractFromHls(hls, {
        referer: url,
        host: 'generic',
        videoNameGen: (q) => `${prefix}${hostName} - ${q}`,
      }).catch(() => []);
    }

    return [createVideo({
      url: candidates[0],
      quality: `${prefix}${hostName} - mp4`,
      host: 'generic',
      referer: url,
      headers: buildHeaders(referer),
    })];
  },
};
