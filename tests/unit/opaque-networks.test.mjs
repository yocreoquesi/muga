/**
 * MUGA — Unit tests for src/lib/opaque-networks.js (B20, #453)
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { OPAQUE_NETWORKS } from "../../src/lib/opaque-networks.js";

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
  test("has at least 16 entries (original 6 + 7 redirector-coverage + 3 batch-3)", () => {
    assert.ok(
      OPAQUE_NETWORKS.length >= 16,
      `Expected >= 16 entries, got ${OPAQUE_NETWORKS.length}`,
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
