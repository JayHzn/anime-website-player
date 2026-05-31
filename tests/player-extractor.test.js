import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

// The player-extractor is a content script (classic script, world: MAIN) — it can't be
// imported. Instead we load the REAL file into a mocked browser-iframe context and drive
// the same runtime signals a video host's player would emit (XHR/fetch/jwplayer), then
// assert which URL it relays to the parent frame. This validates the collect+score logic
// deterministically, without a browser or network.

const SRC = readFileSync(resolve(process.cwd(), 'extension/player-extractor.js'), 'utf8');
const LOCATION = { href: 'https://embed.example/play/abc', origin: 'https://embed.example', protocol: 'https:' };

function loadExtractor({ video = null, jwplayer, videojs } = {}) {
  const sent = [];
  const sandbox = {
    self: { frame: 'child' },
    top: { frame: 'top' }, // self !== top → behaves as an embedded iframe
    parent: { postMessage: (msg) => sent.push(msg) },
    location: { ...LOCATION },
    console: { debug() {}, log() {}, warn() {}, error() {} },
    document: { querySelector: () => video },
    // Long retry timers (1500/4500ms) must not keep the test runner alive.
    setTimeout: (fn, ms) => { const t = setTimeout(fn, ms); if (t.unref) { t.unref(); } return t; },
    clearTimeout: (t) => clearTimeout(t),
  };
  // The originals the extractor will wrap:
  sandbox.XMLHttpRequest = class { open() { /* original no-op */ } };
  sandbox.fetch = () => Promise.resolve({});
  // Optional pre-existing players (must be present BEFORE the script's static probes run).
  if (jwplayer !== undefined) sandbox.jwplayer = jwplayer;
  if (videojs !== undefined) sandbox.videojs = videojs;

  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);

  return {
    sent,
    // Simulate a request the host's player makes (URL passes through the wrapped APIs):
    xhr: (url) => new sandbox.XMLHttpRequest().open('GET', url),
    fetch: (url) => sandbox.fetch(url),
    // Run code inside the iframe context (e.g. the page defining jwplayer late).
    eval: (code) => vm.runInContext(code, sandbox),
  };
}

// A minimal fake <video> element (needs addEventListener/load for Strategy 7's probe).
function fakeVideo({ currentSrc = '', src = '' } = {}) {
  return { currentSrc, src, muted: false, addEventListener() {}, load() {} };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const FLUSH = 400; // > FLUSH_WINDOW (350ms) used for weaker candidates

describe('player-extractor — scored extraction', () => {
  it('relays a master .m3u8 immediately and includes the embed Referer', () => {
    const ext = loadExtractor();
    ext.fetch('https://cdn.example/seg/seg-001.ts'); // weak candidate (buffered)
    ext.fetch('https://cdn.example/hls/master.m3u8'); // score 100 → flush now

    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].type).toBe('ANIME_EXT_VIDEO_URL');
    expect(ext.sent[0].url).toBe('https://cdn.example/hls/master.m3u8');
    expect(ext.sent[0].referer).toBe(LOCATION.href);
  });

  it('prefers .m3u8 over an earlier .mp4', async () => {
    const ext = loadExtractor();
    ext.fetch('https://cdn.example/video/file.mp4');   // score 70 (buffered)
    ext.fetch('https://cdn.example/stream/index.m3u8'); // score 100 → wins

    await wait(FLUSH);
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/stream/index.m3u8');
  });

  it('ignores junk (thumbnails, sprites, subtitles) and keeps the real stream', async () => {
    const ext = loadExtractor();
    ext.fetch('https://cdn.example/thumbnails/sprite.jpg');
    ext.fetch('https://cdn.example/subs/fr.vtt');
    ext.fetch('https://cdn.example/storyboard/board.vtt');
    ext.fetch('https://cdn.example/video/movie.mp4'); // the only real candidate

    await wait(FLUSH);
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/video/movie.mp4');
  });

  it('captures URLs from XHR too, and normalizes a root-relative path', () => {
    const ext = loadExtractor();
    ext.xhr('/hls/index.m3u8'); // root-relative → resolved against origin, score 100

    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://embed.example/hls/index.m3u8');
  });

  it('relays nothing when no candidate looks like a video', async () => {
    const ext = loadExtractor();
    ext.fetch('https://cdn.example/api/track?e=play');
    ext.fetch('https://cdn.example/ping.gif');
    ext.xhr('https://cdn.example/config.json');

    await wait(FLUSH);
    expect(ext.sent).toHaveLength(0);
  });

  it('sends only once even if more streams arrive after the winner', () => {
    const ext = loadExtractor();
    ext.fetch('https://cdn.example/a/master.m3u8'); // wins immediately
    ext.fetch('https://cdn.example/b/master.m3u8'); // ignored (already locked)

    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/a/master.m3u8');
  });

  it('upgrades from a buffered .ts to a .m3u8 that arrives within the window', async () => {
    const ext = loadExtractor();
    ext.fetch('https://cdn.example/seg/0.ts');         // score 20, buffered
    ext.fetch('https://cdn.example/play/media.m3u8');  // score 90 → flush now

    await wait(FLUSH);
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/play/media.m3u8');
  });
});

describe('player-extractor — static strategies (no network request)', () => {
  it('Strategy 5: reads the src of a <video> element present on load', () => {
    const ext = loadExtractor({
      video: fakeVideo({ currentSrc: 'https://cdn.example/dom/file.m3u8' }),
    });
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/dom/file.m3u8');
  });

  it('Strategy 5: ignores a blob: src (MSE) — relays nothing', async () => {
    const ext = loadExtractor({
      video: fakeVideo({ currentSrc: 'blob:https://embed.example/123-456' }),
    });
    await wait(FLUSH);
    expect(ext.sent).toHaveLength(0);
  });

  it('Strategy 4: reads videojs player currentSrc() on load', () => {
    const videojs = {
      getPlayers: () => ({
        p1: { currentSrc: () => 'https://cdn.example/vjs/stream.m3u8' },
      }),
    };
    const ext = loadExtractor({ videojs });
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/vjs/stream.m3u8');
  });

  it('Strategy 6: reads jwplayer().getPlaylist() sources when jwplayer pre-exists', () => {
    const jwplayer = () => ({
      getPlaylist: () => [{
        sources: [
          { file: 'https://cdn.example/jw/720.mp4' },
          { file: 'https://cdn.example/jw/auto.m3u8' }, // m3u8 preferred by tryJWPlayer
        ],
      }],
    });
    const ext = loadExtractor({ jwplayer });
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/jw/auto.m3u8');
  });

  it('Strategy 3: hooks jwplayer.setup({ file }) defined late by the page', () => {
    const ext = loadExtractor(); // jwplayer undefined at load → setter hook installed
    ext.eval(`
      globalThis.jwplayer = function (id) {
        return { setup: function (cfg) { return cfg; } };
      };
      jwplayer('player').setup({ file: 'https://cdn.example/jw/setup.m3u8' });
    `);
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/jw/setup.m3u8');
  });

  it('Strategy 3: extracts from a jwplayer setup playlist[].sources[].file', () => {
    const ext = loadExtractor();
    ext.eval(`
      globalThis.jwplayer = function (id) {
        return { setup: function (cfg) { return cfg; } };
      };
      jwplayer('player').setup({
        playlist: [{ sources: [{ file: 'https://cdn.example/jw/pl.m3u8' }] }],
      });
    `);
    expect(ext.sent).toHaveLength(1);
    expect(ext.sent[0].url).toBe('https://cdn.example/jw/pl.m3u8');
  });
});
