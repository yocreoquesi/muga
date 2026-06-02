/**
 * MUGA — Unit tests for tools/rule-ingestion/format-surface.mjs
 *
 * Covers (W-PR2-1 fix — off-critical-path violation):
 *   FS1 — surface-input.json MISSING → does NOT throw, exit 0, fallback markdown emitted
 *   FS2 — surface-input.json MALFORMED JSON → does NOT throw, fallback markdown emitted
 *   FS3 — surface-input.json VALID → full formatted markdown written, summary.md created
 *
 * Injects surfaceInputPath + summaryPath to tmp dirs so no real files are touched.
 * Captures stdout via an injected writer (matches runFormatSurface({ stdout? }) API).
 *
 * Run with: npm test
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fresh tmp dir for each test */
function makeTmpDir() {
  return mkdtempSync(join(tmpdir(), "muga-fs-test-"));
}

/** Build a minimal valid surface-input.json object */
function makeValidSurfaceInput() {
  return {
    report: {
      generatedAt: "2025-01-15T12:00:00.000Z",
      autoMergeCount: 3,
      quarantineCount: 2,
      ingestStats: {
        adapters: [
          { adapterId: "adguard-tp", admitted: 10, skipped: 1, affiliateExcluded: 0 },
        ],
        merged: { emptyDropped: 0, total: 10 },
      },
      // Real production shape: each entry is { candidate: { param, signals }, rejections }
      quarantine: [
        { candidate: { param: "utm_source", signals: ["a"] }, rejections: [{ gate: "CORROBORATION", reason: "only 1 source" }] },
        { candidate: { param: "utm_medium", signals: ["a"] }, rejections: [{ gate: "CANARY", reason: "canary failed" }] },
      ],
    },
    promoteSkipped: [{ param: "ref", reason: "domain-specific" }],
    noop: false,
  };
}

/** Tiny stdout-capturing writer — accumulates written strings */
function makeCapture() {
  const chunks = [];
  return {
    write(s) {
      chunks.push(s);
    },
    get value() {
      return chunks.join("");
    },
  };
}

// ---------------------------------------------------------------------------
// FS1 — Missing surface-input.json → graceful fallback, exit 0
// ---------------------------------------------------------------------------

describe("FS1 — surface-input.json MISSING → graceful fallback, no throw", () => {
  test("runFormatSurface does NOT throw when surface-input.json does not exist", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "nonexistent-surface-input.json"); // deliberately not created
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    // Must not throw
    assert.doesNotThrow(() => {
      runFormatSurface({ surfaceInputPath, summaryPath, stdout });
    }, "runFormatSurface must not throw when surface-input.json is missing");
  });

  test("fallback markdown written to stdout contains 'surface data unavailable' when file is missing", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "nonexistent-surface-input.json");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    runFormatSurface({ surfaceInputPath, summaryPath, stdout });

    const out = stdout.value;
    assert.ok(
      /surface data unavailable/i.test(out),
      `stdout must contain 'surface data unavailable', got: ${out.slice(0, 300)}`
    );
    assert.ok(
      /quarantine review summary/i.test(out),
      `stdout must contain a heading like 'Quarantine Review Summary', got: ${out.slice(0, 300)}`
    );
  });

  test("fallback markdown written to summary.md when file is missing", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "nonexistent-surface-input.json");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    runFormatSurface({ surfaceInputPath, summaryPath, stdout });

    assert.ok(existsSync(summaryPath), "summary.md must be written even on fallback");
    const md = readFileSync(summaryPath, "utf8");
    assert.ok(
      /surface data unavailable/i.test(md),
      `summary.md must contain 'surface data unavailable', got: ${md.slice(0, 300)}`
    );
  });
});

// ---------------------------------------------------------------------------
// FS2 — Malformed JSON → graceful fallback, no throw
// ---------------------------------------------------------------------------

describe("FS2 — surface-input.json MALFORMED → graceful fallback, no throw", () => {
  test("runFormatSurface does NOT throw when surface-input.json is malformed JSON", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "surface-input.json");
    writeFileSync(surfaceInputPath, "{not json", "utf8");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    assert.doesNotThrow(() => {
      runFormatSurface({ surfaceInputPath, summaryPath, stdout });
    }, "runFormatSurface must not throw when surface-input.json is malformed JSON");
  });

  test("fallback markdown contains 'surface data unavailable' for malformed JSON", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "surface-input.json");
    writeFileSync(surfaceInputPath, "{not json", "utf8");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    runFormatSurface({ surfaceInputPath, summaryPath, stdout });

    const out = stdout.value;
    assert.ok(
      /surface data unavailable/i.test(out),
      `stdout must contain 'surface data unavailable' for malformed input, got: ${out.slice(0, 300)}`
    );
  });

  test("fallback markdown written to summary.md for malformed JSON", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "surface-input.json");
    writeFileSync(surfaceInputPath, "{not json", "utf8");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    runFormatSurface({ surfaceInputPath, summaryPath, stdout });

    assert.ok(existsSync(summaryPath), "summary.md must be written even when JSON is malformed");
    const md = readFileSync(summaryPath, "utf8");
    assert.ok(
      /surface data unavailable/i.test(md),
      `summary.md must contain 'surface data unavailable' for malformed input`
    );
  });
});

// ---------------------------------------------------------------------------
// FS3 — Valid surface-input.json → full formatted markdown (happy path)
// ---------------------------------------------------------------------------

describe("FS3 — VALID surface-input.json → full formatted markdown written", () => {
  test("runFormatSurface does NOT throw on valid input", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "surface-input.json");
    writeFileSync(surfaceInputPath, JSON.stringify(makeValidSurfaceInput()), "utf8");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    assert.doesNotThrow(() => {
      runFormatSurface({ surfaceInputPath, summaryPath, stdout });
    }, "runFormatSurface must not throw on valid input");
  });

  test("stdout contains sections from formatQuarantineReport on valid input", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "surface-input.json");
    writeFileSync(surfaceInputPath, JSON.stringify(makeValidSurfaceInput()), "utf8");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    runFormatSurface({ surfaceInputPath, summaryPath, stdout });

    const out = stdout.value;
    assert.ok(typeof out === "string" && out.length > 0, "stdout must receive non-empty markdown");
    // Sections expected from formatQuarantineReport
    assert.ok(/ingest/i.test(out), "output must contain ingest stats section");
    assert.ok(/quarantine/i.test(out), "output must contain quarantine section");
    // Params from fixture must appear
    assert.ok(/utm_source/.test(out), "output must list utm_source from quarantine");
    assert.ok(/adguard-tp/.test(out), "output must list adapter adguard-tp");
  });

  test("summary.md is written with the same content on valid input", async () => {
    const { runFormatSurface } = await import("../../tools/rule-ingestion/format-surface.mjs");

    const dir = makeTmpDir();
    const surfaceInputPath = join(dir, "surface-input.json");
    writeFileSync(surfaceInputPath, JSON.stringify(makeValidSurfaceInput()), "utf8");
    const summaryPath = join(dir, "summary.md");
    const stdout = makeCapture();

    runFormatSurface({ surfaceInputPath, summaryPath, stdout });

    assert.ok(existsSync(summaryPath), "summary.md must be created on valid input");
    const md = readFileSync(summaryPath, "utf8");
    assert.ok(typeof md === "string" && md.length > 0, "summary.md must be non-empty on valid input");
    // Happy path must NOT contain the fallback message
    assert.ok(
      !/surface data unavailable/i.test(md),
      "summary.md must NOT contain fallback text on valid input"
    );
  });
});
