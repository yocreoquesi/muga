/**
 * Unit tests: test-key fixture helpers (T7.2)
 *
 * Verifies that generateTestKeypair() and signPayload() from
 * tests/fixtures/test-keys.mjs produce signatures that validate correctly
 * against the production verifySignature() from src/lib/remote-rules.js.
 *
 * This is the critical round-trip assertion: test-generated signed payloads
 * MUST pass the same verification path that runs in the extension at runtime.
 *
 * SC-08, SC-09, Design §13.5, NFR-TEST-1
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";

// Production verification function — we test against the real code path
import { verifySignature, canonicalMessage } from "../../src/lib/remote-rules.js";

// Test fixtures — test-only, never imported from production code
import { generateTestKeypair, signPayload, canonical } from "../fixtures/test-keys.mjs";

// node:crypto SubtleCrypto for verifySignature
const subtle = webcrypto.subtle;

describe("test-key fixture helpers", () => {
  test("generateTestKeypair returns privateKey, publicKey, and publicKeyB64Raw", () => {
    const kp = generateTestKeypair();
    assert.ok(kp.privateKey, "privateKey should be defined");
    assert.ok(kp.publicKey, "publicKey should be defined");
    assert.ok(typeof kp.publicKeyB64Raw === "string", "publicKeyB64Raw should be a string");
    // Raw Ed25519 public key is 32 bytes → 44-char base64 with trailing =
    assert.ok(kp.publicKeyB64Raw.length >= 43 && kp.publicKeyB64Raw.length <= 44,
      `publicKeyB64Raw should be 43-44 chars, got ${kp.publicKeyB64Raw.length}`);
    // Verify it decodes to 32 bytes
    const rawBytes = Buffer.from(kp.publicKeyB64Raw, "base64");
    assert.strictEqual(rawBytes.length, 32, "raw key material should be 32 bytes");
  });

  test("generateTestKeypair generates a fresh keypair on each call", () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    // Different calls should produce different keys
    assert.notStrictEqual(kp1.publicKeyB64Raw, kp2.publicKeyB64Raw,
      "two generateTestKeypair() calls should produce different key pairs");
  });

  test("signPayload + verifySignature round-trip succeeds with test keypair", async () => {
    const { privateKey, publicKeyB64Raw } = generateTestKeypair();
    const unsigned = {
      version: 1,
      published: "2026-04-24T00:00:00Z",
      params: ["test_param_a", "test_param_b"],
    };

    const signed = signPayload(unsigned, privateKey);

    // Verify structure
    assert.strictEqual(signed.version, unsigned.version);
    assert.strictEqual(signed.published, unsigned.published);
    assert.deepStrictEqual(signed.params, unsigned.params);
    assert.ok(typeof signed.sig === "string" && signed.sig.length > 0, "sig should be a non-empty string");

    // Verify against production code path
    const msg = canonicalMessage(signed.version, signed.published, signed.params);
    const ok = await verifySignature(msg, signed.sig, [publicKeyB64Raw], subtle);
    assert.ok(ok, "verifySignature must accept test-signed payload using the test public key");
  });

  test("verifySignature rejects tampered message (SC-09 analogue)", async () => {
    const { privateKey, publicKeyB64Raw } = generateTestKeypair();
    const unsigned = { version: 1, published: "2026-04-24T00:00:00Z", params: ["test_param"] };
    const signed = signPayload(unsigned, privateKey);

    // Tamper with the canonical message — verify should fail
    const tamperedMsg = canonicalMessage(signed.version, signed.published, ["EVIL_param"]);
    const ok = await verifySignature(tamperedMsg, signed.sig, [publicKeyB64Raw], subtle);
    assert.strictEqual(ok, false, "tampered message must not verify");
  });

  test("verifySignature rejects payload signed with a different key (SC-09)", async () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();

    const unsigned = { version: 1, published: "2026-04-24T00:00:00Z", params: ["some_param"] };
    const signed = signPayload(unsigned, kp1.privateKey);

    // Verify with kp2's public key — should fail
    const msg = canonicalMessage(signed.version, signed.published, signed.params);
    const ok = await verifySignature(msg, signed.sig, [kp2.publicKeyB64Raw], subtle);
    assert.strictEqual(ok, false, "payload signed with kp1 must not verify with kp2's public key");
  });

  test("canonical() matches production canonicalMessage() exactly", () => {
    const version = 7;
    const published = "2026-04-01T12:00:00Z";
    const params = ["utm_source", "fbclid", "gclid"];

    const fromFixture = canonical(version, published, params);
    const fromProduction = canonicalMessage(version, published, params);

    assert.strictEqual(fromFixture, fromProduction,
      "fixture canonical() must produce identical output to production canonicalMessage()");
    assert.strictEqual(fromFixture, "7|2026-04-01T12:00:00Z|utm_source,fbclid,gclid");
  });

  test("verifySignature accepts payload when test key is one of multiple trusted keys (SC-08)", async () => {
    const kp1 = generateTestKeypair();
    const kp2 = generateTestKeypair();
    // Sign with kp1 but trust both [kp2, kp1] — iteration finds kp1
    const unsigned = { version: 1, published: "2026-04-24T00:00:00Z", params: ["overlap_param"] };
    const signed = signPayload(unsigned, kp1.privateKey);

    const msg = canonicalMessage(signed.version, signed.published, signed.params);
    // Trusted keys includes kp2 (won't match) and kp1 (will match)
    const ok = await verifySignature(msg, signed.sig, [kp2.publicKeyB64Raw, kp1.publicKeyB64Raw], subtle);
    assert.ok(ok, "verifySignature must succeed when the signing key is anywhere in the trusted array");
  });
});
