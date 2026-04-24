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
