import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { unpack, isPacked, unpackIfNeeded } from '../extension/lib/unpacker.js';
import { parseMasterPlaylist, fixUrl } from '../extension/lib/playlist-utils.js';
import {
  sortVideos, dedupeVideos, standardQuality, buildHeaders, isDirectUrl, createVideo,
} from '../extension/lib/video.js';
import { findExtractor, DEFAULT_HOST_PRIORITY } from '../extension/lib/extractors/index.js';
import { base64ToBinary, base64ToUtf8, utf8ToBase64 } from '../extension/lib/base64.js';
import { httpGetText } from '../extension/lib/http.js';
import { toWebVtt } from '../extension/lib/subtitles.js';

// ── Unpacker ─────────────────────────────────────────────────

describe('unpacker', () => {
  // Real shape of what uqload/filemoon/vidhide ship.
  const packed =
    "eval(function(p,a,c,k,e,d){e=function(c){return c};if(!''.replace(/^/,String))" +
    "{while(c--){d[c]=k[c]||c}k=[function(e){return d[e]}];e=function(){return'\\\\w+'};c=1};" +
    "while(c--){if(k[c]){p=p.replace(new RegExp('\\\\b'+e(c)+'\\\\b','g'),k[c])}}return p}" +
    "('0 1=\"2\";',3,3,'var|file|https://cdn.example.com/master.m3u8'.split('|'),0,{}))";

  it('detects a packed payload', () => {
    expect(isPacked(packed)).toBe(true);
    expect(isPacked('var file = "x";')).toBe(false);
  });

  it('restores the symbol table', () => {
    const out = unpack(packed);
    expect(out).toBe('var file="https://cdn.example.com/master.m3u8";');
  });

  it('returns null for non-packed input', () => {
    expect(unpack('console.log(1)')).toBeNull();
  });

  it('unpackIfNeeded passes plain scripts through untouched', () => {
    expect(unpackIfNeeded('console.log(1)')).toBe('console.log(1)');
  });

  it('handles base > 36 (uppercase symbols)', () => {
    // c=40 with base 62 encodes as 'e'; make sure the encoder agrees with the packer.
    const p62 =
      "eval(function(p,a,c,k,e,d){}('0',62,1,'ok'.split('|'),0,{}))";
    expect(unpack(p62)).toBe('ok');
  });
});

// ── Playlist parsing ─────────────────────────────────────────

describe('parseMasterPlaylist', () => {
  const MASTER = `#EXTM3U
#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="Français",DEFAULT=YES,URI="subs/fr.vtt"
#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="audio",NAME="Japanese",LANGUAGE="jpn",URI="audio/jpn.m3u8"
#EXT-X-STREAM-INF:BANDWIDTH=1200000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=854x480
480/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=4500000,CODECS="avc1.640028,mp4a.40.2",RESOLUTION=1920x1080
https://cdn.example.com/1080/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.5"
audio-only/index.m3u8
`;

  const BASE_URL = 'https://cdn.example.com/hls/master.m3u8';

  it('expands one Video per video variant, best bandwidth first', () => {
    const videos = parseMasterPlaylist(MASTER, BASE_URL);
    expect(videos).toHaveLength(2);
    expect(videos[0].resolution).toBe(1080);
    expect(videos[1].resolution).toBe(480);
    expect(videos[0].bandwidth).toBe(4500000);
  });

  it('skips audio-only renditions', () => {
    const videos = parseMasterPlaylist(MASTER, BASE_URL);
    expect(videos.some((v) => v.url.includes('audio-only'))).toBe(false);
  });

  it('resolves relative variant URIs against the playlist URL', () => {
    const videos = parseMasterPlaylist(MASTER, BASE_URL);
    const sd = videos.find((v) => v.resolution === 480);
    expect(sd.url).toBe('https://cdn.example.com/hls/480/index.m3u8');
  });

  it('labels variants with a standard quality and the raw resolution', () => {
    const videos = parseMasterPlaylist(MASTER, BASE_URL);
    expect(videos[0].quality).toContain('1080p');
    expect(videos[0].quality).toContain('1920x1080');
  });

  it('collects subtitle and audio tracks', () => {
    const [video] = parseMasterPlaylist(MASTER, BASE_URL);
    expect(video.subtitles).toEqual([
      { url: 'https://cdn.example.com/hls/subs/fr.vtt', lang: 'Français' },
    ]);
    expect(video.audio[0].lang).toBe('Japanese');
  });

  it('applies videoNameGen to every variant', () => {
    const videos = parseMasterPlaylist(MASTER, BASE_URL, {
      videoNameGen: (q) => `VidMoly - ${q}`,
    });
    expect(videos.every((v) => v.quality.startsWith('VidMoly - '))).toBe(true);
  });

  it('returns a single Auto entry for a media playlist (no variants)', () => {
    const media = '#EXTM3U\n#EXTINF:10,\nseg0.ts\n';
    const videos = parseMasterPlaylist(media, BASE_URL);
    expect(videos).toHaveLength(1);
    expect(videos[0].url).toBe(BASE_URL);
    expect(videos[0].quality).toBe('Auto');
  });
});

describe('fixUrl', () => {
  const base = 'https://a.example.com/hls/master.m3u8';

  it('resolves relative, absolute and protocol-relative URLs', () => {
    expect(fixUrl('x.m3u8', base)).toBe('https://a.example.com/hls/x.m3u8');
    expect(fixUrl('/x.m3u8', base)).toBe('https://a.example.com/x.m3u8');
    expect(fixUrl('//b.example.com/x.m3u8', base)).toBe('https://b.example.com/x.m3u8');
    expect(fixUrl('https://c.example.com/x.m3u8', base)).toBe('https://c.example.com/x.m3u8');
  });

  it('returns null for empty input', () => {
    expect(fixUrl('', 'https://a.example.com/')).toBeNull();
    expect(fixUrl(undefined, 'https://a.example.com/')).toBeNull();
  });

  // React Native's URL is only partial and can't be trusted with the
  // two-argument form. Simulate that and check the manual path agrees with the
  // platform one — a mismatch here silently loses quality variants on mobile.
  describe('without a usable two-argument URL constructor (React Native)', () => {
    const cases = [
      ['x.m3u8', 'https://a.example.com/hls/x.m3u8'],
      ['./x.m3u8', 'https://a.example.com/hls/x.m3u8'],
      ['../up.m3u8', 'https://a.example.com/up.m3u8'],
      ['sub/dir/x.m3u8', 'https://a.example.com/hls/sub/dir/x.m3u8'],
      ['/root.m3u8', 'https://a.example.com/root.m3u8'],
      ['//b.example.com/x.m3u8', 'https://b.example.com/x.m3u8'],
      ['https://c.example.com/x.m3u8', 'https://c.example.com/x.m3u8'],
    ];

    let RealURL;
    beforeEach(() => {
      RealURL = globalThis.URL;
      // Mimic a partial implementation: one-argument parsing works, the
      // base-relative form throws.
      globalThis.URL = class extends RealURL {
        constructor(input, baseArg) {
          if (baseArg !== undefined) throw new TypeError('not implemented');
          super(input);
        }
      };
    });
    afterEach(() => { globalThis.URL = RealURL; });

    it.each(cases)('resolves %s', (input, expected) => {
      expect(fixUrl(input, base)).toBe(expected);
    });

    it('resolves a query-carrying base against its directory', () => {
      expect(fixUrl('seg.m3u8', 'https://a.example.com/hls/master.m3u8?token=abc'))
        .toBe('https://a.example.com/hls/seg.m3u8');
    });
  });
});

// ── Video model ──────────────────────────────────────────────

describe('video model', () => {
  it('snaps odd heights to a standard quality', () => {
    expect(standardQuality(1080)).toBe('1080p');
    expect(standardQuality(1078)).toBe('1080p');
    expect(standardQuality(406)).toBe('360p');
  });

  it('derives Origin from Referer', () => {
    expect(buildHeaders('https://vidmoly.biz/embed-x.html')).toMatchObject({
      Referer: 'https://vidmoly.biz/embed-x.html',
      Origin: 'https://vidmoly.biz',
    });
  });

  it('recognises playable URLs', () => {
    expect(isDirectUrl('https://x/y.m3u8?t=1')).toBe(true);
    expect(isDirectUrl('https://x/y.mp4')).toBe(true);
    expect(isDirectUrl('https://vidmoly.biz/embed-abc.html')).toBe(false);
  });

  it('dedupes on quality + URL path, ignoring the token query', () => {
    const videos = [
      createVideo({ url: 'https://x/a.m3u8?token=1', quality: '1080p' }),
      createVideo({ url: 'https://x/a.m3u8?token=2', quality: '1080p' }),
      createVideo({ url: 'https://x/a.m3u8?token=3', quality: '720p' }),
    ];
    expect(dedupeVideos(videos)).toHaveLength(2);
  });

  it('sorts by host preference first, then quality, then bandwidth', () => {
    const videos = [
      createVideo({ url: 'a', host: 'streamtape', resolution: 1080, bandwidth: 9 }),
      createVideo({ url: 'b', host: 'sendvid', resolution: 480, bandwidth: 1 }),
      createVideo({ url: 'c', host: 'sendvid', resolution: 1080, bandwidth: 5 }),
    ];
    const sorted = sortVideos(videos, { quality: 1080, hosts: DEFAULT_HOST_PRIORITY });
    expect(sorted.map((v) => v.url)).toEqual(['c', 'b', 'a']);
  });

  it('prefers Sibnet over Sendvid', () => {
    expect(DEFAULT_HOST_PRIORITY.indexOf('sibnet'))
      .toBeLessThan(DEFAULT_HOST_PRIORITY.indexOf('sendvid'));
  });

  // Sibnet wins on host even when Sendvid offers a higher resolution: host rank
  // is the first sort key, so the preference is not silently overridden.
  it('picks Sibnet first even against a better Sendvid variant', () => {
    const videos = [
      createVideo({ url: 'sendvid-1080', host: 'sendvid', resolution: 1080, bandwidth: 9 }),
      createVideo({ url: 'sibnet-720', host: 'sibnet', resolution: 720, bandwidth: 2 }),
    ];
    const sorted = sortVideos(videos, { quality: 1080, hosts: DEFAULT_HOST_PRIORITY });
    expect(sorted[0].url).toBe('sibnet-720');
  });

  it('never prefers a variant above the requested quality', () => {
    const videos = [
      createVideo({ url: '1080', host: 'voe', resolution: 1080 }),
      createVideo({ url: '720', host: 'voe', resolution: 720 }),
    ];
    expect(sortVideos(videos, { quality: 720 })[0].url).toBe('720');
  });
});

// ── HTTP client ──────────────────────────────────────────────
// Regression: `AbortSignal.timeout` doesn't exist on Hermes. Calling it
// unguarded threw on the first fetch of every extractor, so the app resolved
// nothing and fell back to the host's embed player while the extension played
// the stream normally.

describe('httpGet timeout handling', () => {
  let realFetch;
  let realTimeout;

  beforeEach(() => {
    realFetch = globalThis.fetch;
    realTimeout = AbortSignal.timeout;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
    AbortSignal.timeout = realTimeout;
  });

  it('still issues the request when AbortSignal.timeout is missing', async () => {
    delete AbortSignal.timeout;
    const calls = [];
    globalThis.fetch = (url, opts) => {
      calls.push({ url, opts });
      return Promise.resolve({ ok: true, text: () => Promise.resolve('BODY') });
    };

    const body = await httpGetText('https://host.example/embed');
    expect(body).toBe('BODY');
    expect(calls).toHaveLength(1);
    // A working abort signal is still supplied, via AbortController.
    expect(calls[0].opts.signal).toBeDefined();
  });

  it('uses AbortSignal.timeout when the platform provides it', async () => {
    const sentinel = new AbortController().signal;
    AbortSignal.timeout = () => sentinel;
    globalThis.fetch = (_url, opts) => Promise.resolve({
      ok: true,
      text: () => Promise.resolve(opts.signal === sentinel ? 'USED' : 'NOT USED'),
    });

    expect(await httpGetText('https://host.example/embed')).toBe('USED');
  });

  it('returns null instead of throwing when the request fails', async () => {
    globalThis.fetch = () => Promise.reject(new Error('network down'));
    expect(await httpGetText('https://host.example/embed')).toBeNull();
  });
});

// ── base64 / UTF-8 ───────────────────────────────────────────
// These back the VOE decryption chain and subtitle inlining, and have to behave
// identically in a service worker and under Hermes.

describe('base64', () => {
  it('round-trips UTF-8 text', () => {
    const text = 'Épisode 12 — « Le début » 日本語';
    expect(base64ToUtf8(utf8ToBase64(text))).toBe(text);
  });

  it('decodes to raw bytes, one char each', () => {
    // 0xC3 0xA9 is "é" in UTF-8; the binary decode must NOT collapse it.
    const binary = base64ToBinary('w6k=');
    expect(binary).toHaveLength(2);
    expect(binary.charCodeAt(0)).toBe(0xc3);
    expect(binary.charCodeAt(1)).toBe(0xa9);
  });

  it('tolerates whitespace and missing padding', () => {
    expect(base64ToUtf8('aGVs bG8=')).toBe('hello');
    expect(base64ToUtf8('aGVsbG8')).toBe('hello');
  });

  it('matches the platform built-ins', () => {
    const sample = 'The quick brown fox — 0123456789';
    expect(utf8ToBase64(sample)).toBe(Buffer.from(sample, 'utf8').toString('base64'));
  });

  // The reason this module exists: under Hermes any of these globals may be
  // missing depending on the React Native version. Hide them and check the
  // pure-JS path produces byte-identical results.
  it('falls back to pure JS when the globals are missing', () => {
    const saved = {
      atob: globalThis.atob,
      btoa: globalThis.btoa,
      TextEncoder: globalThis.TextEncoder,
      TextDecoder: globalThis.TextDecoder,
    };
    for (const k of Object.keys(saved)) delete globalThis[k];
    try {
      for (const sample of ['hello', 'Épisode 12 — « début » 日本語', 'a', 'ab', 'abc']) {
        const expected = Buffer.from(sample, 'utf8').toString('base64');
        expect(utf8ToBase64(sample), sample).toBe(expected);
        expect(base64ToUtf8(expected), sample).toBe(sample);
      }
      const binary = base64ToBinary('w6k=');
      expect(binary).toHaveLength(2);
      expect(binary.charCodeAt(0)).toBe(0xc3);
    } finally {
      Object.assign(globalThis, saved);
    }
  });
});

// ── Subtitles ────────────────────────────────────────────────

describe('toWebVtt', () => {
  it('converts SubRip served from a .vtt URL', () => {
    const srt = '1\n00:00:03,520 --> 00:00:05,240\nBonjour\n\n2\n00:00:06,000 --> 00:00:08,100\nAu revoir\n';
    const vtt = toWebVtt(srt);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:03.520 --> 00:00:05.240');
    expect(vtt).not.toMatch(/^1$/m); // cue indexes dropped
  });

  it('leaves real WebVTT untouched', () => {
    const vtt = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHi\n';
    expect(toWebVtt(vtt)).toBe(vtt);
  });

  it('leaves a format without SubRip timings alone (ASS/SSA)', () => {
    const ass = '[Script Info]\nTitle: x\n\n[Events]\nDialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,Hi\n';
    expect(toWebVtt(ass)).toBe(ass);
  });

  it('strips the BOM and normalises CRLF', () => {
    const srt = '﻿1\r\n00:00:01,000 --> 00:00:02,000\r\nHi\r\n';
    const out = toWebVtt(srt);
    expect(out.startsWith('WEBVTT')).toBe(true);
    expect(out).not.toContain('\r');
  });
});

// ── Registry ─────────────────────────────────────────────────

describe('extractor registry', () => {
  it('routes each embed URL to its dedicated extractor', () => {
    const cases = [
      ['https://sendvid.com/embed/abc', 'Sendvid'],
      ['https://vidmoly.to/embed-abc.html', 'VidMoly'],
      ['https://voe.sx/e/abc', 'VOE'],
      ['https://streamtape.com/e/abc', 'Streamtape'],
      ['https://video.sibnet.ru/shell.php?videoid=1', 'Sibnet'],
      ['https://uqload.io/embed-abc.html', 'Packed player'],
      ['https://filemoon.sx/e/abc', 'Packed player'],
    ];
    for (const [url, name] of cases) {
      expect(findExtractor(url).name, url).toBe(name);
    }
  });

  it('falls back to the generic extractor for unknown hosts', () => {
    expect(findExtractor('https://totally-new-host.example/e/abc').name).toBe('Generic');
  });
});
