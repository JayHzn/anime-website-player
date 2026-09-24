// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// Sendvid — the stream URL sits in a plain <source id="video_source"> tag.
// Modelled on Aniyomi's SendvidExtractor.
//
// Worth extracting server-side even though it looks simple: sendvid sends
// X-Frame-Options, so the hidden-iframe path can never see it.

import { httpGetText } from '../http.js';
import { extractFromHls } from '../playlist-utils.js';
import { buildHeaders, createVideo } from '../video.js';

export const sendvid = {
  name: 'Sendvid',
  host: 'sendvid',
  match: (url) => /sendvid\.com/i.test(url),

  async extract(url, { prefix = '' } = {}) {
    const referer = `${new URL(url).origin}/`;
    const html = await httpGetText(url, { referer, headers: buildHeaders(referer) });
    if (!html) return [];

    const tag = /<source[^>]*\bid=["']video_source["'][^>]*>/i.exec(html)?.[0];
    const src = tag
      ? /\bsrc=["']([^"']+)["']/i.exec(tag)?.[1]
      : /<source[^>]*\bsrc=["']([^"']+\.(?:m3u8|mp4)[^"']*)["']/i.exec(html)?.[1];
    if (!src) return [];

    const masterUrl = new URL(src, url).href;
    const label = (q) => `${prefix}Sendvid - ${q}`;

    if (masterUrl.includes('.m3u8')) {
      return extractFromHls(masterUrl, { referer: url, host: 'sendvid', videoNameGen: label });
    }
    return [createVideo({
      url: masterUrl,
      quality: label('mp4'),
      host: 'sendvid',
      referer,
      headers: buildHeaders(referer),
    })];
  },
};
