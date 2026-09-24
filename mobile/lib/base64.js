// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// ── Base64 / UTF-8 ───────────────────────────────────────────
// The extractors run in two very different runtimes: a Chrome service worker,
// where `atob`/`btoa`/`TextDecoder` are all standard, and Hermes, where their
// availability depends on the React Native version. Rather than assume, the lib
// goes through here: the platform built-in when it exists, a small pure-JS
// implementation otherwise. Keeps every extractor free of platform checks.

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function decodeFallback(input) {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, '');
  let out = '';
  for (let i = 0; i < clean.length; i += 4) {
    const n = (ALPHABET.indexOf(clean[i]) << 18)
      | (ALPHABET.indexOf(clean[i + 1]) << 12)
      | ((i + 2 < clean.length ? ALPHABET.indexOf(clean[i + 2]) : 0) << 6)
      | (i + 3 < clean.length ? ALPHABET.indexOf(clean[i + 3]) : 0);
    out += String.fromCharCode((n >> 16) & 0xff);
    if (i + 2 < clean.length) out += String.fromCharCode((n >> 8) & 0xff);
    if (i + 3 < clean.length) out += String.fromCharCode(n & 0xff);
  }
  return out;
}

function encodeFallback(binary) {
  let out = '';
  for (let i = 0; i < binary.length; i += 3) {
    const a = binary.charCodeAt(i);
    const b = i + 1 < binary.length ? binary.charCodeAt(i + 1) : NaN;
    const c = i + 2 < binary.length ? binary.charCodeAt(i + 2) : NaN;
    const n = (a << 16) | ((Number.isNaN(b) ? 0 : b) << 8) | (Number.isNaN(c) ? 0 : c);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63]
      + (Number.isNaN(b) ? '=' : ALPHABET[(n >> 6) & 63])
      + (Number.isNaN(c) ? '=' : ALPHABET[n & 63]);
  }
  return out;
}

/** base64 → binary string, one char per byte (equivalent to an ISO-8859-1 decode). */
export function base64ToBinary(input) {
  const clean = input.replace(/[^A-Za-z0-9+/=]/g, '');
  if (typeof atob === 'function') return atob(clean);
  return decodeFallback(clean);
}

/** UTF-8 text → base64. */
export function utf8ToBase64(text) {
  const binary = utf8Encode(text);
  if (typeof btoa === 'function') return btoa(binary);
  return encodeFallback(binary);
}

/** base64 → UTF-8 text (for payloads carrying accents). */
export function base64ToUtf8(input) {
  return utf8Decode(base64ToBinary(input));
}

/** Text → a binary string of its UTF-8 bytes. */
export function utf8Encode(text) {
  if (typeof TextEncoder === 'function') {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return binary;
  }
  return unescape(encodeURIComponent(text));
}

/** A binary string of UTF-8 bytes → text. */
export function utf8Decode(binary) {
  if (typeof TextDecoder === 'function') {
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }
  try {
    return decodeURIComponent(escape(binary));
  } catch {
    return binary; // not valid UTF-8 — hand back the raw bytes
  }
}
