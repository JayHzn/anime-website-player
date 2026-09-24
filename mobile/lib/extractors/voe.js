// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// VOE — the config is a JSON blob run through a home-made obfuscation chain.
// Port of Aniyomi's VoeExtractor.decryptF7.
//
// The chain, in order: rot13 → a handful of digraphs replaced by "_" →
// underscores stripped → base64 → every char shifted down 3 → reversed → base64
// → JSON. Pure string work, so no JS engine needed.

import { base64ToBinary, base64ToUtf8 } from '../base64.js';
import { httpGetText } from '../http.js';
import { extractFromHls } from '../playlist-utils.js';
import { buildHeaders, createVideo } from '../video.js';

const REDIRECT_RE = /window\.location\.href\s*=\s*'([^']+)'/;
const JSON_SCRIPT_RE = /<script[^>]*type=["']application\/json["'][^>]*>([\s\S]*?)<\/script>/i;

const PATTERNS = ['@$', '^^', '~@', '%?', '*~', '!!', '#&'];
const PATTERNS_RE = new RegExp(PATTERNS.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');

function rot13(input) {
  return input.replace(/[a-zA-Z]/g, (c) => {
    const base = c <= 'Z' ? 65 : 97;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}

export function decryptVoe(encoded) {
  try {
    const step1 = rot13(encoded);
    const step2 = step1.replace(PATTERNS_RE, '_').replace(/_/g, '');
    // Byte-level from here: the shift and reverse operate on raw bytes, matching
    // Aniyomi's ISO_8859_1 decode. Only the final JSON is real UTF-8.
    const step3 = base64ToBinary(step2);
    const step4 = [...step3].map((c) => String.fromCharCode(c.charCodeAt(0) - 3)).join('');
    const step5 = [...step4].reverse().join('');
    return JSON.parse(base64ToUtf8(step5));
  } catch {
    return null;
  }
}

export const voe = {
  name: 'VOE',
  host: 'voe',
  match: (url) => /voe\.sx|voe-un-block|voe\.network|\bvoe\b/i.test(url),

  async extract(url, { prefix = '' } = {}) {
    const referer = `${new URL(url).origin}/`;
    let pageUrl = url;
    let html = await httpGetText(url, { referer, headers: buildHeaders(referer) });
    if (!html) return [];

    // VOE often serves a one-line bounce page before the real embed.
    const redirect = REDIRECT_RE.exec(html)?.[1];
    if (redirect) {
      pageUrl = new URL(redirect, url).href;
      html = await httpGetText(pageUrl, { referer, headers: buildHeaders(referer) });
      if (!html) return [];
    }

    const raw = JSON_SCRIPT_RE.exec(html)?.[1]?.trim();
    if (!raw) return [];
    const encoded = raw.replace(/^\["/, '').replace(/"\]$/, '');

    const config = decryptVoe(encoded);
    if (!config) return [];

    const subtitles = (Array.isArray(config.captions) ? config.captions : [])
      .map((c) => {
        const file = c?.file;
        if (!file) return null;
        return { url: new URL(file, pageUrl).href, lang: c.label || 'Subtitle' };
      })
      .filter(Boolean);

    const videos = [];
    if (config.source) {
      videos.push(...await extractFromHls(config.source, {
        referer: pageUrl,
        host: 'voe',
        videoNameGen: (q) => `${prefix}VOE - ${q}`,
        subtitles,
      }).catch(() => []));
    }
    if (config.direct_access_url) {
      videos.push(createVideo({
        url: config.direct_access_url,
        quality: `${prefix}VOE - mp4`,
        host: 'voe',
        referer: pageUrl,
        headers: buildHeaders(pageUrl),
        subtitles,
      }));
    }
    return videos;
  },
};
