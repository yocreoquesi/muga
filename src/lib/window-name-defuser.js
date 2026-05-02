/**
 * MUGA: Window-Name Defuser (#451 / B11)
 *
 * `window.name` persists across same-origin navigations within a tab and
 * across page reloads — it's the only top-frame slot that survives
 * `location.assign()` without a referrer leak. Tracking SDKs abuse this
 * by stashing a URL with tracking params into `window.name` BEFORE
 * navigating, then reading it back after the navigation to "recover"
 * params MUGA stripped at the navigation edge. This is the
 * window.name-as-side-channel pattern documented in the privacy
 * literature (e.g. Google Analytics' linker plugin and a long tail of
 * affiliate scripts).
 *
 * Strategy: install a property accessor on `window.name` at
 * `document_start` so all subsequent READS go through us. Cleaning at
 * read-time (not write-time) is the safer contract:
 *
 *   - Many legitimate scripts WRITE a value and immediately READ IT
 *     BACK expecting their exact value to round-trip (cross-frame
 *     handshakes, popup result transports). Cleaning on write would
 *     corrupt those flows. Cleaning on read mutates the OUTPUT only —
 *     legitimate non-URL payloads return verbatim because the URL-shape
 *     heuristic skips them.
 *   - The tracking-recovery scripts read after navigation; we win that
 *     read.
 *
 * Pure module — no DOM, no globals, no chrome.* — so unit tests can
 * exercise the wrapping logic with plain stubs (no jsdom).
 *
 * Two correctness invariants:
 *
 *   1. STORED VALUE IS NEVER REWRITTEN. Writes pass through into a
 *      private slot exactly as the page sent them; the cleaner runs on
 *      read only. Sites that round-trip a token through window.name
 *      see their token unchanged.
 *   2. NON-URL READS ARE PASS-THROUGH. The URL-shape gate (must parse
 *      with `new URL()` AND have an http/https scheme) keeps cross-
 *      frame tokens, JSON blobs, opaque session strings, etc. out of
 *      the cleaner entirely.
 *
 * Cleaner errors (e.g. cleaner blowing up deep inside `processUrl`)
 * MUST NOT crash the read. We swallow the throw and return the raw
 * stored value: a dirty value re-emerging is strictly better than the
 * page crashing on a property read.
 */

/**
 * Heuristic: is this string URL-shaped enough to worth cleaning?
 *
 * We only treat http(s) URLs as cleanable. Anything else — opaque
 * tokens, JSON, javascript: URIs, data: URIs — is returned verbatim.
 * The conservative scheme allowlist matches what the cleaner pipeline
 * itself accepts and prevents collateral damage on the long tail of
 * legitimate window.name payloads.
 *
 * @param {string} s
 * @returns {boolean}
 */
function looksLikeHttpUrl(s) {
  if (typeof s !== "string" || s.length === 0) return false;
  // Cheap prefix check before paying for `new URL()`.
  if (!/^https?:\/\//i.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Installs the window-name defuser on the given window-like host.
 *
 * The host's `name` property is replaced with a configurable accessor.
 * Reads pass the stored value through `urlCleaner` only when it looks
 * URL-shaped; non-URL values fall through untouched. Writes update the
 * private storage slot only — they do NOT mutate the value the cleaner
 * sees on subsequent reads (cleaning is read-time).
 *
 * @param {object} target
 *   The host object whose `name` property will be redefined IN PLACE.
 *   Typically `window` from a content script. Plain objects with a
 *   `name` data property also work — useful for tests.
 * @param {(url: string) => string|null|undefined} urlCleaner
 *   Synchronous cleaner. Receives the URL the page tried to read.
 *   Should return the cleaned URL string. If it returns null,
 *   undefined, or a non-string, the wrapper falls back to the original
 *   stored value.
 * @param {object} [options]
 * @param {() => boolean} [options.isEnabled]
 *   Optional disabled-state guard. When provided and returns false at
 *   read time, the wrapper bypasses the cleaner entirely and returns
 *   the raw stored value. Default: always enabled.
 * @returns {() => void}
 *   Uninstall callback. Restores a plain data property on the host
 *   with the latest stored value, so reads and writes flow normally
 *   afterwards.
 */
export function installWindowNameDefuser(target, urlCleaner, options = {}) {
  const isEnabled = typeof options.isEnabled === "function"
    ? options.isEnabled
    : () => true;

  // Capture whatever the property held BEFORE we replaced it. This is
  // the value the page may have set before our document_start wrap
  // landed (rare, but possible if some earlier extension or manifest
  // entry beat us to it — fail-safe).
  let stored;
  try {
    stored = target.name;
  } catch {
    stored = "";
  }
  if (typeof stored !== "string") stored = "";

  Object.defineProperty(target, "name", {
    configurable: true,
    enumerable: true,
    get() {
      const raw = stored;
      if (typeof raw !== "string" || raw.length === 0) return raw;
      let enabled;
      try { enabled = !!isEnabled(); } catch { enabled = false; }
      if (!enabled) return raw;
      if (!looksLikeHttpUrl(raw)) return raw;
      let cleaned;
      try {
        cleaned = urlCleaner(raw);
      } catch {
        // Cleaner blew up — return raw rather than crashing the read.
        return raw;
      }
      if (typeof cleaned !== "string" || cleaned.length === 0) return raw;
      return cleaned;
    },
    set(v) {
      // Coerce to string the way `window.name` itself does. The browser
      // converts non-strings to their string form before storage; we
      // mirror that so the round-trip semantics match what the page
      // would have observed without our wrap.
      stored = typeof v === "string" ? v : String(v);
    },
  });

  return function uninstall() {
    // Restore a plain data property holding the LATEST stored value.
    // This is the closest we can get to "remove our wrap" without
    // capturing the original property descriptor (which we deliberately
    // don't, because we want a clean slate after uninstall).
    Object.defineProperty(target, "name", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: stored,
    });
  };
}
