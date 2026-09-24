#!/usr/bin/env node
/**
 * MUGA — anchored-only-globals detector (#1228).
 *
 * Every prior pass at issue #1228 ("params in the global strip rule are
 * only ever host-anchored upstream": #1322, #1323, #1324, #1338, and the
 * #1228-next-batch task) used a throwaway measurement script, never
 * committed, to find `TRACKING_PARAMS` entries that AdGuard Filter 17 and
 * ClearURLs only ever anchor to a host or path, never assert globally. This
 * module makes that detection a tested, reproducible, monthly-scheduled
 * report instead of a one-off script — it NEVER edits `TRACKING_PARAMS`
 * itself; every candidate still needs a human to triage per-host coverage,
 * guard membership, and self-hosted/SaaS-platform risk (see #1228's own
 * comment history for why "anchored ⇒ remove" is not safe on its own).
 *
 * Pure decision core: findAnchoredOnlyGlobals(trackingParams, adguard,
 * clearurls, exclusions). A candidate is a current TRACKING_PARAMS entry
 * that has at least one anchored mention (AdGuard host/path anchor, or a
 * ClearURLs host-scoped provider) and ZERO global mentions (AdGuard
 * `bareNames`, or a ClearURLs `globalPatterns` full match) across BOTH
 * sources, and is not a member of any exclusion set: `AFFILIATE_PARAM_GUARD`,
 * `REMOTE_PARAM_DENYLIST` (src/lib/remote-rules.js), `PATH_ANCHORED_STAY_GLOBAL`,
 * or `HOT_PATH_REQUIRED` (src/lib/hot-path-strip.js) — structural reasons a
 * name must stay global regardless of anchor evidence — plus
 * `ADJUDICATED_KEEP_GLOBAL` (src/lib/affiliates-data.js), the record of
 * names a human already triaged out of a prior report run (self-hosted/
 * SaaS-platform risk, or an anchor that contradicts MUGA's own attribution
 * model). Without that last exclusion, the exact same already-rejected
 * names reappear every month — the failure mode the first live run hit.
 *
 * CLI entry point (run with `node tools/anchored-only-globals.mjs` or
 * `npm run anchored-only-report`): fetches both sources live, prints the
 * report to stdout, and writes a JSON report + a Markdown issue body to
 * disk for the monthly workflow to consume. A network fetch failure
 * propagates as a non-zero exit — never a silent "0 candidates".
 *
 * Public API (named exports only — no default):
 *   findAnchoredOnlyGlobals(trackingParams, adguard, clearurls, exclusions?)
 *     → Array<{ param: string, evidence: Array<{source, host?, path?}> }>
 *   renderIssueBody(report) → string
 */

import { writeFileSync } from "node:fs";

import { fetchAdGuardFilter17, parseRemoveparamRules } from "./import-upstream.mjs";
import { clearurls, extractClearurlsScopeFacts } from "./rule-ingestion/adapters/clearurls.mjs";
import { TRACKING_PARAMS } from "../src/lib/affiliates.js";
import { PATH_ANCHORED_STAY_GLOBAL, ADJUDICATED_KEEP_GLOBAL } from "../src/lib/affiliates-data.js";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../src/lib/remote-rules.js";
import { HOT_PATH_REQUIRED } from "../src/lib/hot-path-strip.js";

// ── Pure decision core ───────────────────────────────────────────────────────

/**
 * Finds TRACKING_PARAMS entries with anchored-only upstream evidence.
 *
 * @param {string[]} trackingParams Current MUGA TRACKING_PARAMS (any case; deduped and lowercased internally).
 * @param {{ bareNames?: Set<string>, scoped?: Array<{param: string, scope: string}>, pathAnchored?: Array<{param: string, host: string, pathPrefix: string}>, bareRegexes?: RegExp[] }} adguard
 *   Subset of `parseRemoveparamRules`'s return shape. `bareRegexes` (#1228 R3
 *   review) is unanchored regex-spec evidence — a name AdGuard strips
 *   everywhere via regex, tested full-match/case-insensitive same as
 *   `clearurls.globalPatterns` below.
 * @param {{ globalPatterns?: RegExp[], anchored?: Array<{param: string, scope: string}> }} clearurls
 *   Subset of `extractClearurlsScopeFacts`'s return shape.
 * @param {{ guard?: Iterable<string>, denylist?: Iterable<string>, pathAnchoredStayGlobal?: Iterable<string>, hotPathRequired?: Iterable<string>, adjudicatedKeepGlobal?: Iterable<string> }} [exclusions]
 *   Names that must never be reported regardless of evidence: AFFILIATE_PARAM_GUARD,
 *   REMOTE_PARAM_DENYLIST, PATH_ANCHORED_STAY_GLOBAL, HOT_PATH_REQUIRED (a
 *   client-side-reinjectable name needs the synchronous hot-path strip on every
 *   site, so host-scoping it is not a safe substitute), and ADJUDICATED_KEEP_GLOBAL
 *   (names a human already triaged out of a prior report run).
 * @returns {Array<{ param: string, evidence: Array<{source: "adguard"|"clearurls", host?: string, path?: string}> }>}
 *   Sorted by param name.
 */
export function findAnchoredOnlyGlobals(trackingParams, adguard, clearurls, exclusions = {}) {
  const excludedNames = new Set(
    [
      ...(exclusions.guard ?? []),
      ...(exclusions.denylist ?? []),
      ...(exclusions.pathAnchoredStayGlobal ?? []),
      ...(exclusions.hotPathRequired ?? []),
      ...(exclusions.adjudicatedKeepGlobal ?? []),
    ].map((p) => String(p).toLowerCase()),
  );

  const adguardBare = adguard?.bareNames ?? new Set();
  const adguardScoped = adguard?.scoped ?? [];
  const adguardPathAnchored = adguard?.pathAnchored ?? [];
  const adguardBareRegexes = adguard?.bareRegexes ?? [];
  const clearurlsGlobalPatterns = clearurls?.globalPatterns ?? [];
  const clearurlsAnchored = clearurls?.anchored ?? [];

  const seen = new Set();
  const results = [];

  for (const rawParam of trackingParams) {
    const param = String(rawParam).toLowerCase();
    if (seen.has(param)) continue;
    seen.add(param);
    if (excludedNames.has(param)) continue;

    /** @type {Array<{source: "adguard"|"clearurls", host?: string, path?: string}>} */
    const evidence = [];
    for (const { param: p, scope } of adguardScoped) {
      if (p === param) evidence.push({ source: "adguard", host: scope });
    }
    for (const { param: p, host, pathPrefix } of adguardPathAnchored) {
      if (p === param) evidence.push({ source: "adguard", host, path: pathPrefix });
    }
    for (const { param: p, scope } of clearurlsAnchored) {
      if (p === param) evidence.push({ source: "clearurls", host: scope });
    }

    if (evidence.length === 0) continue; // not in this class at all

    const hasGlobalEvidence =
      adguardBare.has(param) ||
      adguardBareRegexes.some((re) => re.test(param)) ||
      clearurlsGlobalPatterns.some((re) => re.test(param));
    if (hasGlobalEvidence) continue;

    results.push({ param, evidence });
  }

  return results.sort((a, b) => a.param.localeCompare(b.param));
}

// ── Markdown issue body renderer (pure) ──────────────────────────────────────

/**
 * Renders the Markdown body for the monthly deduplicated tracking issue.
 *
 * @param {{ generated_at: string, tracking_params_count: number, candidate_count: number, candidates: Array<{param: string, evidence: Array<{source: string, host?: string, path?: string}>}> }} report
 * @returns {string}
 */
export function renderIssueBody(report) {
  const { generated_at, tracking_params_count, candidate_count, candidates } = report;

  if (candidate_count === 0) {
    return [
      `Monthly automated scan (#1228) of MUGA's ${tracking_params_count} \`TRACKING_PARAMS\` entries against AdGuard Filter 17 and ClearURLs found no candidates this run.`,
      "",
      `**Generated:** ${generated_at}`,
      "",
      "Every current global entry has at least one global upstream mention (or no anchored evidence at all). No action needed.",
    ].join("\n");
  }

  const evidenceLine = (e) =>
    e.path
      ? `  - \`${e.source}\`: host \`${e.host}\`, path \`${e.path}\``
      : `  - \`${e.source}\`: host \`${e.host}\``;

  const lines = [
    `Monthly automated scan (#1228) found ${candidate_count} of MUGA's ${tracking_params_count} \`TRACKING_PARAMS\` entries with upstream evidence that is ONLY anchored (to a host or path), never global, across both AdGuard Filter 17 and ClearURLs.`,
    "",
    `**Generated:** ${generated_at}`,
    "",
    "## Candidates",
    "",
  ];

  for (const candidate of candidates) {
    lines.push(`### \`${candidate.param}\``);
    for (const e of candidate.evidence) lines.push(evidenceLine(e));
    lines.push("");
  }

  lines.push(
    "## Triage steps (per #1374's method)",
    "",
    "1. Check `AFFILIATE_PARAM_GUARD` / `REMOTE_PARAM_DENYLIST` membership first — a guard member should stay global; `extraStrips` filters guard members, so host-anchoring it would never reach a compiled DNR rule.",
    "2. For every anchored host above, confirm it already carries the param in its own `domain-rules.json` `stripParams` (add the entry if missing).",
    "3. Verify the GENERATED `src/rules/tracking-params.json` DNR profile rule for that host lists the param in `removeParams` and does not exclude the host via `excludedRequestDomains` — run `npm run compile:rules` first if needed.",
    "4. Watch for a self-hosted/SaaS-platform family (one example site does not establish host-exclusivity for something like Piwik/Matomo or an ESP) and for a wildcard/TLD-family anchor that an enumerated `domain-rules.json` list does not fully cover.",
    "5. Add a pinning test to `tests/unit/removed-global-params-network-coverage.test.mjs` (mirror the existing per-param/per-host blocks) before removing the entry from `TRACKING_PARAMS` (and any `TRACKING_PARAM_CATEGORIES` duplicate).",
    "6. If triage instead concludes a candidate must STAY global (self-hosted/SaaS-platform risk, an anchor that contradicts MUGA's own attribution, etc.), add it to `ADJUDICATED_KEEP_GLOBAL` in `src/lib/affiliates-data.js` with a reason citing this triage — otherwise the exact same name reappears in next month's report.",
    "",
    "**DO NOT auto-remove.** This report only surfaces candidates; removal always requires human triage per host.",
  );

  return lines.join("\n");
}

// ── CLI orchestration (I/O boundary) ─────────────────────────────────────────

/**
 * Builds the exclusions object from MUGA's live source-of-truth constants.
 * Exported so the CLI and tests can share the exact same construction.
 *
 * @returns {{ guard: Set<string>, denylist: Set<string>, pathAnchoredStayGlobal: Set<string>, hotPathRequired: Set<string>, adjudicatedKeepGlobal: Set<string> }}
 */
export function buildExclusions() {
  return {
    guard: AFFILIATE_PARAM_GUARD,
    denylist: REMOTE_PARAM_DENYLIST,
    pathAnchoredStayGlobal: new Set(PATH_ANCHORED_STAY_GLOBAL.map((p) => p.toLowerCase())),
    hotPathRequired: new Set(HOT_PATH_REQUIRED.map((p) => p.toLowerCase())),
    adjudicatedKeepGlobal: new Set(Object.keys(ADJUDICATED_KEEP_GLOBAL).map((p) => p.toLowerCase())),
  };
}

// ── Degenerate-upstream refusal (#1228 R3 review) ────────────────────────────
//
// A "0 candidates" result must only ever come from real upstream data. A
// degenerate response — an empty or truncated fetch, or an HTML error page
// served with a 200 status for AdGuard; a JSON payload missing or emptying
// `providers`/`globalRules` for ClearURLs — would otherwise parse down to
// near-nothing and silently report "everything is fine" instead of failing.
//
// The floors below are conservative minimums, NOT an assertion of a
// specific count: both sources update their lists routinely. They were
// derived from a live measurement (2026-09-24) —
//   AdGuard Filter 17:  338 bareNames + 1807 scoped + 177 pathAnchored = 2322 total facts
//   ClearURLs:          48 globalRules patterns, 621 anchored facts
// — each floor set well below (roughly a fifth to a third of) that
// measurement, so ordinary upstream drift never trips it, but a genuinely
// empty/truncated/wrong-shaped response — which parses down to a handful of
// facts at most, usually zero — always does.

/** @type {number} Measured ~2322 total AdGuard facts on 2026-09-24. */
export const MIN_ADGUARD_FACTS = 500;
/** @type {number} Measured 48 ClearURLs globalRules patterns on 2026-09-24. */
export const MIN_CLEARURLS_GLOBAL_PATTERNS = 15;
/** @type {number} Measured 621 ClearURLs anchored facts on 2026-09-24. */
export const MIN_CLEARURLS_ANCHORED = 100;

/**
 * Throws when a parsed AdGuard snapshot looks degenerate — too few facts,
 * combined across `bareNames` + `scoped` + `pathAnchored`, to plausibly be
 * real upstream data — rather than letting a garbage fetch silently
 * produce a false "0 candidates".
 *
 * @param {{ bareNames?: Set<string>, scoped?: Array<unknown>, pathAnchored?: Array<unknown> }} adguard
 * @throws {Error} When the total fact count is below MIN_ADGUARD_FACTS.
 */
export function assertAdguardNotDegenerate(adguard) {
  const total =
    (adguard?.bareNames?.size ?? 0) + (adguard?.scoped?.length ?? 0) + (adguard?.pathAnchored?.length ?? 0);
  if (total < MIN_ADGUARD_FACTS) {
    throw new Error(
      `[anchored-only-globals] AdGuard Filter 17 parsed only ${total} removeparam fact(s) ` +
        `(bareNames + scoped + pathAnchored), below the conservative floor of ${MIN_ADGUARD_FACTS}. ` +
        "This looks like a degenerate response (empty, truncated, or an HTML error page served " +
        "with a 200 status) rather than real upstream data — refusing rather than reporting a false " +
        "'0 candidates'.",
    );
  }
}

/**
 * Throws when parsed ClearURLs facts look degenerate — too few global
 * patterns or anchored facts to plausibly reflect real, populated
 * `providers`/`globalRules` — rather than letting a garbage fetch silently
 * produce a false "0 candidates".
 *
 * @param {{ globalPatterns?: RegExp[], anchored?: Array<unknown> }} clearurlsFacts
 * @throws {Error} When either count is below its conservative floor.
 */
export function assertClearurlsNotDegenerate(clearurlsFacts) {
  const globalCount = clearurlsFacts?.globalPatterns?.length ?? 0;
  const anchoredCount = clearurlsFacts?.anchored?.length ?? 0;
  if (globalCount < MIN_CLEARURLS_GLOBAL_PATTERNS || anchoredCount < MIN_CLEARURLS_ANCHORED) {
    throw new Error(
      `[anchored-only-globals] ClearURLs parsed ${globalCount} globalRules pattern(s) and ` +
        `${anchoredCount} anchored fact(s), below the conservative floors of ` +
        `${MIN_CLEARURLS_GLOBAL_PATTERNS} / ${MIN_CLEARURLS_ANCHORED} respectively. This looks like a ` +
        "degenerate response (missing or empty providers/globalRules) rather than real upstream " +
        "data — refusing rather than reporting a false '0 candidates'.",
    );
  }
}

async function main() {
  const [adguardText, clearurlsText] = await Promise.all([
    fetchAdGuardFilter17(),
    clearurls.fetchRaw(),
  ]);

  const adguard = parseRemoveparamRules(adguardText);
  const clearurlsFacts = extractClearurlsScopeFacts(clearurlsText);

  assertAdguardNotDegenerate(adguard);
  assertClearurlsNotDegenerate(clearurlsFacts);

  const exclusions = buildExclusions();

  const candidates = findAnchoredOnlyGlobals(TRACKING_PARAMS, adguard, clearurlsFacts, exclusions);

  const report = {
    generated_at: new Date().toISOString(),
    tracking_params_count: TRACKING_PARAMS.length,
    candidate_count: candidates.length,
    candidates,
  };

  const jsonPath = process.env.ANCHORED_ONLY_REPORT_PATH || "/tmp/anchored-only-globals-report.json";
  const bodyPath = process.env.ANCHORED_ONLY_ISSUE_BODY_PATH || "/tmp/anchored-only-globals-issue.md";

  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(bodyPath, renderIssueBody(report) + "\n", "utf8");

  console.log(`[anchored-only-globals] TRACKING_PARAMS: ${TRACKING_PARAMS.length}`);
  console.log(`[anchored-only-globals] Candidates (anchored upstream, never global): ${candidates.length}`);
  for (const c of candidates) {
    const evidenceStr = c.evidence
      .map((e) => (e.path ? `${e.source}:${e.host}${e.path}` : `${e.source}:${e.host}`))
      .join(", ");
    console.log(`  - ${c.param}  [${evidenceStr}]`);
  }
  console.log(`JSON report written: ${jsonPath}`);
  console.log(`Issue body written: ${bodyPath}`);
}

// Only run when invoked directly (not when imported by tests).
if (process.argv[1]?.endsWith("anchored-only-globals.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
