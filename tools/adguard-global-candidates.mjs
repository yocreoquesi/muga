#!/usr/bin/env node
/**
 * MUGA — AdGuard global-candidates detector (#1463 Area 5).
 *
 * #1463's own audit found the automation gap: new GLOBAL params AdGuard
 * Filter 17 adds upstream are no longer detected on a schedule.
 * `tools/import-upstream.mjs` / `import-upstream.yml` used to do this
 * weekly-then-monthly, but that path was closed on purpose after the `u`
 * incident (#1212/#1217, formalized in #1303): a param appended to
 * `TRACKING_PARAMS` has no `urlFilter` and strips on every site, so a
 * recurring PR whose only correct resolution is usually "do not merge" is
 * noise, not signal. The weekly host-anchored ingestion pipeline
 * (`tools/rule-ingestion/`) already lands this same source safely, at the
 * anchor, through the gate stack.
 *
 * This module is the mirror-image of `tools/anchored-only-globals.mjs`
 * (#1228, opposite direction: candidates AdGuard anchors but MUGA holds
 * global) and follows the exact same shape: pure decision core,
 * MEASUREMENT-ONLY, one deduplicated tracking issue, NEVER auto-landed,
 * NEVER opens a PR, NEVER edits `TRACKING_PARAMS`. Every candidate still
 * needs a human to run the same evidence-and-collision-risk triage #1463's
 * own Area 1 did by hand (see odd/tasks/1463-adguard-coverage.md T1) —
 * vendor evidence, collision risk, global vs host-anchored vs skip.
 *
 * Public API (named exports only — no default):
 *   findNewGlobalCandidates(trackingParams, prefixes, adguardBareNames, exclusions?)
 *     → string[] (lowercase, sorted)
 *   buildExclusions() → { guard, denylist, landingParams, adjudicatedSkip }
 *   renderIssueBody(report) → string
 */

import { writeFileSync } from "node:fs";

import { fetchAdGuardFilter17, parseRemoveparamRules } from "./import-upstream.mjs";
import { assertAdguardNotDegenerate } from "./anchored-only-globals.mjs";
import { TRACKING_PARAMS, TRACKING_PREFIXES, getAllLandingParams } from "../src/lib/affiliates.js";
import { ADJUDICATED_SKIP_GLOBAL } from "../src/lib/affiliates-data.js";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../src/lib/remote-rules.js";

// ── Pure decision core ───────────────────────────────────────────────────────

/**
 * Finds AdGuard Filter 17 unanchored ("bare") param names that are not yet
 * in `TRACKING_PARAMS`, not covered by a `TRACKING_PREFIXES` prefix, and
 * not excluded by any structural or adjudicated reason.
 *
 * @param {string[]} trackingParams Current MUGA TRACKING_PARAMS (any case; deduped and lowercased internally).
 * @param {string[]} prefixes Current MUGA TRACKING_PREFIXES.
 * @param {Set<string>|string[]} adguardBareNames `parseRemoveparamRules(...).bareNames` — upstream's globally-asserted (unanchored) param names.
 * @param {{ guard?: Iterable<string>, denylist?: Iterable<string>, landingParams?: Iterable<string>, adjudicatedSkip?: Iterable<string> }} [exclusions]
 *   Names that must never be reported regardless of evidence: `AFFILIATE_PARAM_GUARD`,
 *   `REMOTE_PARAM_DENYLIST`, `getAllLandingParams()` (already stripped everywhere
 *   under `stripAllAffiliates` via Step 4c/#1443 — landing it again in
 *   `TRACKING_PARAMS` would be redundant, and unconditional rather than
 *   opt-in, which is a strictly worse default for an affiliate-adjacent
 *   name), and `ADJUDICATED_SKIP_GLOBAL` (names a human already triaged out
 *   of a prior report run).
 * @returns {string[]} Lowercased, sorted, deduped candidate names.
 */
export function findNewGlobalCandidates(trackingParams, prefixes, adguardBareNames, exclusions = {}) {
  const existing = new Set(trackingParams.map((p) => String(p).toLowerCase()));
  const excludedNames = new Set(
    [
      ...(exclusions.guard ?? []),
      ...(exclusions.denylist ?? []),
      ...(exclusions.landingParams ?? []),
      ...(exclusions.adjudicatedSkip ?? []),
    ].map((p) => String(p).toLowerCase()),
  );
  const prefixList = Array.isArray(prefixes) ? prefixes : [];
  const isPrefixed = (name) => prefixList.some((pre) => name.startsWith(String(pre).toLowerCase()));

  const out = new Set();
  const names = adguardBareNames instanceof Set ? adguardBareNames : new Set(adguardBareNames ?? []);
  for (const raw of names) {
    const name = String(raw).toLowerCase();
    if (!name) continue;
    if (existing.has(name)) continue;
    if (isPrefixed(name)) continue;
    if (excludedNames.has(name)) continue;
    out.add(name);
  }
  return [...out].sort();
}

/**
 * Builds the exclusions object from MUGA's live source-of-truth constants.
 * Exported so the CLI and tests can share the exact same construction.
 *
 * @returns {{ guard: Set<string>, denylist: Set<string>, landingParams: Set<string>, adjudicatedSkip: Set<string> }}
 */
export function buildExclusions() {
  return {
    guard: AFFILIATE_PARAM_GUARD,
    denylist: REMOTE_PARAM_DENYLIST,
    landingParams: getAllLandingParams(),
    adjudicatedSkip: new Set(Object.keys(ADJUDICATED_SKIP_GLOBAL).map((p) => p.toLowerCase())),
  };
}

// ── Markdown issue body renderer (pure) ──────────────────────────────────────

/**
 * Renders the Markdown body for the monthly deduplicated tracking issue.
 *
 * @param {{ generated_at: string, tracking_params_count: number, candidate_count: number, candidates: string[] }} report
 * @returns {string}
 */
export function renderIssueBody(report) {
  const { generated_at, tracking_params_count, candidate_count, candidates } = report;

  if (candidate_count === 0) {
    return [
      `Monthly automated scan (#1463 Area 5) of AdGuard Filter 17's globally-asserted param names against MUGA's ${tracking_params_count} \`TRACKING_PARAMS\` entries found no new candidates this run.`,
      "",
      `**Generated:** ${generated_at}`,
      "",
      "Every current AdGuard global name is already covered — in `TRACKING_PARAMS`, a `TRACKING_PREFIXES` prefix, `REDIRECT_NETWORK_PATTERNS.landingParams`, or already adjudicated. No action needed.",
    ].join("\n");
  }

  const lines = [
    `Monthly automated scan (#1463 Area 5) found ${candidate_count} AdGuard Filter 17 param name(s), asserted GLOBALLY upstream, not yet covered by any of MUGA's ${tracking_params_count} \`TRACKING_PARAMS\` entries, a \`TRACKING_PREFIXES\` prefix, or \`REDIRECT_NETWORK_PATTERNS.landingParams\`.`,
    "",
    `**Generated:** ${generated_at}`,
    "",
    "## Candidates",
    "",
    ...candidates.map((p) => `- \`${p}\``),
    "",
    "## Triage steps (per #1463 Area 1's method)",
    "",
    "1. Search for public vendor documentation of this exact param name. No documentation found is a reason to SKIP, not a reason to guess.",
    "2. Check for a collision-risk pattern: a short/generic name (the #1212/#1217 `u` class), a name structurally similar to an existing `AFFILIATE_PARAM_GUARD` member or `REDIRECT_NETWORK_PATTERNS.landingParams` entry (affiliate-adjacent), or a name already used as a functional param somewhere in `domain-rules.json`'s `preserveParams`.",
    "3. If AdGuard anchors the SAME name to a specific host elsewhere (check `tools/anchored-only-globals.mjs`'s sibling data or re-run `parseRemoveparamRules`'s `scoped` output), prefer landing it host-anchored in `domain-rules.json` over global.",
    "4. Only land a candidate in `TRACKING_PARAMS` with BOTH citable vendor evidence AND low collision risk. Run `npm run compile:rules` + `npm run build:content` + `npm run build:web` and update the count claims (README, CONTEXT.md, docs, locales) in the same PR.",
    "5. If triage instead concludes a candidate must NOT land (no evidence, or a collision-risk pattern), add it to `ADJUDICATED_SKIP_GLOBAL` in `src/lib/affiliates-data.js` with a reason citing this triage — otherwise the exact same name reappears in next month's report.",
    "",
    "**DO NOT auto-land. DO NOT open a PR that adds these to `TRACKING_PARAMS`.** This report only surfaces candidates — the #1303 decision that closed the previous auto-PR path for this exact class of change still applies.",
  ];

  return lines.join("\n");
}

// ── CLI orchestration (I/O boundary) ─────────────────────────────────────────

async function main() {
  const text = await fetchAdGuardFilter17();
  const adguard = parseRemoveparamRules(text);

  assertAdguardNotDegenerate(adguard);

  const exclusions = buildExclusions();
  const candidates = findNewGlobalCandidates(TRACKING_PARAMS, TRACKING_PREFIXES, adguard.bareNames, exclusions);

  const report = {
    generated_at: new Date().toISOString(),
    tracking_params_count: TRACKING_PARAMS.length,
    candidate_count: candidates.length,
    candidates,
  };

  const jsonPath = process.env.ADGUARD_GLOBAL_REPORT_PATH || "/tmp/adguard-global-candidates-report.json";
  const bodyPath = process.env.ADGUARD_GLOBAL_ISSUE_BODY_PATH || "/tmp/adguard-global-candidates-issue.md";

  writeFileSync(jsonPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(bodyPath, renderIssueBody(report) + "\n", "utf8");

  console.log(`[adguard-global-candidates] TRACKING_PARAMS: ${TRACKING_PARAMS.length}`);
  console.log(`[adguard-global-candidates] New global candidates: ${candidates.length}`);
  for (const c of candidates) console.log(`  - ${c}`);
  console.log(`JSON report written: ${jsonPath}`);
  console.log(`Issue body written: ${bodyPath}`);
}

// Only run when invoked directly (not when imported by tests). Guard is
// defensive against process.argv[1] being undefined (node -e, REPL, etc.).
if (process.argv[1]?.endsWith("adguard-global-candidates.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
