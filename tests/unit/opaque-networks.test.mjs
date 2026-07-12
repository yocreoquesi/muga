/**
 * MUGA — Unit tests for src/lib/opaque-networks.js (B20, #453)
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  OPAQUE_NETWORKS,
  GENERIC_SHORTENERS,
  AFFILIATE_REDIRECT_NETWORKS,
  AD_GATEWAY_NETWORKS,
  isOpaqueNetworkHost,
  isGenericShortener,
  isAffiliateRedirectNetwork,
  isAdGateway,
} from "../../src/lib/opaque-networks.js";

describe("OPAQUE_NETWORKS — shape and content", () => {
  test("is an array", () => {
    assert.ok(Array.isArray(OPAQUE_NETWORKS));
  });

  test("is frozen", () => {
    assert.ok(Object.isFrozen(OPAQUE_NETWORKS));
  });

  test("has at least 6 entries (1 AliExpress + 4+ CJ + 1 Admitad)", () => {
    assert.ok(OPAQUE_NETWORKS.length >= 6, `Expected >= 6 entries, got ${OPAQUE_NETWORKS.length}`);
  });

  test("every entry is a non-empty string", () => {
    for (const entry of OPAQUE_NETWORKS) {
      assert.strictEqual(typeof entry, "string");
      assert.ok(entry.length > 0);
    }
  });

  test("every entry contains a dot (basic hostname shape)", () => {
    for (const entry of OPAQUE_NETWORKS) {
      assert.ok(entry.includes("."), `Entry "${entry}" has no dot`);
    }
  });

  test("every entry is lowercase", () => {
    for (const entry of OPAQUE_NETWORKS) {
      assert.strictEqual(entry, entry.toLowerCase(), `Entry "${entry}" is not lowercase`);
    }
  });

  test("includes AliExpress opaque click host", () => {
    assert.ok(OPAQUE_NETWORKS.includes("s.click.aliexpress.com"));
  });

  test("includes Admitad host", () => {
    assert.ok(OPAQUE_NETWORKS.includes("ad.admitad.com"));
  });

  test("includes at least one CJ Affiliate domain", () => {
    const CJ_DOMAINS = ["anrdoezrs.net", "dpbolvw.net", "jdoqocy.com", "kqzyfj.com", "tkqlhce.com", "emjcd.com", "qksrv.net", "cj.dotomi.com"];
    const hasCJ = CJ_DOMAINS.some(d => OPAQUE_NETWORKS.includes(d));
    assert.ok(hasCJ, "Must include at least one CJ Affiliate domain");
  });

  test("has no duplicate entries", () => {
    const unique = new Set(OPAQUE_NETWORKS);
    assert.strictEqual(unique.size, OPAQUE_NETWORKS.length);
  });

  // redirector-coverage-expansion (T24): assert all 7 new/activated hosts present
  // Batch 3 (#607): plus 3 branded shorteners (lnkd.in, fb.me, ebay.to)
  // shortener-resolver-expansion Slice 1: plus 6 confident-tier generic
  // shorteners (is.gd, v.gd, cutt.ly, rebrand.ly, ow.ly, buff.ly).
  // shortener-resolver-expansion Slice 2: plus 5 probe-verified generic
  // shorteners (rb.gy, tiny.cc, dlvr.it, ift.tt, qr.ae).
  // shortener-resolver-expansion Slice 3: plus 1 re-probed generic shortener
  // (t.ly — verified CLEAN with a real browser UA).
  test("has at least 28 entries (original 6 + 7 redirector-coverage + 3 batch-3 + 6 slice-1 + 5 slice-2 + 1 slice-3)", () => {
    assert.ok(
      OPAQUE_NETWORKS.length >= 28,
      `Expected >= 28 entries, got ${OPAQUE_NETWORKS.length}`,
    );
  });

  test("includes bit.ly (PR-02 — generic shortener)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("bit.ly"));
  });

  test("includes tinyurl.com (PR-03 — generic shortener)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("tinyurl.com"));
  });

  test("includes prf.hn (PR-04 — Partnerize / Performance Horizon affiliate)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("prf.hn"));
  });

  test("includes px.a8.net (PR-05 — A8.net Japan affiliate, T00 STANDARD probe)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("px.a8.net"));
  });

  test("does NOT include r.a8.net (T00 corrected hostname — r.a8.net does not resolve)", () => {
    assert.ok(
      !OPAQUE_NETWORKS.includes("r.a8.net"),
      "r.a8.net must NOT be in the list — the real A8.net hostname is px.a8.net",
    );
  });

  test("includes amzn.to (PR-06 — Amazon branded shortener, G3 gate passed)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("amzn.to"));
  });

  test("includes t.co (PR-07 — extension-only activation; Worker already accepts via caps-spec)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("t.co"));
  });

  test("includes link.medium.com (PR-08 — extension-only activation; Worker already accepts via caps-spec)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("link.medium.com"));
  });

  // Batch 3 (#607 — verified STANDARD via curl probe 2026-05-09)
  test("includes lnkd.in (#607 — LinkedIn share tracker)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("lnkd.in"));
  });

  test("includes fb.me (#607 — Facebook universal shortener)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("fb.me"));
  });

  test("includes ebay.to (#607 — eBay branded shortener)", () => {
    assert.ok(OPAQUE_NETWORKS.includes("ebay.to"));
  });

  test("does NOT include aliexpress.us (#607 — probed 2026-05-09 NOT a redirector, apex .us TLD)", () => {
    assert.ok(
      !OPAQUE_NETWORKS.includes("aliexpress.us"),
      "aliexpress.us must NOT be in the list — it's the apex of the .us TLD, not a shortener",
    );
  });
});

// 2.1 denoise pivot (#653): semantic split — generic shorteners (no
// attribution at stake) vs affiliate redirect networks (click IS the
// attribution event). See docs/affiliate-networks-matrix.md.
describe("GENERIC_SHORTENERS — split bucket", () => {
  test("is a frozen array of non-empty lowercase hostname strings", () => {
    assert.ok(Array.isArray(GENERIC_SHORTENERS));
    assert.ok(Object.isFrozen(GENERIC_SHORTENERS));
    for (const entry of GENERIC_SHORTENERS) {
      assert.strictEqual(typeof entry, "string");
      assert.ok(entry.length > 0);
      assert.ok(entry.includes("."), `Entry "${entry}" has no dot`);
      assert.strictEqual(entry, entry.toLowerCase(), `Entry "${entry}" is not lowercase`);
    }
  });

  test("contains the nineteen expected generic shortener hosts", () => {
    const expected = [
      "bit.ly", "tinyurl.com", "t.co", "link.medium.com", "lnkd.in", "fb.me", "ebay.to",
      // shortener-resolver-expansion Slice 1 (confident-tier)
      "is.gd", "v.gd", "cutt.ly", "rebrand.ly", "ow.ly", "buff.ly",
      // shortener-resolver-expansion Slice 2 (probe-verified CLEAN)
      "rb.gy", "tiny.cc", "dlvr.it", "ift.tt", "qr.ae",
      // shortener-resolver-expansion Slice 3 (re-probed CLEAN with browser UA)
      "t.ly",
    ];
    for (const host of expected) {
      assert.ok(GENERIC_SHORTENERS.includes(host), `Expected ${host} in GENERIC_SHORTENERS`);
    }
  });

  test("does NOT contain any affiliate-redirect host (no bucket leakage)", () => {
    const affiliateHosts = ["s.click.aliexpress.com", "ad.admitad.com", "prf.hn", "px.a8.net", "anrdoezrs.net"];
    for (const host of affiliateHosts) {
      assert.ok(!GENERIC_SHORTENERS.includes(host), `${host} must NOT be in GENERIC_SHORTENERS`);
    }
  });

  test("does NOT contain any AD_GATEWAY_NETWORKS host (no bucket leakage)", () => {
    for (const host of AD_GATEWAY_NETWORKS) {
      assert.ok(!GENERIC_SHORTENERS.includes(host), `${host} must NOT be in GENERIC_SHORTENERS`);
    }
  });
});

// shortener-resolver-expansion Slice 1 (D1): a third bucket for hosts that
// present as shorteners but gate the destination behind an ad-interstitial or
// paywall. Never resolved — recognized so the disjointness invariant catches
// any future accidental addition to GENERIC_SHORTENERS.
describe("AD_GATEWAY_NETWORKS — ad-gateway bucket", () => {
  test("is a frozen array of non-empty lowercase hostname strings", () => {
    assert.ok(Array.isArray(AD_GATEWAY_NETWORKS));
    assert.ok(Object.isFrozen(AD_GATEWAY_NETWORKS));
    for (const entry of AD_GATEWAY_NETWORKS) {
      assert.strictEqual(typeof entry, "string");
      assert.ok(entry.length > 0);
      assert.ok(entry.includes("."), `Entry "${entry}" has no dot`);
      assert.strictEqual(entry, entry.toLowerCase(), `Entry "${entry}" is not lowercase`);
    }
  });

  test("contains ouo.io, linkvertise.com, soo.gd", () => {
    const expected = ["ouo.io", "linkvertise.com", "soo.gd"];
    for (const host of expected) {
      assert.ok(AD_GATEWAY_NETWORKS.includes(host), `Expected ${host} in AD_GATEWAY_NETWORKS`);
    }
  });

  test("does NOT contain any affiliate-redirect host (no bucket leakage)", () => {
    for (const host of AFFILIATE_REDIRECT_NETWORKS) {
      assert.ok(!AD_GATEWAY_NETWORKS.includes(host), `${host} must NOT be in AD_GATEWAY_NETWORKS`);
    }
  });
});

describe("isAdGateway", () => {
  test("returns true for known ad-gateway hosts", () => {
    assert.strictEqual(isAdGateway("ouo.io"), true);
    assert.strictEqual(isAdGateway("linkvertise.com"), true);
    assert.strictEqual(isAdGateway("soo.gd"), true);
  });

  test("returns false for generic shorteners and affiliate networks", () => {
    assert.strictEqual(isAdGateway("bit.ly"), false);
    assert.strictEqual(isAdGateway("prf.hn"), false);
  });

  test("handles www. prefix defensively", () => {
    assert.strictEqual(isAdGateway("www.ouo.io"), true);
  });

  test("returns false for null/undefined/empty", () => {
    for (const value of [null, undefined, ""]) {
      assert.strictEqual(isAdGateway(value), false);
    }
  });
});

describe("Three-way bucket disjointness (D1 invariant)", () => {
  test("GENERIC_SHORTENERS, AFFILIATE_REDIRECT_NETWORKS, AD_GATEWAY_NETWORKS are pairwise disjoint", () => {
    const genericSet = new Set(GENERIC_SHORTENERS);
    const affiliateSet = new Set(AFFILIATE_REDIRECT_NETWORKS);
    const adGatewaySet = new Set(AD_GATEWAY_NETWORKS);

    const genericVsAffiliate = [...genericSet].filter((h) => affiliateSet.has(h));
    const genericVsAdGateway = [...genericSet].filter((h) => adGatewaySet.has(h));
    const affiliateVsAdGateway = [...affiliateSet].filter((h) => adGatewaySet.has(h));

    assert.deepStrictEqual(genericVsAffiliate, [], `GENERIC ∩ AFFILIATE: ${genericVsAffiliate.join(", ")}`);
    assert.deepStrictEqual(genericVsAdGateway, [], `GENERIC ∩ AD_GATEWAY: ${genericVsAdGateway.join(", ")}`);
    assert.deepStrictEqual(affiliateVsAdGateway, [], `AFFILIATE ∩ AD_GATEWAY: ${affiliateVsAdGateway.join(", ")}`);
  });
});

describe("AFFILIATE_REDIRECT_NETWORKS — split bucket", () => {
  test("is a frozen array of non-empty lowercase hostname strings", () => {
    assert.ok(Array.isArray(AFFILIATE_REDIRECT_NETWORKS));
    assert.ok(Object.isFrozen(AFFILIATE_REDIRECT_NETWORKS));
    for (const entry of AFFILIATE_REDIRECT_NETWORKS) {
      assert.strictEqual(typeof entry, "string");
      assert.ok(entry.length > 0);
      assert.ok(entry.includes("."), `Entry "${entry}" has no dot`);
      assert.strictEqual(entry, entry.toLowerCase(), `Entry "${entry}" is not lowercase`);
    }
  });

  test("contains AliExpress, all 8 CJ domains, Admitad, Partnerize, A8.net", () => {
    const expected = [
      "s.click.aliexpress.com",
      "anrdoezrs.net", "dpbolvw.net", "jdoqocy.com", "kqzyfj.com",
      "tkqlhce.com", "emjcd.com", "qksrv.net", "cj.dotomi.com",
      "ad.admitad.com",
      "prf.hn",
      "px.a8.net",
    ];
    for (const host of expected) {
      assert.ok(AFFILIATE_REDIRECT_NETWORKS.includes(host), `Expected ${host} in AFFILIATE_REDIRECT_NETWORKS`);
    }
  });

  test("does NOT contain any generic shortener (no bucket leakage)", () => {
    const shorteners = ["bit.ly", "tinyurl.com", "t.co", "link.medium.com", "lnkd.in", "fb.me", "ebay.to"];
    for (const host of shorteners) {
      assert.ok(!AFFILIATE_REDIRECT_NETWORKS.includes(host), `${host} must NOT be in AFFILIATE_REDIRECT_NETWORKS`);
    }
  });

  test("does NOT contain amzn.to (pending P4.2 verdict — stays in legacy union only)", () => {
    assert.ok(!AFFILIATE_REDIRECT_NETWORKS.includes("amzn.to"));
    assert.ok(!GENERIC_SHORTENERS.includes("amzn.to"));
    assert.ok(OPAQUE_NETWORKS.includes("amzn.to"), "amzn.to must remain in the legacy OPAQUE_NETWORKS union");
  });
});

describe("OPAQUE_NETWORKS — legacy union", () => {
  test("equals the union of the three split buckets", () => {
    const union = new Set([...GENERIC_SHORTENERS, ...AFFILIATE_REDIRECT_NETWORKS, "amzn.to"]);
    const legacy = new Set(OPAQUE_NETWORKS);
    assert.deepStrictEqual([...legacy].sort(), [...union].sort());
  });

  test("split buckets are disjoint (no host appears in both)", () => {
    const overlap = GENERIC_SHORTENERS.filter(h => AFFILIATE_REDIRECT_NETWORKS.includes(h));
    assert.deepStrictEqual(overlap, [], `Overlapping hosts: ${overlap.join(", ")}`);
  });
});

describe("isGenericShortener / isAffiliateRedirectNetwork / isOpaqueNetworkHost", () => {
  test("isGenericShortener returns true for shorteners, false for affiliate redirects", () => {
    assert.strictEqual(isGenericShortener("bit.ly"), true);
    assert.strictEqual(isGenericShortener("tinyurl.com"), true);
    assert.strictEqual(isGenericShortener("ebay.to"), true);
    assert.strictEqual(isGenericShortener("prf.hn"), false);
    assert.strictEqual(isGenericShortener("ad.admitad.com"), false);
    assert.strictEqual(isGenericShortener("s.click.aliexpress.com"), false);
  });

  test("isAffiliateRedirectNetwork returns true for affiliate redirects, false for shorteners", () => {
    assert.strictEqual(isAffiliateRedirectNetwork("prf.hn"), true);
    assert.strictEqual(isAffiliateRedirectNetwork("ad.admitad.com"), true);
    assert.strictEqual(isAffiliateRedirectNetwork("s.click.aliexpress.com"), true);
    assert.strictEqual(isAffiliateRedirectNetwork("anrdoezrs.net"), true);
    assert.strictEqual(isAffiliateRedirectNetwork("px.a8.net"), true);
    assert.strictEqual(isAffiliateRedirectNetwork("bit.ly"), false);
    assert.strictEqual(isAffiliateRedirectNetwork("t.co"), false);
  });

  test("isOpaqueNetworkHost matches every host in either bucket plus pending verdict", () => {
    for (const host of [...GENERIC_SHORTENERS, ...AFFILIATE_REDIRECT_NETWORKS, "amzn.to"]) {
      assert.strictEqual(isOpaqueNetworkHost(host), true, `isOpaqueNetworkHost should be true for ${host}`);
    }
  });

  test("all three helpers handle www. prefix defensively", () => {
    assert.strictEqual(isGenericShortener("www.bit.ly"), true);
    assert.strictEqual(isAffiliateRedirectNetwork("www.prf.hn"), true);
    assert.strictEqual(isOpaqueNetworkHost("www.amzn.to"), true);
  });

  test("all three helpers return false for null/undefined/empty", () => {
    for (const value of [null, undefined, ""]) {
      assert.strictEqual(isGenericShortener(value), false);
      assert.strictEqual(isAffiliateRedirectNetwork(value), false);
      assert.strictEqual(isOpaqueNetworkHost(value), false);
    }
  });

  test("all three helpers return false for unknown hosts", () => {
    assert.strictEqual(isGenericShortener("example.com"), false);
    assert.strictEqual(isAffiliateRedirectNetwork("example.com"), false);
    assert.strictEqual(isOpaqueNetworkHost("example.com"), false);
  });
});
