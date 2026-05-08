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
});
