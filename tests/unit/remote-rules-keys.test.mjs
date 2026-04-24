/**
 * MUGA — Unit tests for src/lib/remote-rules-keys.js
 *
 * Run with: npm test
 *
 * Coverage (T1.3):
 *   - TRUSTED_PUBLIC_KEYS is non-empty
 *   - Array is frozen (mutation throws in strict mode)
 *   - First entry is a valid base64 string of exactly 44 characters
 *   - First entry decodes to exactly 32 bytes (raw Ed25519 public key)
 *
 * Per REQ-VERIFY-1, REQ-VERIFY-2, and design ADR-D5:
 * The file keeps only the frozen key bundle so key-rotation PRs are trivially
 * reviewable. No private key material may appear in this file or in tests.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { TRUSTED_PUBLIC_KEYS } from "../../src/lib/remote-rules-keys.js";

// ── Helper: standard base64 character set ────────────────────────────────────

/** Returns true if the string is valid standard base64 (not base64url). */
function isValidBase64(str) {
  return /^[A-Za-z0-9+/]+=*$/.test(str);
}

// ---------------------------------------------------------------------------
// TRUSTED_PUBLIC_KEYS shape and content
// ---------------------------------------------------------------------------
describe("TRUSTED_PUBLIC_KEYS — shape and invariants", () => {

  test("array is non-empty (at least one trusted key)", () => {
    assert.ok(
      Array.isArray(TRUSTED_PUBLIC_KEYS) && TRUSTED_PUBLIC_KEYS.length >= 1,
      "TRUSTED_PUBLIC_KEYS must contain at least one key (REQ-VERIFY-1)"
    );
  });

  test("array is frozen — mutation throws in strict mode", () => {
    assert.throws(
      () => { TRUSTED_PUBLIC_KEYS.push("bad-key"); },
      /Cannot add property|not extensible|read-only|frozen/i,
      "TRUSTED_PUBLIC_KEYS must be frozen so it cannot be tampered at runtime"
    );
  });

  test("first entry has exactly 44 characters (base64-encoded 32-byte key)", () => {
    const key = TRUSTED_PUBLIC_KEYS[0];
    assert.strictEqual(
      key.length,
      44,
      `First key must be 44 chars (32 raw bytes in base64), got ${key.length}`
    );
  });

  test("first entry is valid standard base64 (no base64url chars)", () => {
    const key = TRUSTED_PUBLIC_KEYS[0];
    assert.ok(
      isValidBase64(key),
      `First key must be valid standard base64, got: ${key}`
    );
  });

  test("first entry decodes to exactly 32 bytes (raw Ed25519 public key length)", () => {
    const key = TRUSTED_PUBLIC_KEYS[0];
    // atob decodes standard base64 in Node 18+ (available as globalThis.atob)
    // Fallback to Buffer for older Node versions.
    const decoded = typeof atob === "function"
      ? Uint8Array.from(atob(key), c => c.charCodeAt(0))
      : Buffer.from(key, "base64");
    assert.strictEqual(
      decoded.length,
      32,
      `Ed25519 raw public key must be 32 bytes, decoded to ${decoded.length} bytes`
    );
  });

});
