/**
 * MUGA — path-scoped rules never strip a preserved param (#1467, #1490)
 *
 * `tools/generate-rules.mjs`'s path-rule builder (`buildPathRuleSpecs`,
 * extracted from `buildDnrRules` in #1490) unions a `pathStrips` group's own
 * `params` into the host's base removeParams, filtering out only what is
 * already in the base, plus the guard/deny denylists — it never re-checks a
 * group's params against ITS OWN domain's (or an ancestor's) `preserveParams`.
 * That is safe today only because nobody has authored a `pathStrips` entry
 * naming a param its governing domain-rules.json entry preserves. Nothing in
 * the generator itself would catch it if someone did (#1490 item 2): a widen
 * past a preserve would silently ship.
 *
 * This file is that missing check: it asserts, over the REAL committed
 * `src/rules/tracking-params.json` + `src/rules/domain-rules.json`, that no
 * path-scoped rule's removeParams intersects the preserveParams of the
 * domain-rules.json entry that actually governs it (the nearest tailored
 * ancestor — same walk resolvePathRuleHostBase uses). It then proves the
 * check has teeth with a synthetic domainRules set built to violate the
 * invariant, run through the real `buildPathRuleSpecs` (not a hand-rolled
 * mirror), showing the resulting spec DOES carry the preserved param.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRACKING_PARAMS } from "../../src/lib/affiliates.js";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../../src/lib/remote-rules.js";
import {
  DNR_PATH_SCOPED_RULE_ID_BASE,
  DNR_PATH_SCOPED_MAX_RULES,
} from "../../src/lib/dnr-ids.js";
import { computeTailoredDomainState, buildPathRuleSpecs } from "../../tools/generate-rules.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const TRACKING_PARAMS_JSON = JSON.parse(
  readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"),
);
const DOMAIN_RULES = JSON.parse(
  readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"),
);

const removeOf = (rule) =>
  rule.action?.redirect?.transform?.queryTransform?.removeParams ?? [];

const guard = new Set([...AFFILIATE_PARAM_GUARD].map((s) => s.toLowerCase()));
const deny = new Set([...REMOTE_PARAM_DENYLIST].map((s) => s.toLowerCase()));

/**
 * Walks a domain up to its nearest tailored ancestor (same rule
 * resolvePathRuleHostBase follows) and returns that ancestor's OWN
 * `preserveParams`, lowercased and narrowed to actual tracking params (a
 * preserve of a param that was never stripped in the first place cannot be
 * "widened past"). Returns an empty set past the outermost tailored domain
 * (the global rule has no preserves) or when the ancestor is itself an
 * empty-base tailored domain with no raw entry reachable — in practice every
 * tailored domain has a raw entry by construction.
 */
function effectivePreserveFor(domain, tailoredDomains, rawByDomain, trackingLc) {
  let d = domain;
  for (;;) {
    if (tailoredDomains.has(d)) {
      const entry = rawByDomain.get(d);
      const preserveLc = new Set((entry?.preserveParams ?? []).map((p) => p.toLowerCase()));
      return new Set([...preserveLc].filter((p) => trackingLc.has(p)));
    }
    const dot = d.indexOf(".");
    if (dot === -1) return new Set();
    d = d.slice(dot + 1);
  }
}

/**
 * Checks a list of `{domain, prefix, removeParams}` specs (or emitted DNR
 * rule objects exposing the same shape via `getDomain`/`getRemoveParams`)
 * against the preserve-params invariant. Returns an array of violation
 * descriptions — empty means clean. Shared by the real-data test and the
 * synthetic-violation proof below so both exercise the exact same check.
 */
function findPreserveViolations(specs, tailoredDomains, rawByDomain, trackingLc, getDomain, getRemoveParams) {
  const violations = [];
  for (const spec of specs) {
    const domain = getDomain(spec);
    const preserved = effectivePreserveFor(domain, tailoredDomains, rawByDomain, trackingLc);
    if (preserved.size === 0) continue;
    const removeLc = new Set(getRemoveParams(spec).map((p) => p.toLowerCase()));
    const hit = [...preserved].filter((p) => removeLc.has(p));
    if (hit.length > 0) {
      violations.push({ domain, hit });
    }
  }
  return violations;
}

describe("path-scoped rules never strip a param their governing ancestor preserves (#1490)", () => {
  const trackingLc = new Set(TRACKING_PARAMS.map((p) => p.toLowerCase()));
  const rawByDomain = new Map(
    DOMAIN_RULES.filter((r) => typeof r.domain === "string").map((r) => [r.domain, r]),
  );
  const { tailoredDomains } = computeTailoredDomainState(DOMAIN_RULES, guard, deny, TRACKING_PARAMS);

  const pathRules = TRACKING_PARAMS_JSON.filter(
    (r) => r.id >= DNR_PATH_SCOPED_RULE_ID_BASE && r.id < DNR_PATH_SCOPED_RULE_ID_BASE + DNR_PATH_SCOPED_MAX_RULES,
  );

  test("sanity: at least one path-scoped rule and at least one domain with preserveParams exist", () => {
    assert.ok(pathRules.length > 0);
    assert.ok(DOMAIN_RULES.some((r) => Array.isArray(r.preserveParams) && r.preserveParams.length > 0));
  });

  test("no real path-scoped rule strips a param its governing ancestor preserves", () => {
    const violations = findPreserveViolations(
      pathRules,
      tailoredDomains,
      rawByDomain,
      trackingLc,
      (rule) => rule.condition.requestDomains[0],
      removeOf,
    );
    assert.deepEqual(
      violations,
      [],
      `path-scoped rule(s) strip a param their ancestor preserves: ${JSON.stringify(violations)}`,
    );
  });

  test("synthetic violation: a pathStrips entry naming its own ancestor's preserved param IS caught", () => {
    // naver.com preserves gclid (tailored, still emits a rule: it does not
    // preserve every tracking param). A descendant's pathStrips group lists
    // gclid too — nothing in buildPathRuleSpecs stops this today (it only
    // filters against hostBase/guard/deny, not preserveParams), so the
    // resulting removeParams DOES carry gclid back in. This is the exact
    // defect #1490 item 2 describes; this test proves the check above would
    // have failed the suite had it existed in the real data.
    const synthDomainRules = [
      { domain: "naver.com", preserveParams: ["gclid"] },
      {
        domain: "search.naver.com",
        pathStrips: [{ pathPrefixes: ["/search"], params: ["gclid", "extra_nav"] }],
      },
    ];
    const { tailoredDomains: synthTailored, removeParamsByDomain: synthRemoveParamsByDomain } =
      computeTailoredDomainState(synthDomainRules, guard, deny, TRACKING_PARAMS);
    const specs = buildPathRuleSpecs(
      synthDomainRules,
      synthTailored,
      synthRemoveParamsByDomain,
      TRACKING_PARAMS,
      guard,
      deny,
    );
    assert.ok(specs.length > 0, "expected the synthetic /search path rule to be emitted");

    const synthRawByDomain = new Map(synthDomainRules.map((r) => [r.domain, r]));
    const violations = findPreserveViolations(
      specs,
      synthTailored,
      synthRawByDomain,
      trackingLc,
      (spec) => spec.domain,
      (spec) => spec.removeParams,
    );
    assert.equal(violations.length, 1, "expected the check to flag the gclid widen");
    assert.equal(violations[0].domain, "search.naver.com");
    assert.deepEqual(violations[0].hit, ["gclid"]);

    // And confirm the spec itself really does carry it — the violation
    // report isn't a false positive from the checker's own logic.
    assert.ok(specs[0].removeParams.map((p) => p.toLowerCase()).includes("gclid"));
  });

  test("synthetic control: the same shape WITHOUT the widened param is clean", () => {
    const synthDomainRules = [
      { domain: "naver.com", preserveParams: ["gclid"] },
      {
        domain: "search.naver.com",
        pathStrips: [{ pathPrefixes: ["/search"], params: ["extra_nav"] }],
      },
    ];
    const { tailoredDomains: synthTailored, removeParamsByDomain: synthRemoveParamsByDomain } =
      computeTailoredDomainState(synthDomainRules, guard, deny, TRACKING_PARAMS);
    const specs = buildPathRuleSpecs(
      synthDomainRules,
      synthTailored,
      synthRemoveParamsByDomain,
      TRACKING_PARAMS,
      guard,
      deny,
    );
    const synthRawByDomain = new Map(synthDomainRules.map((r) => [r.domain, r]));
    const violations = findPreserveViolations(
      specs,
      synthTailored,
      synthRawByDomain,
      trackingLc,
      (spec) => spec.domain,
      (spec) => spec.removeParams,
    );
    assert.deepEqual(violations, []);
  });
});
