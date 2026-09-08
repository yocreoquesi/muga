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
 *  (C) STATED NUMBERS AND INVENTORIES (#1254) — the gap the pinned claims
 *      left open. (A) proves a path still exists and (B) pins four hand-picked
 *      structural facts, so a COUNT stated in prose could drift freely:
 *      CONTEXT.md said domain-rules.json had 169 entries when it had 188, and
 *      its manifest table omitted a DNR ruleset the manifest declares. These
 *      read the number out of CONTEXT.md and compare it to live data.
 *
 *        c1. The domain-rules.json entry count CONTEXT.md states is the real one
 *        c2. The tracking-param and prefix counts CONTEXT.md states are real
 *        c3. Every DNR ruleset id in both manifests is named in CONTEXT.md,
 *            and its per-manifest table row claims exactly those ids —
 *            over-claiming a ruleset Firefox does not ship is the same
 *            defect as omitting one Chrome does
 *        c4. Every ADR is indexed in docs/adr/README.md, with a status that
 *            agrees with the ADR's own
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
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

// ── (C) Stated numbers and inventories ────────────────────────────────────────

describe("context-map — stated numbers and inventories", () => {
  // c1. domain-rules.json entry count
  test("(c1) the domain-rules.json entry count CONTEXT.md states is the real one", () => {
    const context = readRoot("CONTEXT.md");
    const m = context.match(/domain-rules\.json[^\n]*?\((\d+) entries\)/);
    assert.ok(
      m,
      'CONTEXT.md must state the domain-rules.json size as "(N entries)" so it can be checked'
    );

    const stated = Number(m[1]);
    const actual = JSON.parse(readRoot("src/rules/domain-rules.json")).length;
    assert.strictEqual(
      stated,
      actual,
      `CONTEXT.md says domain-rules.json has ${stated} entries; it has ${actual}. ` +
        "Update the number in CONTEXT.md section 8."
    );
  });

  // c2. Tracking-param and prefix counts in the lead paragraph
  test("(c2) the tracking-param and prefix counts CONTEXT.md states are real", async () => {
    const context = readRoot("CONTEXT.md");
    const m = context.match(
      /removes (\d+) tracking parameters and (\d+) prefix-based noise patterns/
    );
    assert.ok(
      m,
      "CONTEXT.md's lead paragraph must state the tracking-param and prefix counts"
    );

    const { TRACKING_PARAMS, TRACKING_PREFIXES } = await import(
      "../../src/lib/affiliates.js"
    );
    assert.deepStrictEqual(
      [Number(m[1]), Number(m[2])],
      [TRACKING_PARAMS.length, TRACKING_PREFIXES.length],
      `CONTEXT.md's lead says ${m[1]} tracking parameters and ${m[2]} prefixes; the code ships ` +
        `${TRACKING_PARAMS.length} and ${TRACKING_PREFIXES.length}. ` +
        "Update the lead paragraph, which is the first thing a contributor reads."
    );
  });

  // c3. DNR ruleset inventory, per manifest, in both directions.
  //
  // CONTEXT.md section 2 has one "DNR rulesets" row with a cell per manifest.
  // The cell must name exactly what that manifest declares: a missing id is a
  // rewrite rule no contributor knows exists, and an extra one sends a Firefox
  // contributor looking for a ruleset that is not there.
  const MANIFEST_COLUMNS = [
    { column: 1, path: "src/manifest.json", label: "Chrome MV3" },
    { column: 2, path: "src/manifest.v2.json", label: "Firefox MV2" },
  ];

  for (const { column, path, label } of MANIFEST_COLUMNS) {
    test(`(c3) CONTEXT.md's ${label} column lists exactly ${path}'s DNR rulesets`, () => {
      const declared = (
        JSON.parse(readRoot(path)).declarative_net_request?.rule_resources ?? []
      ).map((r) => r.id);
      assert.ok(declared.length > 0, `${path} must declare at least one DNR ruleset`);

      const row = readRoot("CONTEXT.md")
        .split("\n")
        .find((l) => l.startsWith("| DNR rulesets |"));
      assert.ok(
        row,
        'CONTEXT.md section 2 must keep a "| DNR rulesets |" row, one cell per manifest'
      );

      // cells[0] is the empty string before the leading pipe, cells[1] the label.
      const cell = row.split("|").map((c) => c.trim())[column + 1] ?? "";
      const stated = [...cell.matchAll(/`([a-z_]+)`/g)].map((m) => m[1]);

      assert.deepStrictEqual(
        stated.slice().sort(),
        declared.slice().sort(),
        `CONTEXT.md's ${label} column says [${stated.join(", ")}] but ${path} declares ` +
          `[${declared.join(", ")}]. Update the table row in CONTEXT.md section 2, and the ` +
          '"Why it differs" paragraph under it if the difference is new.'
      );
    });
  }

  // c4. ADR index completeness and status agreement
  test("(c4) every ADR is indexed in docs/adr/README.md with an agreeing status", () => {
    const index = readRoot("docs/adr/README.md");
    const adrFiles = readdirSync(join(ROOT, "docs/adr"))
      .filter((f) => /^\d{4}-.*\.md$/.test(f))
      .sort();
    assert.ok(adrFiles.length > 0, "docs/adr must contain numbered ADRs");

    const problems = [];
    for (const file of adrFiles) {
      if (!index.includes(file)) {
        problems.push(`${file} has no row in docs/adr/README.md`);
        continue;
      }

      // The ADR's own status, first word, stripped of markdown emphasis.
      const own = readRoot(`docs/adr/${file}`).match(/^\*\*Status\*\*:\s*(.+)$/m);
      if (!own) {
        problems.push(`${file} has no "**Status**:" line`);
        continue;
      }
      const ownWord = own[1].replace(/\*/g, "").trim().split(/[\s—-]/)[0];

      // The status cell is the last column of that ADR's row.
      const row = index.split("\n").find((l) => l.includes(file) && l.startsWith("|"));
      const cells = row.split("|").map((c) => c.trim());
      const stated = cells[cells.length - 2] ?? "";
      if (!stated.startsWith(ownWord)) {
        problems.push(
          `${file} says "${ownWord}" but the index row says "${stated}"`
        );
      }
    }

    assert.deepStrictEqual(
      problems,
      [],
      `docs/adr/README.md disagrees with the ADRs it indexes:\n  ${problems.join("\n  ")}\n` +
        "The index is where a contributor decides which ADR still binds them, so a stale " +
        'status there ("phases pending" for work that shipped) is worse than no index. ' +
        "Update the row, or the ADR's own Status line, so the two agree."
    );
  });
});
