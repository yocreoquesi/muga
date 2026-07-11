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
    mugaReferralPresent: false,
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
 * `injectOwnAffiliate` stays on (design D1, web-tool-naked-link-injection
 * slice 2, ADR-1): the web tool injects MUGA's own tag on naked Amazon/eBay
 * links so the tool can fund itself, while every other web-tool policy
 * override (no notify, no honor-creator, no lists) stays in place. The
 * tag-free variant is no longer produced by a second injection-off run; it
 * is derived by surgically stripping MUGA's own tag from the cleaned URL
 * (see detectOwnReferral), which also covers links that ALREADY carried our
 * referral before cleaning.
 *
 * @param {object} prefDefaults
 * @returns {object}
 */
function buildPureCleanerPrefs(prefDefaults) {
  return {
    ...prefDefaults,
    enabled: true,
    onboardingDone: true,
    injectOwnAffiliate: true,
    notifyForeignAffiliate: false,
    honorCreatorMode: false,
    blacklist: [],
    whitelist: [],
    customParams: [],
    userCustomRules: [],
  };
}

/**
 * Resolves MUGA's own affiliate tag for an affiliate pattern + hostname.
 * Adapter-local mirror of src/lib/affiliates.js `resolveOurTag`: the engine
 * bundle exposes `AFFILIATE_PATTERNS` (each pattern carries its per-host
 * `ourTag` map) and `getPatternsForHost`, but not `resolveOurTag` itself.
 * Reading the already-exposed `ourTag` map keeps the tag VALUES single-
 * sourced in the engine, so this adapter never hard-codes them.
 *
 * @param {{ourTag?: Object}|null|undefined} pattern
 * @param {string} hostname
 * @returns {string} the tag configured for this host, or "" when none.
 */
function resolveOurTag(pattern, hostname) {
  if (!pattern || !pattern.ourTag || !hostname) return "";
  const host = hostname.replace(/^www\./, "");
  return pattern.ourTag[host] || pattern.ourTag[hostname] || "";
}

/**
 * Detects whether a cleaned URL carries MUGA's OWN affiliate referral and,
 * when it does, returns the URL with only that param removed.
 *
 * Matches our tag by VALUE against the engine's per-host affiliate patterns,
 * so a foreign/creator referral (a different value on the same param, e.g.
 * `tag=somecreator-20`) is never stripped: the preservation moat stays
 * intact. Covers BOTH the just-injected case and a link the user pasted that
 * already carried MUGA's tag (design "copy-without-referral parity"). Never
 * throws: any failure degrades to "no own referral".
 *
 * @param {string} cleanUrl            The cleaned URL returned by the engine.
 * @param {string|null} destinationHost  Its hostname (already parsed by the caller).
 * @param {object} engine              The resolved engine handle.
 * @returns {{ present: boolean, stripped: string|null }}
 */
function detectOwnReferral(cleanUrl, destinationHost, engine) {
  const none = { present: false, stripped: null };
  if (typeof cleanUrl !== "string" || !destinationHost) return none;
  if (!engine || typeof engine.getPatternsForHost !== "function") return none;

  let url;
  try {
    url = new URL(cleanUrl);
  } catch {
    return none;
  }

  const host = destinationHost.replace(/^www\./, "");
  const patterns = engine.getPatternsForHost(host) || [];
  let present = false;
  for (const pattern of patterns) {
    const ourTag = resolveOurTag(pattern, host);
    if (!ourTag) continue;
    if (url.searchParams.get(pattern.param) === ourTag) {
      url.searchParams.delete(pattern.param);
      present = true;
    }
  }
  return present ? { present: true, stripped: url.toString() } : none;
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
 *   mugaReferralPresent: boolean,
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
  // affiliatePreserved. "injected" means MUGA added its own tag THIS run; a
  // preserved creator/foreign referral means nothing MUGA-owned was added.
  // It drives the disclosure WORDING (added vs already present).
  const mugaReferralInjected = result.action === "injected";

  // mugaReferralPresent + cleanUrlNoMugaReferral: the "copy without referral"
  // opt-out must appear whenever the cleaned URL carries MUGA's OWN referral,
  // whether MUGA injected it this run OR the pasted link already carried it
  // (a MUGA-tagged link the user re-cleans). Detect our tag by value against
  // the engine's per-host affiliate patterns and surgically remove only that
  // param, so a foreign/creator referral is never stripped. This replaces the
  // old injection-off rerun, which missed the already-present case entirely.
  const ownReferral = detectOwnReferral(result.cleanUrl, destinationHost, engine);

  return {
    ok: true,
    cleanUrl: result.cleanUrl,
    removed: Array.isArray(result.removedTracking) ? result.removedTracking : [],
    unwrapped,
    destinationHost,
    affiliatePreserved: !!(result.preservedAffiliate || result.creatorReferralPreserved),
    mugaReferralInjected,
    mugaReferralPresent: ownReferral.present,
    cleanUrlNoMugaReferral: ownReferral.stripped,
    action: result.action,
  };
}
