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
import { renderMarkdown } from "./lib/report-md.mjs";
import { renderHtml } from "./lib/report-html.mjs";
import { baselineAdapter } from "./competitors/baseline.mjs";
import { clearurlsAdapter } from "./competitors/clearurls.mjs";
import { adguardAdapter } from "./competitors/adguard.mjs";
import { firefoxAdapter } from "./competitors/firefox.mjs";

// A6 phase 2 (#506) competitor adapter list.
//
// Phase 2a — synthetic baseline (UTM + common click IDs) — floor.
// Phase 2b — ClearURLs (data.minify.json default config).
// Phase 2c — AdGuard URL Tracking Protection (filter #17).
// Phase 2e — Firefox built-in (Remote Settings query-stripping).
// Phase 2d will add Brave Shields.
// Each new adapter vendors its rule snapshot under
// tests/benchmark/competitors/data/ and appends here. See
// tests/benchmark/competitors/README-CONTRACT.txt for the contract.
const COMPETITOR_ADAPTERS = [baselineAdapter, clearurlsAdapter, adguardAdapter, firefoxAdapter];

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
  const jsonOut = join(REPORTS_DIR, `${stamp}-muga.json`);
  const mdOut = join(REPORTS_DIR, `${stamp}-muga.md`);
  const htmlOut = join(REPORTS_DIR, `${stamp}-muga.html`);
  writeFileSync(jsonOut, JSON.stringify(report, null, 2) + "\n");
  writeFileSync(mdOut, renderMarkdown(report));
  writeFileSync(htmlOut, renderHtml(report));
  process.stdout.write(
    `[muga-benchmark] corpus files: ${files.length}, entries: ${report.totalEntries}, matched: ${report.matched}, mismatched: ${report.mismatched}\n` +
      `[muga-benchmark] reports: ${jsonOut}\n` +
      `                         ${mdOut}\n` +
      `                         ${htmlOut}\n`,
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
