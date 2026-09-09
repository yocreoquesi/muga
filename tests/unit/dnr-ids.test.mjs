/**
 * MUGA — Unit tests for src/lib/dnr-ids.js
 *
 * Verifies the DNR rule ID registry:
 *   - All IDs are exported and have the expected values
 *   - No two IDs collide (preventing silent rule overwrites)
 *   - service-worker.js and remote-rules.js import from dnr-ids.js
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  DNR_STATIC_RULE_ID,
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8"
);
const remoteRulesSource = readFileSync(
  join(__dirname, "../../src/lib/remote-rules.js"),
  "utf8"
);
const dnrIdsSource = readFileSync(
  join(__dirname, "../../src/lib/dnr-ids.js"),
  "utf8"
);

// ── Value assertions ─────────────────────────────────────────────────────────

describe("dnr-ids.js — exported values", () => {
  test("DNR_STATIC_RULE_ID is 1", () => {
    assert.strictEqual(DNR_STATIC_RULE_ID, 1);
  });

  test("DNR_CUSTOM_PARAMS_RULE_ID is 1000", () => {
    assert.strictEqual(DNR_CUSTOM_PARAMS_RULE_ID, 1000);
  });

  test("DNR_REMOTE_PARAMS_RULE_ID is 1001", () => {
    assert.strictEqual(DNR_REMOTE_PARAMS_RULE_ID, 1001);
  });
});

// ── No collision ─────────────────────────────────────────────────────────────

describe("dnr-ids.js — no ID collisions", () => {
  test("all three IDs are distinct", () => {
    const ids = [DNR_STATIC_RULE_ID, DNR_CUSTOM_PARAMS_RULE_ID, DNR_REMOTE_PARAMS_RULE_ID];
    const unique = new Set(ids);
    assert.strictEqual(unique.size, ids.length, `DNR rule IDs must all be distinct; got: ${ids}`);
  });

  test("DNR_REMOTE_PARAMS_RULE_ID does not equal DNR_CUSTOM_PARAMS_RULE_ID", () => {
    assert.notEqual(
      DNR_REMOTE_PARAMS_RULE_ID,
      DNR_CUSTOM_PARAMS_RULE_ID,
      "Remote rule ID must differ from custom params rule ID"
    );
  });
});

// ── Import chain ─────────────────────────────────────────────────────────────

describe("dnr-ids.js — import chain", () => {
  test("service-worker.js imports from lib/dnr-ids.js", () => {
    assert.ok(
      swSource.includes('from "../lib/dnr-ids.js"'),
      "service-worker.js must import from lib/dnr-ids.js"
    );
  });

  test("service-worker.js uses DNR_CUSTOM_PARAMS_RULE_ID (not a bare literal 1000)", () => {
    assert.ok(
      swSource.includes("DNR_CUSTOM_PARAMS_RULE_ID"),
      "service-worker.js must reference DNR_CUSTOM_PARAMS_RULE_ID"
    );
    // Ensure the bare constant 1000 is not used directly as a rule ID
    assert.ok(
      !swSource.includes("removeRuleIds: [1000]"),
      "service-worker.js must not use bare literal 1000 as a DNR rule ID"
    );
  });

  test("remote-rules.js imports from lib/dnr-ids.js", () => {
    assert.ok(
      remoteRulesSource.includes('from "./dnr-ids.js"'),
      "remote-rules.js must import from lib/dnr-ids.js"
    );
  });

  test("remote-rules.js REMOTE_RULE_ID is derived from DNR_REMOTE_PARAMS_RULE_ID", () => {
    assert.ok(
      remoteRulesSource.includes("DNR_REMOTE_PARAMS_RULE_ID"),
      "remote-rules.js REMOTE_RULE_ID must be assigned from DNR_REMOTE_PARAMS_RULE_ID"
    );
  });

  test("dnr-ids.js exports all three ID constants", () => {
    assert.ok(dnrIdsSource.includes("export const DNR_STATIC_RULE_ID"));
    assert.ok(dnrIdsSource.includes("export const DNR_CUSTOM_PARAMS_RULE_ID"));
    assert.ok(dnrIdsSource.includes("export const DNR_REMOTE_PARAMS_RULE_ID"));
  });
});

// ── Dynamic ID ranges ────────────────────────────────────────────────────────
//
// The header of dnr-ids.js states the reason this file exists: "A collision
// would cause one rule to silently overwrite another with no error." The
// single-ID assertions above cover 1000/1001; every range added since is
// covered here, so a new range that overruns its neighbour fails a test rather
// than silently disabling whichever rule loses.

describe("dnr-ids.js — dynamic ID ranges never overlap", () => {
  test("every dynamic range is disjoint from every other", async () => {
    const ids = await import("../../src/lib/dnr-ids.js");

    const ranges = [
      ["custom-params", ids.DNR_CUSTOM_PARAMS_RULE_ID, 1],
      ["remote-params", ids.DNR_REMOTE_PARAMS_RULE_ID, 1],
      ["allowlist", ids.DNR_ALLOWLIST_RULE_ID_BASE, ids.DNR_ALLOWLIST_MAX_RULES],
      ["suppress-referer", ids.DNR_SUPPRESS_REFERER_RULE_ID, 1],
      ["block-beacons", ids.DNR_BLOCK_BEACONS_RULE_ID, 1],
      ["blocklist-referer", ids.DNR_BLOCKLIST_REFERER_RULE_ID_BASE, ids.DNR_BLOCKLIST_MAX_RULES],
      ["blocklist-beacons", ids.DNR_BLOCKLIST_BEACON_RULE_ID_BASE, ids.DNR_BLOCKLIST_MAX_RULES],
      ["scoped-params", ids.DNR_SCOPED_PARAMS_RULE_ID_BASE, ids.DNR_SCOPED_PARAMS_MAX_RULES],
      ["category-filter", ids.DNR_CATEGORY_FILTER_RULE_ID_BASE, ids.DNR_CATEGORY_FILTER_MAX_RULES],
    ].map(([name, base, length]) => ({ name, start: base, end: base + length - 1 }));

    for (let i = 0; i < ranges.length; i++) {
      for (let j = i + 1; j < ranges.length; j++) {
        const a = ranges[i], b = ranges[j];
        assert.ok(
          a.end < b.start || b.end < a.start,
          `${a.name} (${a.start}-${a.end}) overlaps ${b.name} (${b.start}-${b.end})`,
        );
      }
    }
  });
});

// ── #1221 slice 2: the host-scoped strip rules ───────────────────────────────

describe("dnr-ids.js — host-scoped strip rules (#1221 slice 2)", () => {
  test("outrank the global strip rules, which is a measured requirement", async () => {
    const { DNR_SCOPED_PARAMS_PRIORITY } = await import("../../src/lib/dnr-ids.js");
    // A thin scoped rule only ADDS to the global strip. At equal priority the
    // composition depends on which rule wins the first redirect pass: measured
    // in real Chromium it composed 11 times in 12 and failed on CI, and at
    // priority 2 it composed 24 of 24 (#1229, PR #1242). Every global strip
    // rule MUGA registers is priority 1.
    assert.ok(DNR_SCOPED_PARAMS_PRIORITY > 1);
  });

  test("stay below the allow rules, so the allowlist still always wins", async () => {
    const { DNR_SCOPED_PARAMS_PRIORITY, DNR_SIGNED_URL_ALLOW_PRIORITY } =
      await import("../../src/lib/dnr-ids.js");
    assert.ok(DNR_SCOPED_PARAMS_PRIORITY < DNR_SIGNED_URL_ALLOW_PRIORITY);
  });
});
