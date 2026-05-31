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
import { LANDING_CANARIES } from "../../tools/affiliate-safety/canaries.mjs";

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
  // Cases are the shared canary fixtures — single source of truth (#768/#769).
  // Exact-set equality keeps the original strength; coverage now also includes
  // Tradedoubler (tduid), which previously had none.
  for (const c of LANDING_CANARIES) {
    test(`${c.network}: ${c.referrer} preserves ${c.mustPreserve.join(" + ")}`, () => {
      const policy = getLandingPolicy(c.landingHost, c.referrer);
      assert.deepStrictEqual([...policy.preserve].sort(), [...c.mustPreserve].sort());
      assert.equal(policy.network, c.network);
    });
  }
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
