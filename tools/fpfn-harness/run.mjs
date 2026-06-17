/**
 * MUGA FP/FN harness — corpus-driven processUrl accuracy gate (#890)
 *
 * Loads two sources of labelled URL entries:
 *   1. tools/fpfn-harness/corpus.json   — new entries (tracker-only, functional,
 *                                          wrapper, #885 AliExpress regression)
 *   2. tests/integration/affiliate-harness/fixtures/*.json — 10 existing affiliate
 *                                          fixture landing_samples
 *
 * For each entry, runs processUrl and checks:
 *   FP (false positive): a param in expected.preserve that is GONE from cleanUrl
 *   FN (false negative): a param in expected.strip that is STILL in cleanUrl
 *
 * FP == 0 is the hard gate (preserve violations are catastrophic — the class
 * of bug that produced #885). FN is informational.
 *
 * Export: runHarness() → { entries, totalFP, totalFN, totalEntries, fpViolations }
 * CLI:    node tools/fpfn-harness/run.mjs [--json path/to/report.json]
 */

import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join, dirname } from "node:path";

// ---------------------------------------------------------------------------
// Locate project root
// ---------------------------------------------------------------------------

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Load processUrl
// ---------------------------------------------------------------------------

const { processUrl } = await import(
  pathToFileURL(join(ROOT, "src", "lib", "cleaner.js")).href
);

// ---------------------------------------------------------------------------
// PREFS — matches the pattern used in affiliate-harness.test.mjs
// ---------------------------------------------------------------------------

const PREFS = Object.freeze({
  enabled: true,
  blacklist: [],
  whitelist: [],
  customParams: [],
  remoteParams: [],
  userCustomRules: [],
  disabledCategories: [],
});

// ---------------------------------------------------------------------------
// Load corpus entries
// ---------------------------------------------------------------------------

function loadCorpus() {
  const raw = readFileSync(join(__dirname, "corpus.json"), "utf8");
  return JSON.parse(raw);
}

// ---------------------------------------------------------------------------
// Load affiliate fixture landing_samples
// ---------------------------------------------------------------------------

function loadFixtures() {
  const fixturesDir = join(ROOT, "tests", "integration", "affiliate-harness", "fixtures");
  const files = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));
  const entries = [];
  for (const file of files) {
    const raw = readFileSync(join(fixturesDir, file), "utf8");
    const fixture = JSON.parse(raw);
    const network = fixture.network ?? file.replace(".json", "");
    for (const sample of fixture.landing_samples ?? []) {
      entries.push({
        url: sample.url,
        referrer: sample.referrer ?? null,
        note: `${network} fixture`,
        expected: sample.expected ?? { preserve: [], strip: [] },
      });
    }
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Run a single entry through processUrl and compute FP/FN
// ---------------------------------------------------------------------------

function runEntry(entry) {
  // domainRules is intentionally [] — the harness measures preservation that
  // holds WITHOUT the domain-rules preserveParams safety net (a stricter FP
  // test). A future corpus entry depending on a domain-rules-only preserve
  // would need domainRules wired in here.
  const { cleanUrl } = processUrl(
    entry.url,
    PREFS,
    [],
    undefined,
    undefined,
    entry.referrer ?? null
  );

  let cleanParams;
  try {
    // NOTE: checks querystring params only, not path segments. Every current
    // corpus label is a query param; a path-segment label would be un-checked.
    cleanParams = new URL(cleanUrl).searchParams;
  } catch {
    // If cleanUrl is unparseable, treat all preserve as missing (FP) and
    // all strip as absent (FN=0) — conservative.
    cleanParams = new URLSearchParams();
  }

  const fp = [];
  for (const param of entry.expected.preserve ?? []) {
    if (!cleanParams.has(param)) {
      fp.push(param);
    }
  }

  const fn = [];
  for (const param of entry.expected.strip ?? []) {
    if (cleanParams.has(param)) {
      fn.push(param);
    }
  }

  return { fp, fn, cleanUrl };
}

// ---------------------------------------------------------------------------
// runHarness() — main export
// ---------------------------------------------------------------------------

export function runHarness() {
  const corpusEntries = loadCorpus();
  const fixtureEntries = loadFixtures();
  const allEntries = [...corpusEntries, ...fixtureEntries];

  const entries = [];
  const fpViolations = [];
  let totalFP = 0;
  let totalFN = 0;

  for (const entry of allEntries) {
    const { fp, fn, cleanUrl } = runEntry(entry);
    totalFP += fp.length;
    totalFN += fn.length;

    for (const param of fp) {
      fpViolations.push({ url: entry.url, param, note: entry.note ?? "" });
    }

    entries.push({
      url: entry.url,
      note: entry.note ?? "",
      cleanUrl,
      fp,
      fn,
      ok: fp.length === 0,
    });
  }

  return {
    entries,
    totalFP,
    totalFN,
    totalEntries: allEntries.length,
    fpViolations,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

async function main() {
  const result = runHarness();

  const statusLine = result.totalFP === 0
    ? `✓ FP gate PASSED — 0 false positives`
    : `✗ FP gate FAILED — ${result.totalFP} false positive(s)`;

  console.log(`\nMUGA FP/FN Harness`);
  console.log(`─────────────────────────────────────────────`);
  console.log(`  Total entries : ${result.totalEntries}`);
  console.log(`  False positives (preserve violations): ${result.totalFP}  ← hard gate`);
  console.log(`  False negatives (tracker not stripped): ${result.totalFN}  ← informational`);
  console.log(`\n  ${statusLine}`);

  if (result.fpViolations.length > 0) {
    console.log(`\n  FP violations:`);
    for (const v of result.fpViolations) {
      console.log(`    [${v.note}] param "${v.param}" was stripped from: ${v.url}`);
    }
  }

  if (result.totalFN > 0) {
    console.log(`\n  FN details (informational):`);
    for (const entry of result.entries) {
      if (entry.fn.length > 0) {
        console.log(`    [${entry.note}] tracker(s) not stripped: ${entry.fn.join(", ")} — ${entry.url}`);
      }
    }
  }

  console.log("");

  // Optional JSON report output
  const jsonFlagIdx = process.argv.indexOf("--json");
  if (jsonFlagIdx !== -1 && process.argv[jsonFlagIdx + 1]) {
    const outPath = process.argv[jsonFlagIdx + 1];
    writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
    console.log(`  Report written to: ${outPath}\n`);
  }

  if (result.totalFP > 0) {
    process.exit(1);
  }
}

// Run main only when executed directly (not imported)
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  await main();
}
