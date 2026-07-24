/**
 * MUGA: broken-site-report — opt-in full-URL builder for "Report a problem
 * with this URL" (issue: allow full URLs behind explicit user consent)
 *
 * Historically both report surfaces (popup #report-broken and the options
 * dev URL tester) sent ONLY the hostname to the deep-linked GitHub issue —
 * a deliberate privacy stance, since the full URL can carry personal or
 * sensitive data (tokens, emails, account IDs) in its path/query.
 *
 * The product decision (issue owner, 2026-07) is to allow the FULL page URL
 * in the report, but ONLY when:
 *   1. The user explicitly opts in (checkbox, unchecked by default), AND
 *   2. The user has confirmed (via the same checkbox / the GitHub form's
 *      own privacy-ack) that the URL carries no personal/sensitive data.
 *
 * This module is the single funnel both surfaces go through, mirroring the
 * defensive style of csft-upstream.js: every function is pure (no DOM, no
 * chrome.*, no network), never throws, and the "full URL" field is added
 * to the output ONLY when every gate passes. If ANY gate fails — opt-in is
 * false, the URL fails to parse, the scheme isn't http(s), or the URL
 * exceeds the 2000-char cap (AGENTS.md) — the `url` field/line is OMITTED
 * entirely rather than included as an empty/garbage value. The DEFAULT
 * (includeFullUrl absent or false) is therefore always the pre-existing
 * hostname-only behaviour, unchanged.
 *
 * ── Pure module guarantees ────────────────────────────────────────────
 *   - No DOM access
 *   - No chrome.* / storage / fetch
 *   - No clock / Math.random
 *   - No network
 *   - Never throws — malformed input degrades to safe defaults
 */

/** Redirect-destination length cap shared across MUGA (AGENTS.md: ≤ 2000 chars). */
const MAX_REPORT_URL_LENGTH = 2000;

/**
 * Parses `url` defensively and returns its hostname, or "" if the URL is
 * missing, malformed, or not http(s). Never throws (AGENTS.md: wrap every
 * `new URL()` in try/catch).
 *
 * @param {string|null|undefined} url
 * @returns {{ hostname: string, isValidHttpUrl: boolean }}
 */
function _parseReportUrl(url) {
  if (typeof url !== "string" || url.length === 0) {
    return { hostname: "", isValidHttpUrl: false };
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { hostname: "", isValidHttpUrl: false };
    }
    return { hostname: parsed.hostname, isValidHttpUrl: true };
  } catch {
    return { hostname: "", isValidHttpUrl: false };
  }
}

/**
 * Decides whether the full URL is safe to include: the user must have
 * opted in AND the URL must be a valid http(s) URL within the length cap.
 * Any single failed gate omits the full URL — no partial/best-effort
 * inclusion.
 *
 * @param {string|null|undefined} url
 * @param {boolean|undefined} includeFullUrl
 * @param {boolean} isValidHttpUrl
 * @returns {boolean}
 */
function _canIncludeFullUrl(url, includeFullUrl, isValidHttpUrl) {
  return (
    includeFullUrl === true &&
    isValidHttpUrl &&
    typeof url === "string" &&
    url.length <= MAX_REPORT_URL_LENGTH
  );
}

/**
 * Builds the field set for the popup's form-based GitHub issue deep-link
 * (.github/ISSUE_TEMPLATE/broken-site.yml). Returns a plain object matching
 * the template's field IDs. The `url` key is present ONLY when the caller
 * opted in AND the URL is a valid http(s) URL within the length cap;
 * otherwise it is omitted entirely (hostname-only, current behaviour).
 *
 * Defensive defaults — never throws on bad input:
 *   - url null/undefined/malformed → hostname "", url key omitted
 *   - removedParams empty/missing  → params key omitted
 *
 * @param {object} input
 * @param {string} input.url - the page URL being reported
 * @param {boolean} [input.includeFullUrl] - user opt-in checkbox state
 * @param {string[]} [input.removedParams] - tracking params MUGA removed
 * @param {string} [input.version] - MUGA version (manifest)
 * @param {string} [input.browser] - browser identifier (e.g. navigator.userAgent)
 * @returns {object} plain fields object for URLSearchParams
 */
export function buildBrokenSiteReportFields(input) {
  // Defensive: destructuring defaults (`= {}`) only cover `undefined`, not an
  // explicit `null` argument — normalise both to an empty object up front.
  const { url, includeFullUrl, removedParams, version, browser } = input || {};
  const { hostname, isValidHttpUrl } = _parseReportUrl(url);

  const fields = {
    template: "broken-site.yml",
    title: `[Broken] ${hostname}`,
    hostname,
    browser: browser == null ? "" : String(browser),
    version: version == null ? "" : String(version),
    // Defensive: the YAML template applies labels=broken-site,bug
    // automatically, but pass it explicitly so the label is applied
    // even if the template file ever fails to load on GitHub's side.
    labels: "broken-site",
  };

  if (Array.isArray(removedParams) && removedParams.length > 0) {
    fields.params = removedParams.join(", ");
  }

  // PRIVACY-CRITICAL: `url` is added ONLY when every gate passes. Do not
  // relax this to "truthy url" — an unchecked box or a non-http(s)/oversized
  // URL must NEVER leak into the report.
  if (_canIncludeFullUrl(url, includeFullUrl, isValidHttpUrl)) {
    fields.url = url;
  }

  return fields;
}

/**
 * Builds the markdown body for the options page's free-text GitHub issue
 * report. Includes a `**Full URL:**` line ONLY when the caller opted in AND
 * the URL is a valid http(s) URL within the length cap; otherwise falls
 * back to the current `**Domain:**` line (hostname only).
 *
 * @param {object} input
 * @param {string} input.url - the page URL being reported
 * @param {boolean} [input.includeFullUrl] - user opt-in checkbox state
 * @param {string} [input.hostname] - precomputed hostname (falls back to deriving from url)
 * @param {string} [input.version] - MUGA version
 * @param {string} [input.browser] - browser identifier
 * @param {string} [input.action] - cleaner action taken (e.g. "cleaned")
 * @param {string[]} [input.removedParams] - tracking params MUGA removed
 * @returns {string} markdown body
 */
export function buildBrokenSiteReportBody(input) {
  // Defensive: destructuring defaults (`= {}`) only cover `undefined`, not an
  // explicit `null` argument — normalise both to an empty object up front.
  const { url, includeFullUrl, hostname, version, browser, action, removedParams } = input || {};
  const parsed = _parseReportUrl(url);
  const safeHostname = hostname == null || hostname === "" ? parsed.hostname : String(hostname);
  const safeVersion = version == null ? "" : String(version);
  const safeBrowser = browser == null ? "" : String(browser);
  const safeAction = action == null || action === "" ? "none" : String(action);
  const safeRemoved =
    Array.isArray(removedParams) && removedParams.length > 0
      ? removedParams.join(", ")
      : "none";

  const locationLine = _canIncludeFullUrl(url, includeFullUrl, parsed.isValidHttpUrl)
    ? `**Full URL:** ${url}\n`
    : `**Domain:** ${safeHostname}\n`;

  return (
    `## URL Report\n\n` +
    locationLine +
    `**MUGA version:** ${safeVersion}\n` +
    `**Browser:** ${safeBrowser}\n` +
    `**Action taken:** ${safeAction}\n` +
    `**Params removed:** ${safeRemoved}\n\n` +
    `## Problem\n\n` +
    `<!-- Describe what went wrong: params that should have been removed but weren't, or params that were removed but shouldn't have been -->\n\n` +
    `## Expected behavior\n\n` +
    `<!-- What should MUGA do with this URL? -->\n`
  );
}
