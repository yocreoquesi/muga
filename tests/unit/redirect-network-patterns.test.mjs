/**
 * MUGA — Unit tests for REDIRECT_NETWORK_PATTERNS + helpers (#654)
 *
 * 2.1 denoise pivot: preservable-but-not-injectable entries for the 9
 * redirect-network programs in docs/affiliate-networks-matrix.md v1.0.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  REDIRECT_NETWORK_PATTERNS,
  getRedirectNetworkPatterns,
  getRedirectNetworkForRedirectHost,
  getLandingParamsForReferrer,
} from "../../src/lib/affiliates.js";

const EXPECTED_NETWORKS = [
  "awin",
  "cj-affiliate",
  "aliexpress-affiliate",
  "impact-radius",
  "partnerize",
  "admitad",
  "a8net",
  "rakuten-linkshare",
  "tradetracker",
];

describe("REDIRECT_NETWORK_PATTERNS — shape", () => {
  test("is a frozen array with 9 entries (one per matrix v1.0 network)", () => {
    assert.ok(Array.isArray(REDIRECT_NETWORK_PATTERNS));
    assert.ok(Object.isFrozen(REDIRECT_NETWORK_PATTERNS));
    assert.strictEqual(REDIRECT_NETWORK_PATTERNS.length, 9);
  });

  test("contains every expected network id, no duplicates", () => {
    const ids = REDIRECT_NETWORK_PATTERNS.map(n => n.id);
    assert.deepStrictEqual([...new Set(ids)].sort(), [...EXPECTED_NETWORKS].sort());
  });

  test("each entry has required fields with correct types", () => {
    for (const entry of REDIRECT_NETWORK_PATTERNS) {
      assert.strictEqual(typeof entry.id, "string", `id missing on ${entry.id}`);
      assert.strictEqual(typeof entry.name, "string");
      assert.strictEqual(typeof entry.group, "string");
      assert.ok(Array.isArray(entry.redirectHosts), `redirectHosts not array on ${entry.id}`);
      assert.ok(entry.redirectHosts.length > 0, `redirectHosts empty on ${entry.id}`);
      assert.ok(Array.isArray(entry.landingParams), `landingParams not array on ${entry.id}`);
      assert.ok(entry.landingParams.length > 0, `landingParams empty on ${entry.id}`);
      assert.strictEqual(entry.type, "redirect-network", `type wrong on ${entry.id}`);
      assert.deepStrictEqual(entry.ourTag, {}, `ourTag must be empty on ${entry.id}`);
      assert.ok(Array.isArray(entry.references), `references not array on ${entry.id}`);
    }
  });

  test("every redirectHost is lowercase and non-empty", () => {
    for (const entry of REDIRECT_NETWORK_PATTERNS) {
      for (const host of entry.redirectHosts) {
        assert.strictEqual(typeof host, "string");
        assert.ok(host.length > 0);
        assert.strictEqual(host, host.toLowerCase(), `host "${host}" not lowercase`);
      }
    }
  });

  test("every landingParam is lowercase and non-empty", () => {
    for (const entry of REDIRECT_NETWORK_PATTERNS) {
      for (const p of entry.landingParams) {
        assert.strictEqual(typeof p, "string");
        assert.ok(p.length > 0);
        assert.strictEqual(p, p.toLowerCase(), `param "${p}" not lowercase`);
      }
    }
  });
});

describe("REDIRECT_NETWORK_PATTERNS — per-network content matches matrix v1.0", () => {
  function pick(id) {
    const entry = REDIRECT_NETWORK_PATTERNS.find(n => n.id === id);
    assert.ok(entry, `Network ${id} missing from REDIRECT_NETWORK_PATTERNS`);
    return entry;
  }

  test("awin: awin1.com → awc, wt_mc", () => {
    const n = pick("awin");
    assert.deepStrictEqual(n.redirectHosts, ["awin1.com"]);
    assert.deepStrictEqual([...n.landingParams].sort(), ["awc", "wt_mc"]);
  });

  test("cj-affiliate: 8 CJ domains → cjevent, cjdata", () => {
    const n = pick("cj-affiliate");
    assert.strictEqual(n.redirectHosts.length, 8);
    for (const host of ["anrdoezrs.net", "dpbolvw.net", "jdoqocy.com", "kqzyfj.com", "tkqlhce.com", "emjcd.com", "qksrv.net", "cj.dotomi.com"]) {
      assert.ok(n.redirectHosts.includes(host), `Expected ${host} in CJ redirectHosts`);
    }
    assert.deepStrictEqual([...n.landingParams].sort(), ["cjdata", "cjevent"]);
  });

  test("aliexpress-affiliate: s.click.aliexpress.com → aff_* + algo_* + btsid + ws_ab_test", () => {
    const n = pick("aliexpress-affiliate");
    assert.deepStrictEqual(n.redirectHosts, ["s.click.aliexpress.com"]);
    assert.deepStrictEqual(
      [...n.landingParams].sort(),
      ["aff_request_id", "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test"],
    );
  });

  test("impact-radius: *.pxf.io (wildcard) → irclickid, irgwc, iclid", () => {
    const n = pick("impact-radius");
    assert.deepStrictEqual(n.redirectHosts, ["*.pxf.io"]);
    assert.deepStrictEqual([...n.landingParams].sort(), ["iclid", "irclickid", "irgwc"]);
  });

  test("partnerize: prf.hn → clickref, pubref, adref", () => {
    const n = pick("partnerize");
    assert.deepStrictEqual(n.redirectHosts, ["prf.hn"]);
    assert.deepStrictEqual([...n.landingParams].sort(), ["adref", "clickref", "pubref"]);
  });

  test("admitad: ad.admitad.com + alitems.com → admitad_uid, tagtag_uid", () => {
    const n = pick("admitad");
    assert.deepStrictEqual([...n.redirectHosts].sort(), ["ad.admitad.com", "alitems.com"]);
    assert.deepStrictEqual([...n.landingParams].sort(), ["admitad_uid", "tagtag_uid"]);
  });

  test("a8net: px.a8.net → a8", () => {
    const n = pick("a8net");
    assert.deepStrictEqual(n.redirectHosts, ["px.a8.net"]);
    assert.deepStrictEqual(n.landingParams, ["a8"]);
  });

  test("rakuten-linkshare: click.linksynergy.com → ranmid, ransiteid, raneaid", () => {
    const n = pick("rakuten-linkshare");
    assert.deepStrictEqual(n.redirectHosts, ["click.linksynergy.com"]);
    assert.deepStrictEqual([...n.landingParams].sort(), ["raneaid", "ranmid", "ransiteid"]);
  });

  test("tradetracker: tc.tradetracker.net → ttaid, ttrk, ttcid", () => {
    const n = pick("tradetracker");
    assert.deepStrictEqual(n.redirectHosts, ["tc.tradetracker.net"]);
    assert.deepStrictEqual([...n.landingParams].sort(), ["ttaid", "ttcid", "ttrk"]);
  });
});

describe("REDIRECT_NETWORK_PATTERNS — invariants across the table", () => {
  test("only Impact uses the wildcard primitive (single source of truth)", () => {
    const wildcards = REDIRECT_NETWORK_PATTERNS.flatMap(n =>
      n.redirectHosts.filter(h => h.startsWith("*.")).map(h => `${n.id}:${h}`),
    );
    assert.deepStrictEqual(wildcards, ["impact-radius:*.pxf.io"]);
  });

  test("ourTag is empty {} for every entry (never injectable by MUGA)", () => {
    for (const entry of REDIRECT_NETWORK_PATTERNS) {
      assert.deepStrictEqual(entry.ourTag, {}, `${entry.id} must have empty ourTag`);
      assert.strictEqual(Object.keys(entry.ourTag).length, 0);
    }
  });

  test("type is uniformly 'redirect-network' (distinguishes from caps-spec direct-injection)", () => {
    for (const entry of REDIRECT_NETWORK_PATTERNS) {
      assert.strictEqual(entry.type, "redirect-network");
    }
  });

  test("references list cites docs/affiliate-networks-matrix.md", () => {
    for (const entry of REDIRECT_NETWORK_PATTERNS) {
      assert.ok(
        entry.references.some(r => r.includes("affiliate-networks-matrix.md")),
        `${entry.id} references must cite the matrix`,
      );
    }
  });
});

describe("getRedirectNetworkPatterns()", () => {
  test("returns the same frozen reference as REDIRECT_NETWORK_PATTERNS", () => {
    assert.strictEqual(getRedirectNetworkPatterns(), REDIRECT_NETWORK_PATTERNS);
  });
});

describe("getRedirectNetworkForRedirectHost() — exact-match hosts", () => {
  test("matches Awin", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("awin1.com")?.id, "awin");
  });

  test("matches every CJ redirect domain", () => {
    for (const host of ["anrdoezrs.net", "dpbolvw.net", "jdoqocy.com", "kqzyfj.com", "tkqlhce.com", "emjcd.com", "qksrv.net", "cj.dotomi.com"]) {
      assert.strictEqual(getRedirectNetworkForRedirectHost(host)?.id, "cj-affiliate", `Failed for ${host}`);
    }
  });

  test("matches AliExpress redirect", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("s.click.aliexpress.com")?.id, "aliexpress-affiliate");
  });

  test("matches Partnerize, Admitad (both hosts), A8.net, Rakuten, TradeTracker", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("prf.hn")?.id, "partnerize");
    assert.strictEqual(getRedirectNetworkForRedirectHost("ad.admitad.com")?.id, "admitad");
    assert.strictEqual(getRedirectNetworkForRedirectHost("alitems.com")?.id, "admitad");
    assert.strictEqual(getRedirectNetworkForRedirectHost("px.a8.net")?.id, "a8net");
    assert.strictEqual(getRedirectNetworkForRedirectHost("click.linksynergy.com")?.id, "rakuten-linkshare");
    assert.strictEqual(getRedirectNetworkForRedirectHost("tc.tradetracker.net")?.id, "tradetracker");
  });
});

describe("getRedirectNetworkForRedirectHost() — wildcard *.pxf.io", () => {
  test("matches subdomains of pxf.io", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("target.pxf.io")?.id, "impact-radius");
    assert.strictEqual(getRedirectNetworkForRedirectHost("walmart.pxf.io")?.id, "impact-radius");
    assert.strictEqual(getRedirectNetworkForRedirectHost("any-advertiser.pxf.io")?.id, "impact-radius");
  });

  test("does NOT match the bare apex pxf.io", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("pxf.io"), null);
  });

  test("does NOT match deceptive lookalikes", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("notpxf.io"), null);
    assert.strictEqual(getRedirectNetworkForRedirectHost("pxf.io.evil.com"), null);
  });
});

describe("getRedirectNetworkForRedirectHost() — defensive normalization", () => {
  test("strips www. prefix", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("www.prf.hn")?.id, "partnerize");
    assert.strictEqual(getRedirectNetworkForRedirectHost("www.awin1.com")?.id, "awin");
  });

  test("lowercases the input (case-insensitive hostname lookup)", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost("PRF.HN")?.id, "partnerize");
    assert.strictEqual(getRedirectNetworkForRedirectHost("Target.Pxf.Io")?.id, "impact-radius");
  });

  test("returns null for null / undefined / empty / unknown", () => {
    assert.strictEqual(getRedirectNetworkForRedirectHost(null), null);
    assert.strictEqual(getRedirectNetworkForRedirectHost(undefined), null);
    assert.strictEqual(getRedirectNetworkForRedirectHost(""), null);
    assert.strictEqual(getRedirectNetworkForRedirectHost("example.com"), null);
    assert.strictEqual(getRedirectNetworkForRedirectHost("amazon.com"), null);
  });
});

describe("getLandingParamsForReferrer()", () => {
  test("returns a Set of landingParams for a known referrer", () => {
    const params = getLandingParamsForReferrer("prf.hn");
    assert.ok(params instanceof Set);
    assert.deepStrictEqual([...params].sort(), ["adref", "clickref", "pubref"]);
  });

  test("returns the full param family for AliExpress redirect", () => {
    const params = getLandingParamsForReferrer("s.click.aliexpress.com");
    assert.deepStrictEqual(
      [...params].sort(),
      ["aff_request_id", "aff_trace_key", "algo_expid", "algo_pvid", "btsid", "ws_ab_test"],
    );
  });

  test("wildcard match returns Impact landingParams for any *.pxf.io subdomain", () => {
    const params = getLandingParamsForReferrer("target.pxf.io");
    assert.deepStrictEqual([...params].sort(), ["iclid", "irclickid", "irgwc"]);
  });

  test("returns empty Set for unknown / null / undefined", () => {
    assert.strictEqual(getLandingParamsForReferrer(null).size, 0);
    assert.strictEqual(getLandingParamsForReferrer(undefined).size, 0);
    assert.strictEqual(getLandingParamsForReferrer("").size, 0);
    assert.strictEqual(getLandingParamsForReferrer("example.com").size, 0);
  });

  test("returned Sets are independent (mutating one does not affect another call)", () => {
    const a = getLandingParamsForReferrer("prf.hn");
    a.add("polluted");
    const b = getLandingParamsForReferrer("prf.hn");
    assert.ok(!b.has("polluted"));
  });
});
