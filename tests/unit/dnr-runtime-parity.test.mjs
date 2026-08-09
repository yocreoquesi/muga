/**
 * MUGA — DNR ↔ runtime cleaner parity test (TA-4, D5)
 *
 * Verifies that Chrome DNR and the runtime cleaner produce the same set of
 * stripped params for a 10-URL corpus.
 *
 * simulateDnr models Chrome faithfully: Chrome applies AT MOST ONE redirect rule
 * per request (no cascade, no re-evaluation). So exactly one rule may match any
 * host — the global rule OR that host's profile rule, never both — and the test
 * asserts that (a multi-match means the generator broke the one-rule-per-request
 * invariant, which would half-clean mixed-param URLs on real Chrome).
 *
 * Divergence cases are included where a param is in BOTH TRACKING_PARAMS AND a
 * domain's preserveParams. The generator keeps such a param in the GLOBAL rule
 * (which strips it everywhere else) but lists the preserve domain in the global
 * rule's excludedRequestDomains and emits a per-domain profile rule that omits
 * the param. So on the preserve host only the profile rule matches (param kept);
 * on any other host only the global rule matches (param stripped) — matching the
 * runtime cleaner. This is the fix for the old behavior that dropped a
 * domain-preserved param from the global rule entirely, un-stripping it
 * network-wide.
 *
 * Divergence pairs (in preserveParams + in TRACKING_PARAMS):
 *   sharepoint.com -> cid
 *   aladin.co.kr   -> cid
 *   www.youtube.com -> ab_channel
 *
 * Run with: node --test tests/unit/dnr-runtime-parity.test.mjs
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { processUrl } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

const TRACKING_PARAMS_JSON = JSON.parse(
  readFileSync(join(ROOT, "src/rules/tracking-params.json"), "utf8")
);
const DOMAIN_RULES = JSON.parse(
  readFileSync(join(ROOT, "src/rules/domain-rules.json"), "utf8")
);

// Default prefs — mirrors cleaner-add-rule-regression.test.mjs baseline.
// No categories disabled, no custom params, no remote rules, affiliate ON.
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

// ── Corpus ────────────────────────────────────────────────────────────────────
//
// "must agree" URLs: DNR and runtime strip set MUST be identical. Includes a
//   conditioned param (cid) on a NON-preserve host, which must be stripped by
//   BOTH the domain-conditioned DNR rule and the runtime cleaner — the
//   regression guard for the old network-wide un-strip.
// "must diverge" URLs: param is in preserveParams for the host, so both DNR
//   (host in the rule's excludedRequestDomains) and runtime (domain rule)
//   PRESERVE it — test asserts the param survives in BOTH output URLs.

const CORPUS = [
  // ── 8 "DNR and runtime MUST agree" cases ─────────────────────────────────
  {
    url: "https://example.com/?utm_source=newsletter&utm_medium=email&utm_campaign=spring",
    divergence: false,
  },
  {
    url: "https://example.com/article?gclid=abc123&fbclid=xyz789",
    divergence: false,
  },
  {
    url: "https://example.com/?msclkid=foo&dclid=bar&gbraid=baz",
    divergence: false,
  },
  {
    url: "https://example.com/?mc_cid=abc&mc_eid=def&mkt_tok=ghi",
    divergence: false,
  },
  {
    // ascsubtag is in TRACKING_PARAMS → stripped by both DNR and runtime.
    // keep=yes is a non-tracking param → preserved in both paths.
    url: "https://www.amazon.com/dp/B000?ascsubtag=foo&keep=yes",
    divergence: false,
  },
  {
    // Confirms non-tracking params survive unchanged in both paths.
    url: "https://example.com/?utm_source=a&keep_me=ok&also_keep=yes",
    divergence: false,
  },
  {
    url: "https://example.com/?igshid=abc&_t=def&s_cid=foo",
    divergence: false,
  },
  {
    url: "https://example.com/?cjevent=abc&irgwc=def&tduid=ghi",
    divergence: false,
  },
  {
    // Regression guard (#dnr-domain-preserve): cid is preserved on sharepoint/
    // aladin/google, so it lives in a domain-conditioned DNR rule. On a host
    // NOT in that rule's excludedRequestDomains it MUST still be stripped by
    // DNR — exactly as the runtime cleaner strips it here. Previously cid was
    // dropped from the global rule and leaked network-wide.
    url: "https://example.com/?cid=strip_me&utm_source=strip_me",
    divergence: false,
  },

  // ── "DNR and runtime MUST DIVERGE" (preserveParams) ──────────────────────
  // sharepoint.com has cid in preserveParams (domain-rules.json verified).
  // cid is in TRACKING_PARAMS → emitted in a domain-conditioned rule whose
  // excludedRequestDomains includes sharepoint.com. Both DNR and runtime
  // PRESERVE cid here; utm_source is still stripped.
  {
    url: "https://sharepoint.com/page?cid=keep_me&utm_source=strip_me",
    divergence: true,
    preservedParam: "cid",
  },
  // aladin.co.kr has cid in preserveParams (domain-rules.json verified).
  // Same mechanism as sharepoint.com above.
  {
    url: "https://aladin.co.kr/shop?cid=keep_me&utm_campaign=strip_me",
    divergence: true,
    preservedParam: "cid",
  },
  // www.youtube.com has ab_channel in preserveParams; the conditioned rule
  // excludes youtube.com, so the subdomain www.youtube.com is excluded too.
  // Both PRESERVE ab_channel; gclid is still stripped.
  {
    url: "https://www.youtube.com/watch?v=abc&ab_channel=SomeChannel&gclid=strip_me",
    divergence: true,
    preservedParam: "ab_channel",
  },
  // #1200 — an Azure Blob SAS URL, the shape behind a GitHub artifact
  // download. NOT a divergence: both paths must strip nothing at all, DNR via
  // the signed-URL allow rule and the runtime via cleaner.js's Step 0b guard.
  // The two mechanisms are independent, which is exactly why they are pinned
  // together here: if either one regresses, downloads break and this fails.
  {
    url:
      "https://productionresultssa10.blob.core.windows.net/actions-results/1a2b/artifacts/build.zip" +
      "?sv=2025-01-05&spr=https&se=2026-08-08T22%3A00%3A00Z&sr=b&sp=r" +
      "&sig=nBx7Qk2ZfLp9YwR4tVhC8mJdE6sA1uGvXo0KpTzN5Ic%3D",
    divergence: false,
  },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * True when a hostname is the domain or a subdomain of it — mirrors DNR
 * requestDomains/excludedRequestDomains matching (domain + subdomains).
 */
function hostUnderAny(hostname, domains) {
  return domains.some((d) => hostname === d || hostname.endsWith("." + d));
}

/**
 * True when a rule's condition matches this request. Covers the three
 * condition forms tracking-params.json actually emits: requestDomains,
 * excludedRequestDomains and regexFilter. DNR matches regexFilter
 * case-insensitively unless isUrlFilterCaseSensitive is set, which MUGA does
 * not set anywhere.
 */
function conditionMatches(rule, url, host) {
  const c = rule.condition;
  if (c.requestDomains && !hostUnderAny(host, c.requestDomains)) return false;
  if (c.excludedRequestDomains && hostUnderAny(host, c.excludedRequestDomains)) return false;
  if (c.regexFilter && !new RegExp(c.regexFilter, "i").test(url)) return false;
  return true;
}

/**
 * Simulates Chrome DNR semantics FAITHFULLY.
 *
 * Two rules of the engine matter here:
 *
 *  1. An `allow` rule that outranks the matching redirect rules exempts the
 *     request: nothing is modified. That is how the signed-URL guard (#1200,
 *     rule id 2, priority 1000) protects presigned URLs from every strip rule.
 *  2. Chrome then applies at most ONE redirect rule per request. This asserts
 *     that at most one matches — a stronger guard than unioning, because a
 *     multi-match is exactly the one-rule-per-request violation that would
 *     half-clean URLs on real Chrome.
 *
 * The surviving rule's removeParams are applied exactly and
 * case-insensitively, with no prefix matching.
 *
 * @param {string} rawUrl
 * @param {Array}  trackingParamsJson — parsed tracking-params.json array
 * @returns {string} cleaned URL
 */
function simulateDnr(rawUrl, trackingParamsJson) {
  const u = new URL(rawUrl);
  const host = u.hostname;

  const matching = trackingParamsJson.filter((rule) => conditionMatches(rule, rawUrl, host));

  const allowRules = matching.filter((r) => r.action.type === "allow");
  const redirectRules = matching.filter((r) => r.action.type === "redirect");

  // An allow rule wins on strictly higher priority (and, at equal priority,
  // by Chrome's allow > redirect action precedence). Either way the request
  // passes through untouched.
  const topRedirectPriority = Math.max(0, ...redirectRules.map((r) => r.priority ?? 1));
  if (allowRules.some((r) => (r.priority ?? 1) >= topRedirectPriority)) {
    return rawUrl;
  }

  assert.ok(
    redirectRules.length <= 1,
    `ONE-RULE-PER-REQUEST violated for host "${host}": rules [${redirectRules
      .map((r) => r.id)
      .join(", ")}] all match. Chrome would fire only one, half-cleaning the URL.`,
  );

  const removeParams = new Set(
    (redirectRules[0]?.action.redirect.transform.queryTransform.removeParams ?? []).map((p) =>
      p.toLowerCase(),
    ),
  );

  const toDelete = [];
  for (const key of u.searchParams.keys()) {
    if (removeParams.has(key.toLowerCase())) toDelete.push(key);
  }
  for (const k of toDelete) u.searchParams.delete(k);
  return u.toString();
}

/** Returns the set of query-param names for a URL string. */
function paramSet(urlStr) {
  return new Set(new URL(urlStr).searchParams.keys());
}

/** Returns elements in setA that are not in setB. */
function setDiff(setA, setB) {
  return new Set([...setA].filter((x) => !setB.has(x)));
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("DNR ↔ runtime parity — 10-URL corpus (TA-4)", () => {
  for (const entry of CORPUS) {
    const label = new URL(entry.url).hostname + (entry.divergence ? " [divergence]" : "");

    test(label, () => {
      const dnrCleaned = simulateDnr(entry.url, TRACKING_PARAMS_JSON);
      const { cleanUrl: runtimeCleaned } = processUrl(
        entry.url,
        PREFS,
        DOMAIN_RULES
      );

      const originalParams = paramSet(entry.url);
      const dnrParams = paramSet(dnrCleaned);
      const runtimeParams = paramSet(runtimeCleaned);

      const dnrStripped = setDiff(originalParams, dnrParams);
      const runtimeStripped = setDiff(originalParams, runtimeParams);

      if (!entry.divergence) {
        // Both paths must strip the exact same set of params.
        assert.deepEqual(
          [...dnrStripped].sort(),
          [...runtimeStripped].sort(),
          `${entry.url}\n  DNR stripped:     [${[...dnrStripped].sort()}]\n  runtime stripped: [${[...runtimeStripped].sort()}]`
        );
      } else {
        // Both paths PRESERVE the param — via different mechanisms.
        // DNR: param was excluded from removeParams by the generator filter.
        // Runtime: domain-rule preserveParams keeps it.
        assert.ok(
          runtimeParams.has(entry.preservedParam),
          `runtime should preserve "${entry.preservedParam}" via domain rule on ${new URL(entry.url).hostname}`
        );
        assert.ok(
          dnrParams.has(entry.preservedParam),
          `DNR should also preserve "${entry.preservedParam}" (excluded from removeParams by generator filter)`
        );
        // The rest of the strip must still be identical.
        assert.deepEqual(
          [...dnrStripped].sort(),
          [...runtimeStripped].sort(),
          `non-preserved params should still strip identically\n  DNR stripped:     [${[...dnrStripped].sort()}]\n  runtime stripped: [${[...runtimeStripped].sort()}]`
        );
      }
    });
  }
});
