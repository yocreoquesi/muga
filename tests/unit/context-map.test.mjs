/**
 * MUGA — CONTEXT.md path + load-bearing-claim guard (#784)
 *
 * PURPOSE: CONTEXT.md is the living architecture map. This test prevents
 * three categories of drift:
 *
 *  (A) PATH GUARD — every src/tests/tools/docs path mentioned in CONTEXT.md
 *      must exist on disk. A rename or deletion that is not reflected in
 *      CONTEXT.md fails here immediately.
 *
 *  (B) LOAD-BEARING CLAIMS — pin a small set of concrete, verifiable numbers
 *      to live data so a structural change that changes a count (new adapter,
 *      new hub module) cannot silently diverge from the map.
 *
 *      Pinned claims (sourced from live code, not CONTEXT.md text):
 *        b1. Hub modules for the affiliates split exist and are acyclic
 *            (affiliates.js re-exports from both data-leaf modules)
 *        b2. Hub modules for the storage split exist and are acyclic
 *            (storage.js re-exports from both leaf modules)
 *        b3. ENABLED_ADAPTERS length in tools/rule-ingestion/adapters/index.mjs
 *            equals 2 (adguardTp + clearurls — the corroboration baseline)
 *        b4. docs/adr/0005-rule-scaling-pipeline.md exists (CONTEXT.md links it)
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

function readRoot(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

// ── (A) Path guard ────────────────────────────────────────────────────────────

describe("context-map — path guard", () => {
  test("(A) every src/tests/tools/docs path in CONTEXT.md exists on disk", () => {
    const context = readRoot("CONTEXT.md");

    // Extract all paths that start with a known source root
    const PATH_RE = /\b(src|tests|tools|docs|\.github)\/[a-zA-Z0-9_.\-/]+/g;
    const rawMatches = context.match(PATH_RE) ?? [];

    // Deduplicate
    const paths = [...new Set(rawMatches)];
    assert.ok(paths.length > 0, "CONTEXT.md must mention at least one src/tests/tools/docs path");

    // Runtime-created, gitignored paths exist on dev machines but never in a
    // fresh clone (CI). CONTEXT.md documents them deliberately (ADR-0005's
    // quarantine zone) — they are exempt from the on-disk check.
    const GITIGNORED_RUNTIME_PATHS = new Set([
      "tools/rule-ingestion/quarantine",
      "tools/rule-ingestion/quarantine/",
    ]);

    const missing = paths.filter(
      (p) => !GITIGNORED_RUNTIME_PATHS.has(p) && !existsSync(join(ROOT, p))
    );

    assert.deepStrictEqual(
      missing,
      [],
      `CONTEXT.md references path(s) that do not exist on disk:\n  ${missing.join("\n  ")}\n` +
        "Update CONTEXT.md to reflect the current file layout, or restore the missing file."
    );
  });
});

// ── (B) Load-bearing claims ───────────────────────────────────────────────────

describe("context-map — load-bearing claims", () => {

  // b1. Affiliates split hub modules
  test("(b1) affiliates.js re-exports from affiliates-data.js and redirect-networks.js", () => {
    const src = readRoot("src/lib/affiliates.js");
    assert.ok(
      src.includes('from "./affiliates-data.js"'),
      "affiliates.js must re-export from affiliates-data.js (CONTEXT.md section 5: affiliates split)"
    );
    assert.ok(
      src.includes('from "./redirect-networks.js"'),
      "affiliates.js must re-export from redirect-networks.js (CONTEXT.md section 5: affiliates split)"
    );
  });

  // b2. Storage split hub modules
  test("(b2) storage.js re-exports from prefs.js and storage-migrations.js", () => {
    const src = readRoot("src/lib/storage.js");
    assert.ok(
      src.includes('from "./prefs.js"'),
      "storage.js must re-export from prefs.js (CONTEXT.md section 5: storage split)"
    );
    assert.ok(
      src.includes('from "./storage-migrations.js"'),
      "storage.js must re-export from storage-migrations.js (CONTEXT.md section 5: storage split)"
    );
  });

  // b3. ENABLED_ADAPTERS length
  test("(b3) ENABLED_ADAPTERS has exactly 2 entries (adguardTp + clearurls)", () => {
    const src = readRoot("tools/rule-ingestion/adapters/index.mjs");
    // Find the export line: export const ENABLED_ADAPTERS = [adguardTp, clearurls];
    const m = src.match(/export const ENABLED_ADAPTERS\s*=\s*\[([^\]]*)\]/);
    assert.ok(
      m,
      "tools/rule-ingestion/adapters/index.mjs must declare ENABLED_ADAPTERS as a single-line array"
    );
    // Count non-empty comma-separated identifiers
    const items = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    assert.strictEqual(
      items.length,
      2,
      `ENABLED_ADAPTERS has ${items.length} entries but CONTEXT.md documents 2 (adguardTp + clearurls). ` +
        "Update CONTEXT.md section 6 (Rule-ingestion pipeline) to reflect the new adapter count."
    );
  });

  // b4. ADR-0005 file exists (CONTEXT.md links it in multiple sections)
  test("(b4) docs/adr/0005-rule-scaling-pipeline.md exists", () => {
    assert.ok(
      existsSync(join(ROOT, "docs/adr/0005-rule-scaling-pipeline.md")),
      "docs/adr/0005-rule-scaling-pipeline.md must exist — CONTEXT.md links it in sections 4, 6, and 7. " +
        "If the ADR was moved or renamed, update CONTEXT.md and the guard accordingly."
    );
  });
});
