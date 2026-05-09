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

import { processUrl, parseListEntry, getDomainParamSets, getPreservedParams } from "../lib/cleaner.js";
import {
  TRACKING_PARAMS,
  TRACKING_PARAM_CATEGORIES,
  AFFILIATE_PATTERNS,
  getAffiliateDomains,
  getPatternsForHost,
} from "../lib/affiliates.js";
import { detectWrapper, unwrap, WRAPPERS } from "../lib/wrapper-engine.js";
// redirector-coverage-expansion (T11): expose the single-source opaque-network
// list and its hostname matcher via the bundle so cleaner.js can delegate to
// window.__mugaCleaner.isOpaqueNetworkHost instead of carrying an inline replica.
import { OPAQUE_NETWORKS, isOpaqueNetworkHost } from "../lib/opaque-networks.js";

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
    TRACKING_PARAMS,
    TRACKING_PARAM_CATEGORIES,
    AFFILIATE_PATTERNS,
    getAffiliateDomains,
    getPatternsForHost,
    detectWrapper,
    unwrap,
    WRAPPERS,
    OPAQUE_NETWORKS,
    isOpaqueNetworkHost,
  });
}
