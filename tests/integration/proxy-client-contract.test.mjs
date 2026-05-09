/** MUGA: Integration test — proxy-client end-to-end contract (#608) */
//
// Calls the LIVE production Worker at unwrap.muga.app and verifies the
// extension-Worker contract holds end-to-end:
//
//   1. PROXY_URL path is what the Worker actually serves (catches /v1/unwrap
//      vs /unwrap drift like the v1.15.1 hotfix bug).
//   2. base64UrlEncode produces what the Worker can decode (catches param
//      shape drift like the ?url= vs ?u= bug from the same hotfix).
//   3. Worker accepts an extension-style Origin header.
//   4. Response is a signed envelope verifiable with PROXY_TRUSTED_PUBLIC_KEYS
//      (catches public-key rotation drift between extension and Worker).
//
// This is the integration-level counterpart to the unit-level regression
// tests added in PR #606 (which assert on the request shape via fetch stub
// but cannot detect public-key drift or live Worker availability).
//
// Network dependency: this test hits https://unwrap.muga.app over the public
// Internet. In normal conditions the Worker has 99.9%+ uptime and the test
// is stable. If CI shows transient flakiness in this test, the right answer
// is to investigate WHY (the Worker is the production endpoint users hit) —
// not to disable the test. Stub coverage already exists at unit level.

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  PROXY_URL,
  base64UrlEncode,
  verifyUnwrapResponse,
} from "../../src/lib/proxy-client.js";
import { PROXY_TRUSTED_PUBLIC_KEYS } from "../../src/lib/remote-rules-keys.js";

// Stable test URL — an AliExpress affiliate click ID that resolves to a
// real product page. Used because:
//   - s.click.aliexpress.com has been in OPAQUE_NETWORKS since B20 (#453),
//     so it would have caught the v1.14.0 contract bugs.
//   - AliExpress affiliate URLs are not user-deletable like vanity bit.ly
//     paths, so the test won't break if a third party unregisters a slug.
//   - The Worker caches successful resolutions for 30 days; even if the
//     upstream destination changes, signed-envelope round-trip stays
//     verifiable. The test does NOT assert on destination value.
const TEST_URL = "https://s.click.aliexpress.com/e/_oBtAfD";

// Synthetic extension origin. Real extensions send a chrome-extension:// or
// moz-extension:// scheme URL (the Worker accepts either prefix per the
// origin gate in src/lib/origin.ts).
const ORIGIN = "chrome-extension://muga-integration-test";

// Generous timeout: the Worker may follow up to 5 redirect hops with a 5s
// per-hop budget, so a cold cache miss can take 10–15s end-to-end.
const TIMEOUT_MS = 20_000;

/**
 * Imports a raw 32-byte Ed25519 public key (standard base64) into a CryptoKey
 * usable by verifyUnwrapResponse. Mirrors what the extension does at runtime
 * when it boots — keeps this test path identical to production.
 */
async function importPublicKey(rawBase64) {
  const bytes = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
  return webcrypto.subtle.importKey(
    "raw",
    bytes,
    { name: "Ed25519" },
    false,
    ["verify"],
  );
}

describe("integration: proxy-client end-to-end contract (#608)", () => {
  test("Worker accepts extension request shape and returns verifiable signed envelope", async () => {
    // Build the URL the same way fetchUnwrap would. If PROXY_URL or
    // base64UrlEncode regress, this constructed URL will not match what the
    // Worker serves.
    const u = base64UrlEncode(TEST_URL);
    const endpoint = `${PROXY_URL}?u=${u}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    let response;
    try {
      response = await fetch(endpoint, {
        signal: controller.signal,
        headers: { Origin: ORIGIN },
        cache: "no-store",
        redirect: "error",
      });
    } finally {
      clearTimeout(timer);
    }

    // 200 = signed envelope. Anything else means the contract drifted.
    //   404 → path drift (e.g., /v1/unwrap vs /unwrap)
    //   400 → param drift (e.g., ?url= vs ?u=)
    //   403 → origin-gate change
    //   429 → rate limit (transient — retry locally if you hit this)
    //   502/504 → upstream resolution failure (separate from the contract)
    assert.strictEqual(
      response.status,
      200,
      `Worker returned HTTP ${response.status} for ${endpoint} with Origin=${ORIGIN}. ` +
        `Expected 200 with a signed envelope. The extension–Worker contract may have drifted.`,
    );

    const payload = await response.json();

    // Required envelope fields — same set the extension's verifyUnwrapResponse
    // expects. If the Worker drops or renames any of these, signature
    // verification will fail downstream.
    for (const field of ["destination", "hops", "network", "cached", "signature"]) {
      assert.ok(
        Object.prototype.hasOwnProperty.call(payload, field),
        `Worker response missing required field: ${field}. Payload was: ${JSON.stringify(payload)}`,
      );
    }

    assert.strictEqual(typeof payload.destination, "string");
    assert.ok(
      payload.destination.startsWith("http://") || payload.destination.startsWith("https://"),
      `destination has unexpected scheme: ${payload.destination}`,
    );

    // Signature verification — proves the public key in the extension matches
    // the private key the Worker is signing with. Iterate every key in
    // PROXY_TRUSTED_PUBLIC_KEYS; pass if ANY verifies (mirrors the rotation
    // window pattern documented in remote-rules-keys.js).
    let verified = false;
    for (const rawKey of PROXY_TRUSTED_PUBLIC_KEYS) {
      const publicKey = await importPublicKey(rawKey);
      if (await verifyUnwrapResponse(payload, publicKey)) {
        verified = true;
        break;
      }
    }

    assert.strictEqual(
      verified,
      true,
      "Signature verification failed against every key in PROXY_TRUSTED_PUBLIC_KEYS. " +
        "This signals public-key drift between the extension and the Worker — " +
        "either the Worker rotated and the extension did not pick up the new key, " +
        "or vice versa. See engram://muga-unwrap/abuse-mitigation for rotation procedure.",
    );
  });
});
