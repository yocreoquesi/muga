/**
 * MUGA — disabledCategories reaches the DNR layer (#1256)
 *
 * The defect: `disabledCategories` was honoured by the JS cleaner and by
 * nothing else. On Chrome, navigations are stripped by DNR at the network layer
 * before any JS runs, from rules generated at build time out of the full param
 * list — `tools/generate-rules.mjs` has never seen the pref. So a user who
 * turned off a category still had it stripped on every page they opened, while
 * Settings promised "Disabling a category keeps those parameters in URLs".
 *
 * (Firefox was never affected: its blocking webRequest stripper routes
 * navigations through processUrl, which honours the pref.)
 *
 * The last describe here is the one that matters — it runs the real
 * src/rules/tracking-params.json through the filter with a real category and
 * asserts the params actually leave. Everything above it is the mechanism.
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import {
  buildCategoryFilteredRules,
  disabledParamSet,
} from "../../src/lib/dnr-category-filter.js";
import { TRACKING_PARAM_CATEGORIES } from "../../src/lib/affiliates.js";
import {
  DNR_CATEGORY_FILTER_RULE_ID_BASE,
  DNR_CATEGORY_FILTER_MAX_RULES,
} from "../../src/lib/dnr-ids.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const OPTS = {
  idBase: DNR_CATEGORY_FILTER_RULE_ID_BASE,
  maxRules: DNR_CATEGORY_FILTER_MAX_RULES,
};

/** A strip rule in the shape tracking-params.json ships. */
function stripRule(id, removeParams, condition = { resourceTypes: ["main_frame"] }, priority = 1) {
  return {
    id,
    priority,
    action: {
      type: "redirect",
      redirect: { transform: { queryTransform: { removeParams } } },
    },
    condition,
  };
}

const CATS = {
  utm: { params: ["utm_source", "utm_medium"] },
  ads: { params: ["gclid", "fbclid"] },
};

// ── The param set ─────────────────────────────────────────────────────────────

describe("disabledParamSet", () => {
  test("is empty when no category is disabled", () => {
    assert.strictEqual(disabledParamSet([], CATS).size, 0);
  });

  test("unions the params of every disabled category, lowercased", () => {
    const set = disabledParamSet(["utm", "ads"], CATS);
    assert.deepStrictEqual([...set].sort(), ["fbclid", "gclid", "utm_medium", "utm_source"]);
  });

  test("an unknown category key contributes nothing rather than throwing", () => {
    assert.strictEqual(disabledParamSet(["nope"], CATS).size, 0);
  });
});

// ── The mirror ────────────────────────────────────────────────────────────────

describe("buildCategoryFilteredRules — mechanism", () => {
  test("no disabled category produces no mirrors at all", () => {
    const rules = [stripRule(1, ["utm_source", "gclid"])];
    assert.deepStrictEqual(
      buildCategoryFilteredRules(rules, [], CATS, OPTS),
      [],
      "with nothing disabled the static ruleset stays enabled, so a mirror would be a second matching rule"
    );
  });

  test("a disabled category's params are subtracted and the rest survive", () => {
    const rules = [stripRule(1, ["utm_source", "utm_medium", "gclid", "mc_cid"])];
    const [mirror] = buildCategoryFilteredRules(rules, ["utm"], CATS, OPTS);
    assert.deepStrictEqual(
      mirror.action.redirect.transform.queryTransform.removeParams,
      ["gclid", "mc_cid"]
    );
  });

  test("subtraction is case-insensitive", () => {
    const rules = [stripRule(1, ["UTM_Source", "gclid"])];
    const [mirror] = buildCategoryFilteredRules(rules, ["utm"], CATS, OPTS);
    assert.deepStrictEqual(
      mirror.action.redirect.transform.queryTransform.removeParams,
      ["gclid"]
    );
  });

  test("priority and condition are carried over verbatim", () => {
    const condition = {
      requestDomains: ["example.com"],
      excludedRequestDomains: ["sub.example.com"],
      resourceTypes: ["main_frame"],
    };
    const rules = [stripRule(300, ["utm_source", "gclid"], condition, 1)];
    const [mirror] = buildCategoryFilteredRules(rules, ["utm"], CATS, OPTS);

    assert.strictEqual(mirror.priority, 1,
      "priority must not shift: it is what orders MUGA's rule families against each other");
    assert.deepStrictEqual(mirror.condition, condition,
      "a per-host rule that loses its requestDomains would apply everywhere");
  });

  test("the source rules are not mutated", () => {
    const rules = [stripRule(1, ["utm_source", "gclid"])];
    buildCategoryFilteredRules(rules, ["utm"], CATS, OPTS);
    assert.deepStrictEqual(
      rules[0].action.redirect.transform.queryTransform.removeParams,
      ["utm_source", "gclid"],
      "the cached static ruleset is read once per worker lifetime and reused"
    );
  });

  test("a rule whose every param is disabled is DROPPED, not emitted empty", () => {
    const rules = [stripRule(1, ["utm_source", "utm_medium"]), stripRule(300, ["gclid"])];
    const out = buildCategoryFilteredRules(rules, ["utm"], CATS, OPTS);
    assert.strictEqual(out.length, 1);
    assert.deepStrictEqual(
      out[0].action.redirect.transform.queryTransform.removeParams,
      ["gclid"],
      "an empty removeParams is a redirect to the same URL, which Chrome reads as a loop rather than a no-op"
    );
  });

  test("ids are assigned from the base, contiguously, in input order", () => {
    const rules = [stripRule(1, ["gclid"]), stripRule(300, ["mc_cid"]), stripRule(301, ["fbclid"])];
    const out = buildCategoryFilteredRules(rules, ["utm"], CATS, OPTS);
    assert.deepStrictEqual(
      out.map((r) => r.id),
      [
        DNR_CATEGORY_FILTER_RULE_ID_BASE,
        DNR_CATEGORY_FILTER_RULE_ID_BASE + 1,
        DNR_CATEGORY_FILTER_RULE_ID_BASE + 2,
      ]
    );
  });

  test("a dropped rule leaves no id gap, so the range cap counts real rules", () => {
    const rules = [stripRule(1, ["utm_source"]), stripRule(300, ["gclid"])];
    const out = buildCategoryFilteredRules(rules, ["utm"], CATS, OPTS);
    assert.deepStrictEqual(out.map((r) => r.id), [DNR_CATEGORY_FILTER_RULE_ID_BASE]);
  });

  test("output is capped at maxRules", () => {
    const rules = Array.from({ length: 10 }, (_, i) => stripRule(i + 1, ["gclid"]));
    const out = buildCategoryFilteredRules(rules, ["utm"], CATS, { idBase: 4100, maxRules: 3 });
    assert.strictEqual(out.length, 3);
  });

  test("a malformed ruleset yields no rules rather than throwing", () => {
    assert.deepStrictEqual(buildCategoryFilteredRules(null, ["utm"], CATS, OPTS), []);
    assert.deepStrictEqual(buildCategoryFilteredRules([null, 5], ["utm"], CATS, OPTS), []);
  });
});

// ── The #1200 regression this could easily have re-opened ─────────────────────

describe("buildCategoryFilteredRules — the signed-URL allow guard survives", () => {
  test("a rule with no removeParams is mirrored verbatim, priority intact", () => {
    // Rule id 2 in tracking-params.json: presigned URLs are exempted from every
    // strip rule, because their signature covers the query fields and removing
    // one returns 403 (#1200 — it broke GitHub artifact downloads). It carries
    // no removeParams, so a filter that only understood strip rules would drop
    // it, and disabling any category would silently re-open #1200.
    const allowGuard = {
      id: 2,
      priority: 1000,
      action: { type: "allow" },
      condition: { regexFilter: "[?&](sig|signature)=[^&]{16,}", resourceTypes: ["main_frame"] },
    };
    const out = buildCategoryFilteredRules([allowGuard], ["utm"], CATS, OPTS);

    assert.strictEqual(out.length, 1, "the allow guard must survive the switch to dynamic rules");
    assert.strictEqual(out[0].priority, 1000,
      "at a lower priority it would stop outranking the strip rules and 403s would return");
    assert.deepStrictEqual(out[0].action, { type: "allow" });
    assert.deepStrictEqual(out[0].condition, allowGuard.condition);
  });
});

// ── Against the real shipped ruleset ──────────────────────────────────────────

describe("buildCategoryFilteredRules — the real ruleset (#1256 end to end)", () => {
  const staticRules = JSON.parse(
    readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8")
  );

  test("disabling `utm` removes every utm param from what Chrome would apply", () => {
    const utmParams = TRACKING_PARAM_CATEGORIES.utm.params.map((p) => p.toLowerCase());
    assert.ok(utmParams.includes("utm_source"), "fixture sanity: the utm category must carry utm_source");

    const before = staticRules
      .flatMap((r) => r.action?.redirect?.transform?.queryTransform?.removeParams ?? [])
      .filter((p) => utmParams.includes(p.toLowerCase()));
    assert.ok(before.length > 0, "the shipped rules must strip utm params, or this test proves nothing");

    const mirrors = buildCategoryFilteredRules(
      staticRules, ["utm"], TRACKING_PARAM_CATEGORIES, OPTS
    );
    const after = mirrors
      .flatMap((r) => r.action?.redirect?.transform?.queryTransform?.removeParams ?? [])
      .filter((p) => utmParams.includes(p.toLowerCase()));

    assert.deepStrictEqual(after, [],
      "this is the whole defect: Settings says these are kept, and the network layer removed them anyway");
  });

  test("params outside the disabled category are untouched", () => {
    const mirrors = buildCategoryFilteredRules(
      staticRules, ["utm"], TRACKING_PARAM_CATEGORIES, OPTS
    );
    const global = mirrors.find((r) => r.condition?.excludedRequestDomains);
    assert.ok(global, "the global strip rule must still be present");

    const params = global.action.redirect.transform.queryTransform.removeParams;
    assert.ok(params.includes("fbclid"), "an ads-category param must survive a utm-only opt-out");
    assert.ok(params.includes("gclid"));
  });

  test("every shipped rule is mirrored, and stays within the reserved range", () => {
    const mirrors = buildCategoryFilteredRules(
      staticRules, ["utm"], TRACKING_PARAM_CATEGORIES, OPTS
    );
    assert.strictEqual(
      mirrors.length,
      staticRules.length,
      "no shipped rule may vanish: Chrome applies one redirect rule per request, so each " +
        "must stay complete for the hosts it matches"
    );
    for (const r of mirrors) {
      assert.ok(
        r.id >= DNR_CATEGORY_FILTER_RULE_ID_BASE &&
          r.id < DNR_CATEGORY_FILTER_RULE_ID_BASE + DNR_CATEGORY_FILTER_MAX_RULES,
        `mirror id ${r.id} escapes the reserved range and could overwrite another rule family`
      );
    }
  });

  test("disabling every category strips no TRACKING_PARAMS name anywhere", async () => {
    const { TRACKING_PARAMS } = await import("../../src/lib/affiliates.js");
    const categorised = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));

    const mirrors = buildCategoryFilteredRules(
      staticRules, Object.keys(TRACKING_PARAM_CATEGORIES), TRACKING_PARAM_CATEGORIES, OPTS
    );
    const survivors = mirrors
      .flatMap((r) => r.action?.redirect?.transform?.queryTransform?.removeParams ?? [])
      .filter((p) => categorised.has(p.toLowerCase()));

    assert.deepStrictEqual(survivors, [],
      "the six categories partition TRACKING_PARAMS exactly, so turning all six off must leave none of them");

    assert.ok(
      mirrors.some((r) => r.action.type === "allow"),
      "the presigned-URL exemption is not a category and must outlive all of them"
    );
  });

  test("domain-specific extra strips are NOT category-governed, and survive", () => {
    // Worth pinning because it is surprising: the per-domain profile rules carry
    // strips that come from domain-rules.json `stripParams`, not from
    // TRACKING_PARAMS — Amazon internal-nav params like `aaxitk` and `almbrandid`.
    // No category contains them, so no category can switch them off, and the
    // Settings copy governs tracking categories only. A future change that
    // folded them into a category would silently widen what the toggle controls.
    const mirrors = buildCategoryFilteredRules(
      staticRules, Object.keys(TRACKING_PARAM_CATEGORIES), TRACKING_PARAM_CATEGORIES, OPTS
    );
    const remaining = mirrors
      .flatMap((r) => r.action?.redirect?.transform?.queryTransform?.removeParams ?? []);

    assert.ok(remaining.length > 0,
      "the domain-specific strips must survive: they were never governed by a tracking category");
    assert.ok(remaining.includes("aaxitk"),
      "Amazon's internal-nav strips come from domain-rules.json, outside the category system");
  });
});
