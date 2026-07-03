/**
 * MUGA — Source-grep ratchet (#824)
 *
 * Enforces the #709 decision: tests should assert BEHAVIOR through public
 * interfaces, not verify that source code contains particular strings.
 * Source-string assertions create zombie code — deleting a function breaks
 * a test, so contributors re-add the zombie "to fix the test."
 *
 * ## How this ratchet works
 *
 * For every test file in tests/unit/ we count occurrences of the heuristic
 * patterns that indicate source-text assertions:
 *
 *   /[A-Za-z]+Source\.(includes|match|indexOf|slice)\(/g
 *
 * This regex catches `swSource.includes(`, `cleanerSource.match(`, etc.
 * It is a heuristic — it catches the dominant pattern. Edge cases like
 * reading source into a variable named `src` and using `src.includes()`
 * are counted by a broader sweep in the full-audit companion tests; those
 * are tracked separately.
 *
 * ### Ratchet invariants
 *
 *   - A file whose count is BELOW its baseline → OK.
 *   - A file whose count is ABOVE its baseline → FAIL. Counts may only go
 *     DOWN (behavioral migration) not UP (new source-string assertions).
 *   - A NEW file with a nonzero count not in the baseline → FAIL.
 *
 * ### Lowering a baseline
 *
 * When you migrate a source-string assertion to a behavioral test, LOWER
 * the corresponding baseline number here. The baseline is a CEILING, not
 * a target. Seeing slack (actual < baseline) is fine and expected during
 * the migration arc. The "slack guard" test below reminds you to ratchet
 * down once the count is more than 10 below the ceiling (10 gives buffer
 * for in-flight PRs changing the same file without merge conflicts).
 *
 * ### Adding a new source-string assertion
 *
 * Do NOT do this. Prefer a behavioral test. If you genuinely cannot (e.g.
 * the module cannot be imported in Node because it calls chrome.* at the
 * top level, AND the invariant you need to verify has no observable
 * behavioral proxy), then:
 *
 *   1. Add the file with the exact current count to BASELINE (if absent).
 *   2. If the file already exists, increment its count by exactly 1.
 *   3. Add a comment in the baseline entry explaining WHY.
 *   4. Reference #824 in the commit message.
 *
 * ### Exempt files
 *
 * Some test files use source-text analysis as the CORRECT pattern because
 * the SUBJECT UNDER TEST is the source artifact itself (config consistency,
 * duplication guards, workflow structure). They are listed in EXEMPT below
 * with a reason comment and are skipped by the ratchet.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const UNIT_DIR = __dirname; // this file lives in tests/unit/

// ── Heuristic pattern ────────────────────────────────────────────────────────
// Matches *Source.includes( / *Source.match( / *Source.indexOf( / *Source.slice(
// where * is one or more identifier characters (e.g. swSource, cleanerSource).
const SOURCE_GREP_PATTERN = /[A-Za-z]+Source\.(includes|match|indexOf|slice)\(/g;

// ── Exempt files ─────────────────────────────────────────────────────────────
// Files where source-analysis IS the correct pattern — the subject under test
// is the source artifact itself, not a behavioral proxy for it.
const EXEMPT = new Set([
  // Workflow YAML structure guards — analyzing CI config is the point.
  "workflow-hardening.test.mjs",
  "workflows-hardened.test.mjs",
  "ingestion-scheduled-workflow.test.mjs",

  // Security nonce handshake — structural contracts across content-script
  // files that cannot be imported in Node (chrome.* top-level calls).
  "gate-nonce.test.mjs",

  // Bundle/STRIP parity — verifies four content-script files are byte-identical
  // on the hot-path STRIP table; duplication enforcement is the purpose.
  "strip-table-parity.test.mjs",
  "cleaner-bundle-sync.test.mjs",

  // Toast i18n sync — cleaner.js carries an inline copy of toast keys because
  // content scripts cannot import ES modules; sync guard is correct pattern.
  "content-cleaner-toast-sync.test.mjs",

  // Manifest-order checks — verifies key ordering/presence in JSON manifests
  // as a structural contract, not a proxy for behavior.
  "caps-manifest-sync.test.mjs",
  "rules-manifest-sync.test.mjs",

  // Drift guard that reads THIS category of test files to count assertions;
  // meta-analysis of the test suite is inherently source-reading.
  "service-worker-patterns-drift-guard.test.mjs",

  // This file itself — the heuristic regex and its inline examples contain
  // the patterns we are searching for, causing false self-detection.
  "source-grep-ratchet.test.mjs",
]);

// ── Baseline ─────────────────────────────────────────────────────────────────
// Snapshot of source-grep counts as of the #824 PR (2026-06-10).
// Keys are bare filenames (no path). Values are INTEGER ceilings.
//
// Counts may go DOWN (migrate assertions → lower the number).
// A file may only go UP with an explicit baseline bump + rationale.
// A new file appearing with count > 0 and NOT in this map → test fails.
//
// Top offenders targeted for migration in the #824 arc (NOT this PR):
//   service-worker-patterns.test.mjs  76  ← largest; SW not importable in Node
//   shortener-stats-sw.test.mjs       39  ← SW + storage both not importable
//   misc-regression.test.mjs          29  ← mixed; some migratable
//   content-cleaner-patterns.test.mjs 27  ← content script not importable
//   content-script.test.mjs           19  ← content script not importable
const BASELINE = {
  // Files with SW/content-script source that cannot be imported in Node —
  // migration requires extracting pure functions or an integration harness.
  "service-worker-patterns.test.mjs": 76,   // SW not importable; behavioral migration is long arc (#824)
  "shortener-stats-sw.test.mjs": 40,        // SW + storage; behavioral migration deferred (#824). +1 for #922 egress-gate guard (SW not importable)
  "misc-regression.test.mjs": 29,           // mixed bag; partial migration possible (#824)
  "content-cleaner-patterns.test.mjs": 27,  // content script not importable (#824)
  "content-script.test.mjs": 19,            // content script not importable (#824)
  "dnr-ids.test.mjs": 8,                    // verifies SW + remote-rules import the ids module (#824)
  "dnr-consent-gate.test.mjs": 8,           // SW not importable; mixed with behavioral tests (#824). +1 for #921 rule-1001 gate guard
  "verify-warnings-regression.test.mjs": 6, // regression guards; some migratable (#824)
  "i18n-orphan.test.mjs": 5,               // reads HTML/JS to find orphaned i18n keys (#824)
  "browser-detect.test.mjs": 4,            // verifies popup/options import the module (#824)
  "popup-reactive-status.test.mjs": 4,     // popup source; mixed behavioral/source (#824)
  "storage.test.mjs": 2,                   // verifies storage structure patterns (#824)
  "url-regex-sync.test.mjs": 2,            // verifies SW + cleaner regex are byte-identical (#824)
  "docs-prefs-table.test.mjs": 1,          // reads storage source to verify docs table (#824)
  "shortener-stats-race.test.mjs": 1,      // reads SW source for regression guard (#824)
  "shortener-stats.test.mjs": 1,           // reads SW source for regression guard (#824)
  "options-write-path-override.test.mjs": 2, // SW ENABLE/DISABLE_REMOTE_RULES handlers not importable in Node; 2 guards pin the reconcile wiring (#888 write-path follow-up, #824)
};

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Source-grep ratchet (#824) — counts may go DOWN, never UP", () => {
  const files = readdirSync(UNIT_DIR)
    .filter((f) => f.endsWith(".test.mjs") && !EXEMPT.has(f));

  for (const filename of files) {
    test(`${filename}: source-grep count does not exceed baseline`, () => {
      const src = readFileSync(join(UNIT_DIR, filename), "utf8");
      const matches = src.match(SOURCE_GREP_PATTERN) || [];
      const actual = matches.length;
      const ceiling = BASELINE[filename] ?? 0;

      assert.ok(
        actual <= ceiling,
        `${filename} has ${actual} source-grep assertion(s) but the baseline ceiling is ${ceiling}.\n` +
          `New source-string assertions are blocked by the #824 ratchet.\n` +
          `Prefer a behavioral test that exercises the public interface instead.\n` +
          `If a source-string assertion is genuinely unavoidable (module not importable in Node),\n` +
          `raise BASELINE["${filename}"] in tests/unit/source-grep-ratchet.test.mjs by exactly 1\n` +
          `and explain why in the commit message. See #824 for the migration guide.`,
      );
    });
  }

  test("baseline has no phantom entries (every key maps to a real test file)", () => {
    // Prevents stale entries accumulating after a file is renamed/deleted.
    const allFiles = new Set(
      readdirSync(UNIT_DIR).filter((f) => f.endsWith(".test.mjs")),
    );
    for (const key of Object.keys(BASELINE)) {
      assert.ok(
        allFiles.has(key),
        `BASELINE contains "${key}" but that file no longer exists in tests/unit/.\n` +
          `Remove the stale entry from BASELINE in source-grep-ratchet.test.mjs.`,
      );
    }
  });

  test("baseline slack guard — lower ceilings when files drop by more than 10 (keeps ratchet tight)", () => {
    // If a file's actual count drops > 10 below its ceiling, the baseline is
    // stale. This isn't a hard failure — it's a maintenance reminder.
    // It becomes a hard failure if slack > 20 to force cleanup.
    const largeSlack = [];
    for (const [filename, ceiling] of Object.entries(BASELINE)) {
      const filePath = join(UNIT_DIR, filename);
      let actual = 0;
      try {
        const src = readFileSync(filePath, "utf8");
        actual = (src.match(SOURCE_GREP_PATTERN) || []).length;
      } catch {
        continue; // phantom-entries test will catch missing files
      }
      const slack = ceiling - actual;
      if (slack > 20) largeSlack.push({ filename, ceiling, actual, slack });
    }
    assert.deepStrictEqual(
      largeSlack,
      [],
      `The following baseline entries have > 20 slack — lower the ceiling to stay tight:\n` +
        largeSlack
          .map((e) => `  ${e.filename}: ceiling=${e.ceiling} actual=${e.actual} (slack=${e.slack})`)
          .join("\n") +
        "\nEdit BASELINE in tests/unit/source-grep-ratchet.test.mjs.",
    );
  });
});
