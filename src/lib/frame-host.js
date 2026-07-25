/**
 * MUGA — TOP-frame hostname resolution (cookie-consent-all-frames FIX A)
 *
 * The cookie-consent gate needs the hostname of the TOP frame (the site
 * the user is actually on), not the current frame's own hostname — a
 * cross-origin consent-or-pay dialog iframe's `location.hostname` is the
 * CMP vendor's own host, not the paused site's.
 *
 * Pure, environment-injected (no `window`/`location` access here) so it
 * stays unit-testable in this lib module — the content-script call site in
 * src/content/cookie-noise.js supplies the real values (hand-copied below
 * the `@sync:frame-host` markers, content scripts cannot use ES module
 * imports — see AGENTS.md).
 */

/**
 * @param {{isTopFrame?: boolean, hostname?: string|null, ancestorOrigins?: {length: number, [index: number]: string}|null}} env
 * @returns {string|null} the top frame's hostname, or `null` when it cannot
 *   be determined (FAIL-CLOSED — callers must treat `null` as "assume the
 *   worst", never as "no restriction").
 */
// @sync:frame-host:start
function resolveTopFrameHostname(env) {
  const e = env && typeof env === "object" ? env : {};

  if (e.isTopFrame === true) {
    return typeof e.hostname === "string" && e.hostname.length > 0 ? e.hostname : null;
  }

  // Child frame: only Chrome/Edge expose `location.ancestorOrigins` (a
  // DOMStringList of ancestor frame origins, outermost-last — the LAST
  // entry is always the top frame's origin, regardless of nesting depth).
  // Firefox has no equivalent API — an absent or empty list is
  // UNDETERMINABLE, not "no ancestors", and must fail closed to `null`.
  const ancestorOrigins = e.ancestorOrigins;
  const length =
    ancestorOrigins && typeof ancestorOrigins.length === "number" ? ancestorOrigins.length : 0;
  if (length === 0) return null;

  const topOrigin = ancestorOrigins[length - 1];
  if (typeof topOrigin !== "string" || topOrigin.length === 0) return null;

  try {
    const hostname = new URL(topOrigin).hostname;
    return hostname.length > 0 ? hostname : null;
  } catch {
    // Malformed origin string — never throw, fail closed instead.
    return null;
  }
}
// @sync:frame-host:end

export { resolveTopFrameHostname };
