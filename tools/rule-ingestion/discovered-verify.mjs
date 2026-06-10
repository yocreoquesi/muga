/** MUGA: hand-rolled Ed25519 verify + shape validator for crawler discovery artifacts (#787) */

/**
 * Verify and validate artifacts produced by caps-crawler and landing in discovered/.
 *
 * Why a dedicated helper instead of reusing remote-rules.js:
 *   remote-rules.js uses a pipe-delimited canonicalization (`${version}|${published}|${params}`)
 *   incompatible with the sorted-key JSON scheme used here. Mixing them would silently break.
 *
 * Zero npm dependencies — node:crypto and node:fs only.
 *
 * CLI usage (iterates discovered/*.json, fails-closed on any error):
 *   node tools/rule-ingestion/discovered-verify.mjs
 *
 * Importable exports (named only, no default export):
 *   sortKeys(value)
 *   canonicalDiscovered(obj)
 *   validateDiscoveredShape(obj)
 *   verifyDiscovered(obj, { pubKeyB64 })
 */

import { createPublicKey, verify as cryptoVerify } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

// 12-byte DER SPKI prefix for Ed25519 raw 32-byte public key.
// SubjectPublicKeyInfo header: SEQUENCE { AlgorithmIdentifier { OID 1.3.101.112 } BIT STRING }
// hex: 302a300506032b6570032100
const DER_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

// Path to the stored crawler public key (co-located with this helper).
const DEFAULT_PUBKEY_PATH = join(__dirname, "crawler-pubkey.txt");

// Regex for a valid crawler_version: 7–40 lowercase hex characters.
const CRAWLER_VERSION_RE = /^[0-9a-f]{7,40}$/;

// Regex for the artifact signature: exactly 128 lowercase hex characters (64 raw bytes).
const SIGNATURE_RE = /^[0-9a-f]{128}$/;

// Regex for a lowercase hostname. Mirrors the JSON Schema pattern on corpus[] items
// and candidates[].first_seen_on. The crawler lowercases all hostnames at signing time;
// enforcement here keeps schema and validator in parity.
const HOSTNAME_LOWERCASE_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

// Required top-level fields of a discovered artifact.
const TOP_LEVEL_REQUIRED = [
  "candidates",
  "corpus",
  "crawler_version",
  "discovered_at",
  "signature",
];

// Allowed top-level fields (same set — additionalProperties: false).
const TOP_LEVEL_ALLOWED = new Set(TOP_LEVEL_REQUIRED);

// Required fields within each candidate object.
const CANDIDATE_REQUIRED = ["first_seen_on", "injected_by", "occurrence_count", "param"];

// Allowed candidate fields (same set — additionalProperties: false).
const CANDIDATE_ALLOWED = new Set(CANDIDATE_REQUIRED);

// ---------------------------------------------------------------------------
// sortKeys — recursive alphabetical key-sort
// ---------------------------------------------------------------------------

/**
 * Recursively rebuilds every object with keys in alphabetical sort order.
 * Arrays preserve element order; elements that are objects are sorted recursively.
 * Primitive values (string, number, boolean, null) pass through unchanged.
 *
 * WHY: the crawler signs over a compactly serialized representation of the payload
 * after this transform, so the verifier must reproduce it exactly.
 *
 * @param {*} value - Any JSON-serializable value.
 * @returns {*} The input with all nested object keys sorted.
 */
export function sortKeys(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = sortKeys(value[key]);
    }
    return sorted;
  }
  return value;
}

// ---------------------------------------------------------------------------
// canonicalDiscovered — produce the signed message string
// ---------------------------------------------------------------------------

/**
 * Produces the canonical representation of a discovered artifact for signature
 * verification. Algorithm (matches caps-crawler sign.mjs exactly):
 *   1. Deep-clone the object via sortKeys (handles the recursion).
 *   2. Delete the `signature` field from the clone.
 *   3. JSON.stringify the sorted clone with no spacing (compact).
 *
 * The on-disk artifact file is pretty-printed, so the verifier MUST parse and
 * re-canonicalize — NEVER verify over raw file bytes.
 *
 * @param {object} obj - Parsed artifact object (may or may not have `signature`).
 * @returns {string} Compact JSON string ready for UTF-8 encoding and verification.
 */
export function canonicalDiscovered(obj) {
  // sortKeys deep-clones the object, so the original is never mutated.
  const clone = sortKeys(obj);
  delete clone.signature;
  return JSON.stringify(clone);
}

// ---------------------------------------------------------------------------
// validateDiscoveredShape — hand-rolled shape check
// ---------------------------------------------------------------------------

/**
 * Validates the shape of a parsed discovered artifact object.
 * Mirrors validatePayloadShape() conventions from remote-rules.js but enforces
 * the discovered artifact schema — MUST NOT reuse that function.
 *
 * Checks:
 *   - All required top-level fields are present.
 *   - No unknown top-level fields (additionalProperties: false).
 *   - corpus is a non-empty array.
 *   - crawler_version matches [0-9a-f]{7,40}.
 *   - signature matches [0-9a-f]{128}.
 *   - candidates is an array; each element passes candidate-level checks.
 *
 * @param {object} obj - Parsed artifact object.
 * @returns {{ ok: boolean, code: string }} ok=true on success; ok=false with code on failure.
 */
export function validateDiscoveredShape(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, code: "ERR_NOT_OBJECT" };
  }

  // Check for unknown top-level keys (additionalProperties: false).
  for (const key of Object.keys(obj)) {
    if (!TOP_LEVEL_ALLOWED.has(key)) {
      return { ok: false, code: `ERR_UNKNOWN_FIELD:${key}` };
    }
  }

  // Check all required top-level fields are present.
  for (const field of TOP_LEVEL_REQUIRED) {
    if (!(field in obj)) {
      return { ok: false, code: `ERR_MISSING_FIELD:${field}` };
    }
  }

  // corpus: array with at least one entry.
  if (!Array.isArray(obj.corpus) || obj.corpus.length === 0) {
    return { ok: false, code: "ERR_CORPUS_EMPTY" };
  }

  // corpus: each entry must be a lowercase hostname (mirrors JSON Schema pattern).
  for (const hostname of obj.corpus) {
    if (typeof hostname !== "string" || !HOSTNAME_LOWERCASE_RE.test(hostname)) {
      return { ok: false, code: `ERR_CORPUS_HOSTNAME_CASE:${hostname}` };
    }
  }

  // crawler_version: 7–40 lowercase hex chars.
  if (typeof obj.crawler_version !== "string" || !CRAWLER_VERSION_RE.test(obj.crawler_version)) {
    return { ok: false, code: "ERR_CRAWLER_VERSION_INVALID" };
  }

  // signature: exactly 128 lowercase hex chars.
  if (typeof obj.signature !== "string" || !SIGNATURE_RE.test(obj.signature)) {
    return { ok: false, code: "ERR_SIGNATURE_FORMAT" };
  }

  // candidates: must be an array (empty is valid — heartbeat run).
  if (!Array.isArray(obj.candidates)) {
    return { ok: false, code: "ERR_CANDIDATES_NOT_ARRAY" };
  }

  // Validate each candidate object.
  for (let i = 0; i < obj.candidates.length; i++) {
    const candidate = obj.candidates[i];
    if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
      return { ok: false, code: `ERR_CANDIDATE_${i}_NOT_OBJECT` };
    }

    // No unknown candidate fields (additionalProperties: false).
    for (const key of Object.keys(candidate)) {
      if (!CANDIDATE_ALLOWED.has(key)) {
        return { ok: false, code: `ERR_CANDIDATE_${i}_UNKNOWN_FIELD:${key}` };
      }
    }

    // All required candidate fields must be present.
    for (const field of CANDIDATE_REQUIRED) {
      if (!(field in candidate)) {
        return { ok: false, code: `ERR_CANDIDATE_${i}_MISSING_FIELD:${field}` };
      }
    }

    // occurrence_count: integer >= 1.
    if (
      !Number.isInteger(candidate.occurrence_count) ||
      candidate.occurrence_count < 1
    ) {
      return { ok: false, code: `ERR_CANDIDATE_${i}_OCCURRENCE_COUNT` };
    }

    // first_seen_on: must be a lowercase hostname (mirrors JSON Schema pattern).
    if (
      typeof candidate.first_seen_on !== "string" ||
      !HOSTNAME_LOWERCASE_RE.test(candidate.first_seen_on)
    ) {
      return { ok: false, code: `ERR_CANDIDATE_${i}_FIRST_SEEN_ON_CASE` };
    }
  }

  return { ok: true, code: "OK" };
}

// ---------------------------------------------------------------------------
// verifyDiscovered — full verify: shape + Ed25519 signature
// ---------------------------------------------------------------------------

/**
 * Validates the shape and verifies the Ed25519 signature of a discovered artifact.
 *
 * Pubkey-injection seam: callers (especially tests) may pass { pubKeyB64 } to
 * override the default production key from crawler-pubkey.txt. This allows the
 * test suite to use ephemeral fixture keys without the production private key.
 *
 * Pubkey wrapping: the stored key is a raw 32-byte Ed25519 pubkey (base64-encoded).
 * node:crypto requires a KeyObject from DER SPKI format. We prepend the fixed
 * 12-byte DER SPKI prefix and call createPublicKey({ key, format:'der', type:'spki' }).
 *
 * @param {object} obj - Parsed artifact object.
 * @param {{ pubKeyB64?: string }} [options] - Optional pubkey injection for tests.
 * @returns {{ ok: boolean, code: string }}
 */
export function verifyDiscovered(obj, { pubKeyB64 } = {}) {
  // Shape must be valid before we attempt crypto.
  const shapeResult = validateDiscoveredShape(obj);
  if (!shapeResult.ok) {
    return shapeResult;
  }

  // Resolve the public key: injected (tests) or read from disk (production).
  let resolvedPubKeyB64 = pubKeyB64;
  if (!resolvedPubKeyB64) {
    try {
      const keyFileContent = readFileSync(DEFAULT_PUBKEY_PATH, "utf8");
      // Skip comment lines (lines starting with #) and blank lines.
      const keyLine = keyFileContent
        .split("\n")
        .map(line => line.trim())
        .find(line => line.length > 0 && !line.startsWith("#"));
      if (!keyLine) {
        return { ok: false, code: "ERR_PUBKEY_NOT_FOUND" };
      }
      resolvedPubKeyB64 = keyLine;
    } catch {
      return { ok: false, code: "ERR_PUBKEY_READ_FAILED" };
    }
  }

  // Wrap the raw 32-byte key in DER SPKI format and create a KeyObject.
  let keyObject;
  try {
    const raw32 = Buffer.from(resolvedPubKeyB64, "base64");
    if (raw32.length !== 32) {
      return { ok: false, code: "ERR_PUBKEY_SIZE" };
    }
    const derKey = Buffer.concat([DER_SPKI_PREFIX, raw32]);
    keyObject = createPublicKey({ key: derKey, format: "der", type: "spki" });
  } catch {
    return { ok: false, code: "ERR_PUBKEY_INVALID" };
  }

  // Produce the canonical signed message and verify.
  let verified = false;
  try {
    const canonical = canonicalDiscovered(obj);
    const msgBytes = Buffer.from(canonical, "utf8");
    const sigBytes = Buffer.from(obj.signature, "hex");
    verified = cryptoVerify(null, msgBytes, keyObject, sigBytes);
  } catch {
    return { ok: false, code: "ERR_VERIFY_EXCEPTION" };
  }

  if (!verified) {
    return { ok: false, code: "ERR_SIGNATURE_INVALID" };
  }

  return { ok: true, code: "OK" };
}

// ---------------------------------------------------------------------------
// CLI mode — iterate discovered/*.json, validate + verify each
// ---------------------------------------------------------------------------

/**
 * CLI entry point. Run as `node tools/rule-ingestion/discovered-verify.mjs`.
 * Iterates every discovered/*.json file, validates shape and verifies signature.
 * Exits with code 0 on success, non-zero on any failure (fail-closed).
 */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const discoveredDir = join(__dirname, "../../discovered");
  let files;

  try {
    files = readdirSync(discoveredDir).filter(f => f.endsWith(".json"));
  } catch (err) {
    process.stderr.write(`[discovered-verify] Cannot read discovered/ directory: ${err.message}\n`);
    process.exit(1);
  }

  if (files.length === 0) {
    // No artifacts to verify — clean exit (workflow runs on path triggers,
    // so this branch occurs only when discovered/ has no .json files yet).
    process.stdout.write("[discovered-verify] No artifacts found in discovered/. Nothing to verify.\n");
    process.exit(0);
  }

  let allOk = true;

  for (const file of files) {
    const filePath = join(discoveredDir, file);
    let artifact;

    try {
      artifact = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (err) {
      process.stderr.write(`[discovered-verify] FAIL ${file}: JSON parse error — ${err.message}\n`);
      allOk = false;
      continue;
    }

    const result = verifyDiscovered(artifact);
    if (result.ok) {
      process.stdout.write(`[discovered-verify] OK   ${file}\n`);
    } else {
      process.stderr.write(`[discovered-verify] FAIL ${file}: ${result.code}\n`);
      allOk = false;
    }
  }

  process.exit(allOk ? 0 : 1);
}
