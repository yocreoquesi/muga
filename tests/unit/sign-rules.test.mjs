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
const REPO_ROOT = join(__dirname, "..", "..");

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

// ---------------------------------------------------------------------------
// #1221 slice 1 — the scoped section and its own signature
// ---------------------------------------------------------------------------
describe("sign-rules.mjs scoped facts (#1221)", () => {
  test("emits scoped + scopedSig, and leaves the base sig BYTE-IDENTICAL", () => {
    // The backward-compatibility proof, and the reason `sig` is not extended:
    // a payload signed over an extended canonical fails verification on every
    // currently deployed version, which would stop them receiving even the
    // global rules they get today. Same version/published/params in and out,
    // so the base signature must not move at all.
    const version = 1;
    const published = new Date().toISOString();
    const params = ["utm_scoped_signing"];

    const withoutScoped = runScript({
      sourceContent: JSON.stringify({ version, published, params }),
    });
    assert.strictEqual(withoutScoped.status, 0, withoutScoped.stderr);
    const plain = JSON.parse(readFileSync(tmpOutputFile, "utf8"));

    const withScoped = runScript({
      sourceContent: JSON.stringify({
        version,
        published,
        params,
        scoped: [{ param: "si", hosts: ["youtube.com"] }],
      }),
    });
    assert.strictEqual(withScoped.status, 0, withScoped.stderr);
    const scopedOut = JSON.parse(readFileSync(tmpOutputFile, "utf8"));

    assert.strictEqual(
      scopedOut.sig,
      plain.sig,
      "adding a scoped section must not change the base signature by a single byte"
    );
    assert.ok(typeof scopedOut.scopedSig === "string" && scopedOut.scopedSig.length > 0);
    assert.deepStrictEqual(scopedOut.scoped, [{ param: "si", hosts: ["youtube.com"] }]);
  });

  test("refuses an affiliate param at ANY scope", () => {
    const result = runScript({
      sourceContent: JSON.stringify({
        version: 1,
        published: new Date().toISOString(),
        params: ["utm_ok"],
        scoped: [{ param: "tag", hosts: ["example.com"] }],
      }),
    });

    assert.strictEqual(result.status, 1, `Expected exit 1. stderr: ${result.stderr}`);
    assert.ok(/AFFILIATE_PARAM_GUARD/.test(result.stderr));
  });

  test("refuses a scoped fact that collides with that host's preserveParams, via suffix", () => {
    // youtube.com preserves search_query; domain-rules is matched by hostname
    // SUFFIX, so naming the subdomain must not slip past the same protection.
    const result = runScript({
      sourceContent: JSON.stringify({
        version: 1,
        published: new Date().toISOString(),
        params: ["utm_ok"],
        scoped: [{ param: "search_query", hosts: ["www.youtube.com"] }],
      }),
    });

    assert.strictEqual(result.status, 1, `Expected exit 1. stderr: ${result.stderr}`);
    assert.ok(/preserveParams/.test(result.stderr));
    assert.ok(/www\.youtube\.com/.test(result.stderr), "the refusal must name the offending host");
  });

  test("refuses a scoped fact with no host — a fact with no scope is a global claim", () => {
    const result = runScript({
      sourceContent: JSON.stringify({
        version: 1,
        published: new Date().toISOString(),
        params: ["utm_ok"],
        scoped: [{ param: "si", hosts: [] }],
      }),
    });
    assert.strictEqual(result.status, 1, `Expected exit 1. stderr: ${result.stderr}`);
    assert.ok(/at least one host/.test(result.stderr));
  });

  test("a short name IS allowed when scoped", () => {
    // MIN_PARAM_LEN guards the global path, where a two-character name applies
    // to the whole web. Anchored to one host it is just a correct rule (#1229).
    const result = runScript({
      sourceContent: JSON.stringify({
        version: 1,
        published: new Date().toISOString(),
        params: ["utm_ok"],
        scoped: [{ param: "si", hosts: ["youtube.com"] }],
      }),
    });
    assert.strictEqual(result.status, 0, `Expected exit 0. stderr: ${result.stderr}`);
  });
});

// ---------------------------------------------------------------------------
// The preserve guard vs. the built-ins (#1221)
//
// The guard added with the scoped channel refuses to publish a param some host
// declares in preserveParams — publishing it would strip the very param that
// host's entry exists to protect, which is #1212's failure class reached
// through the signed channel.
//
// Asked of EVERY name, it also refused three the channel cannot apply. The
// runtime runs `filterAgainstBuiltin` BEFORE `filterAgainstPreserved`, so a
// param the extension already ships is removed from the remote list before the
// preserve filter ever sees it. `utm_source` and `utm_medium` are both
// built-ins that some host declares, so the guard as first written could not
// sign the committed source at all, and the publish workflow — which runs on
// every push touching tools/rules-source/** — would have failed on the next one.
// ---------------------------------------------------------------------------

describe("sign-rules.mjs preserve guard vs. built-ins (#1221)", () => {
  test("the COMMITTED rules source can actually be signed", () => {
    // The regression test the defect needed and did not have. Every other test
    // here signs a fixture, so all of them passed while the one file the
    // workflow actually signs was unsignable.
    const result = runScript({
      sourceFile: join(REPO_ROOT, "tools", "rules-source", "params.json"),
    });

    assert.strictEqual(
      result.status,
      0,
      `the committed source must be signable — the publish workflow signs exactly this file.\n${result.stderr}`
    );
  });

  test("signing the committed source reproduces the published params exactly", () => {
    // The fix must restore the ability to sign WITHOUT changing what users get.
    // A signer that passed by quietly dropping params would satisfy the test
    // above and be far worse than the failure it replaced.
    runScript({ sourceFile: join(REPO_ROOT, "tools", "rules-source", "params.json") });

    const signed = JSON.parse(readFileSync(tmpOutputFile, "utf8"));
    const published = JSON.parse(
      readFileSync(join(REPO_ROOT, "docs", "rules", "v1", "params.json"), "utf8")
    );

    // The load-bearing half: signing must not silently drop params. A signer
    // that "passed" by discarding the offending ones would satisfy the
    // signability test above and be far worse than the failure it replaced.
    //
    // Compared against the SOURCE, not the published file. That is both
    // stronger and actually checkable. It is the signer's own behaviour under
    // test here, and the source is its input; the published file is a snapshot
    // of some earlier input and says nothing about whether this signer drops
    // anything.
    const source = JSON.parse(
      readFileSync(join(REPO_ROOT, "tools", "rules-source", "params.json"), "utf8")
    );
    assert.deepStrictEqual(
      signed.params,
      source.params,
      "the signer dropped or reordered params from its own input, which is the exact " +
        "failure mode a signability-only test would let through"
    );

    // NOT equality: the source legitimately runs AHEAD of the published file
    // whenever a version bump is committed and waiting to publish. Monotonicity
    // is the actual invariant — the runtime rejects VERSION_REGRESSION.
    assert.ok(
      signed.version >= published.version,
      `source version ${signed.version} must not regress below published ${published.version}`
    );

    // #1326: this used to compare `signed.params` against the PUBLISHED params
    // unconditionally, which made the pending-publish state the comment above
    // describes impossible to reach. A version bump exists precisely because
    // the params changed, so "a bump committed and waiting to publish" always
    // carries a params delta too. Tolerating the version while forbidding the
    // delta contradicted itself, and it fired on the change that removed 31
    // path-anchor-only params from the channel.
    //
    // What is still worth pinning: params must NOT move without a bump, or an
    // installed build rejects the payload as VERSION_REGRESSION and silently
    // keeps the old rules.
    if (signed.version === published.version) {
      assert.deepStrictEqual(
        signed.params,
        published.params,
        "the source params changed without a version bump, so every installed build would " +
          "reject the republished payload and keep the old list"
      );
    }
  });

  test("a built-in that some host preserves is allowed through", () => {
    // utm_source is the exact shape: a built-in, and in glavnoe.life's
    // preserveParams. Inert on this channel either way.
    const result = runScript({
      sourceContent: JSON.stringify({
        version: 1,
        published: new Date().toISOString(),
        params: ["utm_source"],
      }),
    });

    assert.strictEqual(result.status, 0, result.stderr);
    assert.deepStrictEqual(JSON.parse(readFileSync(tmpOutputFile, "utf8")).params, ["utm_source"]);
  });

  test("a NON-built-in that some host preserves is still refused", () => {
    // The guard is narrowed, not removed. `field-keywords` is Amazon's search
    // field and not a built-in, so publishing it globally would strip it on the
    // host whose entry exists to protect it — which is the whole point.
    const result = runScript({
      sourceContent: JSON.stringify({
        version: 1,
        published: new Date().toISOString(),
        params: ["field-keywords"],
      }),
    });

    assert.strictEqual(result.status, 1);
    assert.match(result.stderr, /preserveParams/);
  });
});
