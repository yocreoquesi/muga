/**
 * MUGA: Content-script bundle entry (#356)
 *
 * This module is the SOURCE for the bundled content-script lib. It imports
 * from src/lib/ and re-exports onto a window-scoped namespace so the legacy
 * content-script IIFE in src/content/cleaner.js can call cleaning logic
 * directly without round-tripping to the service worker.
 *
 * **Do not load this file directly as a content script.** MV3 content
 * scripts cannot use ES module imports cross-browser (Firefox MV2). The
 * build pipeline runs `npm run build:content` which uses esbuild to
 * produce `src/content/cleaner-bundle.js` (IIFE) — that's the file the
 * manifest loads.
 *
 * The bundle attaches a single namespace to `window.__mugaCleaner` (in the
 * content-script's isolated world). See cleaner.js for consumers.
 */

import { processUrl, parseListEntry, getDomainParamSets, getPreservedParams, getLandingPolicy, isSiteFullyExempt } from "../lib/cleaner.js";
// web-cleaner-tool (#1029, Phase 1): the standalone web/ tool builds its
// pure-cleaner prefs off the REAL defaults instead of a hand-copied literal
// that could silently drift from src/lib/prefs.js. getPrefs/setPrefs (the
// only chrome.storage touchers in prefs.js) are never called here, so
// esbuild tree-shakes them away — see web-engine-purity.test.mjs.
import { PREF_DEFAULTS } from "../lib/prefs.js";
import {
  TRACKING_PARAMS,
  TRACKING_PARAM_CATEGORIES,
  TRACKING_PREFIXES,
  AFFILIATE_PATTERNS,
  getAffiliateDomains,
  getPatternsForHost,
  // 2.1 denoise pivot (#654): redirect-network patterns + lookup helpers.
  // Consumed by #656 getLandingPolicy and the URL Unwrapper UI rebrand.
  REDIRECT_NETWORK_PATTERNS,
  getRedirectNetworkPatterns,
  getRedirectNetworkForRedirectHost,
  getLandingParamsForReferrer,
} from "../lib/affiliates.js";
import { detectWrapper, unwrap, WRAPPERS } from "../lib/wrapper-engine.js";
// redirector-coverage-expansion (T11): expose the single-source opaque-network
// list and its hostname matcher via the bundle so cleaner.js can delegate to
// window.__mugaCleaner.isOpaqueNetworkHost instead of carrying an inline replica.
// 2.1 denoise pivot (#653): also expose the split buckets (GENERIC_SHORTENERS,
// AFFILIATE_REDIRECT_NETWORKS) and their helpers so callers can express intent.
import {
  OPAQUE_NETWORKS,
  isOpaqueNetworkHost,
  GENERIC_SHORTENERS,
  AFFILIATE_REDIRECT_NETWORKS,
  isGenericShortener,
  isAffiliateRedirectNetwork,
} from "../lib/opaque-networks.js";

// Attach onto the isolated-world window. Content scripts in the same
// content_scripts entry share a window object; cleaner.js (loaded after
// this bundle) reads from here.
//
// Wrapped in a guard so a duplicate execution (already prevented by the
// IIFE guard in cleaner.js but defensive) does not overwrite a live ref.
if (!window.__mugaCleaner) {
  window.__mugaCleaner = Object.freeze({
    processUrl,
    parseListEntry,
    getDomainParamSets,
    getPreservedParams,
    getLandingPolicy,
    isSiteFullyExempt,
    TRACKING_PARAMS,
    TRACKING_PARAM_CATEGORIES,
    TRACKING_PREFIXES,
    AFFILIATE_PATTERNS,
    getAffiliateDomains,
    getPatternsForHost,
    REDIRECT_NETWORK_PATTERNS,
    getRedirectNetworkPatterns,
    getRedirectNetworkForRedirectHost,
    getLandingParamsForReferrer,
    detectWrapper,
    unwrap,
    WRAPPERS,
    OPAQUE_NETWORKS,
    isOpaqueNetworkHost,
    GENERIC_SHORTENERS,
    AFFILIATE_REDIRECT_NETWORKS,
    isGenericShortener,
    isAffiliateRedirectNetwork,
    PREF_DEFAULTS,
    // __MUGA_VERSION__ is substituted at build time by tools/bundle-content.mjs
    // (esbuild `define`, sourced from package.json's version). Declared as a
    // global in eslint.config.mjs + jsconfig.json so lint/typecheck stay green.
    __version__: __MUGA_VERSION__,
  });
}
