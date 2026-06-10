/**
 * MUGA — strip-test-seams unit tests (#827)
 *
 * Tests the rewriteTestFixtures() and neutraliseTrustedKeysSeam()
 * functions exported by tools/strip-test-seams.mjs.
 *
 * These functions are the core of the build-time test/production boundary
 * enforcer.  They must:
 *
 *   rewriteTestFixtures():
 *     - Return source that exports getTestFixtures as an async function
 *     - Return null (not throw, not return undefined)
 *     - Contain NO references to __muga_test_mode or __muga_test_fixtures
 *     - Contain NO references to chrome.storage
 *     - Accept any original content without crashing
 *
 *   neutraliseTrustedKeysSeam():
 *     - Remove the globalThis.__MUGA_TRUSTED_KEYS__ conditional when present
 *     - Leave TRUSTED_PUBLIC_KEYS as the sole key source after patching
 *     - Return patched: true when the seam was found
 *     - Return the content unchanged and patched: false when the seam is absent
 *
 * Run with: npm test
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..", "..");

// Import the exported rewriter functions.
// Use pathToFileURL so Windows absolute paths are valid ESM URLs.
const stripSeamsUrl = pathToFileURL(resolve(ROOT, "tools/strip-test-seams.mjs")).href;
const { rewriteTestFixtures, neutraliseTrustedKeysSeam } = await import(stripSeamsUrl);

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Dynamically evaluate the stub in a sandboxed module-like context. */
async function evalStub(stubSource) {
  // Wrap in a data URL so Node can parse the ESM export.
  const b64 = Buffer.from(stubSource).toString("base64");
  return await import(`data:text/javascript;base64,${b64}`);
}

// ── rewriteTestFixtures ───────────────────────────────────────────────────────

describe("rewriteTestFixtures — output structure", () => {
  const ORIGINAL = readFileSync(
    join(ROOT, "src", "lib", "test-fixtures.js"),
    "utf8"
  );

  test("stub exports getTestFixtures as a named export", async () => {
    const stub = rewriteTestFixtures(ORIGINAL);
    const mod  = await evalStub(stub);
    assert.ok("getTestFixtures" in mod, "stub must export getTestFixtures");
  });

  test("getTestFixtures is an async function", async () => {
    const stub = rewriteTestFixtures(ORIGINAL);
    const mod  = await evalStub(stub);
    assert.equal(
      typeof mod.getTestFixtures,
      "function",
      "getTestFixtures must be a function"
    );
    const result = mod.getTestFixtures();
    assert.ok(
      result instanceof Promise,
      "getTestFixtures() must return a Promise (async function)"
    );
  });

  test("getTestFixtures() resolves to null", async () => {
    const stub = rewriteTestFixtures(ORIGINAL);
    const mod  = await evalStub(stub);
    const val  = await mod.getTestFixtures();
    assert.equal(val, null, "stub must return null, not undefined or a value");
  });

  test("stub contains no __muga_test_mode references", () => {
    const stub = rewriteTestFixtures(ORIGINAL);
    assert.ok(
      !stub.includes("__muga_test_mode"),
      "stub must not contain __muga_test_mode"
    );
  });

  test("stub contains no __muga_test_fixtures references", () => {
    const stub = rewriteTestFixtures(ORIGINAL);
    assert.ok(
      !stub.includes("__muga_test_fixtures"),
      "stub must not contain __muga_test_fixtures"
    );
  });

  test("stub contains no chrome.storage references", () => {
    const stub = rewriteTestFixtures(ORIGINAL);
    assert.ok(
      !stub.includes("chrome.storage"),
      "stub must not reference chrome.storage"
    );
  });

  test("stub does not reference readLocal or any internal helper", () => {
    const stub = rewriteTestFixtures(ORIGINAL);
    assert.ok(
      !stub.includes("readLocal"),
      "stub must not contain internal helper functions"
    );
  });
});

describe("rewriteTestFixtures — input tolerance", () => {
  test("accepts empty string input without throwing", () => {
    assert.doesNotThrow(() => rewriteTestFixtures(""));
  });

  test("accepts arbitrary string input without throwing", () => {
    assert.doesNotThrow(() => rewriteTestFixtures("not valid JS at all!!!"));
  });

  test("stub is identical regardless of input content", () => {
    const stubA = rewriteTestFixtures("input A");
    const stubB = rewriteTestFixtures("totally different input B 🎉");
    assert.equal(stubA, stubB, "stub output must be deterministic and input-independent");
  });
});

// ── neutraliseTrustedKeysSeam ─────────────────────────────────────────────────

describe("neutraliseTrustedKeysSeam — seam present", () => {
  // This is the exact literal that appears in service-worker.js (verified by
  // the grep in the #827 investigation).
  const SEAM_BLOCK =
    "  const trustedKeys =\n" +
    "    Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) && globalThis.__MUGA_TRUSTED_KEYS__.length > 0\n" +
    "      ? globalThis.__MUGA_TRUSTED_KEYS__\n" +
    "      : TRUSTED_PUBLIC_KEYS;";

  const SURROUNDING = `function _remoteRulesDeps() {\n${SEAM_BLOCK}\n  return { trustedKeys };\n}`;

  test("returns patched: true when the seam is found", () => {
    const { patched } = neutraliseTrustedKeysSeam(SURROUNDING);
    assert.equal(patched, true);
  });

  test("patched content no longer contains the Array.isArray seam expression", () => {
    const { content } = neutraliseTrustedKeysSeam(SURROUNDING);
    assert.ok(
      !content.includes("Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__)"),
      "patched output must not contain the Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) expression"
    );
  });

  test("patched content still references TRUSTED_PUBLIC_KEYS", () => {
    const { content } = neutraliseTrustedKeysSeam(SURROUNDING);
    assert.ok(
      content.includes("TRUSTED_PUBLIC_KEYS"),
      "patched output must retain TRUSTED_PUBLIC_KEYS as the key source"
    );
  });

  test("runtime seam expression is removed from the real service-worker.js when applied", () => {
    const sw = readFileSync(
      join(ROOT, "src", "background", "service-worker.js"),
      "utf8"
    );
    // The real file contains the seam — confirm the neutraliser finds and removes it.
    const { content, patched } = neutraliseTrustedKeysSeam(sw);
    assert.equal(patched, true, "seam must be found in the real service-worker.js");
    // The runtime conditional expression (not comments) must be gone.
    // Comments may still reference __MUGA_TRUSTED_KEYS__ for documentation.
    assert.ok(
      !content.includes("Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__)"),
      "patched service-worker.js must not contain the Array.isArray(globalThis.__MUGA_TRUSTED_KEYS__) runtime expression"
    );
    // TRUSTED_PUBLIC_KEYS must remain as the key source.
    assert.ok(
      content.includes("TRUSTED_PUBLIC_KEYS"),
      "patched service-worker.js must still reference TRUSTED_PUBLIC_KEYS"
    );
  });
});

describe("neutraliseTrustedKeysSeam — seam absent", () => {
  test("returns patched: false when the seam is not present", () => {
    const { patched } = neutraliseTrustedKeysSeam("const trustedKeys = TRUSTED_PUBLIC_KEYS;");
    assert.equal(patched, false);
  });

  test("content is returned unchanged when the seam is absent", () => {
    const input = "const trustedKeys = TRUSTED_PUBLIC_KEYS; // already clean";
    const { content } = neutraliseTrustedKeysSeam(input);
    assert.equal(content, input);
  });

  test("accepts empty string without throwing", () => {
    assert.doesNotThrow(() => neutraliseTrustedKeysSeam(""));
  });
});
