/**
 * MUGA — Pure builder for the "Report upstream" tracker-flag GitHub issue
 * deep-link (#1351 R3-tautological-deeplink-tests).
 *
 * Previously this logic lived inline inside options.js's
 * buildReportUpstreamButton, and its unit test independently rebuilt the
 * SAME URL-construction logic instead of calling the real code — a
 * tautological test that could never catch a regression in the actual
 * implementation. Extracted here so the test exercises the real code,
 * mirroring the precedent set by domain-stats-view.js /
 * suspicious-params-view.js.
 *
 * Privacy contract: the deep-link only carries fields the user is about to
 * review and submit themselves on github.com. Nothing is sent
 * automatically, and the fields prefilled are:
 *   - paramName (the flagged param)
 *   - domains   (first-party hosts where the param was seen, capped at 50
 *                entries to stay well under GitHub's ~8 KB URL ceiling)
 *   - entropy_score, frequency_distinct_domains, frequency_distinct_values
 * Raw values, raw URLs, value hashes, and timestamps (firstSeen/lastSeen)
 * are NEVER read from trackerState, so they cannot leak into the URL.
 *
 * @param {string} paramName Original-case param name.
 * @param {object|null} trackerState Raw cross-site-frequency state
 *   ({params:{...}}), the raw unwrapped shape ({[param]:{...}}), or null
 *   when the frequency tracker is disabled or has no entry for this param.
 * @returns {string} the complete https://github.com/... deep-link URL.
 */
export function buildTrackerFlagDeepLinkUrl(paramName, trackerState) {
  let entry = null;
  if (trackerState && typeof trackerState === "object") {
    const entries = trackerState.params && typeof trackerState.params === "object"
      ? trackerState.params
      : trackerState;
    entry = entries && entries[paramName] ? entries[paramName] : null;
  }
  const domains = entry && Array.isArray(entry.domains) ? entry.domains : [];
  const distinctValues = entry && Array.isArray(entry.values) ? entry.values.length : 0;
  const entropyAvg = entry && typeof entry.entropyAvg === "number" ? entry.entropyAvg : null;

  // Cap at 50 entries to stay well under GitHub's ~8 KB URL ceiling. The
  // form's textarea accepts free input, so the user can add more before
  // submitting if their list is longer.
  const cappedDomains = domains.slice(0, 50);

  const params = new URLSearchParams();
  params.set("template", "tracker-flag.yml");
  params.set("paramName", paramName);
  if (cappedDomains.length > 0) params.set("domains", cappedDomains.join("\n"));
  if (entropyAvg !== null) params.set("entropy_score", entropyAvg.toFixed(2));
  if (domains.length > 0) params.set("frequency_distinct_domains", String(domains.length));
  if (distinctValues > 0) params.set("frequency_distinct_values", String(distinctValues));

  return `https://github.com/yocreoquesi/muga/issues/new?${params.toString()}`;
}
