/**
 * MUGA: DNR rule artifact ↔ source-of-truth sync invariants.
 *
 * Companion to tests/unit/cleaner-bundle-sync.test.mjs. The same CI gate
 * at .github/workflows/ci.yml that should have caught cleaner-bundle.js
 * drift ALSO covers src/rules/tracking-params.json. This file pins the
 * tracking-params.json ↔ TRACKING_PARAMS sync inside `npm test` so a stale
 * artifact is caught even when the CI gate is misconfigured.
 *
 * ONE-RULE-PER-REQUEST MODEL (the invariant this file guards):
 * Chrome applies AT MOST ONE redirect rule per request — redirect actions do
 * NOT cascade and the request is not re-evaluated after a rewrite. So the
 * generator MUST make every host match exactly ONE param-stripping rule, and
 * that rule must remove the COMPLETE set of params for that host:
 *   - the GLOBAL rule (id 1, urlFilter:"*") removes ALL TRACKING_PARAMS and is
 *     matched on every host EXCEPT the tailored domains (excludedRequestDomains);
 *   - each PER-DOMAIN-PROFILE rule (requestDomains-scoped) removes the complete
 *     set for its domains = TRACKING_PARAMS minus their preserveParams, plus any
 *     domain-specific extra strips.
 * The tests below fail if a future change re-introduces the old split design
 * (params spread across rules that all match the same host), which left
 * mixed-param URLs half-cleaned.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import {
  DNR_STATIC_RULE_ID,
  DNR_DOMAIN_PRESERVE_RULE_ID_BASE,
  DNR_DOMAIN_PRESERVE_MAX_RULES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES_PATH = join(ROOT, "src", "rules", "tracking-params.json");
const DOMAIN_RULES_PATH = join(ROOT, "src", "rules", "domain-rules.json");

const RULES = JSON.parse(readFileSync(RULES_PATH, "utf8"));
const DOMAIN_RULES = JSON.parse(readFileSync(DOMAIN_RULES_PATH, "utf8"));

const GLOBAL = RULES.find((r) => r.id === DNR_STATIC_RULE_ID);
const PROFILE_RULES = RULES.filter(
  (r) =>
    r.id >= DNR_DOMAIN_PRESERVE_RULE_ID_BASE &&
    r.id < DNR_DOMAIN_PRESERVE_RULE_ID_BASE + DNR_DOMAIN_PRESERVE_MAX_RULES,
);

const removeOf = (rule) =>
  rule.action?.redirect?.transform?.queryTransform?.removeParams ?? [];
const globalRemove = removeOf(GLOBAL);
const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

test("tracking-params.json — has at least one DNR rule", () => {
  assert.ok(Array.isArray(RULES), "tracking-params.json must be a JSON array");
  assert.ok(RULES.length >= 1, "tracking-params.json must contain at least one rule");
});

test("tracking-params.json — global rule shape (id, priority, action.redirect.transform.queryTransform.removeParams)", () => {
  assert.ok(GLOBAL, "the global rule (id DNR_STATIC_RULE_ID) must exist");
  assert.equal(GLOBAL.id, DNR_STATIC_RULE_ID);
  assert.equal(GLOBAL.priority, 1);
  assert.equal(GLOBAL.action?.type, "redirect");
  assert.ok(Array.isArray(globalRemove));
  assert.equal(GLOBAL.condition?.urlFilter, "*");
});

test("tracking-params.json — global rule removeParams IS the full TRACKING_PARAMS set", () => {
  // Under the one-rule-per-request model the global rule carries ALL tracking
  // params (not a filtered subset). Domain-preserved params stay in the global
  // rule but their domains are excluded from it — see the exclusion tests below.
  assert.equal(
    globalRemove.length,
    TRACKING_PARAMS.length,
    `global rule has ${globalRemove.length} params; TRACKING_PARAMS has ${TRACKING_PARAMS.length} — run \`npm run build:rules\``,
  );
  assert.deepEqual(
    [...globalRemove].sort(),
    [...TRACKING_PARAMS].sort(),
    "global rule removeParams must equal TRACKING_PARAMS exactly — run `npm run build:rules`",
  );
});

test("tracking-params.json — every TRACKING_PARAM is in the global removeParams", () => {
  const set = new Set(globalRemove);
  for (const p of TRACKING_PARAMS) {
    assert.ok(set.has(p), `global rule is missing TRACKING_PARAM "${p}" — run \`npm run build:rules\``);
  }
});

// ── One-rule-per-request structural invariants ──────────────────────────────

test("ONE-RULE-PER-HOST — global rule excludes every tailored domain", () => {
  // Every domain that has its own profile rule MUST be in the global rule's
  // excludedRequestDomains, otherwise that host would match BOTH the global rule
  // and its profile rule — and Chrome would fire only one, half-cleaning it.
  const excluded = new Set(GLOBAL.condition?.excludedRequestDomains ?? []);
  for (const rule of PROFILE_RULES) {
    for (const d of rule.condition?.requestDomains ?? []) {
      assert.ok(
        excluded.has(d),
        `domain "${d}" has a profile rule (id ${rule.id}) but is NOT in the global rule's excludedRequestDomains — it would double-match. Run \`npm run build:rules\``,
      );
    }
  }
});

test("ONE-RULE-PER-HOST — excludedRequestDomains equals exactly the union of profile requestDomains", () => {
  const excluded = [...new Set(GLOBAL.condition?.excludedRequestDomains ?? [])].sort();
  const covered = [
    ...new Set(PROFILE_RULES.flatMap((r) => r.condition?.requestDomains ?? [])),
  ].sort();
  assert.deepEqual(
    excluded,
    covered,
    "the global rule must exclude exactly the domains covered by profile rules — no more, no less. Run `npm run build:rules`",
  );
});

test("ONE-RULE-PER-HOST — no domain appears in more than one profile rule", () => {
  const seen = new Map(); // domain -> rule id
  for (const rule of PROFILE_RULES) {
    for (const d of rule.condition?.requestDomains ?? []) {
      assert.ok(
        !seen.has(d),
        `domain "${d}" appears in profile rules ${seen.get(d)} and ${rule.id} — a host must match exactly one. Run \`npm run build:rules\``,
      );
      seen.set(d, rule.id);
    }
  }
});

test("profile rules are requestDomains-scoped and never global (no urlFilter)", () => {
  for (const rule of PROFILE_RULES) {
    assert.ok(
      Array.isArray(rule.condition?.requestDomains) && rule.condition.requestDomains.length > 0,
      `profile rule ${rule.id} must be scoped via requestDomains`,
    );
    assert.equal(
      rule.condition?.urlFilter,
      undefined,
      `profile rule ${rule.id} must NOT use a global urlFilter — that would match every host`,
    );
    assert.equal(
      rule.condition?.excludedRequestDomains,
      undefined,
      `profile rule ${rule.id} must not use excludedRequestDomains — only the global rule does`,
    );
  }
});

test("each preserved-and-tracked param is EXCLUDED from its domain's profile rule but present globally", () => {
  // For every domain that preserves a param which MUGA otherwise strips globally:
  //   - the domain has a profile rule,
  //   - that profile rule does NOT strip the preserved param (so it survives there),
  //   - the global rule DOES contain it (it is stripped everywhere else).
  const profileByDomain = new Map();
  for (const rule of PROFILE_RULES) {
    for (const d of rule.condition?.requestDomains ?? []) profileByDomain.set(d, rule);
  }
  const globalSetLc = new Set(globalRemove.map((p) => p.toLowerCase()));

  for (const dr of DOMAIN_RULES) {
    if (typeof dr.domain !== "string") continue;
    const preservedTracked = (dr.preserveParams ?? []).filter((p) =>
      trackingLc.has(p.toLowerCase()),
    );
    if (preservedTracked.length === 0) continue;

    const rule = profileByDomain.get(dr.domain);
    assert.ok(
      rule,
      `domain "${dr.domain}" preserves tracked params ${JSON.stringify(preservedTracked)} but has no profile rule — global would strip them. Run \`npm run build:rules\``,
    );
    const ruleSetLc = new Set(removeOf(rule).map((p) => p.toLowerCase()));
    for (const p of preservedTracked) {
      assert.ok(
        !ruleSetLc.has(p.toLowerCase()),
        `"${p}" is preserved on "${dr.domain}" but its profile rule (id ${rule.id}) still strips it`,
      );
      assert.ok(
        globalSetLc.has(p.toLowerCase()),
        `"${p}" is a TRACKING_PARAM and must remain in the global rule (stripped everywhere but "${dr.domain}")`,
      );
    }
  }
});
