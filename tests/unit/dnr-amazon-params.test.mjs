/**
 * MUGA — Amazon-scoped internal-nav param strip rule (#910/#911 follow-up)
 *
 * Chrome cleans the CURRENT page via DNR only (the in-page cleaner is skipped
 * when DNR is present). Amazon internal-nav tracking tags (ref, ref_, pf_rd_*,
 * sr, …) that the cleaner strips via domain-rules — but that are unsafe to strip
 * site-wide, so absent from the global DNR rule — therefore survive a direct
 * navigation on Chrome. tracking-params.json now carries a SECOND rule, scoped
 * via requestDomains to Amazon marketplaces, that removes exactly those params.
 *
 * These tests pin:
 *   1. the artifact ↔ generator sync (drift guard, like dnr-rules-sync.test.mjs),
 *   2. that the rule is Amazon-scoped (never global), and
 *   3. the SAFETY invariant: it never strips a creator-attribution or
 *      protected nav/search key.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { AFFILIATE_PATTERNS } from "../../src/lib/affiliates.js";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../../src/lib/remote-rules.js";
import { DNR_AMAZON_PARAMS_RULE_ID, DNR_STATIC_RULE_ID } from "../../src/lib/dnr-ids.js";
import { buildAmazonParamsRule } from "../../tools/generate-rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");
const RULES = JSON.parse(readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"));
const DOMAIN_RULES = JSON.parse(readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"));

const AMAZON_HOST_RE = /(^|\.)amazon\./;
const amazonRule = RULES.find((r) => r.id === DNR_AMAZON_PARAMS_RULE_ID);
const removeParams = amazonRule?.action?.redirect?.transform?.queryTransform?.removeParams ?? [];

// Amazon domain-rule facts, recomputed independently of the generator.
const amazonEntries = DOMAIN_RULES.filter(
  (r) => typeof r.domain === "string" && AMAZON_HOST_RE.test(r.domain),
);
const amazonStrip = new Set();
const amazonPreserve = new Set();
for (const r of amazonEntries) {
  for (const p of r.stripParams ?? []) amazonStrip.add(p);
  for (const p of r.preserveParams ?? []) amazonPreserve.add(p);
}
const globalRemove = new Set(
  RULES[0].action.redirect.transform.queryTransform.removeParams,
);

describe("Amazon-scoped DNR rule — shape & scope", () => {
  test("tracking-params.json contains the Amazon rule at DNR_AMAZON_PARAMS_RULE_ID", () => {
    assert.ok(amazonRule, "a rule with id DNR_AMAZON_PARAMS_RULE_ID must exist");
    assert.equal(amazonRule.id, DNR_AMAZON_PARAMS_RULE_ID);
    assert.notEqual(amazonRule.id, DNR_STATIC_RULE_ID);
    assert.equal(amazonRule.action?.type, "redirect");
    assert.ok(Array.isArray(removeParams) && removeParams.length > 0);
  });

  test("is SCOPED to Amazon hosts (requestDomains), never a global urlFilter", () => {
    assert.ok(Array.isArray(amazonRule.condition.requestDomains));
    assert.ok(amazonRule.condition.requestDomains.length > 0);
    for (const d of amazonRule.condition.requestDomains) {
      assert.ok(AMAZON_HOST_RE.test(d), `requestDomain "${d}" must be an Amazon host`);
    }
    assert.equal(amazonRule.condition.urlFilter, undefined,
      "the Amazon rule must NOT use a global urlFilter — that would strip on every site");
    assert.deepEqual(amazonRule.condition.resourceTypes, ["main_frame"]);
  });

  test("covers every Amazon marketplace domain the cleaner knows about", () => {
    const expected = [...new Set(amazonEntries.map((r) => r.domain))].sort();
    assert.deepEqual([...amazonRule.condition.requestDomains].sort(), expected);
  });
});

describe("Amazon-scoped DNR rule — parity with the cleaner", () => {
  test("every stripped param is one the cleaner strips on Amazon", () => {
    for (const p of removeParams) {
      assert.ok(amazonStrip.has(p), `"${p}" must be in Amazon domain-rules stripParams`);
    }
  });

  test("never strips a param Amazon needs (not in preserveParams)", () => {
    for (const p of removeParams) {
      assert.ok(!amazonPreserve.has(p), `"${p}" is functional on Amazon (preserveParams) — must not strip`);
    }
  });

  test("adds ONLY params the global rule misses (no redundant overlap)", () => {
    for (const p of removeParams) {
      assert.ok(!globalRemove.has(p), `"${p}" is already in the global rule — redundant`);
    }
  });

  test("closes the reported gap — the known internal nav tags are stripped", () => {
    for (const p of ["ref", "ref_", "pf_rd_t", "pf_rd_i", "pf_rd_m", "sr"]) {
      assert.ok(removeParams.includes(p), `internal nav tag "${p}" must be stripped on Amazon`);
    }
  });
});

describe("Amazon-scoped DNR rule — SAFETY (never harm creator attribution)", () => {
  test("no stripped param is an affiliate-attribution key (AFFILIATE_PARAM_GUARD)", () => {
    const guard = new Set([...AFFILIATE_PARAM_GUARD].map((s) => s.toLowerCase()));
    for (const p of removeParams) {
      assert.ok(!guard.has(p.toLowerCase()),
        `"${p}" is affiliate-guarded — stripping it could break a creator's referral`);
    }
  });

  test("no stripped param is a protected nav/search key (REMOTE_PARAM_DENYLIST)", () => {
    const deny = new Set([...REMOTE_PARAM_DENYLIST].map((s) => s.toLowerCase()));
    for (const p of removeParams) {
      assert.ok(!deny.has(p.toLowerCase()), `"${p}" is a protected nav/search key — must not strip`);
    }
  });

  test("the affiliate param 'tag' is NEVER in the strip list", () => {
    assert.ok(!removeParams.map((p) => p.toLowerCase()).includes("tag"));
  });

  test("no stripped param is the attribution param of any Amazon-targeting affiliate program", () => {
    // Scope-aware mirror of dnr-rules.test.mjs's global collision check: a param
    // like `ref` is fine to strip on Amazon even though it's Vercel's affiliate
    // param, because Vercel does not operate on amazon.* — but a param that IS an
    // affiliate key for a program targeting an Amazon domain must never be stripped.
    const amazonProgramParams = new Set(
      AFFILIATE_PATTERNS
        .filter((p) => (p.domains ?? []).some((d) => AMAZON_HOST_RE.test(d)))
        .map((p) => p.param.toLowerCase()),
    );
    for (const p of removeParams) {
      assert.ok(
        !amazonProgramParams.has(p.toLowerCase()),
        `"${p}" is an affiliate param for an Amazon-targeting program — must not strip`,
      );
    }
  });
});

describe("Amazon-scoped DNR rule — artifact ↔ generator sync (drift guard)", () => {
  test("the committed rule equals buildAmazonParamsRule(domainRules, globalRemove)", () => {
    const rebuilt = buildAmazonParamsRule(DOMAIN_RULES, globalRemove);
    assert.deepEqual(
      amazonRule,
      rebuilt,
      "tracking-params.json is stale — run `npm run compile:rules`",
    );
  });
});
