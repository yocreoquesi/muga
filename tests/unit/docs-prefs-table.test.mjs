/**
 * Regression test: docs/data_architect.md sync-prefs table vs PREF_DEFAULTS
 *
 * Asserts that the set of keys documented in the "chrome.storage.sync" table
 * in data_architect.md exactly matches the keys in PREF_DEFAULTS (src/lib/storage.js).
 *
 * Fails with a clear diff on mismatch so documentation drift is caught immediately.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// ── Parse PREF_DEFAULTS keys from storage.js ─────────────────────────────────

const storageSource = readFileSync(join(ROOT, "src", "lib", "storage.js"), "utf8");

// Extract the PREF_DEFAULTS object body between the outermost braces
const prefDefaultsMatch = storageSource.match(
  /export\s+const\s+PREF_DEFAULTS\s*=\s*\{([\s\S]*?)\n\};/
);
assert.ok(prefDefaultsMatch, "Could not locate PREF_DEFAULTS export in src/lib/storage.js");

const prefBody = prefDefaultsMatch[1];

// Extract property names: lines like `  key:` or `  key :` (ignore comment lines)
const prefKeys = new Set(
  [...prefBody.matchAll(/^\s{1,4}(\w+)\s*:/gm)]
    .map(m => m[1])
    .filter(k => !["null", "false", "true"].includes(k))
);

// ── Parse documented keys from data_architect.md ──────────────────────────────

const doc = readFileSync(join(ROOT, "docs", "data_architect.md"), "utf8");

// Find the sync storage section: between "## chrome.storage.sync" and the next "##" heading
const syncSectionMatch = doc.match(
  /##\s+chrome\.storage\.sync[^\n]*\n([\s\S]*?)(?=\n##\s|\s*$)/
);
assert.ok(syncSectionMatch, "Could not locate '## chrome.storage.sync' section in docs/data_architect.md");

const syncSection = syncSectionMatch[1];

// Extract backtick-quoted key names from table rows: | `keyName` | ...
const docKeys = new Set(
  [...syncSection.matchAll(/^\|\s*`(\w+)`/gm)].map(m => m[1])
);

// ── Compare ───────────────────────────────────────────────────────────────────

describe("docs/data_architect.md sync prefs table matches PREF_DEFAULTS", () => {
  it("no keys in PREF_DEFAULTS are missing from the documentation table", () => {
    const missingFromDoc = [...prefKeys].filter(k => !docKeys.has(k));
    assert.deepEqual(
      missingFromDoc,
      [],
      `Keys in PREF_DEFAULTS but NOT documented in data_architect.md:\n` +
      missingFromDoc.map(k => `  - ${k}`).join("\n") + "\n" +
      "Add a row for each missing key to the '## chrome.storage.sync' table."
    );
  });

  it("no obsolete keys are present in the documentation table", () => {
    const obsoleteInDoc = [...docKeys].filter(k => !prefKeys.has(k));
    assert.deepEqual(
      obsoleteInDoc,
      [],
      `Keys documented in data_architect.md but NOT in PREF_DEFAULTS:\n` +
      obsoleteInDoc.map(k => `  - ${k}`).join("\n") + "\n" +
      "Remove the row(s) for obsolete keys from the '## chrome.storage.sync' table."
    );
  });
});
