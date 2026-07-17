#!/usr/bin/env node
/**
 * MUGA — cookie-consent release-smoke report (release-smoke-battery).
 *
 * Reduces the existing CMP canary results (tests/canary/cmp-sites.json +
 * tools/canary-report.mjs's `test-results/canary-results.json` schema,
 * `{cmp, url, status: "pass"|"fail"|"inconclusive", detail}`) into a
 * per-adapter RELEASE verdict for the 9 Tier 1 cookie-consent adapters
 * (src/lib/cmp-adapters.js TIER1: onetrust, cookiebot, didomi, cookieyes,
 * sourcepoint, usercentrics, cookieinformation, cookiescript, tarteaucitron).
 *
 * This does NOT run the canary itself — see tools/canary-report.mjs for
 * that (drift-alarm reporting) and .github/workflows/cmp-canary.yml (the
 * nightly job that produces the results file this script consumes). This
 * script answers a narrower, release-gating question: for each adapter, is
 * there real-site evidence good enough to ship?
 *
 * Verdicts (per CMP):
 *   READY      — at least 1 "pass" and 0 "fail" real-site results.
 *   BLOCKED    — at least 1 "fail" real-site result (any pass count).
 *   UNVERIFIED — only "inconclusive" results, or no results at all (no
 *                positive real-site confirmation either way). Treated as a
 *                WARNING by the CLI, not a hard release blocker — real
 *                sites are flaky/geo-variant/already-consented.
 *
 * Pure: no I/O, no Date.now() inside summarizeRelease/formatReleaseTable —
 * mirrors tools/canary-report.mjs's decideDrift/formatIssueBody split (pure
 * decision logic vs. CLI I/O boundary).
 *
 * Public API (named exports only — no default):
 *   RELEASE_CMPS → the 8 Tier 1 CMP ids, in cmp-adapters.js TIER1 order.
 *   summarizeRelease(results) → Record<string, {verdict, passCount, failCount, inconclusiveCount, sites}>
 *   formatReleaseTable(summary) → string
 *
 * Usage:
 *   node tools/release-smoke-report.mjs
 *   npm run smoke:release
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Pure decision logic ───────────────────────────────────────────────────

/**
 * The 9 Tier 1 cookie-consent CMP ids, in the same order as
 * src/lib/cmp-adapters.js's TIER1 registry.
 * @type {ReadonlyArray<string>}
 */
export const RELEASE_CMPS = Object.freeze([
  "onetrust",
  "cookiebot",
  "didomi",
  "cookieyes",
  "sourcepoint",
  "usercentrics",
  "cookieinformation",
  "cookiescript",
  "tarteaucitron",
]);

function emptyBucket() {
  return { verdict: "UNVERIFIED", passCount: 0, failCount: 0, inconclusiveCount: 0, sites: [] };
}

/**
 * Reduces canary results into a per-adapter release verdict.
 *
 * Every CMP in RELEASE_CMPS is always present in the output — even with
 * zero matching results — so an adapter with no real-site evidence at all
 * (canary run never covered it, or the results file is empty/missing)
 * still shows up as UNVERIFIED rather than silently disappearing. Any
 * other `cmp` value present in `results` is also tracked defensively
 * (forward-compatible with a not-yet-registered adapter before this file's
 * RELEASE_CMPS list is updated), just not required to be READY for `formatReleaseTable`
 * to render cleanly.
 *
 * Pure: no I/O, no Date.now(). Never throws on well-formed input;
 * malformed entries are skipped defensively (fail-closed: unknown shape
 * never counts as pass/fail either way).
 *
 * @param {Array<{cmp: string, url: string, status: "pass"|"fail"|"inconclusive", detail?: string}>} results
 * @returns {Record<string, {verdict: "READY"|"BLOCKED"|"UNVERIFIED", passCount: number, failCount: number, inconclusiveCount: number, sites: Array<{url: string, status: string, detail: string}>}>}
 */
export function summarizeRelease(results) {
  /** @type {Record<string, ReturnType<typeof emptyBucket>>} */
  const byCmp = {};
  for (const cmp of RELEASE_CMPS) {
    byCmp[cmp] = emptyBucket();
  }

  const list = Array.isArray(results) ? results : [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const cmp = typeof entry.cmp === "string" ? entry.cmp : null;
    const status = entry.status;
    if (!cmp || (status !== "pass" && status !== "fail" && status !== "inconclusive")) continue;

    if (!byCmp[cmp]) byCmp[cmp] = emptyBucket();
    const bucket = byCmp[cmp];
    bucket.sites.push({
      url: typeof entry.url === "string" ? entry.url : "",
      status,
      detail: typeof entry.detail === "string" ? entry.detail : "",
    });
    if (status === "pass") bucket.passCount += 1;
    else if (status === "fail") bucket.failCount += 1;
    else bucket.inconclusiveCount += 1;
  }

  for (const cmp of Object.keys(byCmp)) {
    const bucket = byCmp[cmp];
    if (bucket.failCount >= 1) bucket.verdict = "BLOCKED";
    else if (bucket.passCount >= 1) bucket.verdict = "READY";
    else bucket.verdict = "UNVERIFIED";
  }

  return byCmp;
}

/**
 * Renders a readable per-adapter release table.
 *
 * Pure: takes the summary as a parameter, no I/O. RELEASE_CMPS entries are
 * always rendered in the canonical order first (even if `summary` was
 * built by hand and only has a subset); any extra CMP keys present in
 * `summary` beyond RELEASE_CMPS are appended after, sorted, so the output
 * never silently drops an adapter.
 *
 * @param {Record<string, {verdict: string, passCount: number, failCount: number, inconclusiveCount: number}>} summary
 * @returns {string}
 */
export function formatReleaseTable(summary) {
  const s = summary && typeof summary === "object" ? summary : {};
  const known = RELEASE_CMPS.filter((cmp) => cmp in s);
  const extra = Object.keys(s)
    .filter((cmp) => !RELEASE_CMPS.includes(cmp))
    .sort();
  const order = [...known, ...extra];

  const header = ["CMP", "Verdict", "Pass", "Fail", "Inconclusive"];
  const rows = order.map((cmp) => {
    const bucket = s[cmp] || emptyBucket();
    return [cmp, bucket.verdict, String(bucket.passCount), String(bucket.failCount), String(bucket.inconclusiveCount)];
  });

  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const formatRow = (cells) => cells.map((cell, i) => cell.padEnd(widths[i])).join(" | ");

  const lines = [formatRow(header), widths.map((w) => "-".repeat(w)).join("-|-"), ...rows.map(formatRow)];
  return lines.join("\n");
}

// ── CLI I/O boundary ───────────────────────────────────────────────────────

const DEFAULT_RESULTS_PATH = join(__dirname, "..", "test-results", "canary-results.json");

/**
 * Reads canary-results.json, computes the release summary, and prints the
 * table. Exits non-zero when any adapter is BLOCKED (a real-site reject
 * failure), so this can be wired as a hard release-gate check. UNVERIFIED
 * adapters print a warning but never fail the run — real sites are flaky,
 * geo-variant, or already-consented, so a missing positive confirmation is
 * not proof of a broken adapter.
 *
 * @param {{resultsPath?: string, exitImpl?: (code: number) => void}} [opts]
 */
export function runReleaseSmokeReportCli({ resultsPath = DEFAULT_RESULTS_PATH, exitImpl = process.exit } = {}) {
  let raw;
  try {
    raw = readFileSync(resultsPath, "utf8");
  } catch (err) {
    console.error(`[release-smoke-report] cannot read ${resultsPath}: ${err.message}`);
    console.error("[release-smoke-report] no canary results — trigger the cmp-canary workflow first (see docs/qa/cookie-consent-release-smoke.md).");
    console.log(formatReleaseTable(summarizeRelease([])));
    exitImpl(0);
    return;
  }

  let results;
  try {
    results = JSON.parse(raw);
  } catch (err) {
    console.error(`[release-smoke-report] cannot parse ${resultsPath} as JSON: ${err.message}`);
    exitImpl(1);
    return;
  }

  const summary = summarizeRelease(results);
  console.log(formatReleaseTable(summary));

  const blocked = RELEASE_CMPS.filter((cmp) => summary[cmp] && summary[cmp].verdict === "BLOCKED");
  const unverified = RELEASE_CMPS.filter((cmp) => summary[cmp] && summary[cmp].verdict === "UNVERIFIED");

  if (unverified.length > 0) {
    console.warn(`[release-smoke-report] WARNING: unverified adapter(s), no positive real-site confirmation: ${unverified.join(", ")}`);
  }

  if (blocked.length > 0) {
    console.error(`[release-smoke-report] BLOCKED: real-site reject failure for: ${blocked.join(", ")}`);
    exitImpl(1);
    return;
  }

  console.log("[release-smoke-report] no adapter is BLOCKED.");
  exitImpl(0);
}

// Only run the CLI when this file is executed directly — importing it (as
// tests/unit/release-smoke-report.test.mjs does) must never read the
// filesystem or call process.exit. Mirrors tools/canary-report.mjs's entry
// guard (endsWith check, not a strict path-equality compare, so it works
// the same whether invoked as `node tools/release-smoke-report.mjs` or via
// a relative/absolute npm script path on any platform).
const isMain = process.argv[1] && process.argv[1].endsWith("release-smoke-report.mjs");
if (isMain) {
  runReleaseSmokeReportCli();
}
