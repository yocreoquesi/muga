/**
 * MUGA — Core URL processing logic
 * Exported as a module for use in the service worker.
 */

import { TRACKING_PARAMS, getPatternsForHost } from "./affiliates.js";

/**
 * Processes a URL: removes tracking params, detects foreign affiliates,
 * and optionally injects our own affiliate tag.
 *
 * @param {string} rawUrl
 * @param {object} prefs
 * @returns {{ cleanUrl: string, action: string, removedTracking: string[], detectedAffiliate: object|null }}
 */
export function processUrl(rawUrl, prefs) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return { cleanUrl: rawUrl, action: "untouched", removedTracking: [], detectedAffiliate: null };
  }

  const patterns = getPatternsForHost(url.hostname);
  const removedTracking = [];
  let detectedAffiliate = null;
  let action = "untouched";

  // 1. Detect foreign affiliate tag (only when we have our own tag to compare against)
  if (prefs.notifyForeignAffiliate || prefs.allowReplaceAffiliate) {
    for (const pattern of patterns) {
      if (pattern.ourTag) {
        const value = url.searchParams.get(pattern.param);
        if (value && value !== pattern.ourTag) {
          detectedAffiliate = { param: pattern.param, value, pattern };
          action = "detected_foreign";
          break;
        }
      }
    }
  }

  // 2. Remove tracking params
  for (const param of [...url.searchParams.keys()]) {
    if (TRACKING_PARAMS.includes(param.toLowerCase())) {
      url.searchParams.delete(param);
      removedTracking.push(param);
    }
  }

  if (removedTracking.length > 0 && action === "untouched") {
    action = "cleaned";
  }

  // 3. Inject our affiliate tag (only if no foreign affiliate detected)
  if (prefs.injectOwnAffiliate && action !== "detected_foreign") {
    for (const pattern of patterns) {
      if (pattern.ourTag && !url.searchParams.has(pattern.param)) {
        url.searchParams.set(pattern.param, pattern.ourTag);
        action = "injected";
        break;
      }
    }
  }

  return {
    cleanUrl: url.toString(),
    action,
    removedTracking,
    detectedAffiliate,
  };
}
