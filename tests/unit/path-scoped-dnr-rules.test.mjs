/**
 * MUGA — path-scoped DNR ↔ runtime cleaner parity (#1326)
 *
 * `domain-rules.json` entries may carry `pathStrips: [{pathPrefixes, params}]`
 * (#1326) — a literal path-prefix predicate a host-only profile rule cannot
 * express (there is no `excludedUrlFilter`, so a profile rule cannot cede one
 * path the way it cedes a whole host to a more specific profile rule).
 * `tools/generate-rules.mjs` projects it into a static DNR rule at
 * DNR_PATH_SCOPED_PRIORITY (3) — above every priority-1 global/profile rule —
 * so it wins on its own (domain, path-prefix) match and the profile/global
 * rule wins everywhere else on the host. No exclusion list is involved on
 * either side; disjointness comes from priority alone. See
 * docs/adr/0010-path-scoped-param-rules.md.
 *
 * This is the "second matcher" the ADR calls out: DNR and the runtime cleaner
 * (`getDomainParamSets` in src/lib/cleaner.js, threaded a `pathname`) must
 * agree on the predicate, or Chrome and Firefox diverge on the same URL.
 * Follows `tests/unit/dnr-runtime-parity.test.mjs`'s approach — a small
 * simulateDnr that mirrors Chrome's matching rules, compared against
 * `processUrl` — but adds `urlFilter` matching (a literal domain+path anchor,
 * `||domain/prefix`) and priority-based winner selection, neither of which
 * the general parity test's corpus needed before this predicate existed.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { processUrl } from "../../src/lib/cleaner.js";
import {
  DNR_PATH_SCOPED_RULE_ID_BASE,
  DNR_PATH_SCOPED_MAX_RULES,
  DNR_PATH_SCOPED_PRIORITY,
  DNR_DOMAIN_PRESERVE_RULE_ID_BASE,
  DNR_DOMAIN_PRESERVE_MAX_RULES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const TRACKING_PARAMS_JSON = JSON.parse(
  readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8"),
);
const DOMAIN_RULES = JSON.parse(
  readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8"),
);

const PREFS = {
  enabled: true,
  onboardingDone: true,
  blacklist: [],
  whitelist: [],
  customParams: [],
  remoteParams: [],
  disabledCategories: [],
  stripAllAffiliates: false,
  notifyForeignAffiliate: false,
  injectOwnAffiliate: false,
};

const removeOf = (rule) =>
  rule.action?.redirect?.transform?.queryTransform?.removeParams ?? [];

// ── A faithful-enough Chrome DNR simulator, extended for urlFilter ─────────

/** True when `host` is `d` or a subdomain of `d`. */
function hostUnderAny(host, domains) {
  return (domains ?? []).some((d) => host === d || host.endsWith("." + d));
}

/**
 * Matches MUGA's ONLY urlFilter shapes: "*" (matches everything — the global
 * rule) and "||domain/prefix" (a path-scoped rule, #1326) — `||` anchors at
 * the start of a domain name or immediately after a ".", and everything after
 * is a literal PREFIX match (no trailing "|" or "*", so the rest of the URL
 * may be anything). This is not a general DNR urlFilter engine — it covers
 * exactly the two shapes tracking-params.json emits, which is what a parity
 * test needs to stay honest without reimplementing Chrome.
 */
function urlFilterMatches(urlFilter, rawUrl) {
  if (urlFilter === "*") return true;
  const m = /^\|\|([^/]+)(\/.*)$/.exec(urlFilter);
  if (!m) throw new Error(`path-scoped-dnr-rules.test.mjs: unrecognised urlFilter shape "${urlFilter}"`);
  const [, domain, prefix] = m;
  // Domain-anchor: the URL's host must be `domain` or a subdomain of it.
  const host = new URL(rawUrl).hostname;
  if (!hostUnderAny(host, [domain])) return false;
  // Path-prefix: literal, from the very start of the pathname (never a
  // substring match against query/fragment — this mirrors `||domain/prefix`
  // requiring the literal chars to appear immediately after the domain).
  return new URL(rawUrl).pathname.startsWith(prefix);
}

function conditionMatches(rule, rawUrl, host) {
  const c = rule.condition;
  if (c.requestDomains && !hostUnderAny(host, c.requestDomains)) return false;
  if (c.excludedRequestDomains && hostUnderAny(host, c.excludedRequestDomains)) return false;
  if (c.regexFilter && !new RegExp(c.regexFilter, "i").test(rawUrl)) return false;
  if (c.urlFilter && !urlFilterMatches(c.urlFilter, rawUrl)) return false;
  return true;
}

/**
 * Simulates Chrome DNR: highest-priority match wins (an `allow` rule at or
 * above the top matching redirect priority exempts the request entirely);
 * among redirect rules, the WINNER is the one with the highest priority, and
 * ties are a violation of the one-rule-per-request model this repo pins
 * everywhere else (dnr-rules-sync.test.mjs, dnr-runtime-parity.test.mjs) — so
 * this asserts there is never a tie among the top-priority matches.
 *
 * @param {string} rawUrl
 * @param {Array} trackingParamsJson
 * @returns {string} cleaned URL
 */
function simulateDnr(rawUrl, trackingParamsJson) {
  const u = new URL(rawUrl);
  const host = u.hostname;

  const matching = trackingParamsJson.filter((rule) => conditionMatches(rule, rawUrl, host));
  const allowRules = matching.filter((r) => r.action.type === "allow");
  const redirectRules = matching.filter((r) => r.action.type === "redirect");

  const topRedirectPriority = Math.max(0, ...redirectRules.map((r) => r.priority ?? 1));
  if (allowRules.some((r) => (r.priority ?? 1) >= topRedirectPriority)) {
    return rawUrl;
  }

  const topPriority = Math.max(0, ...redirectRules.map((r) => r.priority ?? 1));
  const winners = redirectRules.filter((r) => (r.priority ?? 1) === topPriority);
  assert.ok(
    winners.length <= 1,
    `ONE-RULE-PER-REQUEST violated for "${rawUrl}": rules [${winners.map((r) => r.id).join(", ")}] ` +
      `tie at priority ${topPriority} — Chrome's winner would be non-deterministic.`,
  );

  const removeParams = new Set(
    (winners[0] ? removeOf(winners[0]) : []).map((p) => p.toLowerCase()),
  );
  const toDelete = [];
  for (const key of u.searchParams.keys()) {
    if (removeParams.has(key.toLowerCase())) toDelete.push(key);
  }
  for (const k of toDelete) u.searchParams.delete(k);
  return u.toString();
}

function paramSet(urlStr) {
  return new Set(new URL(urlStr).searchParams.keys());
}
function setDiff(setA, setB) {
  return new Set([...setA].filter((x) => !setB.has(x)));
}

// ── Structural: the rules the generator actually emits ─────────────────────

const pathRules = TRACKING_PARAMS_JSON.filter(
  (r) => r.id >= DNR_PATH_SCOPED_RULE_ID_BASE && r.id < DNR_PATH_SCOPED_RULE_ID_BASE + DNR_PATH_SCOPED_MAX_RULES,
);

describe("path-scoped DNR rules — structure (#1326)", () => {
  test("at least one path-scoped rule is emitted (google.com)", () => {
    assert.ok(pathRules.length > 0, "expected the google.com /search + /webhp rules");
  });

  test("every path-scoped rule runs at DNR_PATH_SCOPED_PRIORITY, above the static priority-1 rules", () => {
    for (const rule of pathRules) {
      assert.equal(rule.priority, DNR_PATH_SCOPED_PRIORITY);
      assert.ok(rule.priority > 1);
    }
  });

  test("every path-scoped rule is requestDomains-scoped AND carries a ||domain/prefix urlFilter", () => {
    for (const rule of pathRules) {
      assert.ok(Array.isArray(rule.condition?.requestDomains) && rule.condition.requestDomains.length === 1);
      const [domain] = rule.condition.requestDomains;
      assert.match(rule.condition.urlFilter, /^\|\|[^/]+\/.+/, `urlFilter "${rule.condition.urlFilter}" is not shaped ||domain/prefix`);
      assert.ok(
        rule.condition.urlFilter.startsWith(`||${domain}`),
        `urlFilter "${rule.condition.urlFilter}" does not anchor to this rule's own domain "${domain}"`,
      );
    }
  });

  test("no path-scoped rule's urlFilter is a regex — literal characters only", () => {
    // "literal path prefix, not a regex" (#1326 prohibition). A crude but
    // effective structural check: none of the regex metacharacters DNR's
    // urlFilter does NOT treat as literal should appear in the prefix half.
    for (const rule of pathRules) {
      const prefix = rule.condition.urlFilter.replace(/^\|\|[^/]+/, "");
      assert.doesNotMatch(prefix, /[()[\]{}+?^$\\]/, `urlFilter "${rule.condition.urlFilter}" looks regex-like`);
    }
  });
});

// ── Deliverable 3: google.com /search, /webhp, /maps ────────────────────────

describe("google.com path-scoped strips — verified against src/rules/tracking-params.json (#1326)", () => {
  const PATH_PARAMS = ["ved", "sca_esv", "gs_lcp"];

  test("a google.com/search URL matches exactly one rule, stripping the three plus the global set minus google.com's preserves", () => {
    const url = "https://google.com/search?q=shoes&ved=abc&sca_esv=def&gs_lcp=ghi&utm_source=x&cid=keepme";
    const matching = TRACKING_PARAMS_JSON.filter(
      (r) => r.action.type === "redirect" && conditionMatches(r, url, "google.com"),
    );
    // Two rules structurally MATCH (the path rule and google.com's profile
    // rule) by design — priority disambiguates which one FIRES.
    const topPriority = Math.max(...matching.map((r) => r.priority ?? 1));
    const firing = matching.filter((r) => (r.priority ?? 1) === topPriority);
    assert.equal(firing.length, 1, `expected exactly one firing rule, got [${firing.map((r) => r.id)}]`);
    assert.ok(
      firing[0].id >= DNR_PATH_SCOPED_RULE_ID_BASE && firing[0].id < DNR_PATH_SCOPED_RULE_ID_BASE + DNR_PATH_SCOPED_MAX_RULES,
      "the path-scoped rule must be the one that fires on /search",
    );

    const cleaned = simulateDnr(url, TRACKING_PARAMS_JSON);
    const stripped = setDiff(paramSet(url), paramSet(cleaned));
    for (const p of [...PATH_PARAMS, "utm_source"]) assert.ok(stripped.has(p), `"${p}" should be stripped`);
    assert.ok(paramSet(cleaned).has("cid"), "cid is preserved on google.com (Maps) and must survive");
    assert.ok(paramSet(cleaned).has("q"), "q (search query) is functional and must survive");
  });

  test("a google.com/maps URL still matches google.com's profile rule and does NOT strip ved/sca_esv/gs_lcp", () => {
    const url = "https://google.com/maps?ved=abc&sca_esv=def&gs_lcp=ghi&utm_source=x&cid=keepme";
    const matching = TRACKING_PARAMS_JSON.filter(
      (r) => r.action.type === "redirect" && conditionMatches(r, url, "google.com"),
    );
    // No path rule should even MATCH here (/maps satisfies neither /search
    // nor /webhp) — only the profile rule should.
    const matchedPathRule = matching.find(
      (r) => r.id >= DNR_PATH_SCOPED_RULE_ID_BASE && r.id < DNR_PATH_SCOPED_RULE_ID_BASE + DNR_PATH_SCOPED_MAX_RULES,
    );
    assert.equal(matchedPathRule, undefined, "no path-scoped rule should match /maps");

    const cleaned = simulateDnr(url, TRACKING_PARAMS_JSON);
    const survived = paramSet(cleaned);
    for (const p of PATH_PARAMS) assert.ok(survived.has(p), `"${p}" must survive on google.com/maps`);
    assert.ok(!survived.has("utm_source"), "utm_source must still be stripped by the profile rule");
    assert.ok(survived.has("cid"), "cid is preserved on google.com (Maps)");

    // Runtime cleaner must agree: it is only given a pathname when a caller
    // has one, and stripTrackingParams passes url.pathname (cleaner.js).
    const { cleanUrl } = processUrl(url, PREFS, DOMAIN_RULES);
    const runtimeSurvived = paramSet(cleanUrl);
    for (const p of PATH_PARAMS) {
      assert.ok(runtimeSurvived.has(p), `runtime should also preserve "${p}" on google.com/maps`);
    }
  });

  test("no other host is affected — an unrelated host never matches a google.com path rule", () => {
    const url = "https://example.com/search?ved=abc&sca_esv=def&gs_lcp=ghi";
    const matching = TRACKING_PARAMS_JSON.filter(
      (r) => r.action.type === "redirect" && conditionMatches(r, url, "example.com"),
    );
    const matchedPathRule = matching.find((r) => r.condition.requestDomains?.includes("google.com"));
    assert.equal(matchedPathRule, undefined);

    // ved/sca_esv/gs_lcp are no longer global, so on a host with no profile
    // of its own they must all survive.
    const cleaned = simulateDnr(url, TRACKING_PARAMS_JSON);
    const survived = paramSet(cleaned);
    for (const p of PATH_PARAMS) assert.ok(survived.has(p), `"${p}" is no longer global — must survive on example.com`);
  });

  test("DNR and the runtime cleaner agree on google.com/search (parity)", () => {
    const url = "https://google.com/search?q=shoes&ved=abc&sca_esv=def&gs_lcp=ghi&utm_source=x";
    const dnrCleaned = simulateDnr(url, TRACKING_PARAMS_JSON);
    const { cleanUrl: runtimeCleaned } = processUrl(url, PREFS, DOMAIN_RULES);

    const dnrStripped = setDiff(paramSet(url), paramSet(dnrCleaned));
    const runtimeStripped = setDiff(paramSet(url), paramSet(runtimeCleaned));
    assert.deepEqual([...dnrStripped].sort(), [...runtimeStripped].sort());
  });

  test("DNR and the runtime cleaner agree on google.com/webhp (parity)", () => {
    const url = "https://google.com/webhp?ved=abc&sca_esv=def&gs_lcp=ghi&utm_source=x";
    const dnrCleaned = simulateDnr(url, TRACKING_PARAMS_JSON);
    const { cleanUrl: runtimeCleaned } = processUrl(url, PREFS, DOMAIN_RULES);

    const dnrStripped = setDiff(paramSet(url), paramSet(dnrCleaned));
    const runtimeStripped = setDiff(paramSet(url), paramSet(runtimeCleaned));
    assert.deepEqual([...dnrStripped].sort(), [...runtimeStripped].sort());
  });

  test("DNR and the runtime cleaner agree on google.com/maps (parity, divergence-free here)", () => {
    const url = "https://google.com/maps?ved=abc&utm_source=x";
    const dnrCleaned = simulateDnr(url, TRACKING_PARAMS_JSON);
    const { cleanUrl: runtimeCleaned } = processUrl(url, PREFS, DOMAIN_RULES);

    const dnrStripped = setDiff(paramSet(url), paramSet(dnrCleaned));
    const runtimeStripped = setDiff(paramSet(url), paramSet(runtimeCleaned));
    assert.deepEqual([...dnrStripped].sort(), [...runtimeStripped].sort());
  });

  test("a deep google.com subdomain on /search still gets exactly one firing rule (the path rule)", () => {
    // requestDomains/||domain are both subdomain-inclusive; a nested tailored
    // subdomain must not create a double-fire.
    const url = "https://deep.probe.google.com/search?ved=abc";
    const matching = TRACKING_PARAMS_JSON.filter(
      (r) => r.action.type === "redirect" && conditionMatches(r, url, "deep.probe.google.com"),
    );
    const topPriority = Math.max(...matching.map((r) => r.priority ?? 1));
    const firing = matching.filter((r) => (r.priority ?? 1) === topPriority);
    assert.equal(firing.length, 1, `expected exactly one firing rule, got [${firing.map((r) => r.id)}]`);
  });
});

// ── The profile rule google.com/search compares against ────────────────────

describe("google.com's own profile rule (sanity fixture for the tests above)", () => {
  test("exists and is requestDomains-scoped to google.com", () => {
    const rule = TRACKING_PARAMS_JSON.find(
      (r) =>
        r.id >= DNR_DOMAIN_PRESERVE_RULE_ID_BASE &&
        r.id < DNR_DOMAIN_PRESERVE_RULE_ID_BASE + DNR_DOMAIN_PRESERVE_MAX_RULES &&
        (r.condition?.requestDomains ?? []).includes("google.com"),
    );
    assert.ok(rule, "expected a DNR profile rule covering google.com");
  });
});
