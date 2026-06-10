/**
 * MUGA — moat-expansion coverage differ (#793).
 *
 * Pure function that classifies each (provider, param) tuple from ClearURLs
 * against the current affiliate moat. No I/O, no side effects.
 *
 * Coverage sources (per spec §Coverage Differ):
 *   (a) AFFILIATE_PATTERNS — param+domain overlap with knownByProgramId + coveredByDomain
 *   (b) REDIRECT_NETWORK_PATTERNS landingParams — landingParamSet (no domain constraint)
 *   (c) AFFILIATE_PARAM_GUARD — guardParams (case-insensitive)
 *
 * A param is a GAP if and only if NOT covered by (a) OR (b) OR (c).
 *
 * Output shape:
 *   {
 *     newOnKnown:         Array<{programId, domains[], param, provider}>
 *     unknownProvider:    Array<{provider, urlPattern, referralMarketing[]}>
 *     alreadyCoveredCount: number
 *   }
 *
 * Deterministic ordering:
 *   - newOnKnown sorted by programId, then param (both ascending)
 *   - unknownProvider sorted by provider key (ascending)
 *
 * Public API (named export only — no default):
 *   diffMoat(signals, snapshot, lookup)
 */

// ── diffMoat ──────────────────────────────────────────────────────────────────

/**
 * Classify ClearURLs referralMarketing signals against the affiliate moat.
 *
 * @param {Array<{provider: string, urlPattern: string, referralMarketing: string[]}>} signals
 *   Extracted tuples from extractReferralSignals.
 * @param {{
 *   coveredByDomain: Map<string, Set<string>>,
 *   guardParams: Set<string>,
 *   knownByProgramId: Map<string, {param: string, domains: string[]}>,
 *   landingParamSet: Set<string>
 * }} snapshot
 *   Built by loadMoatSnapshot; injectable for tests.
 * @param {Record<string, {programId: string, domains: string[], note: string}>} lookup
 *   KNOWN_PROGRAMS from lookup-table.mjs; injectable for tests.
 * @returns {{
 *   newOnKnown: Array<{programId: string, domains: string[], param: string, provider: string}>,
 *   unknownProvider: Array<{provider: string, urlPattern: string, referralMarketing: string[]}>,
 *   alreadyCoveredCount: number
 * }}
 */
export function diffMoat(signals, snapshot, lookup) {
  const { coveredByDomain, guardParams, knownByProgramId, landingParamSet } = snapshot;

  /** @type {Array<{programId: string, domains: string[], param: string, provider: string}>} */
  const newOnKnown = [];

  /** @type {Array<{provider: string, urlPattern: string, referralMarketing: string[]}>} */
  const unknownProvider = [];

  let alreadyCoveredCount = 0;

  for (const signal of signals) {
    const { provider, urlPattern, referralMarketing } = signal;

    // Determine if this provider is in the lookup table
    const lookupEntry = lookup[provider];

    if (lookupEntry === undefined) {
      // Unknown provider: carry raw tuple through, no domain inference
      unknownProvider.push({ provider, urlPattern, referralMarketing });
      continue;
    }

    // Known provider: evaluate coverage per param
    const { programId, domains } = lookupEntry;

    for (const param of referralMarketing) {
      if (isCovered(param, programId, domains, coveredByDomain, guardParams, landingParamSet, knownByProgramId)) {
        alreadyCoveredCount += 1;
      } else {
        newOnKnown.push({ programId, domains: domains.slice(), param, provider });
      }
    }
  }

  // Sort newOnKnown: by programId ASC, then param ASC (deterministic)
  newOnKnown.sort((a, b) => {
    const cmp = a.programId.localeCompare(b.programId);
    return cmp !== 0 ? cmp : a.param.localeCompare(b.param);
  });

  // Sort unknownProvider: by provider ASC (deterministic)
  unknownProvider.sort((a, b) => a.provider.localeCompare(b.provider));

  return { newOnKnown, unknownProvider, alreadyCoveredCount };
}

// ── Coverage logic ────────────────────────────────────────────────────────────

/**
 * Determine if a (param, programId) tuple is covered by any of the three
 * moat coverage sources.
 *
 * @param {string} param
 * @param {string} programId
 * @param {string[]} lookupDomains - Canonical domains from the lookup table for this provider.
 * @param {Map<string, Set<string>>} coveredByDomain
 * @param {Set<string>} guardParams - Already lowercased.
 * @param {Set<string>} landingParamSet
 * @param {Map<string, {param: string, domains: string[]}>} knownByProgramId
 * @returns {boolean}
 */
function isCovered(param, programId, lookupDomains, coveredByDomain, guardParams, landingParamSet, knownByProgramId) {
  // (c) AFFILIATE_PARAM_GUARD — case-insensitive
  // guardParams is already lowercased by loadMoatSnapshot
  if (guardParams.has(param.toLowerCase())) {
    return true;
  }

  // (b) REDIRECT_NETWORK_PATTERNS landingParams — no domain constraint
  if (landingParamSet.has(param)) {
    return true;
  }

  // (a) AFFILIATE_PATTERNS — param+domain overlap
  // A param is covered if the program's param matches AND at least one domain
  // from the lookup table's canonical set overlaps with coveredByDomain entries
  // that carry this param.
  //
  // Spec: "param name equals the program's param field AND the lookup table
  // maps the provider to a domain set that overlaps with the program's domains[]"
  const moatEntry = knownByProgramId.get(programId);
  if (moatEntry !== undefined) {
    // The moat knows about this program
    if (moatEntry.param === param) {
      // The param matches; check domain overlap
      for (const domain of lookupDomains) {
        // Normalize domain to strip leading www. (mirrors moat-snapshot.mjs)
        const normalized = domain.replace(/^www\./, "");
        const coveredParams = coveredByDomain.get(normalized);
        if (coveredParams !== undefined && coveredParams.has(param)) {
          return true;
        }
      }
    }
  } else {
    // Program not in knownByProgramId but provider IS in lookup table.
    // Fall back to domain-based check: if any domain in the lookup set has
    // this param in coveredByDomain, it is covered.
    for (const domain of lookupDomains) {
      const normalized = domain.replace(/^www\./, "");
      const coveredParams = coveredByDomain.get(normalized);
      if (coveredParams !== undefined && coveredParams.has(param)) {
        return true;
      }
    }
  }

  return false;
}
