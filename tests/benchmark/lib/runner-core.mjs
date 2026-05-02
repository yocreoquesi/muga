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
 * Build the report object summarising a benchmark run.
 *
 * The per-category bucket gains a `matchRate` field (0..100, one decimal)
 * so report readers can scan for the worst-covered categories without
 * recomputing percentages.
 *
 * @param {{ corpus: Array<{url:string, category:string, expectedAction:string}>, results: Array<{ok:boolean, expected:object, actual:object, diff?:string}>, generatedAt?: string, runner?: string }} params
 * @returns {{ generatedAt:string, runner:string, totalEntries:number, matched:number, mismatched:number, matchRate:number, byCategory: Record<string,{total:number,matched:number,mismatched:number,matchRate:number}>, mismatches: Array<object> }}
 */
export function buildReport({ corpus, results, generatedAt, runner = "muga" }) {
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
  return {
    generatedAt: generatedAt || new Date().toISOString(),
    runner,
    totalEntries: corpus.length,
    matched,
    mismatched: corpus.length - matched,
    matchRate: pct(matched, corpus.length),
    byCategory,
    mismatches,
  };
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
