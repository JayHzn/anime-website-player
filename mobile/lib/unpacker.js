// AUTO-GENERATED — do not edit. Mirrored from extension/lib by scripts/sync-lib.mjs.
// ── P.A.C.K.E.R. unpacker ────────────────────────────────────
// Most of the "JS-gated" hosts (uqload, vidhide, filemoon, lulustream, earnvids…)
// don't hide their stream URL behind a real API — they just ship it inside a
// Dean Edwards packed script: `eval(function(p,a,c,k,e,d){…}('…',36,42,'…'.split('|')…))`.
//
// Aniyomi's extractors run these through a JS engine (QuickJS) or a Kotlin
// unpacker. We do the same thing without executing anything: the packer is a
// plain base-N symbol substitution, so we can reverse it with string ops only.
// That's what lets a host go from "needs a hidden iframe" to "one HTTP GET".

const PACKED_RE = /eval\(function\(\s*p\s*,\s*a\s*,\s*c\s*,\s*k\s*,\s*e\s*,\s*[dr]\s*\)/;

// Captures the four arguments: payload, base, count, symbol table.
const ARGS_RE =
  /\}\s*\(\s*(['"])([\s\S]*?)\1\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(['"])([\s\S]*?)\5\s*\.\s*split\(\s*(['"])\|\7\s*\)/;

/** True when `script` contains a packed payload we can unpack. */
export function isPacked(script) {
  return typeof script === 'string' && PACKED_RE.test(script);
}

// The packer's own base-N encoder: digits 0-9a-z, then A-Z above 35.
function encodeSymbol(c, base) {
  const head = c < base ? '' : encodeSymbol(Math.floor(c / base), base);
  const rest = c % base;
  return head + (rest > 35 ? String.fromCharCode(rest + 29) : rest.toString(36));
}

// The payload is a JS string literal, so quotes and backslashes are escaped.
function unescapePayload(str) {
  return str
    .replace(/\\\\/g, '\\')
    .replace(/\\'/g, "'")
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t');
}

/**
 * Unpack a packed script.
 * @returns {string|null} the unpacked source, or null if `script` isn't packed
 *   or doesn't match the expected shape.
 */
export function unpack(script) {
  if (!isPacked(script)) return null;
  const m = ARGS_RE.exec(script);
  if (!m) return null;

  let payload = unescapePayload(m[2]);
  const base = Number.parseInt(m[3], 10);
  let count = Number.parseInt(m[4], 10);
  const symbols = unescapePayload(m[6]).split('|');

  if (!Number.isFinite(base) || !Number.isFinite(count)) return null;

  while (count--) {
    const replacement = symbols[count];
    if (!replacement) continue; // empty slot → the symbol stands for itself
    const token = encodeSymbol(count, base);
    payload = payload.replace(new RegExp(`\\b${token}\\b`, 'g'), replacement);
  }
  return payload;
}

/**
 * Unpack if packed, otherwise return the script unchanged — so callers can run
 * their regexes over one string without caring which form the host shipped.
 */
export function unpackIfNeeded(script) {
  return unpack(script) ?? script;
}
