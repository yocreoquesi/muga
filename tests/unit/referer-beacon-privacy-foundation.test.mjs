/**
 * MUGA — referer-beacon-privacy, PR 1 (Foundation): prefs + settings-schema
 * + dnr-ids unit tests.
 *
 * This slice adds config ONLY (two new opt-in prefs, their settings-schema
 * entries, and reserved DNR rule ID ranges). Zero behavioral change: nothing
 * is wired to DNR / Firefox webRequest / the options UI yet (see PR 2-4).
 *
 * suppressReferer / blockBeacons both default to false (opt-in). blockPings
 * (the pre-existing DOM-layer ping blocker) is explicitly asserted UNCHANGED
 * (default true) — this feature must never silently alter its behavior.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { PREF_DEFAULTS } from "../../src/lib/prefs.js";
import {
  SETTINGS_FIELDS,
  BOOLEAN_KEYS,
  buildExportPayload,
  planImport,
} from "../../src/lib/settings-schema.js";
import {
  DNR_SUPPRESS_REFERER_RULE_ID,
  DNR_BLOCK_BEACONS_RULE_ID,
  DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
  DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
  DNR_BLOCKLIST_MAX_RULES,
  DNR_STATIC_RULE_ID,
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
  DNR_ALLOWLIST_RULE_ID_BASE,
  DNR_ALLOWLIST_MAX_RULES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── PREF_DEFAULTS ────────────────────────────────────────────────────────────

describe("PREF_DEFAULTS — suppressReferer / blockBeacons (referer-beacon-privacy)", () => {
  test("suppressReferer defaults to false", () => {
    assert.ok(Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "suppressReferer"));
    assert.strictEqual(PREF_DEFAULTS.suppressReferer, false);
  });

  test("blockBeacons defaults to false", () => {
    assert.ok(Object.prototype.hasOwnProperty.call(PREF_DEFAULTS, "blockBeacons"));
    assert.strictEqual(PREF_DEFAULTS.blockBeacons, false);
  });

  test("both new prefs are real booleans, not undefined/null", () => {
    assert.strictEqual(typeof PREF_DEFAULTS.suppressReferer, "boolean");
    assert.strictEqual(typeof PREF_DEFAULTS.blockBeacons, "boolean");
  });

  test("pre-existing blockPings default is left UNCHANGED (still true)", () => {
    assert.strictEqual(PREF_DEFAULTS.blockPings, true);
  });
});

// ── settings-schema.js ───────────────────────────────────────────────────────

describe("settings-schema.js — suppressReferer / blockBeacons entries", () => {
  test("SETTINGS_FIELDS declares both new keys as kind:boolean", () => {
    const suppress = SETTINGS_FIELDS.find((f) => f.key === "suppressReferer");
    const beacons = SETTINGS_FIELDS.find((f) => f.key === "blockBeacons");
    assert.ok(suppress, "suppressReferer must be declared in SETTINGS_FIELDS");
    assert.ok(beacons, "blockBeacons must be declared in SETTINGS_FIELDS");
    assert.strictEqual(suppress.kind, "boolean");
    assert.strictEqual(beacons.kind, "boolean");
  });

  test("both new keys are present in BOOLEAN_KEYS", () => {
    assert.ok(BOOLEAN_KEYS.includes("suppressReferer"));
    assert.ok(BOOLEAN_KEYS.includes("blockBeacons"));
  });

  test("SETTINGS_FIELDS has no duplicate keys after the addition", () => {
    const keys = SETTINGS_FIELDS.map((f) => f.key);
    assert.strictEqual(new Set(keys).size, keys.length);
  });

  test("buildExportPayload round-trips both new prefs", () => {
    const payload = buildExportPayload(
      { ...PREF_DEFAULTS, suppressReferer: true, blockBeacons: true },
      { devMode: false, appVersion: "9.9.9" },
    );
    assert.strictEqual(payload.suppressReferer, true);
    assert.strictEqual(payload.blockBeacons, true);
  });

  test("planImport round-trips both new prefs when true", () => {
    const plan = planImport({
      muga: true,
      blacklist: [],
      whitelist: [],
      customParams: [],
      suppressReferer: true,
      blockBeacons: true,
    });
    assert.equal(plan.ok, true);
    assert.strictEqual(plan.toSave.suppressReferer, true);
    assert.strictEqual(plan.toSave.blockBeacons, true);
  });

  test("planImport leaves both new prefs unset when absent from the import file (defaults survive)", () => {
    const plan = planImport({ muga: true, blacklist: [], whitelist: [], customParams: [] });
    assert.equal(plan.ok, true);
    assert.strictEqual(plan.toSave.suppressReferer, undefined);
    assert.strictEqual(plan.toSave.blockBeacons, undefined);
  });
});

// ── dnr-ids.js ────────────────────────────────────────────────────────────────

describe("dnr-ids.js — referer/beacon rule ID allocation", () => {
  test("DNR_SUPPRESS_REFERER_RULE_ID is 2500", () => {
    assert.strictEqual(DNR_SUPPRESS_REFERER_RULE_ID, 2500);
  });

  test("DNR_BLOCK_BEACONS_RULE_ID is 2600", () => {
    assert.strictEqual(DNR_BLOCK_BEACONS_RULE_ID, 2600);
  });

  test("DNR_BLOCKLIST_REFERER_RULE_ID_BASE is 2700", () => {
    assert.strictEqual(DNR_BLOCKLIST_REFERER_RULE_ID_BASE, 2700);
  });

  test("DNR_BLOCKLIST_BEACON_RULE_ID_BASE is 2900", () => {
    assert.strictEqual(DNR_BLOCKLIST_BEACON_RULE_ID_BASE, 2900);
  });

  test("DNR_BLOCKLIST_MAX_RULES is 200", () => {
    assert.strictEqual(DNR_BLOCKLIST_MAX_RULES, 200);
  });

  test("the blocklist referer range (2700..2899) and beacon range (2900..3099) do not overlap", () => {
    const refererEnd = DNR_BLOCKLIST_REFERER_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES - 1;
    assert.strictEqual(refererEnd, 2899);
    assert.ok(DNR_BLOCKLIST_BEACON_RULE_ID_BASE > refererEnd,
      "beacon range must start strictly after the referer range ends");
    const beaconEnd = DNR_BLOCKLIST_BEACON_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES - 1;
    assert.strictEqual(beaconEnd, 3099);
  });

  test("all new/pre-existing dynamic IDs and ranges are mutually distinct (no collision)", () => {
    const singleIds = [
      DNR_STATIC_RULE_ID,
      DNR_CUSTOM_PARAMS_RULE_ID,
      DNR_REMOTE_PARAMS_RULE_ID,
      DNR_SUPPRESS_REFERER_RULE_ID,
      DNR_BLOCK_BEACONS_RULE_ID,
    ];
    assert.strictEqual(new Set(singleIds).size, singleIds.length, "single rule IDs must be unique");

    const ranges = [
      { name: "allowlist", start: DNR_ALLOWLIST_RULE_ID_BASE, len: DNR_ALLOWLIST_MAX_RULES },
      { name: "blocklist-referer", start: DNR_BLOCKLIST_REFERER_RULE_ID_BASE, len: DNR_BLOCKLIST_MAX_RULES },
      { name: "blocklist-beacon", start: DNR_BLOCKLIST_BEACON_RULE_ID_BASE, len: DNR_BLOCKLIST_MAX_RULES },
    ];

    // No range may contain any of the single IDs.
    for (const { name, start, len } of ranges) {
      for (const id of singleIds) {
        assert.ok(
          id < start || id >= start + len,
          `single rule id ${id} must not fall inside the ${name} range [${start}, ${start + len})`,
        );
      }
    }

    // No two ranges may overlap.
    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i];
        const b = ranges[j];
        const aEnd = a.start + a.len;
        const bEnd = b.start + b.len;
        const overlaps = a.start < bEnd && b.start < aEnd;
        assert.ok(!overlaps, `${a.name} range must not overlap ${b.name} range`);
      }
    }
  });

  test("dnr-ids.js exports the five new constants by name (source guard)", () => {
    const src = readFileSync(join(__dirname, "../../src/lib/dnr-ids.js"), "utf8");
    for (const name of [
      "DNR_SUPPRESS_REFERER_RULE_ID",
      "DNR_BLOCK_BEACONS_RULE_ID",
      "DNR_BLOCKLIST_REFERER_RULE_ID_BASE",
      "DNR_BLOCKLIST_BEACON_RULE_ID_BASE",
      "DNR_BLOCKLIST_MAX_RULES",
    ]) {
      assert.ok(src.includes(`export const ${name}`), `dnr-ids.js must export ${name}`);
    }
  });
});
