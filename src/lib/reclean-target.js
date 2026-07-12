/**
 * MUGA: reclean-target guard (#951 follow-up — fragment-safe rewrite).
 *
 * Decides whether — and to what — `__mugaReclean` should rewrite the address
 * bar via `history.replaceState`. Pure, DOM-free, no globals, so the whole
 * decision is unit-testable; content/cleaner.js mirrors this logic inline
 * (content scripts can't ES-import cross-browser — same pattern as
 * dom-link-rewriter).
 *
 * WHY THIS EXISTS
 * The reclean pipeline runs on every same-document navigation MUGA can see:
 * pushState/replaceState (via muga:history-committed), popstate, and
 * hashchange. Its old guard rewrote whenever `cleanUrl !== location.href` — a
 * raw string compare. A `hashchange` changes ONLY the fragment (tracking
 * params live in the query, which is untouched), yet the string compare saw a
 * difference and fired `replaceState`, overwriting the fragment the page had
 * just set. That silently broke every hash-driven in-page control on the web
 * (carousels, tabs, hash routers) — reported live on the amazon.es feed
 * carousel, whose arrows are `<a href="#">`.
 *
 * THE INVARIANT
 *   1. Rewrite ONLY when origin+pathname+search actually changed — i.e. real
 *      tracking was removed or our affiliate tag was injected. A fragment-only
 *      difference (or no difference at all) returns null: leave the URL alone.
 *   2. On a legitimate rewrite, carry over the EXACT live fragment, including a
 *      bare "#". MUGA cleans query/path, never the fragment, so the fragment
 *      the page is currently on must survive verbatim. The URL `hash` setter
 *      normalizes an empty fragment away (`url.hash = ""` drops the "#"), so
 *      the fragment is spliced by string, not through the URL API.
 *
 * @param {string} currentHref The live `window.location.href` at reclean time.
 * @param {string} cleanUrl    The cleaner's proposed URL (may be relative to
 *                             currentHref; may or may not carry a fragment).
 * @returns {string|null} The URL to write with `replaceState`, or null when
 *                        nothing meaningful changed (fragment-only / identical
 *                        / unparseable). Never throws.
 */
export function computeRecleanTarget(currentHref, cleanUrl) {
  if (typeof currentHref !== "string" || typeof cleanUrl !== "string") return null;

  let cur;
  let next;
  try {
    cur = new URL(currentHref);
  } catch {
    return null;
  }
  try {
    // cleanUrl may be relative (SPA routers push relative URLs); resolve it
    // against the live URL exactly as the reclean caller does.
    next = new URL(cleanUrl, currentHref);
  } catch {
    return null;
  }

  // Only the query/path matter. A fragment-only difference must never trigger
  // a rewrite — that is the whole bug. Comparing origin+pathname+search also
  // means an already-clean URL (no change) returns null.
  if (
    cur.origin === next.origin &&
    cur.pathname === next.pathname &&
    cur.search === next.search
  ) {
    return null;
  }

  // A real query/path change. Reconstruct the target from the cleaned
  // origin/path/query, then graft the LIVE fragment back on verbatim so the
  // page's in-page hash state is preserved. String-splice both fragments to
  // survive the empty-"#" normalization the URL API would otherwise apply.
  const liveHashAt = currentHref.indexOf("#");
  const liveFragment = liveHashAt >= 0 ? currentHref.slice(liveHashAt) : "";

  const nextStr = next.href;
  const nextHashAt = nextStr.indexOf("#");
  const nextWithoutFragment = nextHashAt >= 0 ? nextStr.slice(0, nextHashAt) : nextStr;

  return nextWithoutFragment + liveFragment;
}
