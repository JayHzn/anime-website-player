// ── HTTP client ──────────────────────────────────────────────
// Aniyomi hands every extractor an OkHttpClient plus a Headers object, and OkHttp
// sends whatever you put in it. On our two platforms that's only half true:
//
//   • React Native  — fetch() sends Referer/Origin as given. Nothing to do.
//   • MV3 extension — Referer and Origin are *forbidden header names*; fetch()
//     drops them silently. The only way to set them is a declarativeNetRequest
//     rule, so that's what we install, keyed per host and reused across calls.
//
// Both platforms therefore get the same `httpGet(url, { referer })` contract, and
// the extractors above stay platform-agnostic — same file, same behaviour.

const HAS_DNR =
  typeof chrome !== 'undefined' &&
  typeof chrome?.declarativeNetRequest?.updateSessionRules === 'function';

/**
 * True in the browser extension, false in React Native. Callers use it for the
 * handful of decisions that genuinely differ between the two consumers — e.g.
 * subtitles must be inlined for a browser `<track>`, while the app's native
 * player reads the tracks embedded in the HLS stream itself.
 */
export const IS_EXTENSION = HAS_DNR;

// Session rule ids live in their own range so they never collide with the static
// rules in extension/rules.json (which start at 1).
const RULE_ID_BASE = 10_000;
const RULE_ID_MAX = 19_999;

const ruleIdsByKey = new Map(); // `${host}|${referer}` → rule id
let nextRuleId = RULE_ID_BASE;

const RESOURCE_TYPES = ['xmlhttprequest', 'media', 'sub_frame', 'object', 'other'];

function hostOf(url) {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

/**
 * Make every request to `url`'s host carry `referer` (and the matching Origin).
 *
 * Also the piece that makes PLAYBACK work in the browser: hls.js fetches the
 * playlist and every segment from the site's own origin, so it can't set a
 * Referer either — the rule installed here is what keeps a host from 403-ing
 * those segment requests. This is our stand-in for the per-Video `headers` that
 * Aniyomi passes straight to ExoPlayer.
 *
 * No-op outside the extension (React Native sets the header directly).
 * Requires the host to be covered by `host_permissions` in the manifest.
 *
 * @returns {Promise<boolean>} whether a rule is now in place
 */
export async function ensureRefererRule(url, referer) {
  if (!HAS_DNR || !referer) return false;
  const host = hostOf(url);
  if (!host) return false;

  const key = `${host}|${referer}`;
  if (ruleIdsByKey.has(key)) return true;

  let origin;
  try {
    origin = new URL(referer).origin;
  } catch {
    return false;
  }

  // Wrap around rather than grow without bound: a long session browsing many
  // hosts would otherwise keep adding rules that are never used again.
  if (nextRuleId > RULE_ID_MAX) nextRuleId = RULE_ID_BASE;
  const id = nextRuleId++;

  try {
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [id],
      addRules: [{
        id,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'referer', operation: 'set', value: referer },
            { header: 'origin', operation: 'set', value: origin },
          ],
        },
        condition: { urlFilter: `||${host}`, resourceTypes: RESOURCE_TYPES },
      }],
    });
    ruleIdsByKey.set(key, id);
    return true;
  } catch (e) {
    // Most likely: the host isn't in host_permissions. Extraction can still work
    // for hosts that don't check Referer, so this is a warning, not a failure.
    console.warn('[lib/http] could not install referer rule for', host, e.message);
    return false;
  }
}

/** Drop every session rule this module installed. */
export async function clearRefererRules() {
  if (!HAS_DNR || ruleIdsByKey.size === 0) return;
  const ids = [...ruleIdsByKey.values()];
  ruleIdsByKey.clear();
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: ids });
  } catch { /* best effort */ }
}

/**
 * A timeout signal that works on both runtimes.
 *
 * `AbortSignal.timeout` is missing on Hermes (React Native's polyfill doesn't
 * provide it). Calling it unguarded threw on the very first fetch, so every
 * extractor returned nothing and the app fell back to the host's embed player
 * while the extension resolved the stream fine — see the same note in
 * mobile/sources/franime.js, where this bit once already.
 *
 * @returns {{ signal: AbortSignal|undefined, clear: () => void }}
 */
function timeoutSignal(ms) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return { signal: AbortSignal.timeout(ms), clear: () => {} };
    } catch { /* present but unusable — fall through */ }
  }
  if (typeof AbortController !== 'function') {
    return { signal: undefined, clear: () => {} }; // no abort support: rely on the platform timeout
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * GET a URL with the headers a video host expects.
 *
 * @param {string} url
 * @param {object} [opts]
 * @param {string} [opts.referer]  set via DNR (extension) or directly (RN)
 * @param {object} [opts.headers]  extra headers (User-Agent, Accept…)
 * @param {number} [opts.timeout=8000]
 * @returns {Promise<Response>}
 */
export async function httpGet(url, opts = {}) {
  const { referer = null, headers = {}, timeout = 8000 } = opts;

  const finalHeaders = { ...headers };
  if (referer) {
    if (HAS_DNR) {
      await ensureRefererRule(url, referer);
    } else {
      finalHeaders.Referer = referer;
      try {
        finalHeaders.Origin = new URL(referer).origin;
      } catch { /* not a full URL */ }
    }
  }

  const { signal, clear } = timeoutSignal(timeout);
  try {
    return await fetch(url, { headers: finalHeaders, signal, redirect: 'follow' });
  } finally {
    // Don't leave the fallback timer pending once the request has settled.
    clear();
  }
}

/** GET and return the body as text, or null on any non-2xx / network failure. */
export async function httpGetText(url, opts = {}) {
  try {
    const res = await httpGet(url, opts);
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
