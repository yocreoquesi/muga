#!/usr/bin/env node
/**
 * MUGA — CMP canary drift report + auto-issue (#1129).
 *
 * Pure decision logic (decideDrift, formatIssueBody) is exported and
 * unit-tested directly in tests/unit/canary-report.test.mjs (no I/O, no
 * Date.now() inside — the caller injects a timestamp, mirroring the
 * tools/moat-expansion/cli.mjs "CLI owns Date, pure modules don't" pattern).
 *
 * The CLI part (reads test-results/canary-results.json, computes drift,
 * files/updates a GitHub issue per drifting CMP via `gh`) only runs when
 * this file is executed directly — importing it (as the unit test does)
 * never triggers network/gh calls.
 *
 * Usage:
 *   node tools/canary-report.mjs [timestamp]
 *   GH_TOKEN=... node tools/canary-report.mjs 2026-07-16T03:00:00Z
 *
 * Non-blocking by design: this script's exit code is never wired into a
 * blocking CI gate (see .github/workflows/cmp-canary.yml) — it only files
 * or updates tracking issues for maintainers to triage.
 *
 * Public API (named exports only — no default):
 *   decideDrift(results, opts?) → Record<string, {inDrift: boolean, failCount: number, inconclusiveCount: number, passCount: number, sites: Array<{url, status, detail}>}>
 *   formatIssueBody(cmp, driftDetail, timestamp) → string
 */

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Pure decision logic ───────────────────────────────────────────────────

/**
 * Decides, per CMP, whether the canary results show drift.
 *
 * A CMP is in drift when the number of "fail" results for that CMP is
 * `>= threshold` (default 2). "inconclusive" results never count toward
 * drift — a site whose banner never appeared this run (already-consented,
 * geo-variant, or a transient miss) says nothing about whether MUGA's
 * reject adapter still works. A CMP with only "pass"/"inconclusive"
 * results is healthy.
 *
 * Pure: no I/O, no Date.now() — the caller supplies `results` and
 * `threshold`. Never throws on well-formed input; malformed entries are
 * skipped defensively (fail-closed: unknown shape never counts as "fail").
 *
 * @param {Array<{cmp: string, url: string, status: "pass"|"fail"|"inconclusive", detail?: string}>} results
 * @param {{threshold?: number}} [opts]
 * @returns {Record<string, {inDrift: boolean, failCount: number, inconclusiveCount: number, passCount: number, sites: Array<{url: string, status: string, detail: string}>}>}
 */
export function decideDrift(results, { threshold = 2 } = {}) {
  /** @type {Record<string, {inDrift: boolean, failCount: number, inconclusiveCount: number, passCount: number, sites: Array<{url: string, status: string, detail: string}>}>} */
  const byCmp = {};

  const list = Array.isArray(results) ? results : [];
  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue;
    const cmp = typeof entry.cmp === "string" ? entry.cmp : null;
    const status = entry.status;
    if (!cmp || (status !== "pass" && status !== "fail" && status !== "inconclusive")) continue;

    if (!byCmp[cmp]) {
      byCmp[cmp] = { inDrift: false, failCount: 0, inconclusiveCount: 0, passCount: 0, sites: [] };
    }
    const bucket = byCmp[cmp];
    bucket.sites.push({
      url: typeof entry.url === "string" ? entry.url : "",
      status,
      detail: typeof entry.detail === "string" ? entry.detail : "",
    });
    if (status === "fail") bucket.failCount += 1;
    else if (status === "inconclusive") bucket.inconclusiveCount += 1;
    else bucket.passCount += 1;
  }

  for (const cmp of Object.keys(byCmp)) {
    byCmp[cmp].inDrift = byCmp[cmp].failCount >= threshold;
  }

  return byCmp;
}

/**
 * Renders the Markdown body for a drift-tracking GitHub issue.
 *
 * Pure: takes the timestamp as a parameter — never calls Date.now()/new
 * Date() internally, so output is deterministic and testable.
 *
 * @param {string} cmp
 * @param {{inDrift: boolean, failCount: number, inconclusiveCount: number, passCount: number, sites: Array<{url: string, status: string, detail: string}>}} driftDetail
 * @param {string} timestamp ISO-ish string, caller-supplied.
 * @returns {string}
 */
export function formatIssueBody(cmp, driftDetail, timestamp) {
  const lines = [];
  lines.push(`**Detected:** ${timestamp}`);
  lines.push("");
  lines.push(
    `\`${cmp}\` failed the reject check on ${driftDetail.failCount} of its canary site(s) this run ` +
      `(${driftDetail.passCount} pass, ${driftDetail.inconclusiveCount} inconclusive).`,
  );
  lines.push("");
  lines.push("| Site | Status | Detail |");
  lines.push("| --- | --- | --- |");
  for (const site of driftDetail.sites) {
    lines.push(`| ${site.url} | ${site.status} | ${site.detail} |`);
  }
  lines.push("");
  lines.push(
    "This is a NON-BLOCKING nightly drift alarm (tests/canary/cmp-canary.spec.mjs) — it does not gate any PR " +
      "or release. It fires when >=2 candidate sites for this CMP show the banner staying visible after MUGA's " +
      "reject call, which usually means the CMP vendor changed its DOM anchor or reject API and " +
      "src/lib/cmp-adapters.js needs an update.",
  );
  lines.push("");
  lines.push(
    "_Opened/updated automatically by tools/canary-report.mjs. Do not rename the title — de-duping matches on it._",
  );
  return lines.join("\n");
}

// ── CLI I/O boundary ───────────────────────────────────────────────────────

const DEFAULT_RESULTS_PATH = join(__dirname, "..", "test-results", "canary-results.json");

function issueTitle(cmp) {
  return `CMP canary: ${cmp} drift?`;
}

/**
 * Reads canary-results.json, computes drift, and files/updates a GitHub
 * issue per drifting CMP via the `gh` CLI. I/O boundary only — all decision
 * logic lives in the pure functions above.
 *
 * @param {{resultsPath?: string, timestamp?: string, threshold?: number, execImpl?: typeof execFileSync}} [opts]
 */
export function runCanaryReportCli({
  resultsPath = DEFAULT_RESULTS_PATH,
  timestamp = new Date().toISOString(),
  threshold = 2,
  execImpl = execFileSync,
} = {}) {
  let raw;
  try {
    raw = readFileSync(resultsPath, "utf8");
  } catch (err) {
    console.error(`[canary-report] cannot read ${resultsPath}: ${err.message}`);
    console.error("[canary-report] no canary results — nothing to report (non-blocking, exiting cleanly).");
    return;
  }

  let results;
  try {
    results = JSON.parse(raw);
  } catch (err) {
    console.error(`[canary-report] cannot parse ${resultsPath} as JSON: ${err.message}`);
    return;
  }

  const byCmp = decideDrift(results, { threshold });
  const driftingCmps = Object.keys(byCmp).filter((cmp) => byCmp[cmp].inDrift);

  if (driftingCmps.length === 0) {
    console.log("[canary-report] no CMP crossed the drift threshold this run.");
    return;
  }

  for (const cmp of driftingCmps) {
    const title = issueTitle(cmp);
    const body = formatIssueBody(cmp, byCmp[cmp], timestamp);

    let existingNumber = null;
    try {
      const searchOut = execImpl(
        "gh",
        ["issue", "list", "--state", "open", "--search", `"${title}" in:title`, "--json", "number,title"],
        { encoding: "utf8" },
      );
      const found = JSON.parse(searchOut).find((i) => i.title === title);
      existingNumber = found ? found.number : null;
    } catch (err) {
      console.error(`[canary-report] gh issue list failed for "${title}": ${err.message}`);
      continue;
    }

    try {
      if (existingNumber) {
        execImpl("gh", ["issue", "comment", String(existingNumber), "--body", body], { encoding: "utf8" });
        console.log(`[canary-report] updated existing issue #${existingNumber} for ${cmp}`);
      } else {
        execImpl("gh", ["issue", "create", "--title", title, "--body", body, "--label", "enhancement"], {
          encoding: "utf8",
        });
        console.log(`[canary-report] created new issue for ${cmp}`);
      }
    } catch (err) {
      console.error(`[canary-report] gh issue create/comment failed for "${title}": ${err.message}`);
    }
  }
}

// Only run the CLI when this file is executed directly — importing it (as
// tests/unit/canary-report.test.mjs does) must never trigger gh/network
// calls. Mirrors tools/moat-expansion/cli.mjs's entry guard (endsWith check,
// not a strict path-equality compare, so it works the same whether invoked
// as `node tools/canary-report.mjs` or via a relative/absolute npm script
// path on any platform).
const isMain = process.argv[1] && process.argv[1].endsWith("canary-report.mjs");
if (isMain) {
  const timestampArg = process.argv[2];
  runCanaryReportCli(timestampArg ? { timestamp: timestampArg } : {});
}
