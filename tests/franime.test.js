import { describe, it, expect } from 'vitest';
import { decodeFranimeEmbed } from '../extension/sources/franime.js';

// franime hides the real host embed URL in the GET_LECTEUR response's `b` param:
//   base64-decode → hex-decode to bytes → XOR every byte with a per-response key.
// decodeFranimeEmbed recovers the key from the first byte (URLs start with "https://").

// Inverse transform, for round-trip tests: url → XOR key → hex string → base64.
function encode(url, key) {
  let hex = '';
  for (const ch of url) hex += ((ch.codePointAt(0) ^ key) & 0xff).toString(16).padStart(2, '0');
  return btoa(hex);
}

describe('decodeFranimeEmbed', () => {
  it('decodes a real captured `b` param (sibnet, key=1)', () => {
    // Captured live from GET /api/anime/11469/7/2/vf/0
    const b = 'Njk3NTc1NzE3MjNiMmUyZTc3Njg2NTY0NmUyZjcyNjg2MzZmNjQ3NTJmNzM3NDJlNzI2OTY0NmQ2ZDJmNzE2OTcxM2U3NzY4NjU2NDZlNjg2NTNjMzczMTM0MzIzNzM4MzE=';
    expect(decodeFranimeEmbed(b)).toBe('https://video.sibnet.ru/shell.php?videoid=6053690');
  });

  it('handles a URL-encoded param (= → %3D)', () => {
    const raw = 'Njk3NTc1NzE3MjNiMmUyZTc3Njg2NTY0NmUyZjcyNjg2MzZmNjQ3NTJmNzM3NDJlNzI2OTY0NmQ2ZDJmNzE2OTcxM2U3NzY4NjU2NDZlNjg2NTNjMzczMTM0MzIzNzM4MzE=';
    const encoded = raw.replace(/=/g, '%3D');
    expect(decodeFranimeEmbed(encoded)).toBe('https://video.sibnet.ru/shell.php?videoid=6053690');
  });

  it('round-trips arbitrary embed URLs across different per-response keys', () => {
    const urls = [
      'https://sendvid.com/embed/kwlmd7tb',
      'https://vidmoly.biz/embed-qzsghym60e6c.html',
      'https://lpayer.embed4me.com/#ksyrd',
      'https://dingtezuni.com/embed/rq4laet2qo4v',
    ];
    for (const url of urls) {
      for (const key of [1, 3, 11, 99, 200]) {
        expect(decodeFranimeEmbed(encode(url, key))).toBe(url);
      }
    }
  });

  it('returns "" for input that does not decode to an http(s) URL', () => {
    expect(decodeFranimeEmbed(btoa('6e6f7065'))).toBe(''); // "nope"
    expect(decodeFranimeEmbed('!!!not-base64!!!')).toBe('');
    expect(decodeFranimeEmbed('')).toBe('');
  });
});
