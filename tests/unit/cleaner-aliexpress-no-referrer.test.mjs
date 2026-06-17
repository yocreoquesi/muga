/**
 * MUGA — #885: AliExpress item-page affiliate landing family preserved
 * without document.referrer.
 *
 * Regression guard for the no-referrer hole: on AliExpress /item/NNN.html
 * pages the wholesale-strip branch must exempt aff_trace_key + family
 * UNCONDITIONALLY, not only when document.referrer matches
 * s.click.aliexpress.com. When referrer is absent (strict Referrer-Policy,
 * meta-refresh chain, cross-origin downgrade, DOM-less worker) getLandingPolicy
 * collapses to EMPTY_LANDING_POLICY, and the pre-#885 code would silently
 * strip the entire attribution family → creator commission destroyed.
 *
 * Asymmetric-risk rationale: over-preserving a transient tracker on an AliExpress
 * item page is the cheap direction; stripping creator attribution is catastrophic.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { __test__, getLandingPolicy } from "../../src/lib/cleaner.js";

const { classifyAndStripTracking } = __test__;

const __dirname = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const domainRules = require("../../src/rules/domain-rules.json");

// aliexpress-affiliate landingParams (from redirect-networks.js)
const ALIEXPRESS_LANDING_FAMILY = [
  "aff_trace_key",
  "aff_request_id",
  "algo_pvid",
  "algo_expid",
  "btsid",
  "ws_ab_test",
];

const BASE_PREFS = {
  enabled: true,
  injectOwnAffiliate: false,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
};

const ALIEXPRESS_ITEM_URL =
  "https://www.aliexpress.com/item/1005006789012345.html";

describe("#885 — AliExpress item-page landing family preserved without referrer", () => {
  test("aff_trace_key survives on item page with NO landingPolicy (no referrer)", () => {
    // No landingPolicy passed → simulates absent document.referrer (the bug scenario).
    const url = new URL(
      ALIEXPRESS_ITEM_URL +
      "?aff_trace_key=abc123&utm_source=newsletter&pdp_npi=4xyz",
    );

    const result = classifyAndStripTracking(url, BASE_PREFS, domainRules);
    // aff_trace_key must survive
    assert.ok(
      url.searchParams.has("aff_trace_key"),
      "aff_trace_key must NOT be stripped on item page even without referrer",
    );
    assert.ok(
      !result.removed.includes("aff_trace_key"),
      "aff_trace_key must not appear in removed[]",
    );
    // utm_source must be stripped
    assert.ok(
      !url.searchParams.has("utm_source"),
      "utm_source must be stripped",
    );
    assert.ok(
      result.removed.includes("utm_source"),
      "utm_source must appear in removed[]",
    );
  });

  test("full aliexpress-affiliate landing family survives without referrer", () => {
    // Build a URL carrying all 6 landing params plus a tracking param.
    const qs = ALIEXPRESS_LANDING_FAMILY.map((p, i) => `${p}=val${i}`).join("&");
    const url = new URL(`${ALIEXPRESS_ITEM_URL}?${qs}&utm_campaign=promo`);

    const result = classifyAndStripTracking(url, BASE_PREFS, domainRules);

    for (const param of ALIEXPRESS_LANDING_FAMILY) {
      assert.ok(
        url.searchParams.has(param),
        `${param} must survive on item page without referrer`,
      );
      assert.ok(
        !result.removed.includes(param),
        `${param} must not be in removed[]`,
      );
    }
    // Tracking noise must be stripped
    assert.ok(
      !url.searchParams.has("utm_campaign"),
      "utm_campaign must be stripped",
    );
  });

  test("aff_fcid is still stripped even when landing family is preserved (#508)", () => {
    // aff_fcid is explicitly in domain-rules stripParams (#508: CPS click id,
    // transient, non-attributing). It must NOT be preserved by the #885 fix
    // because getLandingParamsForHost returns only landingParams, and aff_fcid
    // is not in the aliexpress-affiliate landingParams list.
    const url = new URL(
      ALIEXPRESS_ITEM_URL +
      "?aff_trace_key=keep_me&aff_fcid=strip_me&utm_source=strip_me_too",
    );

    const result = classifyAndStripTracking(url, BASE_PREFS, domainRules);

    assert.ok(
      url.searchParams.has("aff_trace_key"),
      "aff_trace_key must survive (it IS in landingParams)",
    );
    assert.ok(
      !url.searchParams.has("aff_fcid"),
      "aff_fcid must be stripped (it is NOT in landingParams, per #508)",
    );
    assert.ok(
      result.removed.includes("aff_fcid"),
      "aff_fcid must appear in removed[]",
    );
  });

  test("WITH referrer — existing getLandingPolicy path still works (sanity)", () => {
    // Verify the original referrer-gated path is not broken by the #885 change.
    // When referrer IS present and matches s.click.aliexpress.com, getLandingPolicy
    // returns a non-empty preserve set; classifyAndStripTracking receives it and
    // the landing family survives via that path too.
    const url = new URL(
      ALIEXPRESS_ITEM_URL +
      "?aff_trace_key=abc&utm_source=newsletter",
    );
    const policy = getLandingPolicy(
      "www.aliexpress.com",
      "https://s.click.aliexpress.com/e/_0abc123",
    );
    assert.ok(policy.preserve.size > 0, "getLandingPolicy must return non-empty preserve set");
    assert.ok(policy.preserve.has("aff_trace_key"), "policy must include aff_trace_key");

    classifyAndStripTracking(url, BASE_PREFS, domainRules, policy);

    assert.ok(
      url.searchParams.has("aff_trace_key"),
      "aff_trace_key must survive when referrer is present",
    );
    assert.ok(
      !url.searchParams.has("utm_source"),
      "utm_source must be stripped",
    );
  });

  test("non-AliExpress item page is unaffected by the fix", () => {
    // A random domain must not acquire AliExpress landing params as exemptions.
    const url = new URL(
      "https://www.example.com/item/1005006789012345.html" +
      "?aff_trace_key=abc&utm_source=newsletter",
    );

    const result = classifyAndStripTracking(url, BASE_PREFS, domainRules);

    // aff_trace_key is not a known tracking param globally, so it may survive
    // on non-AliExpress pages via the standard path (not a tracking param).
    // What matters: the standard path is taken, not the wholesale-strip branch.
    // utm_source must be stripped as normal.
    assert.ok(
      result.removed.includes("utm_source"),
      "utm_source must be stripped on non-AliExpress page",
    );
    // The item-page wholesale strip must NOT fire — only remaining params should
    // be those not identified as tracking params by the standard classifier.
    // We verify indirectly: aff_trace_key is not in TRACKING_PARAMS, so it
    // survives the standard path, proving the wholesale branch did not fire.
    assert.ok(
      url.searchParams.has("aff_trace_key"),
      "standard path must not wholesale-strip aff_trace_key on non-AliExpress page",
    );
  });

  test("non-item AliExpress page (wholesale) is not affected (search path)", () => {
    // /wholesale path is NOT /item/NNN.html — the standard path applies.
    // aff_trace_key is not in TRACKING_PARAMS so it survives the standard path.
    const url = new URL(
      "https://www.aliexpress.com/wholesale" +
      "?SearchText=mechanical+keyboard&aff_trace_key=abc&utm_source=newsletter",
    );

    const result = classifyAndStripTracking(url, BASE_PREFS, domainRules);

    // SearchText preserved (domain-rules preserveParams)
    assert.ok(
      url.searchParams.has("SearchText"),
      "SearchText must survive on search page",
    );
    // utm_source stripped
    assert.ok(
      result.removed.includes("utm_source"),
      "utm_source must be stripped on wholesale page",
    );
  });
});
