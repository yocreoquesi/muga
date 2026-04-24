/**
 * MUGA: Browser detection helpers
 *
 * Centralized browser detection so that all callers use a consistent,
 * more reliable heuristic rather than scattered navigator.userAgent checks.
 *
 * Design rationale:
 *   navigator.userAgent.includes("Firefox") is trivially spoofable by
 *   user-agent spoofers and unreliable in some browser flavors. We prefer
 *   capability-based detection: Firefox exposes the `browser` namespace
 *   (WebExtensions API) while Chrome/Edge expose only `chrome`.
 *
 *   Fallback: if typeof checks produce an ambiguous result (some Chromium
 *   forks expose both), we fall back to a UA check as a secondary signal.
 */

/**
 * Returns true when running inside Firefox (or a Firefox-based browser).
 *
 * Detection order:
 *  1. Primary: `typeof browser !== "undefined" && typeof chrome === "undefined"`
 *     — the cleanest signal: Firefox exposes `browser`, Chrome does not.
 *  2. Secondary fallback: `navigator.userAgent.includes("Firefox")`
 *     — covers edge cases where both globals are defined (rare forks).
 *
 * @returns {boolean}
 */
export function isFirefox() {
  try {
    // Primary: browser-only API presence (not spoofable by page scripts because
    // content scripts run in an isolated world)
    if (typeof browser !== "undefined" && typeof chrome === "undefined") return true;
    // Secondary fallback
    return typeof navigator !== "undefined" && navigator.userAgent.includes("Firefox");
  } catch {
    return false;
  }
}
