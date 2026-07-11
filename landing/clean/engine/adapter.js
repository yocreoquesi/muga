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

// web/engine/domain-rules.gen.mjs is a generated, drift-gated named-export
// ES module mirror of src/rules/domain-rules.json (tools/build-web.mjs) —
// gives the web tool full per-domain preserveParams/stripParams parity
// with MUGA core. A plain ES module import (no import-attribute syntax)
// so every module-supporting browser can load it; see build-web.mjs for
// why this replaced a JSON `with { type: "json" }` import (Phase 4).
import { DOMAIN_RULES } from "./domain-rules.gen.mjs";

// web/engine/path-strip-rules.gen.mjs is a generated, drift-gated named-export
// ES module mirror of src/rules/path-strip-rules.json (tools/build-web.mjs) —
// gives the web tool the same Amazon-style path-strip (product-name slug
// removal) behaviour as MUGA core. Wired as processUrl's 7th argument only;
// pathAffiliateRules (8th argument) is deliberately deferred to a later
// change.
import { PATH_STRIP_RULES } from "./path-strip-rules.gen.mjs";

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
    mugaReferralInjected: false,
    cleanUrlNoMugaReferral: null,
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
 * `injectOwnAffiliate` is now conditional (design D1, web-tool-naked-link-injection
 * slice 2, ADR-1): the web tool injects MUGA's own tag on naked Amazon/eBay
 * links by default so the tool can fund itself, while every other web-tool
 * policy override (no notify, no honor-creator, no lists) stays in place.
 * Callers that need the tag-free variant pass `injectMugaReferral: false`.
 *
 * @param {object} prefDefaults
 * @param {{ injectMugaReferral?: boolean }} [options]
 * @returns {object}
 */
function buildPureCleanerPrefs(prefDefaults, { injectMugaReferral = true } = {}) {
  return {
    ...prefDefaults,
    enabled: true,
    onboardingDone: true,
    injectOwnAffiliate: injectMugaReferral,
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
 *   mugaReferralInjected: boolean,
 *   cleanUrlNoMugaReferral: string|null,
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
    result = engine.processUrl(input, prefs, DOMAIN_RULES, undefined, undefined, undefined, PATH_STRIP_RULES);
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

  // mugaReferralInjected (design D2): keyed off action === "injected", NOT
  // affiliatePreserved. "injected" means MUGA added its own tag; a preserved
  // creator/foreign referral means nothing MUGA-owned was added. The engine
  // guard (D4) makes these mutually exclusive.
  const mugaReferralInjected = result.action === "injected";

  // cleanUrlNoMugaReferral (design D1): re-run the engine with injection OFF
  // instead of string-stripping the known tag. Single source of truth —
  // byte-exact to what the engine produces without injection, and this
  // adapter never has to know MUGA's own param names.
  let cleanUrlNoMugaReferral = null;
  if (mugaReferralInjected) {
    const noInjectPrefs = buildPureCleanerPrefs(engine.PREF_DEFAULTS || {}, { injectMugaReferral: false });
    try {
      const noInjectResult = engine.processUrl(input, noInjectPrefs, DOMAIN_RULES, undefined, undefined, undefined, PATH_STRIP_RULES);
      if (noInjectResult && typeof noInjectResult.cleanUrl === "string") {
        cleanUrlNoMugaReferral = noInjectResult.cleanUrl;
      }
    } catch {
      cleanUrlNoMugaReferral = null;
    }
  }

  return {
    ok: true,
    cleanUrl: result.cleanUrl,
    removed: Array.isArray(result.removedTracking) ? result.removedTracking : [],
    unwrapped,
    destinationHost,
    affiliatePreserved: !!(result.preservedAffiliate || result.creatorReferralPreserved),
    mugaReferralInjected,
    cleanUrlNoMugaReferral,
    action: result.action,
  };
}
