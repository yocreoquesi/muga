/**
 * MUGA: DNR rule artifact ↔ source-of-truth sync invariants.
 *
 * Companion to tests/unit/cleaner-bundle-sync.test.mjs. The same CI gate
 * at .github/workflows/ci.yml that should have caught cleaner-bundle.js
 * drift ALSO covers src/rules/tracking-params.json (lines 33-38). The
 * gate apparently didn't fire (#513). This file pins the
 * tracking-params.json ↔ TRACKING_PARAMS sync inside `npm test` so a
 * stale artifact is caught even when the CI gate is misconfigured.
 *
 * Note: tracking-params.json filters out params listed in
 * domain-rules.json preserveParams (since DNR strips globally and those
 * params are functional on specific domains). The number of removed
 * params in the DNR rule will therefore be SLIGHTLY less than
 * TRACKING_PARAMS.length — match against the filtered count, not raw.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import { DNR_STATIC_RULE_ID } from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES_PATH = join(ROOT, "src", "rules", "tracking-params.json");
const DOMAIN_RULES_PATH = join(ROOT, "src", "rules", "domain-rules.json");

const RULES = JSON.parse(readFileSync(RULES_PATH, "utf8"));
const DOMAIN_RULES = JSON.parse(readFileSync(DOMAIN_RULES_PATH, "utf8"));

// Mirror the filter in tools/generate-rules.mjs: params that appear
// in any domain-rule's preserveParams are excluded from the global DNR
// strip (the content script handles them with domain-specific logic).
const PRESERVED_BY_DOMAIN = new Set();
for (const rule of DOMAIN_RULES) {
  if (rule.preserveParams) {
    for (const p of rule.preserveParams) PRESERVED_BY_DOMAIN.add(p);
  }
}
const EXPECTED_PARAMS = TRACKING_PARAMS.filter((p) => !PRESERVED_BY_DOMAIN.has(p));

test("tracking-params.json — has at least one DNR rule", () => {
  assert.ok(Array.isArray(RULES), "tracking-params.json must be a JSON array");
  assert.ok(RULES.length >= 1, "tracking-params.json must contain at least one rule");
});

test("tracking-params.json — main rule shape (id, priority, action.redirect.transform.queryTransform.removeParams)", () => {
  const rule = RULES[0];
  assert.equal(rule.id, DNR_STATIC_RULE_ID);
  assert.equal(rule.priority, 1);
  assert.equal(rule.action?.type, "redirect");
  assert.ok(rule.action?.redirect?.transform?.queryTransform?.removeParams);
  assert.ok(Array.isArray(rule.action.redirect.transform.queryTransform.removeParams));
});

test("tracking-params.json — removeParams length equals filtered TRACKING_PARAMS length", () => {
  const removeParams = RULES[0].action.redirect.transform.queryTransform.removeParams;
  assert.equal(
    removeParams.length,
    EXPECTED_PARAMS.length,
    `tracking-params.json has ${removeParams.length} params; source has ${EXPECTED_PARAMS.length} after filtering domain-preserved entries — run \`npm run build:rules\``,
  );
});

test("tracking-params.json — every filtered TRACKING_PARAM is in removeParams", () => {
  const removeParams = new Set(RULES[0].action.redirect.transform.queryTransform.removeParams);
  for (const p of EXPECTED_PARAMS) {
    assert.ok(
      removeParams.has(p),
      `tracking-params.json is missing TRACKING_PARAM "${p}" — run \`npm run build:rules\``,
    );
  }
});

test("tracking-params.json — no extra params beyond filtered TRACKING_PARAMS", () => {
  const expected = new Set(EXPECTED_PARAMS);
  const removeParams = RULES[0].action.redirect.transform.queryTransform.removeParams;
  for (const p of removeParams) {
    assert.ok(
      expected.has(p),
      `tracking-params.json has unexpected param "${p}" not in source TRACKING_PARAMS — run \`npm run build:rules\``,
    );
  }
});

test("tracking-params.json — does NOT include params reserved by domain-rules.json", () => {
  const removeParams = new Set(RULES[0].action.redirect.transform.queryTransform.removeParams);
  for (const p of PRESERVED_BY_DOMAIN) {
    assert.ok(
      !removeParams.has(p),
      `tracking-params.json includes "${p}" which is preserveParams in domain-rules.json — DNR would strip it on every domain, breaking the per-domain logic. Run \`npm run build:rules\``,
    );
  }
});
