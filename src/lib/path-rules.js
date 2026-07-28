/** MUGA: Declarative path-rule loader — applyPathStrip + getPathAffiliatePolicy (issue #625). */

/**
 * Per-array compiled-regex index for path-strip rules.
 * Keyed by the rules array reference (WeakMap so GC can reclaim if SW
 * rebuilds the rules). Each value is an array of compiled rule objects:
 *   { domainRe: RegExp, passes: [{ re: RegExp, replacement: string }],
 *     fallbackPathname: string }
 *
 * Mirrors the _domainRulesIndex pattern in src/lib/cleaner.js.
 */
const _pathStripIndex = new WeakMap();

/**
 * Per-array compiled-regex index for path-affiliate rules.
 * Each value is a Map<domain, { referralRe: RegExp, unwrapRe: RegExp|null }>.
 *
 * drop-affiliate-injection (PR 1a): the inject* fields (injectPath,
 * injectParam, injectValue, affiliateIdSource) were removed — this index
 * only ever drove creator-referral detection/unwrap, not injection.
 */
const _pathAffiliateIndex = new WeakMap();

// ── Validators (throw on schema violation) ────────────────────────────────────

/**
 * @param {object} rule
 * @param {number} i
 */
function _validateStripEntry(rule, i) {
  if (typeof rule.domainPattern !== "string") {
    throw new TypeError(`path-strip-rules[${i}]: domainPattern (string) is required`);
  }
  if (!Array.isArray(rule.pathPatterns)) {
    throw new TypeError(`path-strip-rules[${i}]: pathPatterns must be an array`);
  }
  if (!Array.isArray(rule.replacements)) {
    throw new TypeError(`path-strip-rules[${i}]: replacements must be an array`);
  }
  if (rule.pathPatterns.length !== rule.replacements.length) {
    throw new TypeError(
      `path-strip-rules[${i}]: pathPatterns (${rule.pathPatterns.length}) and replacements (${rule.replacements.length}) must have the same length — different length arrays are invalid`
    );
  }
  try { new RegExp(rule.domainPattern, "i"); } catch (e) {
    throw new TypeError(`path-strip-rules[${i}].domainPattern is not a valid regex: ${e.message}`);
  }
  for (const [j, p] of rule.pathPatterns.entries()) {
    try { new RegExp(p); } catch (e) {
      throw new TypeError(`path-strip-rules[${i}].pathPatterns[${j}] is not a valid regex: ${e.message}`);
    }
  }
}

/**
 * @param {object} rule
 * @param {number} i
 */
function _validateAffiliateEntry(rule, i) {
  if (typeof rule.domain !== "string") {
    throw new TypeError(`path-affiliate-rules[${i}]: domain (string) is required`);
  }
  if (!Array.isArray(rule.referralPaths)) {
    throw new TypeError(`path-affiliate-rules[${i}]: referralPaths must be an array`);
  }
  for (const [j, p] of rule.referralPaths.entries()) {
    try { new RegExp(p); } catch (e) {
      throw new TypeError(`path-affiliate-rules[${i}].referralPaths[${j}] is not a valid regex: ${e.message}`);
    }
  }
  // unwrapReferral is OPTIONAL (#959): older rule entries / other domains
  // without it keep working with no unwrap capability.
  if (rule.unwrapReferral !== undefined) {
    if (typeof rule.unwrapReferral !== "string") {
      throw new TypeError(`path-affiliate-rules[${i}].unwrapReferral must be a string`);
    }
    try { new RegExp(rule.unwrapReferral); } catch (e) {
      throw new TypeError(`path-affiliate-rules[${i}].unwrapReferral is not a valid regex: ${e.message}`);
    }
  }
}

// ── Internal index builders ───────────────────────────────────────────────────

/**
 * Returns a compiled index for the given pathStripRules array, building and
 * caching it on first call for each unique array reference. Returns null when
 * the array is empty or not an array (graceful-degradation path for SW fetch
 * failures — matches _ensureDomainIndex pattern in cleaner.js).
 *
 * @param {Array} rules
 * @returns {Array|null}
 */
function _ensureStripIndex(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  let idx = _pathStripIndex.get(rules);
  if (idx) return idx;
  // Guard: exact duplicate domainPattern strings make the second rule
  // unreachable (first-match-wins in applyPathStrip) and hide data-shape
  // errors (#831).  Regex-overlap in general is undecidable, so we only
  // catch the trivially detectable case: identical pattern strings.
  const seenPatterns = new Set();
  idx = [];
  for (const [i, rule] of rules.entries()) {
    _validateStripEntry(rule, i);
    if (seenPatterns.has(rule.domainPattern)) {
      throw new Error(
        `path-strip-rules[${i}]: duplicate domainPattern "${rule.domainPattern}" — ` +
        `each domainPattern string must be unique (first-match-wins; duplicates are unreachable)`
      );
    }
    seenPatterns.add(rule.domainPattern);
    const flags = Array.isArray(rule.flags) ? rule.flags : [];
    const passes = rule.pathPatterns.map((pattern, j) => ({
      re: new RegExp(pattern, flags[j] ?? ""),
      replacement: rule.replacements[j],
    }));
    idx.push({
      domainRe: new RegExp(rule.domainPattern, "i"),
      passes,
      fallbackPathname: typeof rule.fallbackPathname === "string" ? rule.fallbackPathname : "/",
    });
  }
  _pathStripIndex.set(rules, idx);
  return idx;
}

/**
 * Returns a compiled index for the given pathAffiliateRules array, building
 * and caching it on first call for each unique array reference.
 *
 * @param {Array} rules
 * @returns {Map|null}
 */
function _ensureAffiliateIndex(rules) {
  if (!Array.isArray(rules) || rules.length === 0) return null;
  let idx = _pathAffiliateIndex.get(rules);
  if (idx) return idx;
  idx = new Map();
  for (const [i, rule] of rules.entries()) {
    _validateAffiliateEntry(rule, i);
    // Guard: duplicate rule.domain would silently last-writer-wins and the
    // first rule's referralPaths would be unreachable (#831).
    if (idx.has(rule.domain)) {
      throw new Error(
        `path-affiliate-rules: duplicate domain "${rule.domain}" at index ${i} ` +
        `— each domain must appear at most once`
      );
    }
    const referralRe = new RegExp(rule.referralPaths.join("|"));
    idx.set(rule.domain, {
      referralRe,
      unwrapRe: rule.unwrapReferral ? new RegExp(rule.unwrapReferral) : null,
    });
  }
  _pathAffiliateIndex.set(rules, idx);
  return idx;
}

/**
 * Computes the unwrap destination for a matched /a/CREATOR/DEST wrapper
 * (#959), or undefined when there is nothing to unwrap / unwrap is unsafe.
 *
 * @param {{ unwrapRe: RegExp|null }} entry     Compiled affiliate-index entry.
 * @param {URL} url                             URL being processed.
 * @param {string} hostname                     Outer url.hostname, already
 *                                               normalized (www. stripped).
 * @returns {string|undefined}
 */
function _computeUnwrapTo(entry, url, hostname) {
  if (!entry.unwrapRe) return undefined;
  const match = entry.unwrapRe.exec(url.pathname);
  if (!match) return undefined;

  const capture = match[1];
  if (!capture) return undefined;

  let candidatePathname;
  let candidateSearch;

  if (/^https?:\/\//i.test(capture)) {
    let parsed;
    try {
      parsed = new URL(capture);
    } catch {
      return undefined;
    }
    const capturedHostname = parsed.hostname.replace(/^www\./, "");
    if (capturedHostname !== hostname) return undefined; // cross-origin, refuse to unwrap
    candidatePathname = parsed.pathname;
    candidateSearch = parsed.search;
  } else {
    candidatePathname = "/" + capture.replace(/^\/+/, "");
    candidateSearch = "";
  }

  // Nesting guard: never unwrap into another /a/ wrapper.
  if (/^\/a\//.test(candidatePathname)) return undefined;

  return candidatePathname + candidateSearch;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Apply all path-strip passes whose domainPattern matches hostname.
 * Pure: returns a possibly-rewritten pathname; never mutates inputs.
 *
 * @param {string} hostname        Lowercase hostname from the URL.
 * @param {string} pathname        Original URL.pathname.
 * @param {Array}  pathStripRules  Parsed path-strip-rules.json array.
 * @returns {string}               Rewritten pathname, or original if no rule matched.
 */
export function applyPathStrip(hostname, pathname, pathStripRules) {
  const compiled = _ensureStripIndex(pathStripRules);
  if (!compiled) return pathname;
  for (const rule of compiled) {
    if (!rule.domainRe.test(hostname)) continue;
    let out = pathname;
    for (const pass of rule.passes) {
      out = out.replace(pass.re, pass.replacement);
    }
    return out === "" ? rule.fallbackPathname : out;
  }
  return pathname;
}

/**
 * Returns the path-affiliate policy for the given URL.
 *
 * drop-affiliate-injection (PR 1a): this function used to also resolve the
 * DATA half of the Bookshop own-affiliate-injection guard (`pendingInjection`)
 * — that responsibility is REMOVED along with the inject* fields in
 * path-affiliate-rules.json. This function now ONLY resolves creator-referral
 * detection + unwrap; it never signals a pending injection.
 *
 * @param {URL}   url                  URL being processed (read-only).
 * @param {Array} pathAffiliateRules   Parsed path-affiliate-rules.json array.
 * @returns {{ creatorReferralPreserved: boolean, unwrapTo?: string }}
 *   `unwrapTo` (#959) is present only when the referral path is an
 *   unwrappable /a/CREATOR/DEST wrapper (rule.unwrapReferral matched with a
 *   usable destination); it holds the destination pathname + search to
 *   rewrite the URL to when the caller opts into unwrapping (stripAllAffiliates).
 */
export function getPathAffiliatePolicy(url, pathAffiliateRules) {
  const NO_MATCH = { creatorReferralPreserved: false };
  const idx = _ensureAffiliateIndex(pathAffiliateRules);
  if (!idx) return NO_MATCH;

  // Strip www. for exact-domain match (spec REQ-3: "strip www. from url.hostname")
  const hostname = url.hostname.replace(/^www\./, "");
  const entry = idx.get(hostname);
  if (!entry) return NO_MATCH;

  // Check creator-referral paths — any match means the referral is preserved.
  if (entry.referralRe.test(url.pathname)) {
    const unwrapTo = _computeUnwrapTo(entry, url, hostname);
    return unwrapTo !== undefined
      ? { creatorReferralPreserved: true, unwrapTo }
      : { creatorReferralPreserved: true };
  }

  return NO_MATCH;
}

/**
 * Accepts raw parsed path-strip-rules.json array and pre-compiles all regexes
 * by warming the WeakMap cache. Called once at SW boot.
 *
 * @param {Array} rawArray  Parsed JSON array.
 * @returns {Array}         The same array (pass-through; cache is internal).
 */
export function loadPathStripRules(rawArray) {
  _ensureStripIndex(rawArray);
  return rawArray;
}

/**
 * Accepts raw parsed path-affiliate-rules.json array and pre-compiles all
 * referralPaths regexes by warming the WeakMap cache. Called once at SW boot.
 *
 * @param {Array} rawArray  Parsed JSON array.
 * @returns {Array}         The same array (pass-through; cache is internal).
 */
export function loadPathAffiliateRules(rawArray) {
  _ensureAffiliateIndex(rawArray);
  return rawArray;
}
