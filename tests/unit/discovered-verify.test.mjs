/**
 * MUGA — Behavioral unit tests for tools/rule-ingestion/discovered-verify.mjs
 *
 * Covers spec Domains 2, 3, and 5:
 *   Domain 2  — schema accept/reject (shape validation, additionalProperties:false)
 *   Domain 3  — Ed25519 signature round-trip with ephemeral fixture keys
 *   Domain 5  — all assertions behavioral (no source-grep / no ratchet assertions)
 *
 * Design constraints (§ Validator architecture, § Canonicalization + Ed25519 verify):
 *   - discovered-verify.mjs is zero-dependency (node:crypto + node:fs only)
 *   - Tests inject an ephemeral pubkey via the { pubKeyB64 } seam so no
 *     production crawler private key is needed
 *   - Signer mirrors crawler hex-sig format: sortKeys canonical → compact
 *     JSON.stringify → UTF-8 bytes → Ed25519 sign → lowercase hex 128 chars
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

import {
  sortKeys,
  canonicalDiscovered,
  validateDiscoveredShape,
  verifyDiscovered,
} from "../../tools/rule-ingestion/discovered-verify.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// Test fixture helpers — mirrors crawler hex-sig format
// ---------------------------------------------------------------------------

/**
 * Generates a fresh Ed25519 keypair for test use.
 * Returns raw 32-byte base64 public key (matching verifyDiscovered pubKeyB64 seam).
 *
 * @returns {{ privateKey: KeyObject, publicKeyB64: string }}
 */
function generateFixtureKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  // Export DER SPKI (44 bytes: 12-byte header + 32-byte raw key) and strip header.
  const derBytes = publicKey.export({ type: "spki", format: "der" });
  const raw32 = derBytes.subarray(derBytes.length - 32);
  const publicKeyB64 = Buffer.from(raw32).toString("base64");
  return { privateKey, publicKeyB64 };
}

/**
 * Signs a discovered artifact object using the crawler hex-sig format.
 *
 * Signing algorithm (matches discovered-verify.mjs canonicalization):
 *   1. Deep-clone the object and strip `signature` if present.
 *   2. sortKeys (recursive alphabetical) the clone.
 *   3. JSON.stringify (compact, no spaces) → UTF-8 bytes.
 *   4. Ed25519 sign → 64 raw bytes → lowercase hex 128 chars.
 *
 * @param {object} artifact - Unsigned artifact object (without `signature`).
 * @param {KeyObject} privateKey - Ed25519 private key from generateFixtureKeypair().
 * @returns {object} Signed artifact with `signature` field added.
 */
function signArtifact(artifact, privateKey) {
  // Use the production canonicalization to sign — this keeps the round-trip symmetric.
  const canonical = canonicalDiscovered(artifact);
  const sigBytes = cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey);
  const signature = sigBytes.toString("hex"); // lowercase hex — 128 chars
  return { ...artifact, signature };
}

// ---------------------------------------------------------------------------
// Base valid fixture
// ---------------------------------------------------------------------------

const VALID_CANDIDATE = {
  param: "fbclid",
  first_seen_on: "example.com",
  injected_by: "meta-pixel",
  occurrence_count: 42,
};

function validArtifact() {
  return {
    candidates: [{ ...VALID_CANDIDATE }],
    corpus: ["example.com"],
    crawler_version: "abc1234",
    discovered_at: "2026-06-01T00:00:00Z",
    // signature deliberately absent — added by signArtifact()
  };
}

// ---------------------------------------------------------------------------
// Section A — sortKeys (pure function)
// ---------------------------------------------------------------------------

describe("sortKeys — recursive key-sort", () => {
  test("flat object keys are sorted alphabetically", () => {
    const input = { z: 1, a: 2, m: 3 };
    const result = sortKeys(input);
    assert.deepStrictEqual(Object.keys(result), ["a", "m", "z"]);
    assert.deepStrictEqual(result, { a: 2, m: 3, z: 1 });
  });

  test("nested object keys are sorted at every depth", () => {
    const input = { outer: { z: 1, a: 2 }, b: "v" };
    const result = sortKeys(input);
    assert.deepStrictEqual(Object.keys(result), ["b", "outer"]);
    assert.deepStrictEqual(Object.keys(result.outer), ["a", "z"]);
  });

  test("array element order is preserved", () => {
    const input = { items: [3, 1, 2] };
    const result = sortKeys(input);
    assert.deepStrictEqual(result.items, [3, 1, 2]);
  });

  test("objects inside arrays are sorted recursively", () => {
    const input = { items: [{ z: 1, a: 2 }, { m: 3, b: 4 }] };
    const result = sortKeys(input);
    assert.deepStrictEqual(Object.keys(result.items[0]), ["a", "z"]);
    assert.deepStrictEqual(Object.keys(result.items[1]), ["b", "m"]);
  });

  test("non-object primitives pass through unchanged", () => {
    assert.strictEqual(sortKeys(42), 42);
    assert.strictEqual(sortKeys("hello"), "hello");
    assert.strictEqual(sortKeys(null), null);
  });
});

// ---------------------------------------------------------------------------
// Section B — canonicalDiscovered (pure function)
// ---------------------------------------------------------------------------

describe("canonicalDiscovered — strip signature + sortKeys + compact JSON", () => {
  test("removes the signature field before serializing", () => {
    const art = { ...validArtifact(), signature: "deadbeef".repeat(16) };
    const canonical = canonicalDiscovered(art);
    assert.ok(!canonical.includes('"signature"'), "canonical output must not contain signature field");
  });

  test("output is compact JSON (no spaces)", () => {
    const art = validArtifact();
    const canonical = canonicalDiscovered(art);
    assert.ok(!canonical.includes(" "), "canonical output must not contain spaces (compact JSON)");
  });

  test("output keys are alphabetically sorted at the top level", () => {
    const art = validArtifact();
    const canonical = canonicalDiscovered(art);
    // candidates must appear before corpus before crawler_version before discovered_at
    const cIdx = canonical.indexOf('"candidates"');
    const coIdx = canonical.indexOf('"corpus"');
    const cvIdx = canonical.indexOf('"crawler_version"');
    const dIdx = canonical.indexOf('"discovered_at"');
    assert.ok(cIdx < coIdx, "candidates must appear before corpus in canonical output");
    assert.ok(coIdx < cvIdx, "corpus must appear before crawler_version in canonical output");
    assert.ok(cvIdx < dIdx, "crawler_version must appear before discovered_at in canonical output");
  });

  test("does not mutate the original object", () => {
    const art = { ...validArtifact(), signature: "deadbeef".repeat(16) };
    const originalSig = art.signature;
    canonicalDiscovered(art);
    assert.strictEqual(art.signature, originalSig, "original object must not be mutated");
  });
});

// ---------------------------------------------------------------------------
// Section C — validateDiscoveredShape (hand-rolled schema check)
// ---------------------------------------------------------------------------

describe("validateDiscoveredShape — valid artifacts pass", () => {
  test("valid full artifact with one candidate passes", () => {
    const art = { ...validArtifact(), signature: "ab".repeat(64) };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, true);
  });

  test("empty candidates array is valid (heartbeat)", () => {
    const art = { ...validArtifact(), candidates: [], signature: "ab".repeat(64) };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, true, `expected ok=true, got code=${result.code}`);
  });
});

describe("validateDiscoveredShape — missing required top-level fields fail", () => {
  const REQUIRED_FIELDS = [
    "discovered_at",
    "crawler_version",
    "corpus",
    "candidates",
    "signature",
  ];

  for (const field of REQUIRED_FIELDS) {
    test(`missing '${field}' fails with ok=false`, () => {
      const art = { ...validArtifact(), signature: "ab".repeat(64) };
      delete art[field];
      const result = validateDiscoveredShape(art);
      assert.strictEqual(result.ok, false, `expected ok=false when '${field}' is missing`);
      assert.ok(result.code, "result must include a code string");
    });
  }
});

describe("validateDiscoveredShape — additionalProperties violations fail", () => {
  test("extra top-level field fails", () => {
    const art = { ...validArtifact(), signature: "ab".repeat(64), unexpected_extra: "value" };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "extra top-level field must fail validation");
    assert.ok(result.code, "result must include a code string");
  });

  test("extra candidate field fails", () => {
    const art = {
      ...validArtifact(),
      signature: "ab".repeat(64),
      candidates: [{ ...VALID_CANDIDATE, unknown_field: "bad" }],
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "extra candidate field must fail validation");
    assert.ok(result.code, "result must include a code string");
  });
});

describe("validateDiscoveredShape — corpus and candidate constraints", () => {
  test("corpus must have at least one entry", () => {
    const art = { ...validArtifact(), signature: "ab".repeat(64), corpus: [] };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "empty corpus must fail validation");
  });

  test("occurrence_count must be an integer >= 1", () => {
    const art = {
      ...validArtifact(),
      signature: "ab".repeat(64),
      candidates: [{ ...VALID_CANDIDATE, occurrence_count: 0 }],
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "occurrence_count of 0 must fail validation");
  });

  test("signature must be exactly 128 hex lowercase chars", () => {
    const art = { ...validArtifact(), signature: "tooshort" };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "short signature must fail validation");
  });

  test("crawler_version must be 7–40 hex chars", () => {
    const art = { ...validArtifact(), signature: "ab".repeat(64), crawler_version: "zz" };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "invalid crawler_version must fail validation");
  });
});

describe("validateDiscoveredShape — type parity with discovered.schema.json", () => {
  test("non-string discovered_at fails", () => {
    const art = { ...validArtifact(), signature: "ab".repeat(64), discovered_at: 42 };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "non-string discovered_at must fail validation");
    assert.strictEqual(result.code, "ERR_DISCOVERED_AT_INVALID");
  });

  test("unparseable discovered_at string fails", () => {
    const art = { ...validArtifact(), signature: "ab".repeat(64), discovered_at: "not-a-date" };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "unparseable discovered_at must fail validation");
    assert.strictEqual(result.code, "ERR_DISCOVERED_AT_INVALID");
  });

  test("non-string param fails", () => {
    const art = {
      ...validArtifact(),
      signature: "ab".repeat(64),
      candidates: [{ ...VALID_CANDIDATE, param: 123 }],
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "non-string param must fail validation");
    assert.strictEqual(result.code, "ERR_CANDIDATE_0_PARAM_INVALID");
  });

  test("empty param fails", () => {
    const art = {
      ...validArtifact(),
      signature: "ab".repeat(64),
      candidates: [{ ...VALID_CANDIDATE, param: "" }],
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "empty param must fail validation");
    assert.strictEqual(result.code, "ERR_CANDIDATE_0_PARAM_INVALID");
  });

  test("non-string injected_by fails", () => {
    const art = {
      ...validArtifact(),
      signature: "ab".repeat(64),
      candidates: [{ ...VALID_CANDIDATE, injected_by: 7 }],
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "non-string injected_by must fail validation");
    assert.strictEqual(result.code, "ERR_CANDIDATE_0_INJECTED_BY_INVALID");
  });

  test("empty injected_by fails", () => {
    const art = {
      ...validArtifact(),
      signature: "ab".repeat(64),
      candidates: [{ ...VALID_CANDIDATE, injected_by: "" }],
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "empty injected_by must fail validation");
    assert.strictEqual(result.code, "ERR_CANDIDATE_0_INJECTED_BY_INVALID");
  });
});

describe("validateDiscoveredShape — hostname lowercase constraint", () => {
  test("lowercase corpus hostname passes", () => {
    const art = { ...validArtifact(), corpus: ["example.com"], signature: "ab".repeat(64) };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, true, `expected ok=true for lowercase hostname, got code=${result.code}`);
  });

  test("uppercase corpus hostname fails with ERR_CORPUS_HOSTNAME_CASE", () => {
    const art = { ...validArtifact(), corpus: ["Example.com"], signature: "ab".repeat(64) };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "uppercase corpus hostname must fail validation");
    assert.strictEqual(result.code, "ERR_CORPUS_HOSTNAME_CASE:Example.com");
  });

  test("mixed-case corpus hostname fails", () => {
    const art = { ...validArtifact(), corpus: ["eXaMpLe.com"], signature: "ab".repeat(64) };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "mixed-case corpus hostname must fail validation");
  });

  test("second corpus entry uppercase fails", () => {
    const art = {
      ...validArtifact(),
      corpus: ["example.com", "ANOTHER.org"],
      signature: "ab".repeat(64),
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "uppercase in any corpus entry must fail");
    assert.strictEqual(result.code, "ERR_CORPUS_HOSTNAME_CASE:ANOTHER.org");
  });

  test("lowercase first_seen_on passes", () => {
    const art = {
      ...validArtifact(),
      candidates: [{ ...VALID_CANDIDATE, first_seen_on: "example.com" }],
      signature: "ab".repeat(64),
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, true, `expected ok=true for lowercase first_seen_on, got code=${result.code}`);
  });

  test("uppercase first_seen_on fails with ERR_CANDIDATE_FIRST_SEEN_ON_CASE", () => {
    const art = {
      ...validArtifact(),
      candidates: [{ ...VALID_CANDIDATE, first_seen_on: "Example.com" }],
      signature: "ab".repeat(64),
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "uppercase first_seen_on must fail validation");
    assert.strictEqual(result.code, "ERR_CANDIDATE_0_FIRST_SEEN_ON_CASE");
  });

  test("mixed-case first_seen_on fails", () => {
    const art = {
      ...validArtifact(),
      candidates: [{ ...VALID_CANDIDATE, first_seen_on: "eXaMpLe.CoM" }],
      signature: "ab".repeat(64),
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "mixed-case first_seen_on must fail validation");
  });

  test("uppercase first_seen_on on second candidate fails with correct index", () => {
    const art = {
      ...validArtifact(),
      candidates: [
        { ...VALID_CANDIDATE, first_seen_on: "example.com" },
        { ...VALID_CANDIDATE, param: "utm_source", first_seen_on: "UPPER.org" },
      ],
      signature: "ab".repeat(64),
    };
    const result = validateDiscoveredShape(art);
    assert.strictEqual(result.ok, false, "uppercase first_seen_on in any candidate must fail");
    assert.strictEqual(result.code, "ERR_CANDIDATE_1_FIRST_SEEN_ON_CASE");
  });
});

// ---------------------------------------------------------------------------
// Section D — verifyDiscovered (Ed25519 signature verification)
// ---------------------------------------------------------------------------

describe("verifyDiscovered — signature round-trip with ephemeral fixture keys", () => {
  test("valid artifact signed with fixture key verifies successfully", () => {
    const { privateKey, publicKeyB64 } = generateFixtureKeypair();
    const unsigned = validArtifact();
    const signed = signArtifact(unsigned, privateKey);
    const result = verifyDiscovered(signed, { pubKeyB64: publicKeyB64 });
    assert.strictEqual(result.ok, true, `expected ok=true, got code=${result.code}`);
  });

  test("bit-flipped signature fails verification", () => {
    const { privateKey, publicKeyB64 } = generateFixtureKeypair();
    const signed = signArtifact(validArtifact(), privateKey);
    // Flip the first byte of the signature (hex chars 0-1 → increment by 1 mod 256)
    const firstByte = parseInt(signed.signature.slice(0, 2), 16);
    const flipped = ((firstByte + 1) % 256).toString(16).padStart(2, "0");
    const tamperedSig = flipped + signed.signature.slice(2);
    const result = verifyDiscovered({ ...signed, signature: tamperedSig }, { pubKeyB64: publicKeyB64 });
    assert.strictEqual(result.ok, false, "bit-flipped signature must fail verification");
  });

  test("tampered payload field fails verification", () => {
    const { privateKey, publicKeyB64 } = generateFixtureKeypair();
    const signed = signArtifact(validArtifact(), privateKey);
    // Tamper with a field after signing
    const tampered = { ...signed, crawler_version: "0000000" };
    const result = verifyDiscovered(tampered, { pubKeyB64: publicKeyB64 });
    assert.strictEqual(result.ok, false, "tampered field must fail verification");
  });

  test("wrong key rejects a validly signed artifact", () => {
    const { privateKey } = generateFixtureKeypair();
    const { publicKeyB64: wrongPubKeyB64 } = generateFixtureKeypair(); // different keypair
    const signed = signArtifact(validArtifact(), privateKey);
    const result = verifyDiscovered(signed, { pubKeyB64: wrongPubKeyB64 });
    assert.strictEqual(result.ok, false, "wrong public key must reject verification");
  });
});

describe("verifyDiscovered — shape validation is always run first", () => {
  test("shape-invalid artifact returns ok=false even without pubkey check", () => {
    const art = { ...validArtifact(), signature: "ab".repeat(64), unexpected_extra: "value" };
    // Even with a valid pubkey injected, shape check must reject first
    const { publicKeyB64 } = generateFixtureKeypair();
    const result = verifyDiscovered(art, { pubKeyB64: publicKeyB64 });
    assert.strictEqual(result.ok, false, "shape-invalid artifact must fail before signature check");
  });
});
