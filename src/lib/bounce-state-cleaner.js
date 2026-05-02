/**
 * MUGA: Bounce State Cleaner (#447 / B17)
 *
 * Affiliate-network bounce hosts, social-link wrappers, and privacy proxies
 * (collectively: "intermediaries") frequently set localStorage and
 * sessionStorage entries during the brief microsecond they hold the user's
 * tab. Those entries persist across visits and let the intermediary
 * fingerprint or correlate the visitor on the next bounce. Same-origin
 * navigation handlers — DNR + the cleaner pipeline — strip query params
 * but cannot reach inside the page's storage from outside the page.
 *
 * This module wipes that state from inside the page when the content
 * script lands on a recognized intermediary host. The browser keys
 * localStorage and sessionStorage by ORIGIN, so wiping while we're on
 * `awin1.com` only touches `awin1.com`'s state — never the merchant's.
 *
 * ── What we DO NOT touch ─────────────────────────────────────────────────
 *
 * IndexedDB, service-worker caches, Cache Storage API: out of scope for
 * v1. They have asynchronous APIs and per-database enumeration steps that
 * complicate a document_start cleaner; the population of intermediaries
 * that use them is small enough to defer.
 *
 * COOKIES — INTENTIONALLY NOT REQUESTED. Wiping the intermediary's
 * cookies would require the `cookies` permission in the manifest. That
 * permission triggers a scary install-time prompt ("Read and modify your
 * cookies on all sites") that's wildly out of proportion to the value
 * delivered for a niche cleanup. The product position is: ship the
 * storage cleanup with no extra permission, and let the navigation
 * pipeline + DNR handle the bigger lever (the URL itself never reaches
 * the intermediary's server in many cases). If we later add a `cookies`
 * permission for another feature, this module gains a third storage
 * surface trivially.
 *
 * ── Pure module ──────────────────────────────────────────────────────────
 *
 * No DOM, no chrome.*, no `window.localStorage` reads. Three injection
 * points:
 *   - `wrapperEngine` — exposes `detectWrapper(href) -> entry|null`. The
 *     same surface that `src/lib/wrapper-engine.js` exports. Tests pass a
 *     stub; the content script passes the real engine (or a replicated
 *     copy when the cleaner-bundle hasn't attached yet).
 *   - `storageLike`, `sessionStorageLike` — Web Storage API stubs in
 *     tests; `window.localStorage`/`window.sessionStorage` in production.
 *
 * Defensive contract: every public method swallows throws from the
 * injected dependencies. A storage clear that throws (incognito quota,
 * cross-origin error in some embedded contexts) MUST NOT bubble out to
 * the IIFE that called us — the page must keep running.
 */

/**
 * @typedef {object} BounceStateCleanerDeps
 * @property {{ detectWrapper: (href: string) => object|null } | null} wrapperEngine
 *   Wrapper-engine-shaped object. May be null at construction (the
 *   cleaner becomes a defensive no-op).
 * @property {Storage|null|undefined} storageLike
 *   `window.localStorage`-shaped object. May be null/undefined.
 * @property {Storage|null|undefined} sessionStorageLike
 *   `window.sessionStorage`-shaped object. May be null/undefined.
 */

/**
 * @typedef {object} BounceStateCleaner
 * @property {(href: unknown) => boolean} isIntermediary
 *   True iff the wrapper engine recognizes the URL's host as an
 *   intermediary. Non-string input → false. Engine throws → false.
 * @property {() => { localCleared: number, sessionCleared: number }} cleanCurrent
 *   Wipes both storages unconditionally and returns the number of entries
 *   that WERE present before the wipe. Throws are swallowed — a failed
 *   storage reports 0.
 * @property {(href: unknown) => { cleaned: boolean, localCleared: number, sessionCleared: number }} cleanIfIntermediary
 *   Gates `cleanCurrent` on `isIntermediary`. Always returns an object.
 *   `cleaned: false` when the URL is out of scope or input is invalid.
 */

/**
 * Returns the count of entries in a Web-Storage-shaped object, swallowing
 * any throw. Used to snapshot the "before" count for caller telemetry.
 * @param {{ length: number }|null|undefined} storage
 * @returns {number}
 */
function safeLength(storage) {
  if (!storage) return 0;
  try {
    const n = storage.length;
    return typeof n === "number" && n >= 0 ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Calls `clear()` on a Web-Storage-shaped object, swallowing any throw.
 * Returns true on apparent success, false when the storage is missing or
 * `clear()` threw. The caller pairs this with `safeLength` to report
 * per-surface counts.
 * @param {{ clear: () => void }|null|undefined} storage
 * @returns {boolean}
 */
function safeClear(storage) {
  if (!storage || typeof storage.clear !== "function") return false;
  try {
    storage.clear();
    return true;
  } catch {
    // Incognito-quota errors, cross-origin storage errors, or a hostile
    // intermediary that has redefined `clear`. None of those should
    // bubble out into the page's mutation flow — see module docblock.
    return false;
  }
}

/**
 * Builds a bounce-state cleaner bound to the given wrapper engine and
 * storage surfaces. The factory itself never throws — every public method
 * is tolerant of null/undefined deps.
 *
 * @param {BounceStateCleanerDeps} deps
 * @returns {BounceStateCleaner}
 */
export function createBounceStateCleaner(deps) {
  const wrapperEngine = deps && deps.wrapperEngine;
  const storageLike = deps && deps.storageLike;
  const sessionStorageLike = deps && deps.sessionStorageLike;

  function isIntermediary(href) {
    if (typeof href !== "string" || href.length === 0) return false;
    if (!wrapperEngine || typeof wrapperEngine.detectWrapper !== "function") {
      return false;
    }
    try {
      return wrapperEngine.detectWrapper(href) !== null;
    } catch {
      // A throwing engine is treated as "not an intermediary" — matches
      // the conservative bias of every other gate in MUGA: when in
      // doubt, do nothing.
      return false;
    }
  }

  function cleanCurrent() {
    // Snapshot lengths BEFORE clearing so the returned counts reflect
    // what was actually wiped. Reading `length` after clear() would
    // always be 0 and lose the telemetry signal.
    const localBefore = safeLength(storageLike);
    const sessionBefore = safeLength(sessionStorageLike);

    const localOk = safeClear(storageLike);
    const sessionOk = safeClear(sessionStorageLike);

    return {
      localCleared: localOk ? localBefore : 0,
      sessionCleared: sessionOk ? sessionBefore : 0,
    };
  }

  function cleanIfIntermediary(href) {
    if (!isIntermediary(href)) {
      return { cleaned: false, localCleared: 0, sessionCleared: 0 };
    }
    const counts = cleanCurrent();
    return {
      cleaned: true,
      localCleared: counts.localCleared,
      sessionCleared: counts.sessionCleared,
    };
  }

  return { isIntermediary, cleanCurrent, cleanIfIntermediary };
}
