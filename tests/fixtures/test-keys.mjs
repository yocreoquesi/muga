/**
 * Test-only Ed25519 keypair generation and payload signing helpers.
 *
 * NEVER import this file from production code. These helpers exist solely
 * for unit and E2E test suites. No private key material is committed; keypairs
 * are generated at test runtime via node:crypto.generateKeyPairSync.
 *
 * Approach: dependency injection.
 * - generateTestKeypair() returns fresh { privateKey, publicKey, publicKeyB64Raw }
 * - signPayload() signs a payload object and returns the complete signed payload
 * - verifySignature from lib/remote-rules.js is used to verify in unit tests,
 *   confirming the round-trip against the same production code path.
 *
 * Integration with E2E:
 * - publicKeyB64Raw is injected into globalThis.__MUGA_TRUSTED_KEYS__ in the
 *   extension service worker via Playwright's serviceWorker.evaluate().
 * - The production TRUSTED_PUBLIC_KEYS are NOT used during E2E test runs.
 *
 * Why runtime generation instead of committed fixture keys:
 * - Prevents any accidental private key commitment (no private key exists on disk).
 * - Each test run uses a fresh throw-away keypair, reducing key-misuse surface.
 * - The generation cost is ~1ms per call (negligible for tests).
 */

import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

/**
 * Generates a fresh Ed25519 keypair for test use.
 * Returns the raw 32-byte public key as standard base64 (matching TRUSTED_PUBLIC_KEYS format).
 *
 * @returns {{ privateKey: KeyObject, publicKey: KeyObject, publicKeyB64Raw: string }}
 */
export function generateTestKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // Export DER-encoded public key and take the last 32 bytes (raw key material).
  // Ed25519 DER SubjectPublicKeyInfo is 44 bytes: 12-byte header + 32-byte key.
  const derBytes = publicKey.export({ type: "spki", format: "der" });
  const rawKeyBytes = derBytes.subarray(derBytes.length - 32);
  const publicKeyB64Raw = Buffer.from(rawKeyBytes).toString("base64");

  return { privateKey, publicKey, publicKeyB64Raw };
}

/**
 * Produces the canonical signed message for an unsigned payload.
 * Matches the production canonicalMessage() from lib/remote-rules.js exactly.
 *
 * @param {number}   version   - Payload version integer.
 * @param {string}   published - ISO-8601 published timestamp (verbatim).
 * @param {string[]} params    - Params array (order-sensitive).
 * @returns {string}
 */
export function canonical(version, published, params) {
  return `${version}|${published}|${params.join(",")}`;
}

/**
 * Signs a payload object with the given Ed25519 private key and returns
 * the complete signed payload ready for serving as a remote-rules response.
 *
 * Canonical message format (REQ-VERIFY-3, design §2):
 *   `${version}|${published}|${params.join(",")}`
 *
 * Signature encoding: base64url (URL-safe, no padding), matching the
 * production expectation in verifySignature() from lib/remote-rules.js.
 *
 * @param {{ version: number, published: string, params: string[] }} payload - Unsigned payload.
 * @param {KeyObject} privateKey - Ed25519 private key from generateTestKeypair().
 * @returns {{ version: number, published: string, params: string[], sig: string }}
 */
export function signPayload({ version, published, params }, privateKey) {
  const msg = canonical(version, published, params);

  // Sign using node:crypto Ed25519 — produces a 64-byte raw signature.
  // Use the one-shot sign(null, data, key) API (Ed25519 is a pure scheme,
  // the algorithm argument is null / not applicable — no hash digest involved).
  const sigBytes = cryptoSign(null, Buffer.from(msg, "utf8"), privateKey);

  // Encode as base64url (URL-safe, no padding) — matches what verifySignature() expects.
  const sigB64url = sigBytes
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  return { version, published, params, sig: sigB64url };
}
