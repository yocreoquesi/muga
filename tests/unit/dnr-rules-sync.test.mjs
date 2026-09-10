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
  // A profile rule may carry excludedRequestDomains — this was tightened, not
  // dropped, by #1228. It held as a blanket "never" only while Amazon hosts
  // were the sole tailored ones (the AMAZON_HOST_RE gate in
  // tools/generate-rules.mjs). With that gate removed, ANY host's stripParams
  // can produce a tailored profile rule, so a parent domain (google.com) can
  // now have a nested tailored subdomain (maps.google.com) that needs its own,
  // different profile rule. Chrome matches a requestDomains-scoped rule on the
  // domain AND its subdomains, so without an exclusion the parent's rule would
  // also match the child's requests and both would fire — Chrome applies only
  // one, half-cleaning it (see the ONE-RULE-PER-REQUEST header comment above).
  // The parent rule excluding the child is the correct handoff to the child's
  // more specific rule, so the real invariant is not "no exclusions" but that
  // every exclusion is a strict subdomain of the rule's own requestDomains AND
  // is itself covered by its own profile rule — anything else opens a gap
  // instead of a handoff. The "ONE-RULE-PER-HOST — subdomain-aware" test below
  // proves the resulting mechanism still yields exactly one rule per request.
  const allProfileDomains = new Set(
    PROFILE_RULES.flatMap((r) => r.condition?.requestDomains ?? []),
  );
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

    const excludedForRule = rule.condition?.excludedRequestDomains;
    if (excludedForRule === undefined) continue;
    assert.ok(
      Array.isArray(excludedForRule) && excludedForRule.length > 0,
      `profile rule ${rule.id} has an excludedRequestDomains field that is present but empty/invalid — omit the field instead`,
    );
    for (const excludedHost of excludedForRule) {
      const isStrictSubdomainOfOwnDomain = rule.condition.requestDomains.some(
        (d) => excludedHost !== d && excludedHost.endsWith("." + d),
      );
      assert.ok(
        isStrictSubdomainOfOwnDomain,
        `profile rule ${rule.id} excludes "${excludedHost}" but it is not a strict subdomain of any of this rule's own requestDomains [${rule.condition.requestDomains.join(", ")}] — an exclusion must hand a nested host off to its own more specific rule, not open a gap`,
      );
      assert.ok(
        allProfileDomains.has(excludedHost),
        `profile rule ${rule.id} excludes "${excludedHost}" but no profile rule covers it — this opens a gap instead of a handoff. Run \`npm run build:rules\``,
      );
    }
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

// True when `host` is `d` or a subdomain of `d` — mirrors Chrome's
// requestDomains/excludedRequestDomains matching (domain + subdomains).
function hostUnderAny(host, domains) {
  return (domains ?? []).some((d) => host === d || host.endsWith("." + d));
}

/** Faithful Chrome match: requestDomains include (subdomain) minus excluded. */
function ruleMatchesHost(rule, host) {
  const c = rule.condition ?? {};
  if (c.requestDomains && !hostUnderAny(host, c.requestDomains)) return false;
  if (c.excludedRequestDomains && hostUnderAny(host, c.excludedRequestDomains)) return false;
  // #1326: a path-scoped rule's urlFilter carries a literal path prefix (e.g.
  // "||google.com/search") that a bare HOST string can never satisfy — this
  // helper is probed with hostnames, not full URLs. The global rule's
  // urlFilter is "*" (matches everything) and stays unaffected; any other
  // non-"*" urlFilter means the rule needs more than a bare host to match, so
  // it correctly falls out of this host-only invariant. Its own disjointness
  // (by priority, not exclusion) is proven by
  // tests/unit/path-scoped-dnr-rules.test.mjs instead.
  if (c.urlFilter && c.urlFilter !== "*") return false;
  return true;
}

test("ONE-RULE-PER-HOST — subdomain-aware: every tailored host (and a deep subdomain) matches exactly one param rule", () => {
  // The exact-string tests above miss NESTED tailored domains: Chrome matches a
  // rule scoped to D on D AND its subdomains, so if maps.google.com and
  // google.com landed in different profile rules without an exclusion, a request
  // to maps.google.com (or www.maps.google.com) would match BOTH — Chrome fires
  // one, half-cleaning it. This probes each tailored host and a synthetic deep
  // subdomain against ALL rules honoring Chrome's subdomain semantics.
  // Param rules only. The signed-URL guard (#1200) is an `allow` rule that
  // deliberately matches every host — it is scoped by regexFilter, not by
  // domain, and it exempts rather than competes. Counting it here would flag
  // every tailored host as a double-match.
  const paramRules = RULES.filter((r) => r.action?.type === "redirect");
  const hosts = [...new Set(PROFILE_RULES.flatMap((r) => r.condition?.requestDomains ?? []))];
  for (const host of hosts) {
    for (const probe of [host, "deep-probe." + host]) {
      const matches = paramRules.filter((r) => ruleMatchesHost(r, probe));
      assert.equal(
        matches.length,
        1,
        `host "${probe}" matches ${matches.length} param rules [${matches
          .map((r) => r.id)
          .join(", ")}] — Chrome fires one, half-cleaning it. A nested tailored domain likely needs excludedRequestDomains. Run \`npm run build:rules\``,
      );
    }
  }
});
