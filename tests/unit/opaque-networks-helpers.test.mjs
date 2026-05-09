/**
 * MUGA: Unit tests for isOpaqueNetworkHost() helper in src/lib/opaque-networks.js
 *
 * Why this file exists: after the cleaner.js dedup refactor (T10–T12), the
 * isOpaqueNetworkHost() helper lives in src/lib/opaque-networks.js and is
 * re-exported through the content bundle. This test covers the helper's public
 * contract. The old drift-detection test
 * (tests/unit/opaque-networks-content-sync.test.mjs) is deleted because the
 * inline _OPAQUE_NETWORK_HOSTS replica no longer exists after T12.
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isOpaqueNetworkHost, OPAQUE_NETWORKS } from "../../src/lib/opaque-networks.js";

describe("isOpaqueNetworkHost — helper contract", () => {
  test("is a function", () => {
    assert.strictEqual(typeof isOpaqueNetworkHost, "function");
  });

  test("matches a bare host present in OPAQUE_NETWORKS", () => {
    // s.click.aliexpress.com is a stable existing entry
    assert.ok(isOpaqueNetworkHost("s.click.aliexpress.com"));
  });

  test("matches a www-prefixed host (strips www. normalization)", () => {
    // www.bit.ly strips to bit.ly which is in OPAQUE_NETWORKS.
    assert.ok(isOpaqueNetworkHost("www.bit.ly"),
      "www.bit.ly should match after stripping the www. prefix");
    // www.tinyurl.com strips to tinyurl.com which is in OPAQUE_NETWORKS.
    assert.ok(isOpaqueNetworkHost("www.tinyurl.com"),
      "www.tinyurl.com should match after stripping the www. prefix");
    // www.s.click.aliexpress.com strips to s.click.aliexpress.com which IS in OPAQUE_NETWORKS.
    assert.ok(isOpaqueNetworkHost("www.s.click.aliexpress.com"),
      "www.s.click.aliexpress.com strips to s.click.aliexpress.com which is in OPAQUE_NETWORKS");
  });

  test("returns false for a non-opaque host", () => {
    assert.strictEqual(isOpaqueNetworkHost("example.com"), false);
    assert.strictEqual(isOpaqueNetworkHost("google.com"), false);
    assert.strictEqual(isOpaqueNetworkHost("amazon.com"), false);
  });

  test("returns false for empty string", () => {
    assert.strictEqual(isOpaqueNetworkHost(""), false);
  });

  test("returns false for null", () => {
    assert.strictEqual(isOpaqueNetworkHost(null), false);
  });

  test("returns false for undefined", () => {
    assert.strictEqual(isOpaqueNetworkHost(undefined), false);
  });

  test("checks both stripped and original form (covers subdomains in OPAQUE_NETWORKS)", () => {
    // s.click.aliexpress.com is in OPAQUE_NETWORKS as-is.
    // Passing it directly must return true.
    assert.ok(isOpaqueNetworkHost("s.click.aliexpress.com"));
  });

  test("every host in OPAQUE_NETWORKS matches via isOpaqueNetworkHost", () => {
    for (const host of OPAQUE_NETWORKS) {
      assert.ok(
        isOpaqueNetworkHost(host),
        `Expected isOpaqueNetworkHost("${host}") to be true — host is in OPAQUE_NETWORKS`,
      );
    }
  });
});
