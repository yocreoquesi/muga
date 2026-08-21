/**
 * MUGA — pipeline.mjs (EPIC C, issue #781, v2.3.0)
 *
 * Chains runIngestion → runOrchestrateCli → runPromote with exit-code
 * propagation. Any step throwing CliError or PromoteError halts the chain
 * and bubbles the error (including its .exitCode) to the caller.
 *
 * Usage:
 *   node tools/rule-ingestion/pipeline.mjs
 *   npm run pipeline:rules
 *
 * Public API (named exports only — NO default export):
 *   runPipeline  — async ({ ...injectables, signingKeyPath, now? }) → result
 *
 * Environment variables (main() only):
 *   MUGA_SIGNING_KEY_PATH  (required)  Path to Ed25519 private key PEM file.
 *   CANDIDATES_PATH        (optional)  Override intermediate candidates.json path.
 *   GITHUB_OUTPUT          (optional)  Append noop=<bool> for GitHub Actions.
 *
 * noop signal format:
 *   main() ALWAYS emits a last-line JSON to stdout: {"noop":<bool>,"written":<bool>,"version":<n>}
 *   If GITHUB_OUTPUT is set, also appends "noop=<bool>\n" to that file.
 *
 * Exit codes (mirrors orchestrate-cli.mjs):
 *   0 — success
 *   1 — validation / bad-JSON / empty-source
 *   2 — signing setup (missing/unreadable key)
 *   3 — I/O error
 */

import { mkdirSync, writeFileSync, appendFileSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runIngestion } from "./ingest.mjs";
import { runOrchestrateCli } from "./orchestrate-cli.mjs";
import { runPromote } from "./promote-rules.mjs";
import { ENABLED_ADAPTERS } from "./adapters/index.mjs";
import { TRUSTED_PUBLIC_KEYS } from "../../src/lib/remote-rules-keys.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Production default paths (mirror each CLI's DEFAULT_* constants) ───────────

const DEFAULT_CANDIDATES_PATH = resolve(__dirname, "quarantine/candidates.json");
const DEFAULT_PROMOTE_PATH = resolve(__dirname, "promote/promote-candidates.json");
const DEFAULT_REPORT_PATH = resolve(__dirname, "quarantine/quarantine-report.json");
const DEFAULT_SOURCE_PATH = resolve(__dirname, "../../tools/rules-source/params.json");
const DEFAULT_DOMAIN_RULES_PATH = resolve(__dirname, "../../src/rules/domain-rules.json");
const DEFAULT_SURFACE_INPUT_PATH = resolve(__dirname, "quarantine/surface-input.json");

// ── Core (testable) ────────────────────────────────────────────────────────────

/**
 * Run the full ingestion pipeline: ingest → orchestrate → promote.
 *
 * All I/O paths and dependencies are injectable for unit tests.
 * No default export — named exports only.
 *
 * @param {object} opts
 * @param {import("./adapters/index.mjs").Adapter[]} [opts.adapters]     Defaults to ENABLED_ADAPTERS.
 * @param {typeof fetch}   [opts.fetchImpl]       Injectable fetch. Defaults to global fetch.
 * @param {string}         [opts.candidatesPath]  Intermediate candidates.json path.
 * @param {string}         [opts.promotePath]     promote-candidates.json path.
 * @param {string}         [opts.reportPath]      quarantine-report.json path.
 * @param {string}         [opts.sourcePath]      tools/rules-source/params.json path.
 * @param {string}         [opts.domainRulesPath]    src/rules/domain-rules.json path.
 * @param {string}         [opts.storePath]       tools/rules-source/rules.json path
 *                                                (the normalized source params.json projects from).
 * @param {string}         [opts.surfaceInputPath]   quarantine/surface-input.json path (injectable for tests).
 * @param {string}         [opts.signingKeyPath]  Ed25519 private key PEM path. Fail-closed: if falsy, rejects.
 * @param {readonly string[]} [opts.trustedKeys]  Trusted public keys. Defaults to TRUSTED_PUBLIC_KEYS.
 * @param {SubtleCrypto}   [opts.subtle]          Defaults to globalThis.crypto?.subtle.
 * @param {number}         [opts.version]         Target rules version. If omitted, orchestrate-cli resolves it.
 * @param {Date}           [opts.now]             Injectable clock.
 * @param {string}         [opts.discoveredDir]   Path to discovered artifact JSON files directory.
 *   Forwarded to runOrchestrateCli. Defaults to undefined so orchestrate-cli uses its own default
 *   (repo-root/discovered). An empty or missing directory produces no enrichment (null fields).
 * @param {function}       [opts._verifyOverride] Injectable verify function forwarded to
 *   runOrchestrateCli for tests. Do NOT use in production.
 *
 * @returns {Promise<{
 *   noop: boolean,
 *   written: boolean,
 *   merged: string[],
 *   skipped: Array<{ param: string, reason: string }>,
 *   version: number,
 *   published?: string,
 * }>}
 *
 * @throws {CliError|PromoteError|Error} Bubbles errors from each step with their .exitCode.
 */
export async function runPipeline({
  adapters = ENABLED_ADAPTERS,
  fetchImpl = fetch,
  candidatesPath = DEFAULT_CANDIDATES_PATH,
  promotePath = DEFAULT_PROMOTE_PATH,
  reportPath = DEFAULT_REPORT_PATH,
  sourcePath = DEFAULT_SOURCE_PATH,
  domainRulesPath = DEFAULT_DOMAIN_RULES_PATH,
  storePath,
  surfaceInputPath = DEFAULT_SURFACE_INPUT_PATH,
  signingKeyPath,
  trustedKeys = TRUSTED_PUBLIC_KEYS,
  subtle = globalThis.crypto?.subtle,
  version,
  now,
  discoveredDir,
  _verifyOverride,
} = {}) {
  // ── R4: Fail-closed — validate signing key BEFORE any I/O ─────────────────
  // Mirrors orchestrate-cli key guard to surface the error at the pipeline boundary
  // with a consistent CliError{exitCode:2} shape.
  if (!signingKeyPath) {
    const err = new Error(
      "[pipeline] ERROR: signingKeyPath is required. " +
        "Set MUGA_SIGNING_KEY_PATH or pass signingKeyPath directly."
    );
    // @ts-expect-error — intentional Error extension: exitCode signals process exit code to CLI callers
    err.exitCode = 2;
    throw err;
  }

  // Normalize the injectable clock ONCE so every downstream use (report
  // timestamp, orchestrate, promote) sees the same value — a numeric `now`
  // must coerce to new Date(now) everywhere, not new Date() in one spot.
  const nowDate =
    now instanceof Date ? now : now !== undefined ? new Date(now) : undefined;

  // ── Step 1: Ingest ─────────────────────────────────────────────────────────
  // runIngestion returns { candidates, stats } (#782 quarantine-surface).
  // nowDate.toISOString() converts the normalized Date to the ISO string that
  // runIngestion's `now` parameter expects (#823).
  const { candidates, stats } = await runIngestion({
    adapters,
    fetchImpl,
    quarantineDir: dirname(candidatesPath),
    now: nowDate?.toISOString(),
  });

  // ── CRITICAL: Write report wrapper (NOT bare array) ───────────────────────
  // orchestrate-cli reads `candidateReport.candidates` — bare array breaks it.
  // Mirror exact wrapper shape from ingest.mjs main():
  //   { generatedAt, adapters, candidateCount, candidates, stats }
  const candidateReport = {
    generatedAt: (nowDate ?? new Date()).toISOString(),
    adapters: adapters.map((a) => ({
      id: a.id,
      name: a.name,
      license: a.license,
      url: a.url,
    })),
    candidateCount: candidates.length,
    candidates,
    stats,
  };
  mkdirSync(dirname(candidatesPath), { recursive: true });
  writeFileSync(
    candidatesPath,
    JSON.stringify(candidateReport, null, 2) + "\n",
    "utf8"
  );

  // ── Step 2: Orchestrate ────────────────────────────────────────────────────
  // signingKeyPath is passed via keyPath (no env mutation → testable without env).
  // discoveredDir and _verifyOverride are forwarded when provided (undefined when not set,
  // so orchestrate-cli falls back to its own default).
  await runOrchestrateCli({
    candidatesPath,
    promotePath,
    reportPath,
    version,
    now: nowDate,
    keyPath: signingKeyPath,
    discoveredDir,
    _verifyOverride,
  });

  // ── Step 3: Promote ────────────────────────────────────────────────────────
  const r = await runPromote({
    promotePath,
    sourcePath,
    domainRulesPath,
    // Forwarded so an injected path set stays coherent. promote fails closed if
    // sourcePath is redirected while storePath is not, because reading a fixture
    // and writing the repository's store is never what a caller meant.
    ...(storePath ? { storePath } : {}),
    trustedKeys,
    subtle,
    now: nowDate,
  });

  // ── ADR-5: Write surface-input.json (BOTH branches — noop and non-noop) ──────
  // Reads back quarantine-report.json (written by orchestrate-cli) and combines
  // it with promote skips into a single surface artifact for the formatter step.
  // Written before the noop/non-noop return so it is always emitted on success.
  try {
    const reportObj = JSON.parse(readFileSync(reportPath, "utf8"));
    const surfaceInput = {
      report: reportObj,
      promoteSkipped: r.skipped ?? [],
      noop: r.noop ?? false,
    };
    writeFileSync(surfaceInputPath, JSON.stringify(surfaceInput, null, 2) + "\n", "utf8");
  } catch (surfaceErr) {
    // Non-fatal: surface-input write failure must NOT abort the pipeline result.
    // Log the error for observability but continue to return the pipeline result.
    console.error("[pipeline] WARNING: could not write surface-input.json:", surfaceErr.message);
  }

  // ── R2 + R3: Surface result ────────────────────────────────────────────────
  if (r.noop) {
    return {
      noop: true,
      written: false,
      merged: r.merged ?? [],
      skipped: r.skipped ?? [],
      version: r.version,
      published: r.published ?? null,
    };
  }

  return {
    noop: false,
    written: r.written,
    merged: r.merged,
    skipped: r.skipped,
    version: r.version,
    published: r.published ?? null,
  };
}

// ── Guarded main() ─────────────────────────────────────────────────────────────

/**
 * Testable CLI body. Accepts an injectable `env` map (defaults to process.env)
 * so tests can drive MUGA_SIGNING_KEY_PATH and GITHUB_OUTPUT without mutating
 * the real process environment. Runtime behavior is identical to the old main().
 *
 * Does NOT call process.exit — throws on error so tests can catch it.
 * Returns the pipeline result on success.
 *
 * @param {object} [opts]
 * @param {Record<string, string|undefined>} [opts.env]  Defaults to process.env.
 * @param {object} [opts.pipelineOpts]                   Extra runPipeline overrides (for testing).
 * @returns {Promise<object>} Pipeline result.
 */
export async function runCli({ env = process.env, pipelineOpts = {} } = {}) {
  const signingKeyPath = env.MUGA_SIGNING_KEY_PATH;

  const result = await runPipeline({ signingKeyPath, ...pipelineOpts });

  // Dual-emit noop signal:
  // 1. Last-line JSON to stdout (for local/manual runs)
  const summary = JSON.stringify({
    noop: result.noop,
    written: result.written,
    version: result.version,
  });
  console.log(summary);

  // 2. Append to $GITHUB_OUTPUT if set (for GitHub Actions workflow consumption)
  if (env.GITHUB_OUTPUT) {
    appendFileSync(env.GITHUB_OUTPUT, `noop=${result.noop}\n`, "utf8");
  }

  return result;
}

/**
 * CLI entry point — thin wrapper around runCli().
 * Guard mirrors ingest.mjs: only runs when this file is the entry point.
 */
async function main() {
  try {
    await runCli();
    process.exitCode = 0;
  } catch (err) {
    console.error(err.message ?? err);
    process.exit(err.exitCode ?? 1);
  }
}

if (process.argv[1]?.endsWith("pipeline.mjs")) {
  // main() handles all errors internally (try/catch → process.exit), so it
  // never rejects — no outer .catch needed.
  main();
}
