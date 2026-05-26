/**
 * MUGA — Unit tests for getLandingPolicy (#656, P3.1 of the 2.1 denoise pivot).
 *
 * Contract: given a landing hostname and a navigation referrer, return the
 * matrix-required preservation policy that the cleaner's strip pass must
 * honour. See docs/affiliate-networks-matrix.md and ADR-0002.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { getLandingPolicy, processUrl } from "../../src/lib/cleaner.js";

const PREFS = Object.freeze({
  enabled: true,
  blacklist: [],
  whitelist: [],
  customParams: [],
  remoteParams: [],
  userCustomRules: [],
  disabledCategories: [],
});

describe("getLandingPolicy — empty policy contract", () => {
  test("returns empty preserve + null network when referrer is null", () => {
    const policy = getLandingPolicy("merchant.com", null);
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("returns empty policy when referrer is undefined", () => {
    const policy = getLandingPolicy("merchant.com", undefined);
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("returns empty policy when referrer is the empty string", () => {
    const policy = getLandingPolicy("merchant.com", "");
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("returns empty policy when referrer hostname is unknown", () => {
    const policy = getLandingPolicy("merchant.com", "https://random.example/page");
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("returns empty policy when referrer is same-origin as the landing", () => {
    const policy = getLandingPolicy("merchant.com", "https://merchant.com/some/other/page");
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("same-origin check is case-insensitive", () => {
    const policy = getLandingPolicy("Merchant.COM", "https://merchant.com/path");
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });
});

describe("getLandingPolicy — first-touch from each matrix v1.0 network", () => {
  test("awin1.com referrer → preserve awc + wt_mc, network=awin", () => {
    const policy = getLandingPolicy("zalando.es", "https://www.awin1.com/cread.php?id=1");
    assert.deepStrictEqual([...policy.preserve].sort(), ["awc", "wt_mc"]);
    assert.equal(policy.network, "awin");
  });

  test("CJ redirect referrer → preserve cjevent + cjdata", () => {
    const policy = getLandingPolicy("walmart.com", "https://anrdoezrs.net/click-123-456");
    assert.deepStrictEqual([...policy.preserve].sort(), ["cjdata", "cjevent"]);
    assert.equal(policy.network, "cj-affiliate");
  });

  test("s.click.aliexpress.com referrer → preserve aff_* + algo_* family", () => {
    const policy = getLandingPolicy(
      "aliexpress.com",
      "https://s.click.aliexpress.com/e/_DnZbqGr",
    );
    assert.deepStrictEqual(
      [...policy.preserve].sort(),
      ["aff_request_id", "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test"],
    );
    assert.equal(policy.network, "aliexpress-affiliate");
  });

  test("Impact *.pxf.io subdomain → preserve irclickid + irgwc + iclid", () => {
    const policy = getLandingPolicy(
      "target.com",
      "https://target.pxf.io/c/1234/abc",
    );
    assert.deepStrictEqual([...policy.preserve].sort(), ["iclid", "irclickid", "irgwc"]);
    assert.equal(policy.network, "impact-radius");
  });

  test("prf.hn referrer → preserve clickref + pubref + adref", () => {
    const policy = getLandingPolicy("partner.com", "https://prf.hn/click/123");
    assert.deepStrictEqual([...policy.preserve].sort(), ["adref", "clickref", "pubref"]);
    assert.equal(policy.network, "partnerize");
  });

  test("Admitad redirect (both hosts) → preserve admitad_uid + tagtag_uid", () => {
    const a = getLandingPolicy("shop.com", "https://ad.admitad.com/g/abc");
    assert.deepStrictEqual([...a.preserve].sort(), ["admitad_uid", "tagtag_uid"]);
    assert.equal(a.network, "admitad");

    const b = getLandingPolicy("aliexpress.com", "https://alitems.com/g/xyz");
    assert.deepStrictEqual([...b.preserve].sort(), ["admitad_uid", "tagtag_uid"]);
    assert.equal(b.network, "admitad");
  });

  test("px.a8.net referrer → preserve a8", () => {
    const policy = getLandingPolicy("rakuten.co.jp", "https://px.a8.net/svt/ejp?id=1");
    assert.deepStrictEqual([...policy.preserve], ["a8"]);
    assert.equal(policy.network, "a8net");
  });

  test("click.linksynergy.com referrer → preserve ranmid + ransiteid + raneaid", () => {
    const policy = getLandingPolicy(
      "ebay.com",
      "https://click.linksynergy.com/deeplink?id=1",
    );
    assert.deepStrictEqual([...policy.preserve].sort(), ["raneaid", "ranmid", "ransiteid"]);
    assert.equal(policy.network, "rakuten-linkshare");
  });

  test("tc.tradetracker.net referrer → preserve ttaid + ttrk + ttcid", () => {
    const policy = getLandingPolicy(
      "merchant.de",
      "https://tc.tradetracker.net/?c=1&m=2",
    );
    assert.deepStrictEqual([...policy.preserve].sort(), ["ttaid", "ttcid", "ttrk"]);
    assert.equal(policy.network, "tradetracker");
  });
});

describe("getLandingPolicy — defensive parsing of the referrer arg", () => {
  test("bare hostname (no protocol) is accepted", () => {
    const policy = getLandingPolicy("zalando.es", "awin1.com");
    assert.equal(policy.network, "awin");
  });

  test("referrer with www. prefix matches (delegated to lib/affiliates lookup)", () => {
    const policy = getLandingPolicy("zalando.es", "https://www.awin1.com/cread.php");
    assert.equal(policy.network, "awin");
  });

  test("malformed referrer falls back gracefully without throwing", () => {
    const policy = getLandingPolicy("merchant.com", "not a url at all");
    // String fallback yields a hostname-shaped value that won't match any
    // network — must return empty policy, never throw.
    assert.equal(policy.preserve.size, 0);
    assert.equal(policy.network, null);
  });

  test("returned preserve Set is independent across calls", () => {
    const a = getLandingPolicy("zalando.es", "https://awin1.com/x");
    a.preserve.add("polluted");
    const b = getLandingPolicy("zalando.es", "https://awin1.com/x");
    assert.ok(!b.preserve.has("polluted"));
  });
});

describe("processUrl integration — matrix params preserved on first-touch", () => {
  test("Awin referrer preserves awc on the landing URL", () => {
    const { action, cleanUrl } = processUrl(
      "https://www.zalando.es/product.html?awc=12345_abc&utm_source=newsletter",
      PREFS,
      [],
      undefined,
      undefined,
      "https://www.awin1.com/cread.php?id=1",
    );
    assert.equal(action, "cleaned");
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("awc"), "12345_abc", "awc must survive on first-touch");
    assert.equal(u.searchParams.get("utm_source"), null, "utm_source still strippable");
  });

  test("CJ referrer preserves cjevent + cjdata; co-strips utm_*", () => {
    const { cleanUrl } = processUrl(
      "https://www.walmart.com/ip/1?cjevent=abc&cjdata=enc&utm_medium=email",
      PREFS,
      [],
      undefined,
      undefined,
      "https://anrdoezrs.net/click",
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("cjevent"), "abc");
    assert.equal(u.searchParams.get("cjdata"), "enc");
    assert.equal(u.searchParams.get("utm_medium"), null);
  });

  test("unknown referrer → no preservation; utm_* still stripped", () => {
    const { cleanUrl } = processUrl(
      "https://merchant.com/p?utm_source=email",
      PREFS,
      [],
      undefined,
      undefined,
      "https://random.example/",
    );
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.get("utm_source"), null);
  });

  test("no referrer (background context) → policy is empty no-op", () => {
    const { action, cleanUrl } = processUrl(
      "https://merchant.com/p?utm_source=email&fbclid=xyz",
      PREFS,
    );
    assert.equal(action, "cleaned");
    const u = new URL(cleanUrl);
    assert.equal(u.searchParams.has("utm_source"), false);
    assert.equal(u.searchParams.has("fbclid"), false);
  });
});
