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
import { DNR_SIGNED_URL_ALLOW_RULE_ID } from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

const rulesPath = join(root, "src", "rules", "tracking-params.json");
const rules = JSON.parse(readFileSync(rulesPath, "utf8"));

// The GLOBAL strip rule (urlFilter:"*") is sourced from TRACKING_PARAMS and must
// satisfy the strictest invariants: it strips on EVERY site, so it can never
// touch an affiliate-attribution or domain-functional param. Domain-SCOPED rules
// (e.g. the Amazon internal-nav rule, id 2) are sourced from per-domain
// stripParams and are safe to strip params that would be unsafe site-wide
// (`ref` is Vercel's affiliate param but Amazon's internal breadcrumb). Those
// rules get their own scope-aware safety coverage in dnr-amazon-params.test.mjs,
// so the TRACKING_PARAMS-sourced invariants below target the global rule only.
const globalRule = rules.find(r => r.condition?.urlFilter === "*") ?? rules[0];
const globalRemoveParams =
  globalRule.action?.redirect?.transform?.queryTransform?.removeParams ?? [];

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
  // The one documented exception is the signed-URL guard (#1200): an `allow`
  // rule that exempts presigned URLs from every strip rule. It is named
  // explicitly rather than waved through by action type, so a future stray
  // `allow` rule still fails this test.
  const wrong = rules.filter(
    r => r.action?.type !== "redirect" && r.id !== DNR_SIGNED_URL_ALLOW_RULE_ID
  );
  assert.equal(
    wrong.length,
    0,
    `Rules with unexpected action.type: ${JSON.stringify(wrong.map(r => ({ id: r.id, type: r.action?.type })))}`
  );
});

test("the signed-URL guard is an allow rule that outranks every strip rule", () => {
  const guard = rules.find(r => r.id === DNR_SIGNED_URL_ALLOW_RULE_ID);
  assert.ok(guard, "tracking-params.json is missing the signed-URL allow rule (#1200)");
  assert.equal(guard.action?.type, "allow");
  assert.ok(
    typeof guard.condition?.regexFilter === "string" && guard.condition.regexFilter.length > 0,
    "the signed-URL guard must be scoped by regexFilter"
  );

  // If a strip rule ever matched at equal-or-higher priority, a presigned URL
  // would be stripped and the download would 403 with no visible cause.
  const stripPriorities = rules
    .filter(r => r.action?.type === "redirect")
    .map(r => r.priority ?? 1);
  assert.ok(
    guard.priority > Math.max(...stripPriorities),
    `signed-URL guard priority ${guard.priority} must exceed every strip rule's (max ${Math.max(...stripPriorities)})`
  );
});

// ---------------------------------------------------------------------------
// Test 5 — action.redirect.transform.queryTransform.removeParams is a non-empty string array
// ---------------------------------------------------------------------------
test("All DNR rules have a non-empty removeParams array of strings", () => {
  // Strip rules only — the signed-URL guard (#1200) carries no removeParams
  // by design: it exempts the request instead of rewriting it.
  for (const rule of rules.filter(r => r.action?.type === "redirect")) {
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
  // Global rule only — it strips site-wide, so ANY affiliate-param collision is
  // unsafe. Scoped rules are checked against their own domains elsewhere.
  const collisions = globalRemoveParams.filter(p => affiliateParams.has(p));
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
  // Global rule only — it is the one sourced from TRACKING_PARAMS. Scoped rules
  // draw from per-domain stripParams (a different source), verified separately.
  const allRemoveParams = [...new Set(globalRemoveParams)];

  for (const param of allRemoveParams) {
    assert.ok(
      trackingSet.has(param.toLowerCase()),
      `DNR removeParam "${param}" (lowercased: "${param.toLowerCase()}") not found in TRACKING_PARAMS`
    );
  }
});

// Params that appear in domain-rules.json preserveParams are functional on some
// domains (e.g. cid on Google Maps, ie on CJK search engines).  They must NOT
// be in the global DNR rule — the content script handles them per-domain.
// Derived dynamically so the test stays in sync with domain-rules.json.
const domainRulesPath = join(root, "src", "rules", "domain-rules.json");
const domainRules = JSON.parse(readFileSync(domainRulesPath, "utf8"));
const DNR_EXCLUDED_PARAMS = new Set();
for (const rule of domainRules) {
  if (rule.preserveParams) {
    for (const p of rule.preserveParams) DNR_EXCLUDED_PARAMS.add(p);
  }
}

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

test("domain-preserved params live in the global rule but their domains are excluded from it", () => {
  // One-rule-per-request model: a param preserved on domain X stays in the GLOBAL
  // rule (which strips it everywhere else), and X is listed in the global rule's
  // excludedRequestDomains so the global rule never matches X. On X, only X's
  // profile rule matches — and that rule omits the preserved param. This replaces
  // the old design that dropped the param from the global rule entirely (which
  // left it un-stripped network-wide until a scoped rule happened to match).
  const removeParamSet = new Set(globalRemoveParams.map(p => p.toLowerCase()));
  const excludedDomains = new Set(globalRule.condition?.excludedRequestDomains ?? []);

  // Build param -> domains where it is preserved (from domain-rules.json).
  const preservedOn = new Map();
  for (const rule of domainRules) {
    for (const p of rule.preserveParams ?? []) {
      const key = p.toLowerCase();
      if (!preservedOn.has(key)) preservedOn.set(key, new Set());
      preservedOn.get(key).add(rule.domain);
    }
  }

  for (const param of DNR_EXCLUDED_PARAMS) {
    // Only params that are ALSO tracking params can appear in the global rule at
    // all; a preserved param that MUGA never strips globally simply isn't there.
    if (!removeParamSet.has(param)) continue;
    for (const domain of preservedOn.get(param) ?? []) {
      assert.ok(
        excludedDomains.has(domain),
        `"${param}" is preserved on "${domain}" and is in the global DNR rule, but "${domain}" is NOT in the global rule's excludedRequestDomains — it would be stripped there. Run \`npm run build:rules\``,
      );
    }
  }
});
