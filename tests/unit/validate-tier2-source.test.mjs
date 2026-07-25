/**
 * MUGA — Unit tests for tools/validate-tier2-source.mjs
 *
 * Run with: npm test
 *
 * The validator reuses `validateTier2PayloadShape` + `validateTier2Rules` from
 * `src/lib/remote-tier2-rules.js` — the SAME pure validators the runtime
 * fetch pipeline uses (design ADR-7: "single source of truth ... imported by
 * both"). Version/freshness checks are intentionally SKIPPED here (signing-
 * time concerns — a source file may be dated during authoring), mirroring
 * `validate-rules-source.mjs`'s `validateParamsForSource` precedent.
 *
 * Pure-core coverage (entry-guarded — importing this module runs zero I/O):
 *   - `validateTier2SourceContent`: accept-token in source text → non-ok
 *   - `validateTier2SourceContent`: shape-invalid source → non-ok
 *   - `validateTier2SourceContent`: clean empty seed → ok
 *   - `validateTier2SourceContent`: id colliding with a bundled id → non-ok
 *   - `validateTier2SourceContent`: unparseable-looking selector → non-ok
 *   - `selectorLooksSyntacticallyValid`: balanced vs unbalanced brackets/quotes
 *
 * CLI coverage (subprocess, mirrors validate-rules-source.test.mjs):
 *   - Real seed file (tools/rules-source/tier2.json) → exit 0
 *   - Malformed JSON → exit 1
 *   - Missing source file → exit 3
 *   - validate-tier2-rules.yml workflow file exists and wires this script
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import {
  validateTier2SourceContent,
  selectorLooksSyntacticallyValid,
} from "../../tools/validate-tier2-source.mjs";
import { BUNDLED_TIER2_IDS } from "../../src/lib/remote-tier2-rules.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT = join(__dirname, "../../tools/validate-tier2-source.mjs");
const SEED_FILE = join(__dirname, "../../tools/rules-source/tier2.json");

// ---------------------------------------------------------------------------
// Pure-core tests — no I/O, no subprocess (entry-guard verification)
// ---------------------------------------------------------------------------
describe("validateTier2SourceContent (pure)", () => {
  test("clean empty seed → ok", () => {
    const source = { schemaVersion: 1, version: 1, published: "2026-01-01T00:00:00.000Z", rules: [] };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, true, `Expected ok, got: ${JSON.stringify(result)}`);
  });

  test("accept-token in a selector → non-ok", () => {
    const source = {
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [{ id: "sneaky", present: [".banner"], reject: [".AcceptAll"], openSettings: [] }],
    };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, false);
  });

  test("accept-token anywhere in the raw JSON text (not just a selector) → non-ok", () => {
    const source = {
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [{ id: "allowall-vendor", present: [".x"], reject: [".y"], openSettings: [] }],
    };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, false);
  });

  test("shape-invalid source (missing 'rules' field) → non-ok", () => {
    const source = { schemaVersion: 1, version: 1, published: "2026-01-01T00:00:00.000Z" };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, false);
  });

  test("shape-invalid source (extra top-level key) → non-ok", () => {
    const source = {
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [],
      extra: "nope",
    };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, false);
  });

  test("source containing a 'sig' field is rejected (source must be unsigned)", () => {
    const source = {
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [],
      sig: "should_not_be_here",
    };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, false);
  });

  test("a rule id colliding with a bundled id → non-ok (ADD-only, mirrors runtime)", () => {
    const [bundledId] = [...BUNDLED_TIER2_IDS];
    assert.ok(bundledId, "expected at least one bundled Tier2 id to test against");
    const source = {
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [{ id: bundledId, present: [".x"], reject: [".y"], openSettings: [] }],
    };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, false);
  });

  test("a valid new rule (no collision, no accept token) → ok", () => {
    const source = {
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [{ id: "example-cmp", present: [".consent-banner"], reject: [".reject-all"], openSettings: [] }],
    };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, true, `Expected ok, got: ${JSON.stringify(result)}`);
  });

  test("a selector that fails the DOM-free syntax pre-check → non-ok", () => {
    const source = {
      schemaVersion: 1,
      version: 1,
      published: "2026-01-01T00:00:00.000Z",
      rules: [{ id: "broken-selector", present: [".x"], reject: [".unclosed['bracket"], openSettings: [] }],
    };
    const result = validateTier2SourceContent(source, JSON.stringify(source));
    assert.strictEqual(result.ok, false);
  });
});

describe("selectorLooksSyntacticallyValid (pure)", () => {
  test("a plain class selector is valid", () => {
    assert.strictEqual(selectorLooksSyntacticallyValid(".reject-all"), true);
  });

  test("a well-formed attribute selector is valid", () => {
    assert.strictEqual(selectorLooksSyntacticallyValid("button[data-role='reject']"), true);
  });

  test("an empty string is invalid", () => {
    assert.strictEqual(selectorLooksSyntacticallyValid(""), false);
  });

  test("unbalanced brackets are invalid", () => {
    assert.strictEqual(selectorLooksSyntacticallyValid(".unclosed["), false);
  });

  test("unbalanced quotes are invalid", () => {
    assert.strictEqual(selectorLooksSyntacticallyValid("button[data-role='reject]"), false);
  });
});

// ---------------------------------------------------------------------------
// CLI (subprocess) tests
// ---------------------------------------------------------------------------
function runValidator({ sourceContent, envOverrides = {} } = {}) {
  let tmpDir;
  let tmpFile;

  if (sourceContent !== undefined) {
    tmpDir = mkdtempSync(join(tmpdir(), "muga-tier2-val-test-"));
    tmpFile = join(tmpDir, "tier2.json");
    writeFileSync(tmpFile, sourceContent);
  }

  try {
    return spawnSync("node", [SCRIPT], {
      encoding: "utf8",
      env: {
        ...process.env,
        ...(tmpFile ? { MUGA_TIER2_SOURCE_FILE: tmpFile } : {}),
        ...envOverrides,
      },
    });
  } finally {
    if (tmpDir && existsSync(tmpDir)) rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("validate-tier2-source.mjs CLI", () => {
  test("exits 0 for the real committed seed (tools/rules-source/tier2.json)", () => {
    const result = spawnSync("node", [SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, MUGA_TIER2_SOURCE_FILE: SEED_FILE },
    });
    assert.strictEqual(
      result.status,
      0,
      `Expected exit 0 for the committed seed, got ${result.status}. stderr: ${result.stderr}`
    );
  });

  test("exits 1 for malformed JSON", () => {
    const result = runValidator({ sourceContent: "{ not valid json" });
    assert.strictEqual(result.status, 1);
  });

  test("exits 3 when the source file does not exist", () => {
    const result = runValidator({ envOverrides: { MUGA_TIER2_SOURCE_FILE: "/nonexistent/tier2.json" } });
    assert.strictEqual(result.status, 3);
  });
});

describe("validate-tier2-rules.yml workflow file", () => {
  const workflowFile = join(__dirname, "../../.github/workflows/validate-tier2-rules.yml");

  test("validate-tier2-rules.yml exists in .github/workflows/", () => {
    assert.ok(existsSync(workflowFile), "validate-tier2-rules.yml must exist");
  });

  test("validate-tier2-rules.yml references validate-tier2-source.mjs", () => {
    const content = readFileSync(workflowFile, "utf8");
    assert.ok(content.includes("validate-tier2-source.mjs"));
  });

  test("validate-tier2-rules.yml is scoped to tools/rules-source/tier2.json only", () => {
    const content = readFileSync(workflowFile, "utf8");
    assert.ok(content.includes("tools/rules-source/tier2.json"));
  });
});
