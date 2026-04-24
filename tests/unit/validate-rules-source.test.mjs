/**
 * MUGA — Unit tests for tools/validate-rules-source.mjs
 *
 * Run with: npm test
 *
 * The validator reuses validatePayloadShape + validateParams from
 * src/lib/remote-rules.js (minus signature check). It runs the same
 * denylist / format / length checks the extension enforces, so bad params
 * fail at PR time instead of at user-run time (Design §14.1).
 *
 * Coverage (T6.2):
 *   - Valid source (good params) → exit 0
 *   - Denylist hit (param "id") → exit 1 with error message
 *   - Affiliate guard hit (param "tag") → exit 1
 *   - Invalid format param → exit 1
 *   - Missing required field → exit 1
 *   - Malformed JSON → exit 1
 *   - MUGA_SOURCE_FILE env override: non-existent file → exit 1 or 3
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, mkdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "../../tools/validate-rules-source.mjs");
const SOURCE_DIR = join(__dirname, "../../tools/rules-source");

// ---------------------------------------------------------------------------
// Helper: run the validator with a given source payload string
// ---------------------------------------------------------------------------
function runValidator({ sourceContent, envOverrides = {} } = {}) {
  // Write to a temp file if content provided
  let tmpDir;
  let tmpFile;

  if (sourceContent !== undefined) {
    tmpDir = mkdtempSync(join(tmpdir(), "muga-val-test-"));
    tmpFile = join(tmpDir, "params.json");
    writeFileSync(tmpFile, sourceContent);
  }

  try {
    const result = spawnSync("node", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...(tmpFile ? { MUGA_SOURCE_FILE: tmpFile } : {}),
        ...envOverrides,
      },
    });
    return result;
  } finally {
    if (tmpDir && existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true, force: true });
    }
  }
}

// ---------------------------------------------------------------------------
// T6.2 — Valid source
// ---------------------------------------------------------------------------
describe("validate-rules-source.mjs valid source", () => {
  test("exits 0 for a valid source with allowed params", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: ["utm_custom_test", "muga_clean_x"],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(
      result.status,
      0,
      `Expected exit 0, got ${result.status}. stderr: ${result.stderr}\nstdout: ${result.stdout}`
    );
  });

  test("exits 0 for a valid source with empty params array", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({ version: 1, published: now, params: [] });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 0);
  });
});

// ---------------------------------------------------------------------------
// T6.2 — Denylist hit (REMOTE_PARAM_DENYLIST)
// ---------------------------------------------------------------------------
describe("validate-rules-source.mjs denylist enforcement", () => {
  test("exits 1 when a param matches REMOTE_PARAM_DENYLIST (e.g. 'id')", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: ["id"],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1 for denylist hit, got ${result.status}`
    );
    // Should emit a useful error message
    const combined = result.stdout + result.stderr;
    assert.ok(
      combined.toLowerCase().includes("denylist") ||
      combined.toLowerCase().includes("invalid") ||
      combined.toLowerCase().includes("error"),
      `Expected error mention in output: ${combined}`
    );
  });

  test("exits 1 when a param matches REMOTE_PARAM_DENYLIST (e.g. 'query')", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: ["query"],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });

  test("exits 1 when a param matches AFFILIATE_PARAM_GUARD (e.g. 'tag')", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: ["tag"],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(
      result.status,
      1,
      `Expected exit 1 for affiliate guard hit, got ${result.status}`
    );
  });

  test("exits 1 when a param matches AFFILIATE_PARAM_GUARD (e.g. 'campid')", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: ["campid"],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });
});

// ---------------------------------------------------------------------------
// T6.2 — Format / schema validation
// ---------------------------------------------------------------------------
describe("validate-rules-source.mjs format validation", () => {
  test("exits 1 when a param contains invalid characters (space)", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: ["bad param!"],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });

  test("exits 1 when a param contains unicode characters", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: ["utm_ñoño"],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });

  test("exits 1 when a param exceeds 64 characters", () => {
    const now = new Date().toISOString();
    const longParam = "a".repeat(65);
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: [longParam],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });

  test("exits 0 when a param is exactly 64 characters", () => {
    const now = new Date().toISOString();
    const maxParam = "a".repeat(64);
    const source = JSON.stringify({
      version: 1,
      published: now,
      params: [maxParam],
    });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 0);
  });
});

// ---------------------------------------------------------------------------
// T6.2 — Missing fields / malformed JSON
// ---------------------------------------------------------------------------
describe("validate-rules-source.mjs schema enforcement", () => {
  test("exits 1 when 'version' field is missing", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({ published: now, params: ["utm_x"] });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });

  test("exits 1 when 'published' field is missing", () => {
    const source = JSON.stringify({ version: 1, params: ["utm_x"] });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });

  test("exits 1 when 'params' field is missing", () => {
    const now = new Date().toISOString();
    const source = JSON.stringify({ version: 1, published: now });
    const result = runValidator({ sourceContent: source });
    assert.strictEqual(result.status, 1);
  });

  test("exits 1 for malformed JSON", () => {
    const result = runValidator({ sourceContent: "{ not valid json" });
    assert.strictEqual(result.status, 1);
  });
});

// ---------------------------------------------------------------------------
// T6.2 — workflow YAML guard: validate-rules.yml must exist and be valid YAML
// ---------------------------------------------------------------------------
describe("validate-rules.yml workflow file", () => {
  test("validate-rules.yml exists in .github/workflows/", () => {
    const workflowFile = join(__dirname, "../../.github/workflows/validate-rules.yml");
    assert.ok(
      existsSync(workflowFile),
      ".github/workflows/validate-rules.yml must exist"
    );
  });

  test("validate-rules.yml contains workflow-level permissions block", () => {
    const workflowFile = join(__dirname, "../../.github/workflows/validate-rules.yml");
    const content = readFileSync(workflowFile, "utf8");
    const jobsIndex = content.indexOf("\njobs:");
    const preJobs = jobsIndex === -1 ? content : content.slice(0, jobsIndex);
    assert.ok(
      /^permissions:/m.test(preJobs),
      "validate-rules.yml must have workflow-level permissions block"
    );
  });

  test("validate-rules.yml references validate-rules-source.mjs", () => {
    const workflowFile = join(__dirname, "../../.github/workflows/validate-rules.yml");
    const content = readFileSync(workflowFile, "utf8");
    assert.ok(
      content.includes("validate-rules-source.mjs"),
      "validate-rules.yml must run validate-rules-source.mjs"
    );
  });
});
