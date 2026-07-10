/** MUGA: Web-cleaner-tool adapter (#1029, Phase 3)
 *
 * The ONLY module in the whole repository allowed to reference
 * `window.__mugaCleaner`. Translates MUGA's internal `processUrl` engine
 * return shape into a small, stable contract that the UI (web/ui/*,
 * Phase 4) depends on. If MUGA's internal API shifts, only this file
 * changes (design ADR-1/ADR-5, sdd/web-cleaner-tool/design).
 *
 * Injectable engine (design ADR-6): `cleanUrl(input, engine)` accepts an
 * explicit engine handle as its testability seam. The browser page omits
 * the second argument so `resolveEngine()` resolves the real
 * `window.__mugaCleaner` attached by the vendored engine bundle; unit
 * tests pass a fake or the real bundle loaded DOM-free via
 * tests/unit/helpers/load-web-engine.mjs.
 */

// web/engine/domain-rules.json is a generated, drift-gated byte copy of
// src/rules/domain-rules.json (tools/build-web.mjs) — gives the web tool
// full per-domain preserveParams/stripParams parity with MUGA core.
import domainRules from "./domain-rules.json" with { type: "json" };

/** Redirect-destination length cap, mirrored from AGENTS.md security rules. */
const MAX_URL_LENGTH = 2000;

/**
 * Resolves the cleaning engine from the browser global attached by the
 * vendored `cleaner-bundle.js` `<script>` tag.
 *
 * @returns {object|null} `window.__mugaCleaner` when it exposes a
 *   `processUrl` function, otherwise `null`.
 */
export function resolveEngine() {
  if (typeof window === "undefined" || !window) return null;
  const candidate = window.__mugaCleaner;
  if (candidate && typeof candidate.processUrl === "function") return candidate;
  return null;
}

/**
 * Builds an invalid/error result shape. Shared by every early-return path
 * so the stable contract's keys never drift between branches.
 *
 * @param {string} action  "invalid" or "error"
 * @param {string} error   Friendly, user-facing reason.
 * @param {string} rawInput
 * @returns {object}
 */
function buildFailure(action, error, rawInput) {
  return {
    ok: false,
    cleanUrl: typeof rawInput === "string" ? rawInput : "",
    removed: [],
    unwrapped: false,
    destinationHost: null,
    affiliatePreserved: false,
    action,
    error,
  };
}

/**
 * Builds the pure-cleaner prefs object for the web tool (design ADR-5): no
 * consent flow exists here, so the tool is Scenario-A-only. Built from the
 * REAL defaults (`engine.PREF_DEFAULTS`) so behavioural defaults never
 * hand-drift from `src/lib/prefs.js`.
 *
 * @param {object} prefDefaults
 * @returns {object}
 */
function buildPureCleanerPrefs(prefDefaults) {
  return {
    ...prefDefaults,
    enabled: true,
    onboardingDone: true,
    injectOwnAffiliate: false,
    notifyForeignAffiliate: false,
    honorCreatorMode: false,
    blacklist: [],
    whitelist: [],
    customParams: [],
    userCustomRules: [],
  };
}

/**
 * Cleans a pasted URL using MUGA's real cleaning engine, entirely
 * client-side. Never throws — every failure path (invalid input, missing
 * engine, engine error) returns `{ ok: false, ... }` with a friendly
 * `error` string (AGENTS.md: URL parse failures are no-ops, never
 * rethrown).
 *
 * @param {string} input   Pasted URL text.
 * @param {object} [engine=resolveEngine()]
 *   Injected engine handle (testability seam). Defaults to
 *   `window.__mugaCleaner` in the browser.
 * @returns {{
 *   ok: boolean,
 *   cleanUrl: string,
 *   removed: string[],
 *   unwrapped: boolean,
 *   destinationHost: string|null,
 *   affiliatePreserved: boolean,
 *   action: string,
 *   error?: string,
 * }}
 */
export function cleanUrl(input, engine = resolveEngine()) {
  if (typeof input !== "string" || input.trim().length === 0) {
    return buildFailure("invalid", "Enter a URL to clean.", input);
  }
  if (input.length > MAX_URL_LENGTH) {
    return buildFailure("invalid", "That URL is too long to clean.", input);
  }

  let inputUrl;
  try {
    inputUrl = new URL(input);
  } catch {
    return buildFailure("invalid", "That doesn't look like a valid URL.", input);
  }
  if (inputUrl.protocol !== "http:" && inputUrl.protocol !== "https:") {
    return buildFailure("invalid", "Only http and https links can be cleaned.", input);
  }

  if (!engine || typeof engine.processUrl !== "function") {
    return { ...buildFailure("error", "engine-unavailable", input) };
  }

  const prefs = buildPureCleanerPrefs(engine.PREF_DEFAULTS || {});

  let result;
  try {
    result = engine.processUrl(input, prefs, domainRules);
  } catch {
    return { ...buildFailure("error", "processing-failed", input) };
  }

  if (!result || typeof result.cleanUrl !== "string") {
    return { ...buildFailure("error", "processing-failed", input) };
  }

  let destinationHost = null;
  try {
    destinationHost = new URL(result.cleanUrl).hostname;
  } catch {
    destinationHost = null;
  }

  const unwrapped = destinationHost !== null && destinationHost !== inputUrl.hostname;

  return {
    ok: true,
    cleanUrl: result.cleanUrl,
    removed: Array.isArray(result.removedTracking) ? result.removedTracking : [],
    unwrapped,
    destinationHost,
    affiliatePreserved: !!(result.preservedAffiliate || result.creatorReferralPreserved),
    action: result.action,
  };
}
