/**
 * MUGA: same-document (in-page fragment) navigation detector.
 *
 * The affiliate click interceptor in content/cleaner.js calls
 * `e.preventDefault()` + `navigate()` on clicks bound for affiliate store
 * domains (Amazon, etc.) so it can clean/inject before navigating. But a click
 * on an IN-PAGE control — a carousel arrow `<a href="#">`, a tab, an accordion,
 * a "back to top" anchor, a hash router — is NOT a navigation to intercept: the
 * page handles it itself. Hijacking it makes the page reload/navigate instead
 * of advancing the control (repro: amazon.es feed carousel arrows).
 *
 * The interceptor's original `href.startsWith("#")` guard reads `anchor.href` —
 * the IDL PROPERTY — which RESOLVES a bare "#" or "#section" to the current
 * document's ABSOLUTE URL, so it never begins with "#" and the guard misses
 * every same-document anchor. This predicate closes that gap by comparing the
 * resolved destination to the current document.
 *
 * Same document == identical origin + pathname + search; only the fragment
 * differs (or nothing differs). content/cleaner.js mirrors this check inline
 * (content scripts can't ES-import cross-browser — same pattern as
 * reclean-target / dom-link-rewriter); this pure copy is the unit-tested one.
 *
 * @param {string} currentHref The live `location.href`.
 * @param {string} targetHref  The click destination (`anchor.href`; may be a
 *                             resolved absolute URL or a relative href).
 * @returns {boolean} true when the target is same-document (fragment-only)
 *                    navigation that must NOT be intercepted. Never throws;
 *                    returns false on unparseable input (fail toward the
 *                    existing interception behaviour).
 */
export function isSameDocumentNavigation(currentHref, targetHref) {
  if (typeof currentHref !== "string" || typeof targetHref !== "string") return false;

  let cur;
  let next;
  try {
    cur = new URL(currentHref);
  } catch {
    return false;
  }
  try {
    next = new URL(targetHref, currentHref);
  } catch {
    return false;
  }

  return (
    cur.origin === next.origin &&
    cur.pathname === next.pathname &&
    cur.search === next.search
  );
}
