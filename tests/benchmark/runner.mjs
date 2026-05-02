/**
 * MUGA: Benchmark runner — phase 1.
 *
 * Reads tests/benchmark/corpus/*.json, applies MUGA's processUrl to each
 * entry, and writes a JSON report under tests/benchmark/reports/.
 *
 * Phase 1 ships MUGA-only. Competitor rule sets (ClearURLs, AdGuard,
 * Brave Shields, Firefox built-in) are deferred to phase 2; Markdown +
 * HTML reports and CI-on-release-tag are deferred to phase 3.
 *
 * Exit codes:
 *   0 — all corpus entries matched their expectations
 *   1 — at least one mismatch (details in the report's `mismatches` list)
 */

import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { writeFileSync, mkdirSync } from "node:fs";

import { processUrl } from "../../src/lib/cleaner.js";
import { loadCorpus } from "./lib/corpus-loader.mjs";
import { compareEntry, buildReport, exitCodeFromReport, runCompetitors } from "./lib/runner-core.mjs";

// Phase 2 of A6 (#506) ships the competitor adapter contract but no
// real adapter yet. ClearURLs / AdGuard / Brave / Firefox each get
// their own slice (phase 2a / 2b / 2c / 2d). Each will append to this
// list. See tests/benchmark/competitors/README-CONTRACT.txt for the
// adapter contract. Today this stays empty — runCompetitors handles
// the no-adapters case gracefully.
const COMPETITOR_ADAPTERS = [];

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = join(__dirname, "corpus");
const REPORTS_DIR = join(__dirname, "reports");

// Minimal prefs shape — TRACKING_PARAMS / AFFILIATE_PATTERNS are imported
// inside cleaner.js directly. Cleaner.js reads prefs.blacklist/whitelist
// (not …Domains), customParams, remoteParams, injectOwnAffiliate, etc.
const PREFS = {
  enabled: true,
  onboardingDone: true,
  injectOwnAffiliate: false,
  blacklist: [],
  whitelist: [],
  customParams: [],
  remoteParams: [],
  disabledCategories: [],
  stripAllAffiliates: false,
  notifyForeignAffiliate: true,
};

function main() {
  const { entries, files } = loadCorpus(CORPUS_DIR);
  const results = entries.map((entry) => {
    const result = processUrl(entry.url, PREFS, []);
    return compareEntry(entry, result);
  });
  const competitorResults = entries.map((entry) => runCompetitors(entry, COMPETITOR_ADAPTERS));
  const report = buildReport({ corpus: entries, results, competitorResults, runner: "muga" });
  mkdirSync(REPORTS_DIR, { recursive: true });
  const stamp = report.generatedAt.replace(/[:.]/g, "-");
  const out = join(REPORTS_DIR, `${stamp}-muga.json`);
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(
    `[muga-benchmark] corpus files: ${files.length}, entries: ${report.totalEntries}, matched: ${report.matched}, mismatched: ${report.mismatched}\n` +
      `[muga-benchmark] report: ${out}\n`,
  );
  if (report.mismatched > 0) {
    process.stdout.write(`[muga-benchmark] mismatches:\n`);
    for (const m of report.mismatches) {
      process.stdout.write(`  - [${m.category}] ${m.url}\n      ${m.diff}\n`);
    }
  }
  process.exit(exitCodeFromReport(report));
}

main();
