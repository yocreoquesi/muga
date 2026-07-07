/**
 * MUGA — DNR ↔ runtime cleaner parity test (TA-4, D5)
 *
 * Verifies that Chrome DNR's global strip and the runtime cleaner produce
 * the same set of stripped params for a 10-URL corpus.
 *
 * Divergence cases are included where a param is in BOTH TRACKING_PARAMS AND a
 * domain's preserveParams. The generator emits such a param in a
 * domain-conditioned DNR rule (excludedRequestDomains = its preserve domains),
 * so DNR strips it everywhere EXCEPT those domains — matching the runtime
 * cleaner, which preserves it via the domain rule on those hosts and strips it
 * elsewhere. On the preserve host both PRESERVE (via different mechanisms); on
 * any other host both STRIP. This is the fix for the old behavior that dropped
 * a domain-preserved param from the global rule entirely, un-stripping it
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
 * Simulates Chrome DNR queryTransform.removeParams semantics across ALL rules
 * in tracking-params.json, honoring each rule's condition (requestDomains /
 * excludedRequestDomains). Removes params by exact case-insensitive match — no
 * prefix matching.
 *
 * @param {string} rawUrl
 * @param {Array}  trackingParamsJson — parsed tracking-params.json array
 * @returns {string} cleaned URL
 */
function simulateDnr(rawUrl, trackingParamsJson) {
  const u = new URL(rawUrl);
  const host = u.hostname;
  const removeParams = new Set();
  for (const rule of trackingParamsJson) {
    const c = rule.condition;
    if (c.requestDomains && !hostUnderAny(host, c.requestDomains)) continue;
    if (c.excludedRequestDomains && hostUnderAny(host, c.excludedRequestDomains)) continue;
    for (const p of rule.action.redirect.transform.queryTransform.removeParams) {
      removeParams.add(p.toLowerCase());
    }
  }
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
