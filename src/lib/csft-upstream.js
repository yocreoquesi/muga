/**
 * MUGA: csft-upstream — privacy boundary for the "Report upstream" button (#537)
 *
 * The popup's Suspicious params section lets the user report an unrecognised
 * tracking parameter to the MUGA repo via a deep-linked GitHub issue. The
 * privacy contract is non-negotiable: the report must contain ONLY the
 * param name and the count of distinct first-party domains the user has
 * observed it on. NEVER the value, NEVER the hash, NEVER the domain list.
 *
 * This module exists to enforce that contract STRUCTURALLY rather than by
 * convention. The single export, `buildUpstreamPayload`, accepts the rich
 * cross-site-frequency tracker state (which carries hashes, raw domains,
 * timestamps, entropy, etc.) and returns a tiny object with EXACTLY two
 * fields. Because the function constructs a fresh object literal whose
 * shape is hard-coded — no spread, no Object.assign, no for-loop over the
 * input — there is no path through which a value, hash, or domain string
 * can leak into the output. Every caller in the codebase is forced through
 * this funnel.
 *
 * The shape is also small enough that future reviewers can audit it in
 * one glance: if a sixth field ever appears in the output literal, that
 * is a privacy regression and must be rejected at PR time.
 *
 * ── Pure module guarantees ────────────────────────────────────────────
 *
 *   - No DOM access
 *   - No chrome.* / storage / fetch
 *   - No clock / Math.random
 *   - No network
 *   - No mutation of the input trackerState
 *
 * The function is therefore safe to call from anywhere — popup, options
 * page, future SW context — without dependency injection.
 */

/**
 * Builds the privacy-bounded payload that the popup uses to construct a
 * deep-linked GitHub issue URL. The output ALWAYS has exactly two fields,
 * regardless of how rich the input tracker state is.
 *
 * Accepts both shapes produced by cross-site-frequency.js:
 *   1. Raw entry map: { [paramName]: { domains: [...], values: [...], ... } }
 *   2. Wrapped storage shape: { params: { [paramName]: { ... } } }
 *
 * Defensive defaults — never throws on bad input:
 *   - trackerState null/undefined  → firstPartyDomainCount = 0
 *   - paramName not present        → firstPartyDomainCount = 0
 *   - entry has no domains array   → firstPartyDomainCount = 0
 *   - paramName null/undefined     → coerced to "" so the output stays string
 *
 * @param {object|null|undefined} trackerState
 *   Either the raw `params` map persisted by cross-site-frequency.js, OR
 *   the wrapped `{ params: { ... } }` storage shape. Both are tolerated so
 *   callers can pass whatever they have without unwrapping.
 * @param {string} paramName
 *   The original-case param name the user clicked "Report upstream" on.
 * @returns {{ paramName: string, firstPartyDomainCount: number }}
 *   A fresh object with EXACTLY two keys. No other field — value, hash,
 *   domain, timestamp, entropy — ever appears in the output.
 */
export function buildUpstreamPayload(trackerState, paramName) {
  // Coerce paramName defensively — null/undefined collapse to "" so the
  // output stays a string and the GitHub deep-link template never renders
  // "undefined" into the title.
  const safeName = paramName == null ? "" : String(paramName);

  // Normalise the input shape. Both the raw entry map and the wrapped
  // storage shape are accepted so callers don't have to unwrap manually.
  let entries = null;
  if (trackerState && typeof trackerState === "object") {
    if (trackerState.params && typeof trackerState.params === "object") {
      entries = trackerState.params;
    } else {
      entries = trackerState;
    }
  }

  // Look up the entry. Missing entries → 0 (defensive default — never throws).
  const entry = entries ? entries[safeName] : null;
  let firstPartyDomainCount = 0;
  if (entry && Array.isArray(entry.domains)) {
    firstPartyDomainCount = entry.domains.length;
  }

  // PRIVACY-CRITICAL: the output is a fresh object literal with hard-coded
  // keys. Do NOT spread the entry. Do NOT loop over its fields. Do NOT
  // append any other property here — every additional field is a privacy
  // regression. If you find yourself wanting to add a third key, write a
  // separate function instead.
  return {
    paramName: safeName,
    firstPartyDomainCount,
  };
}
