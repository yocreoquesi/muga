/**
 * MUGA — Unit tests for tools/sign-rules.mjs
 *
 * Run with: npm test
 *
 * Security invariants:
 *   - All keypairs are generated at test runtime (throw-away). No fixture keys.
 *   - Private key is written to os.tmpdir(), passed via MUGA_SIGNING_KEY_PATH env var.
 *   - The script must NOT contain hard-coded private key file paths.
 *
 * Filesystem invariants:
 *   - The test MUST NOT touch the canonical source (`tools/rules-source/params.json`)
 *     or the canonical output (`docs/rules/v1/params.json`). Both are CI-owned;
 *     `docs/rules/v1/params.json` is auto-committed by `.github/workflows/publish-rules.yml`.
 *   - All script invocations point MUGA_SOURCE_FILE and MUGA_OUTPUT_FILE at
 *     a per-process tmp dir. Running `npm test` therefore leaves the working
 *     tree clean.
 *
 * Coverage (T6.1):
 *   - Happy path: valid source + valid key → exit 0, signed output with valid sig
 *   - Missing MUGA_SIGNING_KEY_PATH → exit 2
 *   - Malformed source JSON (missing field) → exit 1
 *   - Malformed source (non-integer version) → exit 1
 *   - No private key path check — tool does NOT accept key path as CLI arg
 *   - Source file not found (IO error) → exit 3
 *   - Script does NOT hard-code any private key file system path
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  generateKeyPairSync,
  createPublicKey,
  verify as cryptoVerify,
} from "node:crypto";
import {
  writeFileSync,
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "../../tools/sign-rules.mjs");

// ---------------------------------------------------------------------------
// Test-only keypair — generated ONCE per test run, thrown away after.
// NEVER commit a real signing key.
// ---------------------------------------------------------------------------
let testPrivKeyPath;
let testPubKeyBase64;
let tmpTestDir;
let tmpSourceFile;
let tmpOutputFile;

before(() => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  // Per-process tmp dir: holds the throw-away private key, the source fixture
  // we'll feed to the script via MUGA_SOURCE_FILE, and the signed output the
  // script will write via MUGA_OUTPUT_FILE. Keeping all three out of the
  // working tree is what makes `npm test` non-destructive on a feature branch.
  tmpTestDir = mkdtempSync(join(tmpdir(), "muga-sign-test-"));
  testPrivKeyPath = join(tmpTestDir, "test-signing.key");
  tmpSourceFile = join(tmpTestDir, "source-params.json");
  tmpOutputFile = join(tmpTestDir, "output-params.json");

  writeFileSync(testPrivKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });

  // Export raw public key as base64 (standard, with padding)
  // Ed25519 SPKI DER is 44 bytes: 12-byte header + 32-byte raw key
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  testPubKeyBase64 = pubDer.slice(12).toString("base64");
});

after(() => {
  if (tmpTestDir && existsSync(tmpTestDir)) {
    rmSync(tmpTestDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helper: write a source params.json fixture into the tmp dir and run the
// script with MUGA_SOURCE_FILE / MUGA_OUTPUT_FILE pointed at that dir.
// `sourceFile` (when provided) overrides MUGA_SOURCE_FILE without writing a
// fixture — used by the IO-error test that needs to point at a missing path.
// ---------------------------------------------------------------------------
function runScript({ envOverrides = {}, sourceContent, sourceFile } = {}) {
  if (sourceContent !== undefined) {
    writeFileSync(tmpSourceFile, sourceContent);
  }
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      MUGA_SIGNING_KEY_PATH: testPrivKeyPath,
      MUGA_SOURCE_FILE: sourceFile ?? tmpSourceFile,
      MUGA_OUTPUT_FILE: tmpOutputFile,
      ...envOverrides,
    },
  });
}

// ---------------------------------------------------------------------------
// Guard: script must NOT contain hard-coded private key paths
// ---------------------------------------------------------------------------
describe("security: no hard-coded private key paths", () => {
  test("sign-rules.mjs does not contain the local muga-keys directory path", () => {
    const content = readFileSync(SCRIPT, "utf8");
    // Check for the forbidden local key path pattern
    assert.ok(
      !content.includes(".muga-keys"),
      "sign-rules.mjs must not contain '.muga-keys' — private key path must come from env only"
    );
  });

  test("sign-rules.mjs does not accept key material as a CLI argument", () => {
    const content = readFileSync(SCRIPT, "utf8");
    // The script must use env var, not process.argv for the key path
    assert.ok(
      content.includes("MUGA_SIGNING_KEY_PATH"),
      "sign-rules.mjs must read the key path from MUGA_SIGNING_KEY_PATH env var"
    );
  });
});

// ---------------------------------------------------------------------------
// T6.1 — Happy path
// ---------------------------------------------------------------------------
describe("sign-rules.mjs happy path", () => {
  test("exits 0 with a valid source and key, and output has all required fields", () => {
    const now = new Date().toISOString();
    const fixture = JSON.stringify({
      version: 1,
      published: now,
      params: ["utm_custom_1", "muga_test_x"],
    });

    const result = runScript({ sourceContent: fixture });

    assert.strictEqual(
      result.status,
      0,
      `Expected exit 0 but got ${result.status}. stderr: ${result.stderr}`
    );

    // Read the output file (written to the tmp dir, NOT the canonical path)
    assert.ok(existsSync(tmpOutputFile), "Output file must exist in tmp dir after signing");

    const output = JSON.parse(readFileSync(tmpOutputFile, "utf8"));
    assert.strictEqual(typeof output.version, "number");
    assert.strictEqual(typeof output.published, "string");
    assert.ok(Array.isArray(output.params));
    assert.strictEqual(typeof output.sig, "string");
    assert.ok(output.sig.length > 0, "sig field must not be empty");
  });

  test("output signature verifies against the test public key", () => {
    const now = new Date().toISOString();
    const params = ["utm_verify_test"];
    const version = 2;
    const fixture = JSON.stringify({ version, published: now, params });

    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(result.status, 0);

    const output = JSON.parse(readFileSync(tmpOutputFile, "utf8"));

    // Reconstruct canonical message per REQ-VERIFY-3
    const canonical = `${output.version}|${output.published}|${output.params.join(",")}`;

    // Decode base64url sig to buffer
    const stdB64 = output.sig
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = stdB64 + "=".repeat((4 - stdB64.length % 4) % 4);
    const sigBuf = Buffer.from(padded, "base64");

    // Verify using the test public key
    const pubDer = Buffer.from(testPubKeyBase64, "base64");
    // Re-import from raw bytes (SPKI prefix for Ed25519)
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const spkiDer = Buffer.concat([spkiPrefix, pubDer]);
    const pubKey = createPublicKey({ key: spkiDer, type: "spki", format: "der" });

    // Node crypto.verify for Ed25519 (null algorithm)
    const ok = cryptoVerify(null, Buffer.from(canonical, "utf8"), pubKey, sigBuf);
    assert.ok(ok, "Signature must verify against the test public key");
  });

  test("sig field is base64url encoded (no padding, URL-safe chars)", () => {
    const now = new Date().toISOString();
    const fixture = JSON.stringify({ version: 3, published: now, params: ["utm_b64url"] });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(result.status, 0);

    const output = JSON.parse(readFileSync(tmpOutputFile, "utf8"));
    // base64url must not contain +, /, or = padding
    assert.ok(!/[+/=]/.test(output.sig), "sig must be base64url (no +, /, or = chars)");
  });
});

// ---------------------------------------------------------------------------
// T6.1 — Exit code 2: missing or unusable key
// ---------------------------------------------------------------------------
describe("sign-rules.mjs exit code 2 (key setup error)", () => {
  test("exits 2 when MUGA_SIGNING_KEY_PATH env var is not set", () => {
    const now = new Date().toISOString();
    const fixture = JSON.stringify({ version: 1, published: now, params: ["utm_x"] });
    const result = runScript({
      sourceContent: fixture,
      envOverrides: { MUGA_SIGNING_KEY_PATH: "" },
    });
    assert.strictEqual(
      result.status,
      2,
      `Expected exit 2, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 2 when the key file path does not exist", () => {
    const now = new Date().toISOString();
    const fixture = JSON.stringify({ version: 1, published: now, params: ["utm_x"] });
    const result = runScript({
      sourceContent: fixture,
      envOverrides: { MUGA_SIGNING_KEY_PATH: "/nonexistent/path/to/key.pem" },
    });
    assert.strictEqual(
      result.status,
      2,
      `Expected exit 2, got ${result.status}. stderr: ${result.stderr}`
    );
  });
});

// ---------------------------------------------------------------------------
// T6.1 — Exit code 1: validation error in source
// ---------------------------------------------------------------------------
describe("sign-rules.mjs exit code 1 (source validation error)", () => {
  test("exits 1 when source is missing 'version' field", () => {
    const fixture = JSON.stringify({
      published: new Date().toISOString(),
      params: ["utm_x"],
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 when version is not an integer", () => {
    const fixture = JSON.stringify({
      version: "one",
      published: new Date().toISOString(),
      params: ["utm_x"],
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 when source is missing 'published' field", () => {
    const fixture = JSON.stringify({ version: 1, params: ["utm_x"] });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 when source is missing 'params' field", () => {
    const fixture = JSON.stringify({
      version: 1,
      published: new Date().toISOString(),
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 when a param fails the format regex", () => {
    const fixture = JSON.stringify({
      version: 1,
      published: new Date().toISOString(),
      params: ["bad param!"],
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 when a param is in the denylist", () => {
    const fixture = JSON.stringify({
      version: 1,
      published: new Date().toISOString(),
      params: ["id"],
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 when source JSON is malformed (parse error)", () => {
    const result = runScript({ sourceContent: "{ this is not valid json" });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 when source contains 'sig' field (source must be unsigned)", () => {
    const fixture = JSON.stringify({
      version: 1,
      published: new Date().toISOString(),
      params: ["utm_x"],
      sig: "should_not_be_here",
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
  });
});

// ---------------------------------------------------------------------------
// T6.1 — Exit code 3: IO error (non-existent source file)
// ---------------------------------------------------------------------------
describe("sign-rules.mjs exit code 3 (IO error)", () => {
  test("exits 3 when the source file cannot be read", () => {
    // Point MUGA_SOURCE_FILE at a path that does not exist. runScript also
    // sets MUGA_OUTPUT_FILE to the tmp dir defensively, so even if the
    // script ever reordered its checks the canonical output path stays clean.
    const result = runScript({ sourceFile: "/nonexistent/path/params.json" });
    assert.strictEqual(
      result.status,
      3,
      `Expected exit 3, got ${result.status}. stderr: ${result.stderr}`
    );
  });
});

// ---------------------------------------------------------------------------
// #1221 — refuse to publish a param some host declares in preserveParams
// ---------------------------------------------------------------------------
//
// The global payload has no way to say WHERE a param applies, so publishing a
// name a host protects strips it on exactly the hosts whose domain-rules entry
// exists to keep it. This is the publication gate: a hit here means someone is
// about to ship a mistake, so it refuses outright rather than filtering.
describe("sign-rules.mjs preserveParams guard (#1221)", () => {
  test("exits 1 when a param is declared in some host's preserveParams", async () => {
    const { PRESERVED_PARAMS } = await import("../../src/rules/preserve-params.data.js");
    // Taken from the real generated set rather than invented, so the test fails
    // if the guard stops reading the artifact the extension actually ships.
    const preserved = PRESERVED_PARAMS.find((p) => p.length >= 3 && /^[a-z0-9_.-]+$/.test(p));
    assert.ok(preserved, "the generated guard set must contain a publishable-shaped name");

    const fixture = JSON.stringify({
      version: 1,
      published: new Date().toISOString(),
      params: ["utm_fine", preserved],
    });

    const result = runScript({ sourceContent: fixture });

    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1, got ${result.status}. stderr: ${result.stderr}`
    );
    assert.ok(
      result.stderr.includes(preserved),
      "the refusal must name the offending param"
    );
    assert.ok(
      /preserveParams/.test(result.stderr),
      "the refusal must say WHY, so the fix is obvious without reading the source"
    );
  });

  test("a param no host preserves still signs cleanly", async () => {
    const { PRESERVED_PARAMS } = await import("../../src/rules/preserve-params.data.js");
    const preserved = new Set(PRESERVED_PARAMS.map((p) => p.toLowerCase()));
    assert.ok(!preserved.has("utm_fine"), "fixture param must not be in the guard set");

    const fixture = JSON.stringify({
      version: 1,
      published: new Date().toISOString(),
      params: ["utm_fine"],
    });

    const result = runScript({ sourceContent: fixture });

    assert.strictEqual(
      result.status,
      0,
      `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`
    );
  });
});
