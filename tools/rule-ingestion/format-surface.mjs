/**
 * MUGA — format-surface.mjs (EPIC C, issue #782, v2.3.0)
 *
 * Thin CLI: reads quarantine/surface-input.json, calls formatQuarantineReport,
 * writes markdown to stdout AND to quarantine/summary.md (for PR-body reuse).
 *
 * Usage:
 *   node tools/rule-ingestion/format-surface.mjs
 *   npm run surface:rules
 *
 * Environment / injectable paths (for tests):
 *   surfaceInputPath  (default: quarantine/surface-input.json)
 *   summaryPath       (default: quarantine/summary.md)
 *
 * Public API (named exports only — NO default export):
 *   runFormatSurface({ surfaceInputPath?, summaryPath?, stdout? }) → void
 *
 * Exit codes:
 *   0 — always (missing/malformed surface-input.json emits fallback markdown, never exits 1)
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { formatQuarantineReport } from "./report-formatter.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SURFACE_INPUT_PATH = resolve(__dirname, "quarantine/surface-input.json");
const DEFAULT_SUMMARY_PATH = resolve(__dirname, "quarantine/summary.md");

/**
 * Emit a minimal fallback markdown block to both stdout and summary.md.
 * Used when surface-input.json is missing or malformed — the surface must
 * NEVER block the pipeline (W-PR2-1: off-critical-path requirement).
 *
 * @param {object} opts
 * @param {string}   opts.summaryPath  Path to write summary.md.
 * @param {object}   opts.stdout       Injectable stdout-like object.
 * @param {string}   opts.reason       Human-readable error description.
 * @returns {void}
 */
function emitFallback({ summaryPath, stdout, reason }) {
  const md =
    "## Quarantine Review Summary\n\n" +
    `_(surface data unavailable — could not read/parse surface-input.json: ${reason})_\n`;

  stdout.write(md);

  try {
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(summaryPath, md, "utf8");
  } catch {
    // Best-effort: a summary.md write failure must not throw or block the job
  }
}

/**
 * Core (testable) formatter runner.
 *
 * Never throws. On any read/parse error, emits a visible fallback markdown
 * to both stdout and summary.md (naming the reason) and returns normally.
 * This ensures the surface step is always off the critical path.
 *
 * @param {object} [opts]
 * @param {string}   [opts.surfaceInputPath]  Path to surface-input.json (injectable for tests).
 * @param {string}   [opts.summaryPath]       Path to write summary.md (injectable for tests).
 * @param {object}   [opts.stdout]            Injectable stdout-like object (defaults to process.stdout).
 * @returns {void}
 */
export function runFormatSurface({
  surfaceInputPath = DEFAULT_SURFACE_INPUT_PATH,
  summaryPath = DEFAULT_SUMMARY_PATH,
  stdout = process.stdout,
} = {}) {
  // Read + parse surface-input.json — on ANY error, emit fallback and return
  // (exit 0). The surface must never block the pipeline (W-PR2-1).
  let surfaceInput;
  try {
    const rawJson = readFileSync(surfaceInputPath, "utf8");
    surfaceInput = JSON.parse(rawJson);
  } catch (err) {
    // Min1: use err.code (e.g. ENOENT) — never err.message, which leaks absolute runner paths
    const reason = err.code
      ? `surface-input.json not found or unreadable (${err.code})`
      : "surface-input.json not found or unreadable";
    emitFallback({ summaryPath, stdout, reason });
    return;
  }

  // Format markdown — a malformed-but-valid-JSON report (e.g. a null quarantine
  // element) must NOT throw out of here. Fall back instead so the surface step
  // stays off the critical path (W-PR2-1 / M1).
  let md;
  try {
    const { report, promoteSkipped = [] } = surfaceInput;
    md = formatQuarantineReport(report, { promoteSkipped });
  } catch (err) {
    const reason = err.code
      ? `could not format surface report (${err.code})`
      : "could not format surface report (malformed report shape)";
    emitFallback({ summaryPath, stdout, reason });
    return;
  }

  // Write to stdout (workflow redirects >> $GITHUB_STEP_SUMMARY)
  stdout.write(md);
  if (!md.endsWith("\n")) {
    stdout.write("\n");
  }

  // Write to summary.md for PR-body reuse (idempotent — always overwrites).
  // Best-effort: an FS error (full disk, permissions) must not throw or block the job (M1).
  try {
    mkdirSync(dirname(summaryPath), { recursive: true });
    writeFileSync(summaryPath, md, "utf8");
  } catch {
    // Best-effort: a summary.md write failure must not throw or block the job
  }
}

/**
 * CLI entry point — thin wrapper around runFormatSurface().
 * Guarded main: only runs when this file is the entry point.
 */
async function main() {
  try {
    runFormatSurface();
    process.exitCode = 0;
  } catch (err) {
    console.error("[format-surface] ERROR:", err.message ?? err);
    process.exit(err.exitCode ?? 1);
  }
}

if (process.argv[1]?.endsWith("format-surface.mjs")) {
  main();
}
