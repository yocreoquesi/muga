/** MUGA: Benchmark runner-core — pure helpers (no I/O). */

/**
 * Compare a corpus entry's expectation against a cleaner result.
 *
 * Returns { ok, expected, actual, diff } where:
 *  - ok: true when expectations are met
 *  - expected: the entry's expected fields
 *  - actual: the cleaner result fields
 *  - diff: a short string describing the mismatch (only set when !ok)
 *
 * The expected outcome is matched LOOSELY: the runner only enforces
 * what the corpus chose to assert. `expectedAction` is always required;
 * `expectedClean` is checked only when present in the entry.
 *
 * @param {{url:string, expectedAction:string, expectedClean?:string, category:string}} entry
 * @param {{action:string, cleanUrl:string}} result
 */
export function compareEntry(entry, result) {
  const expected = {
    action: entry.expectedAction,
    ...(entry.expectedClean !== undefined ? { cleanUrl: entry.expectedClean } : {}),
  };
  const actual = {
    action: result.action,
    cleanUrl: result.cleanUrl,
  };
  if (expected.action !== actual.action) {
    return {
      ok: false,
      expected,
      actual,
      diff: `action: expected "${expected.action}", got "${actual.action}"`,
    };
  }
  if (expected.cleanUrl !== undefined && expected.cleanUrl !== actual.cleanUrl) {
    return {
      ok: false,
      expected,
      actual,
      diff: `cleanUrl: expected "${expected.cleanUrl}", got "${actual.cleanUrl}"`,
    };
  }
  return { ok: true, expected, actual };
}

/**
 * Round a fraction to one decimal percentage point. Returns 0 when the
 * denominator is 0 (an empty category should not be NaN in the report).
 */
function pct(numerator, denominator) {
  if (denominator === 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

/**
 * Run every competitor adapter against an entry, returning a record of
 * { [adapter.name]: { cleanUrl } } per the contract in
 * tests/benchmark/competitors/README-CONTRACT.txt.
 *
 * Adapter `clean()` errors are caught and the input URL is returned
 * unchanged for that adapter — no single competitor's bug should crash
 * the whole run.
 *
 * @param {{url:string}} entry
 * @param {Array<{name:string, clean:(url:string)=>string}>} adapters
 * @returns {Record<string, {cleanUrl:string}>}
 */
export function runCompetitors(entry, adapters) {
  const out = {};
  if (!Array.isArray(adapters)) return out;
  for (const adapter of adapters) {
    if (!adapter || typeof adapter.name !== "string" || typeof adapter.clean !== "function") continue;
    let cleanUrl = entry.url;
    try {
      const result = adapter.clean(entry.url);
      if (typeof result === "string") cleanUrl = result;
    } catch {
      // Swallow per contract — adapter bugs must not crash the run.
    }
    out[adapter.name] = { cleanUrl };
  }
  return out;
}

/**
 * Build the report object summarising a benchmark run.
 *
 * The per-category bucket gains a `matchRate` field (0..100, one decimal)
 * so report readers can scan for the worst-covered categories without
 * recomputing percentages.
 *
 * Optional `competitorResults` (parallel to `results`) carries per-entry
 * competitor adapter outputs — when present, the report gains a
 * `byCompetitor` summary keyed by adapter name. This is phase 2 of A6
 * (#506) — phase 1 (#505) shipped MUGA-only.
 *
 * @param {{ corpus: Array<{url:string, category:string, expectedAction:string}>, results: Array<{ok:boolean, expected:object, actual:object, diff?:string}>, competitorResults?: Array<Record<string, {cleanUrl:string}>>, generatedAt?: string, runner?: string }} params
 * @returns {{ generatedAt:string, runner:string, totalEntries:number, matched:number, mismatched:number, matchRate:number, byCategory: Record<string,{total:number,matched:number,mismatched:number,matchRate:number}>, byCompetitor?: Record<string,{total:number,withExpectedClean:number,changedFromInput:number,matchedExpectedClean:number,matchRate:number}>, mismatches: Array<object> }}
 */
export function buildReport({ corpus, results, competitorResults, generatedAt, runner = "muga" }) {
  if (corpus.length !== results.length) {
    throw new Error(`buildReport: corpus length ${corpus.length} != results length ${results.length}`);
  }
  const byCategory = {};
  const mismatches = [];
  let matched = 0;
  for (let i = 0; i < corpus.length; i++) {
    const entry = corpus[i];
    const result = results[i];
    const cat = entry.category;
    if (!byCategory[cat]) byCategory[cat] = { total: 0, matched: 0, mismatched: 0, matchRate: 0 };
    byCategory[cat].total += 1;
    if (result.ok) {
      matched += 1;
      byCategory[cat].matched += 1;
    } else {
      byCategory[cat].mismatched += 1;
      mismatches.push({
        url: entry.url,
        category: entry.category,
        expected: result.expected,
        actual: result.actual,
        diff: result.diff,
      });
    }
  }
  for (const cat of Object.keys(byCategory)) {
    byCategory[cat].matchRate = pct(byCategory[cat].matched, byCategory[cat].total);
  }

  // Optional competitor summary. We only assert on `expectedClean` when
  // the corpus entry declared one — same precedence rule as compareEntry.
  let byCompetitor;
  if (Array.isArray(competitorResults) && competitorResults.length === corpus.length) {
    byCompetitor = {};
    for (let i = 0; i < corpus.length; i++) {
      const entry = corpus[i];
      const hasExpectedClean = entry.expectedClean !== undefined;
      const adapterMap = competitorResults[i] || {};
      for (const [name, { cleanUrl }] of Object.entries(adapterMap)) {
        if (!byCompetitor[name]) {
          byCompetitor[name] = { total: 0, withExpectedClean: 0, changedFromInput: 0, matchedExpectedClean: 0, matchRate: 0 };
        }
        const bucket = byCompetitor[name];
        bucket.total += 1;
        if (hasExpectedClean) bucket.withExpectedClean += 1;
        if (cleanUrl !== entry.url) bucket.changedFromInput += 1;
        if (hasExpectedClean && cleanUrl === entry.expectedClean) {
          bucket.matchedExpectedClean += 1;
        }
      }
    }
    // matchRate denominator is `withExpectedClean`, NOT `total` — entries
    // without an `expectedClean` field cannot be scored fairly (the
    // corpus author intentionally left the precise output unasserted).
    // Including them in the denominator would unfairly punish adapters
    // by counting unscoreable entries as fails. Phase 3 reports can
    // layer richer metrics (e.g. "changedFromInput" for any-cleanup
    // coverage) on top.
    for (const name of Object.keys(byCompetitor)) {
      byCompetitor[name].matchRate = pct(
        byCompetitor[name].matchedExpectedClean,
        byCompetitor[name].withExpectedClean,
      );
    }
  }

  const out = {
    generatedAt: generatedAt || new Date().toISOString(),
    runner,
    totalEntries: corpus.length,
    matched,
    mismatched: corpus.length - matched,
    matchRate: pct(matched, corpus.length),
    byCategory,
    mismatches,
  };
  if (byCompetitor) out.byCompetitor = byCompetitor;
  return out;
}

/**
 * Compute the runner's exit code from a report.
 * Returns 0 when all entries match, 1 otherwise.
 *
 * @param {{ mismatched:number }} report
 */
export function exitCodeFromReport(report) {
  return report.mismatched > 0 ? 1 : 0;
}

const ALLOWED_CATEGORIES = new Set([
  "utm",
  "affiliate-wrappers",
  "social-shorteners",
  "privacy-proxies",
  "analytics-clickids",
  "email-trackers",
  "amazon-affiliate-preserve",
  "aliexpress",
  "clean-urls",
  "path-trackers",
  "misc-tracking",
  // #544: experimental shape-based heuristic seed corpora. Positive cases
  // pass through as `untouched` with the default-OFF flag (the runner uses
  // baseline PREFS); negatives are oauth/session keys that must stay
  // `untouched` even when the flag is enabled in test mode.
  "heuristic-positives",
  "heuristic-negatives",
]);

const ALLOWED_ACTIONS = new Set([
  "untouched",
  "cleaned",
  "original",
  "injected",
  "detected_foreign",
  "blacklisted",
  "honored-creator",
]);

/**
 * Validate the shape of a corpus file's entries plus its category.
 * Returns { ok: boolean, errors: string[] }.
 *
 * @param {{ category:string, description?:string, entries: Array<object> }} file
 */
export function validateCorpusFile(file) {
  const errors = [];
  if (!file || typeof file !== "object") {
    return { ok: false, errors: ["file is not an object"] };
  }
  if (!ALLOWED_CATEGORIES.has(file.category)) {
    errors.push(`unknown category "${file.category}"`);
  }
  if (!Array.isArray(file.entries)) {
    errors.push("entries is not an array");
    return { ok: false, errors };
  }
  for (let i = 0; i < file.entries.length; i++) {
    const e = file.entries[i];
    if (!e || typeof e !== "object") { errors.push(`entry[${i}] not an object`); continue; }
    if (typeof e.url !== "string" || e.url.length === 0) errors.push(`entry[${i}] missing url`);
    if (!ALLOWED_ACTIONS.has(e.expectedAction)) {
      errors.push(`entry[${i}] has unknown expectedAction "${e.expectedAction}"`);
    }
    if (e.expectedClean !== undefined && typeof e.expectedClean !== "string") {
      errors.push(`entry[${i}] expectedClean must be a string when present`);
    }
  }
  return { ok: errors.length === 0, errors };
}

export const _internals = { ALLOWED_CATEGORIES, ALLOWED_ACTIONS };
