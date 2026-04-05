/**
 * MUGA — tests/unit/dnr-rules.test.mjs
 *
 * Structural validation tests for src/rules/tracking-params.json.
 * Verifies the file is a valid DNR rule array with the expected shape,
 * and that its removeParams list is consistent with TRACKING_PARAMS in affiliates.js.
 *
 * Run with: npm test
 * Resolves #94.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const rulesPath = join(root, "src", "rules", "tracking-params.json");
const rules = JSON.parse(readFileSync(rulesPath, "utf8"));

// ---------------------------------------------------------------------------
// Test 1 — The JSON is an array
// ---------------------------------------------------------------------------
test("tracking-params.json is a JSON array (not an object)", () => {
  assert.ok(Array.isArray(rules), "tracking-params.json must be an array");
});

// ---------------------------------------------------------------------------
// Test 2 — The array is non-empty
// ---------------------------------------------------------------------------
test("tracking-params.json contains at least one rule", () => {
  assert.ok(rules.length > 0, "tracking-params.json must contain at least one rule");
});

// ---------------------------------------------------------------------------
// Test 2b — All rule IDs are unique
// ---------------------------------------------------------------------------
test("has no duplicate rule IDs", () => {
  const ids = rules.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, "Rule IDs must be unique");
});

// ---------------------------------------------------------------------------
// Test 3 — Each rule has id, priority, action, condition
// ---------------------------------------------------------------------------
test("Every DNR rule has id, priority, action, and condition", () => {
  const missing = rules.filter(
    r =>
      typeof r.id !== "number" ||
      typeof r.priority !== "number" ||
      typeof r.action !== "object" || r.action === null ||
      typeof r.condition !== "object" || r.condition === null
  );
  assert.equal(
    missing.length,
    0,
    `Rules missing required fields: ${JSON.stringify(missing.map(r => r.id))}`
  );
});

// ---------------------------------------------------------------------------
// Test 4 — action.type is "redirect" (correct type for param stripping via queryTransform)
// ---------------------------------------------------------------------------
test("All DNR rules use action.type === 'redirect' for param stripping", () => {
  const wrong = rules.filter(r => r.action?.type !== "redirect");
  assert.equal(
    wrong.length,
    0,
    `Rules with unexpected action.type: ${JSON.stringify(wrong.map(r => ({ id: r.id, type: r.action?.type })))}`
  );
});

// ---------------------------------------------------------------------------
// Test 5 — action.redirect.transform.queryTransform.removeParams is a non-empty string array
// ---------------------------------------------------------------------------
test("All DNR rules have a non-empty removeParams array of strings", () => {
  for (const rule of rules) {
    const removeParams = rule.action?.redirect?.transform?.queryTransform?.removeParams;
    assert.ok(
      Array.isArray(removeParams) && removeParams.length > 0,
      `Rule ${rule.id}: removeParams must be a non-empty array`
    );
    const nonStrings = removeParams.filter(p => typeof p !== "string" || p.trim() === "");
    assert.equal(
      nonStrings.length,
      0,
      `Rule ${rule.id}: removeParams contains non-string or empty entries: ${JSON.stringify(nonStrings)}`
    );
  }
});

// ---------------------------------------------------------------------------
// Test 6 — No param in removeParams also appears in AFFILIATE_PATTERNS
// (collision check — cross-reference with imports.test.mjs which defines
// the canonical TRACKING_PARAMS vs AFFILIATE_PATTERNS collision test)
// ---------------------------------------------------------------------------
test("No removeParams entry collides with AFFILIATE_PATTERNS params", async () => {
  const { AFFILIATE_PATTERNS } = await import("../../src/lib/affiliates.js");

  const affiliateParams = new Set(AFFILIATE_PATTERNS.map(e => e.param));
  const allRemoveParams = rules.flatMap(
    r => r.action?.redirect?.transform?.queryTransform?.removeParams ?? []
  );

  const collisions = allRemoveParams.filter(p => affiliateParams.has(p));
  assert.equal(
    collisions.length,
    0,
    `removeParams entries that collide with AFFILIATE_PATTERNS: ${JSON.stringify([...new Set(collisions)])}`
  );
});

// ---------------------------------------------------------------------------
// Test 7 — removeParams count matches the number of lowercase TRACKING_PARAMS
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Test 7b — resourceTypes must be restricted to main_frame (never xmlhttprequest)
// ---------------------------------------------------------------------------
test("DNR rules only target main_frame, never xmlhttprequest or other types", () => {
  const SAFE_TYPES = new Set(["main_frame", "sub_frame"]);
  for (const rule of rules) {
    const types = rule.condition?.resourceTypes ?? [];
    const unsafe = types.filter(t => !SAFE_TYPES.has(t));
    assert.equal(unsafe.length, 0,
      `Rule ${rule.id} targets unsafe resource types: ${JSON.stringify(unsafe)}. Only main_frame/sub_frame allowed.`);
  }
});

// ---------------------------------------------------------------------------
// Test 8 — removeParams count matches lowercase TRACKING_PARAMS count
// ---------------------------------------------------------------------------
test("every removeParam (lowercased) exists in TRACKING_PARAMS", async () => {
  const { TRACKING_PARAMS } = await import("../../src/lib/affiliates.js");

  const trackingSet = new Set(TRACKING_PARAMS.map(p => p.toLowerCase()));
  const allRemoveParams = [
    ...new Set(
      rules.flatMap(r => r.action?.redirect?.transform?.queryTransform?.removeParams ?? [])
    ),
  ];

  for (const param of allRemoveParams) {
    assert.ok(
      trackingSet.has(param.toLowerCase()),
      `DNR removeParam "${param}" (lowercased: "${param.toLowerCase()}") not found in TRACKING_PARAMS`
    );
  }
});

// Params intentionally removed from DNR because they conflict with domain-rules.json
// preserveParams (e.g. cid on Google Maps, ie on CJK search engines).
// The content script handles these with domain-specific logic.
const DNR_EXCLUDED_PARAMS = new Set([
  "si", "_r", "source", "campaign", "cid", "ref_", "ie", "ei", "ab_channel",
]);

test("every lowercase TRACKING_PARAM has a corresponding removeParam entry (except DNR-excluded)", async () => {
  const { TRACKING_PARAMS } = await import("../../src/lib/affiliates.js");

  const removeParamSet = new Set(
    rules.flatMap(r => r.action?.redirect?.transform?.queryTransform?.removeParams ?? [])
      .map(p => p.toLowerCase())
  );

  for (const param of TRACKING_PARAMS) {
    const lower = param.toLowerCase();
    if (DNR_EXCLUDED_PARAMS.has(lower)) continue;
    assert.ok(
      removeParamSet.has(lower),
      `TRACKING_PARAM "${param}" has no corresponding DNR removeParam entry`
    );
  }
});

test("DNR-excluded params are NOT in DNR removeParams", () => {
  const removeParamSet = new Set(
    rules.flatMap(r => r.action?.redirect?.transform?.queryTransform?.removeParams ?? [])
      .map(p => p.toLowerCase())
  );

  for (const param of DNR_EXCLUDED_PARAMS) {
    assert.ok(
      !removeParamSet.has(param),
      `"${param}" should NOT be in DNR — it conflicts with domain-rules.json preserveParams`
    );
  }
});
