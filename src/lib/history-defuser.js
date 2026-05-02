/**
 * MUGA: History Defuser (#444)
 *
 * Wraps `history.pushState` and `history.replaceState` so that the URL
 * argument is passed through a cleaner before being committed to the
 * session history. SPA routers (React Router, Next.js client router,
 * Vue Router, etc.) call these methods with URLs that include the same
 * tracking params MUGA stripped at navigation. Without this defuser,
 * any page script that subsequently reads `window.location.search` —
 * including in-page analytics — sees the dirty URL re-emerge.
 *
 * The cleaning happens SYNCHRONOUSLY: pushState is itself synchronous,
 * and the page may read `window.location.search` on the next line. An
 * async cleaner round-trip to the service worker would not be observed
 * in time. The content-script entry that bootstraps this module uses
 * the bundled `window.__mugaCleaner.processUrl()` for its sync-clean.
 *
 * Pure module — no DOM, no globals, no chrome.* — so unit tests can
 * exercise the wrapping logic with plain stubs (no jsdom).
 *
 * Two correctness invariants:
 *
 *   1. State and title are FORWARDED VERBATIM. The browser stores
 *      whatever object the page passed in; cloning, JSON-roundtripping,
 *      or coercing here would silently corrupt SPA frameworks that
 *      rely on object identity (React Router's location key, etc.).
 *   2. URL absent (undefined or null) is the documented same-document
 *      no-op signal — the cleaner is NOT invoked, and the original
 *      argument is forwarded unchanged.
 *
 * Cleaner errors (e.g. malformed URL crashing `new URL()` deep inside
 * processUrl) MUST NOT block the call. We swallow the throw and forward
 * the original URL: a dirty URL in history is strictly better than a
 * broken page.
 */

/**
 * Installs the history defuser on the given history-like object.
 *
 * @param {{ pushState: Function, replaceState: Function }} historyLike
 *   The host object whose methods will be wrapped IN PLACE. Typically
 *   `window.history` from a content script. Plain objects with two
 *   function properties also work — useful for tests.
 * @param {(url: string) => string|null|undefined} urlCleaner
 *   Synchronous cleaner. Receives the URL the page tried to push.
 *   Should return the cleaned URL string. If it returns null, undefined,
 *   or a non-string, the wrapper falls back to the original URL.
 * @param {object} [options]
 * @param {() => boolean} [options.isEnabled]
 *   Optional disabled-state guard. When provided and returns false at
 *   call time, the wrapper bypasses the cleaner entirely and forwards
 *   the original arguments. Default: always enabled.
 * @returns {{ pushState: Function, replaceState: Function }}
 *   The original (pre-wrap) methods. Callers may stash these to
 *   uninstall later by reassigning them onto the host object.
 */
export function installHistoryDefuser(historyLike, urlCleaner, options = {}) {
  const originalPush = historyLike.pushState;
  const originalReplace = historyLike.replaceState;
  const isEnabled = typeof options.isEnabled === "function"
    ? options.isEnabled
    : () => true;

  function cleanOrPassThrough(rawUrl) {
    // Documented no-op: same-document push with no URL change.
    if (rawUrl === undefined || rawUrl === null) return rawUrl;
    if (typeof rawUrl !== "string") return rawUrl;
    if (!isEnabled()) return rawUrl;
    let cleaned;
    try {
      cleaned = urlCleaner(rawUrl);
    } catch {
      // Cleaner blew up — the page MUST still navigate. Forward the
      // original URL so the SPA doesn't break.
      return rawUrl;
    }
    if (typeof cleaned !== "string" || cleaned.length === 0) return rawUrl;
    return cleaned;
  }

  historyLike.pushState = function pushState(state, title, url) {
    const finalUrl = arguments.length >= 3
      ? cleanOrPassThrough(url)
      : url;
    return arguments.length >= 3
      ? originalPush.call(this, state, title, finalUrl)
      : originalPush.call(this, state, title);
  };

  historyLike.replaceState = function replaceState(state, title, url) {
    const finalUrl = arguments.length >= 3
      ? cleanOrPassThrough(url)
      : url;
    return arguments.length >= 3
      ? originalReplace.call(this, state, title, finalUrl)
      : originalReplace.call(this, state, title);
  };

  return { pushState: originalPush, replaceState: originalReplace };
}
