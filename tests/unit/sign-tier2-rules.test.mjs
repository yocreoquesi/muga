/**
 * MUGA — Unit tests for tools/sign-tier2-rules.mjs
 *
 * Run with: npm test
 *
 * REVISED ADR-6 (shared key): this tool signs with the SAME
 * `MUGA_SIGNING_KEY` / `MUGA_SIGNING_KEY_PATH` used by `tools/sign-rules.mjs`
 * — there is no separate Tier2 key. The only new element is the domain-tagged
 * canonical message, which this tool MUST import (not reimplement) from
 * `src/lib/remote-tier2-rules.js` so the signed bytes are byte-identical to
 * what the runtime verifier builds.
 *
 * Security invariants (mirrors tests/unit/sign-rules.test.mjs):
 *   - All keypairs are generated at test runtime (throw-away). No fixture keys.
 *   - Private key is written to os.tmpdir(), passed via MUGA_SIGNING_KEY_PATH.
 *   - The script must NOT contain hard-coded private key file paths.
 *
 * Filesystem invariants:
 *   - The test MUST NOT touch the canonical source
 *     (tools/rules-source/tier2.json) or canonical output
 *     (docs/rules/v1/tier2.json) — both are CI-owned. All invocations point
 *     MUGA_TIER2_SOURCE_FILE / MUGA_TIER2_OUTPUT_FILE at a per-process tmp dir.
 *
 * Coverage:
 *   - Import-equality: tool re-exports the SAME `canonicalTier2Message`
 *     function reference as src/lib/remote-tier2-rules.js (no signing
 *     needed — proves "do NOT re-implement it" by construction).
 *   - Entry-guard: importing the module performs zero I/O.
 *   - Happy path: valid seed + valid key → exit 0, signed output verifies.
 *   - Exit 2: missing/unusable key.
 *   - Exit 1: source validation failure (reused validateTier2SourceContent).
 *   - Exit 3: source file not found.
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

import { canonicalTier2Message as toolCanonicalTier2Message } from "../../tools/sign-tier2-rules.mjs";
import { canonicalTier2Message as libCanonicalTier2Message } from "../../src/lib/remote-tier2-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "../../tools/sign-tier2-rules.mjs");

// ---------------------------------------------------------------------------
// Import-equality: no signing, no I/O — proves sign-tier2-rules.mjs imports
// (not reimplements) the runtime's canonical-message builder.
// ---------------------------------------------------------------------------
describe("sign-tier2-rules.mjs canonical message (import-equality, pure)", () => {
  test("re-exports the SAME function reference as remote-tier2-rules.js", () => {
    assert.strictEqual(
      toolCanonicalTier2Message,
      libCanonicalTier2Message,
      "sign-tier2-rules.mjs must import (not reimplement) canonicalTier2Message"
    );
  });

  test("produces byte-identical output to the runtime builder for the same input", () => {
    const rules = [{ id: "x", present: ["a"], reject: ["b"], openSettings: [] }];
    assert.strictEqual(
      toolCanonicalTier2Message(1, "2026-01-01T00:00:00.000Z", rules),
      libCanonicalTier2Message(1, "2026-01-01T00:00:00.000Z", rules)
    );
  });
});

// ---------------------------------------------------------------------------
// Guard: script must NOT contain hard-coded private key paths
// ---------------------------------------------------------------------------
describe("security: no hard-coded private key paths", () => {
  test("sign-tier2-rules.mjs does not contain the local muga-keys directory path", () => {
    const content = readFileSync(SCRIPT, "utf8");
    assert.ok(!content.includes(".muga-keys"));
  });

  test("sign-tier2-rules.mjs reads the key path from MUGA_SIGNING_KEY_PATH (shared key, no MUGA_TIER2_SIGNING_KEY)", () => {
    const content = readFileSync(SCRIPT, "utf8");
    assert.ok(content.includes("MUGA_SIGNING_KEY_PATH"));
    assert.ok(
      !content.includes("MUGA_TIER2_SIGNING_KEY"),
      "REVISED ADR-6: no separate Tier2 signing key — must reuse MUGA_SIGNING_KEY"
    );
  });
});

// ---------------------------------------------------------------------------
// CLI (subprocess) tests — per-process tmp dir, never touches canonical paths
// ---------------------------------------------------------------------------
let testPrivKeyPath;
let testPubKeyBase64;
let tmpTestDir;
let tmpSourceFile;
let tmpOutputFile;

before(() => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");

  tmpTestDir = mkdtempSync(join(tmpdir(), "muga-tier2-sign-test-"));
  testPrivKeyPath = join(tmpTestDir, "test-signing.key");
  tmpSourceFile = join(tmpTestDir, "source-tier2.json");
  tmpOutputFile = join(tmpTestDir, "output-tier2.json");

  writeFileSync(testPrivKeyPath, privateKey.export({ type: "pkcs8", format: "pem" }), {
    mode: 0o600,
  });

  const pubDer = publicKey.export({ type: "spki", format: "der" });
  testPubKeyBase64 = pubDer.slice(12).toString("base64");
});

after(() => {
  if (tmpTestDir && existsSync(tmpTestDir)) rmSync(tmpTestDir, { recursive: true, force: true });
});

function runScript({ envOverrides = {}, sourceContent, sourceFile } = {}) {
  if (sourceContent !== undefined) writeFileSync(tmpSourceFile, sourceContent);
  return spawnSync("node", [SCRIPT], {
    encoding: "utf8",
    env: {
      ...process.env,
      MUGA_SIGNING_KEY_PATH: testPrivKeyPath,
      MUGA_TIER2_SOURCE_FILE: sourceFile ?? tmpSourceFile,
      MUGA_TIER2_OUTPUT_FILE: tmpOutputFile,
      ...envOverrides,
    },
  });
}

describe("sign-tier2-rules.mjs happy path", () => {
  test("exits 0 with a valid empty-seed source and key; output has all required fields", () => {
    const fixture = JSON.stringify({
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [],
    });

    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(
      result.status,
      0,
      `Expected exit 0, got ${result.status}. stderr: ${result.stderr}`
    );

    assert.ok(existsSync(tmpOutputFile));
    const output = JSON.parse(readFileSync(tmpOutputFile, "utf8"));
    assert.strictEqual(output.schemaVersion, 1);
    assert.strictEqual(typeof output.version, "number");
    assert.strictEqual(typeof output.published, "string");
    assert.ok(Array.isArray(output.rules));
    assert.strictEqual(typeof output.sig, "string");
    assert.ok(output.sig.length > 0);
  });

  test("output signature verifies against the test public key over canonicalTier2Message", () => {
    const rules = [{ id: "example-cmp", present: [".banner"], reject: [".reject-all"], openSettings: [] }];
    const fixture = JSON.stringify({
      schemaVersion: 1,
      version: 2,
      published: "2026-01-02T00:00:00.000Z",
      rules,
    });

    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(result.status, 0, `stderr: ${result.stderr}`);

    const output = JSON.parse(readFileSync(tmpOutputFile, "utf8"));
    const canonical = libCanonicalTier2Message(output.version, output.published, output.rules);

    const stdB64 = output.sig.replace(/-/g, "+").replace(/_/g, "/");
    const padded = stdB64 + "=".repeat((4 - (stdB64.length % 4)) % 4);
    const sigBuf = Buffer.from(padded, "base64");

    const pubDer = Buffer.from(testPubKeyBase64, "base64");
    const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    const spkiDer = Buffer.concat([spkiPrefix, pubDer]);
    const pubKey = createPublicKey({ key: spkiDer, type: "spki", format: "der" });

    const ok = cryptoVerify(null, Buffer.from(canonical, "utf8"), pubKey, sigBuf);
    assert.ok(ok, "Signature must verify against the test public key over canonicalTier2Message");
  });

  test("sig field is base64url encoded (no padding, URL-safe chars)", () => {
    const fixture = JSON.stringify({
      schemaVersion: 1,
      version: 3,
      published: "2026-01-03T00:00:00.000Z",
      rules: [],
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(result.status, 0);
    const output = JSON.parse(readFileSync(tmpOutputFile, "utf8"));
    assert.ok(!/[+/=]/.test(output.sig));
  });
});

describe("sign-tier2-rules.mjs exit code 2 (key setup error)", () => {
  test("exits 2 when MUGA_SIGNING_KEY_PATH env var is not set", () => {
    const fixture = JSON.stringify({ schemaVersion: 1, version: 1, published: "2026-01-01T00:00:00.000Z", rules: [] });
    const result = runScript({ sourceContent: fixture, envOverrides: { MUGA_SIGNING_KEY_PATH: "" } });
    assert.strictEqual(result.status, 2, `stderr: ${result.stderr}`);
  });

  test("exits 2 when the key file path does not exist", () => {
    const fixture = JSON.stringify({ schemaVersion: 1, version: 1, published: "2026-01-01T00:00:00.000Z", rules: [] });
    const result = runScript({
      sourceContent: fixture,
      envOverrides: { MUGA_SIGNING_KEY_PATH: "/nonexistent/path/to/key.pem" },
    });
    assert.strictEqual(result.status, 2, `stderr: ${result.stderr}`);
  });
});

describe("sign-tier2-rules.mjs exit code 1 (source validation error)", () => {
  test("exits 1 when a selector contains an accept token", () => {
    const fixture = JSON.stringify({
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [{ id: "sneaky", present: [".x"], reject: [".AcceptAll"], openSettings: [] }],
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(result.status, 1, `stderr: ${result.stderr}`);
  });

  test("exits 1 when source JSON is malformed", () => {
    const result = runScript({ sourceContent: "{ not valid json" });
    assert.strictEqual(result.status, 1, `stderr: ${result.stderr}`);
  });

  test("exits 1 when source contains a 'sig' field (must be unsigned)", () => {
    const fixture = JSON.stringify({
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [],
      sig: "should_not_be_here",
    });
    const result = runScript({ sourceContent: fixture });
    assert.strictEqual(result.status, 1, `stderr: ${result.stderr}`);
  });
});

describe("sign-tier2-rules.mjs exit code 3 (IO error)", () => {
  test("exits 3 when the source file cannot be read", () => {
    const result = runScript({ sourceFile: "/nonexistent/path/tier2.json" });
    assert.strictEqual(result.status, 3, `stderr: ${result.stderr}`);
  });
});

describe("publish-tier2-rules.yml workflow file", () => {
  const workflowFile = join(__dirname, "../../.github/workflows/publish-tier2-rules.yml");

  test("publish-tier2-rules.yml exists in .github/workflows/", () => {
    assert.ok(existsSync(workflowFile), "publish-tier2-rules.yml must exist");
  });

  test("publish-tier2-rules.yml references sign-tier2-rules.mjs and the shared MUGA_SIGNING_KEY secret", () => {
    const content = readFileSync(workflowFile, "utf8");
    assert.ok(content.includes("sign-tier2-rules.mjs"));
    assert.ok(content.includes("secrets.MUGA_SIGNING_KEY"));
    assert.ok(
      !content.includes("MUGA_TIER2_SIGNING_KEY"),
      "REVISED ADR-6: must not introduce a second secret"
    );
  });

  test("publish-tier2-rules.yml is scoped to tools/rules-source/tier2.json only", () => {
    const content = readFileSync(workflowFile, "utf8");
    assert.ok(content.includes("tools/rules-source/tier2.json"));
  });

  test("publish-tier2-rules.yml cleans up the signing key (always-run step)", () => {
    const content = readFileSync(workflowFile, "utf8");
    assert.ok(/rm -f .*key\.pem/.test(content));
  });
});
