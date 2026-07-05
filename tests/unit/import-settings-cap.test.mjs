/**
 * MUGA — Import settings graceful cap (#911)
 *
 * Regression for the user-reported "[Settings Import Bug]" (#911): a VALID MUGA
 * export carrying more customParams than the storage cap allows (the reporter's
 * file had 1395) was rejected wholesale with the misleading
 * "That doesn't look like a MUGA settings file" error.
 *
 * The fix (graceful degradation, extends #818): recognise the file, import what
 * fits (filter invalid + truncate to the cap), and report how many entries were
 * dropped — never fail a valid-but-large file.
 *
 * The import handler in options.js is DOM/storage-bound, so its core list logic
 * lives in the pure, exported capImportedLists() which we exercise here against
 * the ACTUAL attachment from the issue (tests/unit/fixtures/muga-settings-1395-params.json).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { capImportedLists, IMPORT_LIST_CAPS, isValidCustomParam } from "../../src/lib/validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OPTIONS_SOURCE = readFileSync(join(__dirname, "../../src/options/options.js"), "utf8");
const FIXTURE = JSON.parse(
  readFileSync(join(__dirname, "fixtures/muga-settings-1395-params.json"), "utf8")
);

// ── Fixture preconditions — this really is the reported repro ─────────────────
describe("#911 fixture — the real reported attachment", () => {
  test("is a structurally valid MUGA file (muga:true, arrays present)", () => {
    assert.equal(FIXTURE.muga, true);
    assert.ok(Array.isArray(FIXTURE.blacklist));
    assert.ok(Array.isArray(FIXTURE.whitelist));
    assert.ok(Array.isArray(FIXTURE.customParams));
  });

  test("carries more customParams than the cap (the trigger condition)", () => {
    assert.ok(
      FIXTURE.customParams.length > IMPORT_LIST_CAPS.customParams,
      `fixture must exceed the cap; has ${FIXTURE.customParams.length}, cap ${IMPORT_LIST_CAPS.customParams}`
    );
  });
});

// ── capImportedLists — graceful degradation ───────────────────────────────────
describe("capImportedLists — graceful cap (#911)", () => {
  test("truncates the real 1395-param import to the cap instead of rejecting it", () => {
    const { customParams, skippedParams } = capImportedLists(FIXTURE);
    assert.equal(customParams.length, IMPORT_LIST_CAPS.customParams);
    // skipped = every entry that did not survive (invalid-filtered + over-cap)
    assert.equal(skippedParams, FIXTURE.customParams.length - IMPORT_LIST_CAPS.customParams >= 0
      ? FIXTURE.customParams.length - customParams.length
      : 0);
    assert.ok(skippedParams > 0, "user must be told entries were dropped");
  });

  test("every surviving customParam is valid (invalid ones filtered, not just sliced)", () => {
    const { customParams } = capImportedLists(FIXTURE);
    for (const p of customParams) {
      assert.ok(isValidCustomParam(p), `surviving param "${p}" must be valid`);
    }
  });

  test("skippedParams counts BOTH invalid entries and over-cap truncation", () => {
    // A mix: valid params over the cap + a couple of guaranteed-invalid entries.
    const data = {
      blacklist: [],
      whitelist: [],
      customParams: [
        ...Array.from({ length: IMPORT_LIST_CAPS.customParams + 5 }, (_, i) => `valid_param_${i}`),
        "q",             // denylisted nav key → invalid
        "tag",           // affiliate-guarded → invalid
        "has spaces",    // bad format → invalid
      ],
    };
    const { customParams, skippedParams } = capImportedLists(data);
    assert.equal(customParams.length, IMPORT_LIST_CAPS.customParams);
    // 3 invalid + 5 over-cap valid = 8 dropped
    assert.equal(skippedParams, 8);
  });

  test("a small valid import passes through untouched with zero skips", () => {
    const data = { blacklist: ["a.com"], whitelist: ["b.com"], customParams: ["ref_code", "promo_id"] };
    const out = capImportedLists(data);
    assert.deepEqual(out.customParams, ["ref_code", "promo_id"]);
    assert.deepEqual(out.blacklist, ["a.com"]);
    assert.deepEqual(out.whitelist, ["b.com"]);
    assert.equal(out.skippedParams, 0);
    assert.equal(out.droppedBlacklist, 0);
    assert.equal(out.droppedWhitelist, 0);
  });

  test("blacklist/whitelist are truncated to their caps and report the drop", () => {
    const data = {
      blacklist: Array.from({ length: IMPORT_LIST_CAPS.blacklist + 10 }, (_, i) => `b${i}.com`),
      whitelist: Array.from({ length: IMPORT_LIST_CAPS.whitelist + 3 }, (_, i) => `w${i}.com`),
      customParams: [],
    };
    const out = capImportedLists(data);
    assert.equal(out.blacklist.length, IMPORT_LIST_CAPS.blacklist);
    assert.equal(out.whitelist.length, IMPORT_LIST_CAPS.whitelist);
    assert.equal(out.droppedBlacklist, 10);
    assert.equal(out.droppedWhitelist, 3);
  });
});

// ── Handler-level regression guards ───────────────────────────────────────────
describe("import handler no longer hard-rejects on size (#911)", () => {
  test("the count-based whole-import throw is gone", () => {
    assert.ok(
      !/data\.customParams\.length\s*>\s*200/.test(OPTIONS_SOURCE),
      "options.js must NOT abort the whole import when customParams exceeds the cap"
    );
    assert.ok(
      !/data\.blacklist\.length\s*>\s*500/.test(OPTIONS_SOURCE),
      "options.js must NOT abort the whole import when blacklist exceeds the cap"
    );
  });

  test("import handler delegates list cleaning to capImportedLists", () => {
    // The graceful filter+cap call now lives in the pure planImport()
    // (src/lib/settings-schema.js), which options.js's import handler calls.
    const SETTINGS_SCHEMA_SOURCE = readFileSync(
      join(__dirname, "../../src/lib/settings-schema.js"),
      "utf8"
    );
    assert.ok(
      SETTINGS_SCHEMA_SOURCE.includes("capImportedLists(migrated)"),
      "planImport must call capImportedLists(migrated) for graceful filter + cap"
    );
    assert.ok(
      OPTIONS_SOURCE.includes("planImport(data)"),
      "import handler must delegate to planImport(data)"
    );
  });

  test("import handler still reports the skipped count to the user", () => {
    assert.ok(
      OPTIONS_SOURCE.includes("import_params_skipped"),
      "import handler must surface a partial-import toast when entries are dropped"
    );
  });
});
