#!/usr/bin/env node
/**
 * MUGA — moat-expansion CLI entry point (#793).
 *
 * Thin I/O orchestrator: fetch → quarantine → extract → snapshot → diff → render → write report.
 * Pure decision logic lives in the pure modules (adapter, differ, report). This
 * module is the I/O boundary: it calls Date, fs.write, and process.exit.
 *
 * Mirrors the orchestrate-cli.mjs pattern:
 *   - All I/O seams are injectable (fetchImpl, now, paths, moatSnapshot)
 *   - Core exported function: runMoatExpansionCli(opts?)
 *   - main() entry guard: only runs when this file is executed directly
 *   - CliError propagates to process.exit(err.exitCode)
 *
 * Exit code contract (via CliError):
 *   0 — success
 *   1 — validation / bad-JSON / unexpected shape
 *   2 — fetch / network failure
 *   3 — I/O error (write failure)
 *
 * Fail-closed: on ANY error before the report write, no report file is created.
 * The report write itself uses a tmp→rename pattern to avoid partial files.
 *
 * Usage:
 *   node tools/moat-expansion/cli.mjs
 *   npm run moat:report
 *
 * Public API (named exports only — no default):
 *   runMoatExpansionCli({ fetchImpl?, now?, paths?, moatSnapshot? }?)
 *     → Promise<void>   // throws CliError on failure
 */

import { writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CliError } from "./cli-error.mjs";
import { fetchRaw, extractReferralSignals } from "./adapters/clearurls-moat.mjs";
import { loadMoatSnapshot } from "./moat-snapshot.mjs";
import { KNOWN_PROGRAMS } from "./lookup-table.mjs";
import { diffMoat } from "./differ.mjs";
import { renderReport } from "./report.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Production defaults ────────────────────────────────────────────────────────

const DEFAULT_QUARANTINE_DIR = resolve(__dirname, "quarantine");
const DEFAULT_REPORTS_DIR = resolve(__dirname, "reports");

// ── runMoatExpansionCli ────────────────────────────────────────────────────────

/**
 * Orchestrate the full moat-expansion pipeline.
 *
 * All seams are injectable so tests can run without network, without real
 * moat imports, and with controlled timestamps.
 *
 * Pipeline:
 *   1. fetchRaw — fetch ClearURLs JSON, write to quarantine
 *   2. extractReferralSignals — parse raw JSON → signals[]
 *   3. loadMoatSnapshot — build coverage snapshot from src/lib (or override)
 *   4. diffMoat — classify each (provider, param) tuple
 *   5. renderReport — pure Markdown string
 *   6. write report to tools/moat-expansion/reports/report-<date>.md
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl] Injectable fetch. Default: globalThis.fetch.
 * @param {Date} [opts.now] Injectable clock. Default: new Date().
 * @param {{ quarantineDir?: string, reportsDir?: string }} [opts.paths] Override I/O paths.
 * @param {object} [opts.moatSnapshot] Pre-built snapshot override (tests). When provided,
 *   loadMoatSnapshot is NOT called; this object is used directly as the snapshot.
 * @returns {Promise<void>}
 * @throws {CliError} with appropriate exitCode on failure.
 */
export async function runMoatExpansionCli({
  fetchImpl = globalThis.fetch,
  now,
  paths = {},
  moatSnapshot,
} = {}) {
  // ── 1. Resolve paths ────────────────────────────────────────────────────────
  const quarantineDir = paths.quarantineDir ?? DEFAULT_QUARANTINE_DIR;
  const reportsDir = paths.reportsDir ?? DEFAULT_REPORTS_DIR;
  const quarantinePath = join(quarantineDir, "clearurls.raw");

  // ── 2. Resolve clock ────────────────────────────────────────────────────────
  // The CLI boundary owns Date — no Date.now() inside pure modules.
  const resolvedNow = now instanceof Date ? now : new Date();
  const isoNow = resolvedNow.toISOString();
  // Date string for filename: YYYY-MM-DD
  const dateStr = isoNow.slice(0, 10);

  // ── 3. Fetch raw JSON and quarantine ────────────────────────────────────────
  // fetchRaw writes the raw file to quarantinePath and returns the text.
  // CliError(2) on network failure, CliError(3) on I/O failure — propagates up.
  const rawText = await fetchRaw({
    fetchImpl,
    quarantinePath,
  });

  // ── 4. Extract referralMarketing signals ────────────────────────────────────
  // PURE function. CliError(1) on bad JSON or wrong shape — propagates up.
  const signals = extractReferralSignals(rawText);

  // Count providers and total params for report meta
  const providerCount = signals.length;
  const paramCount = signals.reduce((sum, s) => sum + s.referralMarketing.length, 0);

  // ── 5. Build moat snapshot ──────────────────────────────────────────────────
  // Production: import from src/lib (no I/O, pure at import-time per D2/D3).
  // Tests: inject a pre-built snapshot to avoid touching src/.
  const snapshot = moatSnapshot ?? loadMoatSnapshot();

  // ── 6. Diff signals against snapshot ────────────────────────────────────────
  // PURE function. No throws.
  const diffResult = diffMoat(signals, snapshot, KNOWN_PROGRAMS);

  // ── 7. Render Markdown report ────────────────────────────────────────────────
  // PURE function. No throws.
  const reportMarkdown = renderReport(diffResult, {
    fetchedAt: isoNow,
    providerCount,
    paramCount,
  });

  // ── 8. Write report file (atomic tmp→rename) ─────────────────────────────────
  // Filename: report-<YYYY-MM-DD>.md (per design D6 + report-<date> naming)
  const reportFilename = `report-${dateStr}.md`;
  const reportPath = join(reportsDir, reportFilename);
  const tmpPath = reportPath + ".tmp";

  try {
    mkdirSync(reportsDir, { recursive: true });
    writeFileSync(tmpPath, reportMarkdown, "utf8");
    renameSync(tmpPath, reportPath);
  } catch (err) {
    // Clean up tmp file on failure (best-effort)
    try {
      writeFileSync(tmpPath, "", "utf8"); // won't throw if already gone
    } catch {
      // ignore
    }
    throw new CliError(
      `[moat-expansion] cli: cannot write report to "${reportPath}": ${err.message}`,
      3
    );
  }

  // ── 9. One-line stdout summary ───────────────────────────────────────────────
  console.log(
    JSON.stringify({
      report: reportPath,
      date: dateStr,
      providerCount,
      paramCount,
      newGaps: diffResult.newOnKnown.length,
      unknownProviders: diffResult.unknownProvider.length,
      alreadyCovered: diffResult.alreadyCoveredCount,
    })
  );
}

// ── main() entry ──────────────────────────────────────────────────────────────

async function main() {
  try {
    await runMoatExpansionCli();
    process.exit(0);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(err instanceof CliError ? err.exitCode : 3);
  }
}

// Only run when invoked directly (mirrors orchestrate-cli.mjs pattern)
if (
  process.argv[1] &&
  (process.argv[1].endsWith("cli.mjs") ||
    process.argv[1].endsWith("cli"))
) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(err instanceof CliError ? err.exitCode : 3);
  });
}
