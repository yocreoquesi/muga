#!/usr/bin/env node
/**
 * MUGA — orchestrate-cli.mjs (EPIC C, issue #779, v2.3.0)
 *
 * Thin CLI: read candidates → orchestrate → sign → write artifacts.
 * Pure decision logic lives in orchestrate.mjs (zero I/O, zero crypto).
 *
 * Usage:
 *   node tools/rule-ingestion/orchestrate-cli.mjs
 *   npm run orchestrate:rules
 *
 * Environment variables:
 *   MUGA_SIGNING_KEY_PATH  (required)  Path to Ed25519 private key PEM file.
 *                                      Do NOT pass key material via CLI args.
 *   MUGA_RULES_VERSION     (optional)  Override target version integer.
 *   CANDIDATES_PATH        (optional)  Override candidates.json path.
 *
 * CLI flags:
 *   --version <n>  Target source version (overridden by MUGA_RULES_VERSION env).
 *
 * Exit codes (mirrors sign-rules.mjs):
 *   0 — success
 *   1 — validation / bad-JSON / empty-source
 *   2 — signing setup (missing/unreadable key)
 *   3 — I/O error
 *
 * Security rules:
 *   - Private key only via MUGA_SIGNING_KEY_PATH — never CLI args (shell history).
 *   - Key material never on stdout.
 *   - No npm dependencies — node:crypto and node:fs only.
 */

import { sign as cryptoSign, createPrivateKey, createHash } from "node:crypto";
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  runOrchestration,
  canonicalMessage,
} from "./orchestrate.mjs";

import {
  readVerifiedArtifacts,
  enrichCandidates,
} from "./enrich-candidates.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Paths (production defaults) ───────────────────────────────────────────────

const DEFAULT_CANDIDATES_PATH = resolve(
  __dirname,
  "quarantine/candidates.json"
);
const DEFAULT_PROMOTE_PATH = resolve(
  __dirname,
  "promote/promote-candidates.json"
);
const DEFAULT_REPORT_PATH = resolve(
  __dirname,
  "quarantine/quarantine-report.json"
);
const PARAMS_JSON_PATH = resolve(
  __dirname,
  "../../tools/rules-source/params.json"
);

const DEFAULT_DISCOVERED_DIR = resolve(__dirname, "../../discovered");

// ── CLI exit error helper ─────────────────────────────────────────────────────

class CliError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

// ── Core (testable) ───────────────────────────────────────────────────────────

/**
 * Orchestrate candidates, sign, and write artifacts.
 *
 * Injectable for unit tests — all I/O paths and key material can be overridden.
 *
 * @param {object} opts
 * @param {string} [opts.candidatesPath]    Path to candidates.json (default: quarantine/candidates.json)
 * @param {string} [opts.promotePath]       Path to write promote-candidates.json (default: promote/...)
 * @param {string} [opts.reportPath]        Path to write quarantine-report.json (default: quarantine/...)
 * @param {number} [opts.version]           Target rules version (overrides env/file fallback when set)
 * @param {Date}   [opts.now]               Injectable clock for deterministic published timestamp
 * @param {string} [opts.keyPath]           Path to Ed25519 PEM private key (overrides MUGA_SIGNING_KEY_PATH)
 * @param {string} [opts.discoveredDir]     Path to directory of discovered artifact JSON files.
 *   Defaults to `<repo-root>/discovered`. An empty or missing directory produces no enrichment
 *   (entropy and crossSiteFrequency remain null). A file that fails signature verification
 *   throws CliError(3) (fail-closed — see enrich-candidates.mjs D2).
 * @param {function} [opts._verifyOverride] Injectable verify function for tests. Passed through
 *   to readVerifiedArtifacts as the `verify` option. Do NOT use in production.
 * @returns {Promise<void>}
 * @throws {CliError} with .exitCode 2 on key errors, 1 on validation, 3 on I/O
 */
export async function runOrchestrateCli({
  candidatesPath,
  promotePath,
  reportPath,
  version: versionOpt,
  now,
  keyPath,
  discoveredDir,
  _verifyOverride,
} = {}) {
  // ── 1. Resolve paths ────────────────────────────────────────────────────────
  const resolvedCandidatesPath =
    candidatesPath ||
    process.env.CANDIDATES_PATH ||
    DEFAULT_CANDIDATES_PATH;

  const resolvedPromotePath = promotePath || DEFAULT_PROMOTE_PATH;
  const resolvedReportPath = reportPath || DEFAULT_REPORT_PATH;

  // ── 2. Load signing key (exit 2 if missing/unreadable) ─────────────────────
  const resolvedKeyPath =
    keyPath || process.env.MUGA_SIGNING_KEY_PATH;

  if (!resolvedKeyPath) {
    throw new CliError(
      "[orchestrate-cli] ERROR: MUGA_SIGNING_KEY_PATH env var is not set.\n" +
        "  Set it to the path of the Ed25519 private key PEM file.",
      2
    );
  }

  let privateKey;
  try {
    const keyPem = readFileSync(resolvedKeyPath, "utf8");
    privateKey = createPrivateKey({ key: keyPem, format: "pem" });
  } catch (err) {
    throw new CliError(
      `[orchestrate-cli] ERROR: Cannot read private key from "${resolvedKeyPath}": ${err.message}`,
      2
    );
  }

  // ── 3. Read candidates ──────────────────────────────────────────────────────
  let rawCandidates;
  try {
    rawCandidates = readFileSync(resolvedCandidatesPath, "utf8");
  } catch (err) {
    throw new CliError(
      `[orchestrate-cli] ERROR: Cannot read candidates file "${resolvedCandidatesPath}": ${err.message}`,
      3
    );
  }

  let candidateReport;
  try {
    candidateReport = JSON.parse(rawCandidates);
  } catch (err) {
    throw new CliError(
      `[orchestrate-cli] ERROR: candidates.json is not valid JSON: ${err.message}`,
      1
    );
  }

  const parsedCandidates = candidateReport.candidates;
  if (!Array.isArray(parsedCandidates)) {
    throw new CliError(
      "[orchestrate-cli] ERROR: candidates.json must have a .candidates array",
      1
    );
  }

  // ── 3b. Enrich candidates with discovered artifact data ────────────────────
  // readVerifiedArtifacts + enrichCandidates run BEFORE runOrchestration so that
  // the corroboration gate's entropy and CSF arms have populated values.
  //
  // Contracts honoured here:
  //   S1 — enrichCandidates RETURNS A NEW ARRAY; we consume the returned value.
  //   S2 — readVerifiedArtifacts throws CliError(3) on sig failure; that error
  //        propagates out of this function and is caught by main()'s try/catch
  //        which calls process.exit(err.exitCode ?? 3) — exit-3 reaches the boundary.
  //
  // Empty/missing directory → readVerifiedArtifacts returns [] → enrichCandidates
  // produces null fields → candidates flow through unchanged (no throw).
  const resolvedDiscoveredDir = discoveredDir || DEFAULT_DISCOVERED_DIR;
  const verifyOpts = _verifyOverride ? { verify: _verifyOverride } : {};
  const artifacts = readVerifiedArtifacts(resolvedDiscoveredDir, verifyOpts);
  const candidates = enrichCandidates(parsedCandidates, artifacts);

  // ── 4. Resolve version ──────────────────────────────────────────────────────
  // Precedence: MUGA_RULES_VERSION env → versionOpt (injectable / --version arg) → params.json fallback
  let version = versionOpt;

  if (process.env.MUGA_RULES_VERSION !== undefined) {
    const parsed = parseInt(process.env.MUGA_RULES_VERSION, 10);
    if (!Number.isInteger(parsed)) {
      throw new CliError(
        `[orchestrate-cli] ERROR: MUGA_RULES_VERSION must be an integer, got "${process.env.MUGA_RULES_VERSION}"`,
        1
      );
    }
    version = parsed;
  }

  if (version === undefined) {
    // Last-resort fallback: read tools/rules-source/params.json
    try {
      const paramsJson = JSON.parse(readFileSync(PARAMS_JSON_PATH, "utf8"));
      version = paramsJson.version;
    } catch (err) {
      throw new CliError(
        `[orchestrate-cli] ERROR: Cannot resolve version — MUGA_RULES_VERSION unset, no --version arg, and cannot read params.json: ${err.message}`,
        1
      );
    }
  }

  if (!Number.isInteger(version)) {
    throw new CliError(
      `[orchestrate-cli] ERROR: Resolved version is not an integer: ${version}`,
      1
    );
  }

  // ── 5. Resolve published ────────────────────────────────────────────────────
  // CLI boundary: Date lives here, never in the pure module.
  const published = (now instanceof Date ? now : new Date()).toISOString();

  // ── 6. Run orchestration ────────────────────────────────────────────────────
  const { autoMerge, quarantine, acceptances, artifactBody, scopedAutoMerge } = runOrchestration({
    candidates,
    version,
    published,
  });

  // ── 6b. Accepted-arm audit trail (#878) ─────────────────────────────────────
  // Surface WHICH corroboration arm rescued each auto-merged param so a reviewer
  // sees why something passed without re-running the gate (no-silent-decisions).
  // Lives in the UNSIGNED sidecar only — the signed promote artifact stays
  // {version, published, params, sig} by contract (orchestrate-cli R5-S1).
  // passedArm is null if the corroboration gate did not run / emit it.
  const autoMergeAudit = acceptances.map(({ candidate, accepted }) => {
    const corrob = accepted.find((a) => a.gate === "corroboration-gate");
    return { param: candidate.param, passedArm: corrob?.passedArm ?? null };
  });

  // Rescue-arm distribution: the data that justifies recalibrating the heuristic
  // floors (ENTROPY_FLOOR, CSF_FLOOR) once real crawler artifacts accumulate.
  const passedArmDistribution = autoMergeAudit.reduce(
    (dist, { passedArm }) => {
      if (passedArm) dist[passedArm] += 1;
      return dist;
    },
    { signals: 0, entropy: 0, csf: 0 }
  );

  // ── 7. Sign the canonical message ───────────────────────────────────────────
  // Inline sign block — mirrors sign-rules.mjs:211-215 verbatim (ADR: no shared helper)
  const canonical = canonicalMessage(
    artifactBody.version,
    artifactBody.published,
    artifactBody.params
  );

  let sigBuf;
  try {
    sigBuf = cryptoSign(null, Buffer.from(canonical, "utf8"), privateKey);
  } catch (err) {
    throw new CliError(
      `[orchestrate-cli] ERROR: Signing failed: ${err.message}`,
      2
    );
  }

  // base64url encode (URL-safe, no padding) — sign-rules.mjs:211-215
  const sig = sigBuf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  // ── 8. Write signed promote artifact ────────────────────────────────────────
  // Canonical JSON (literal key order matches docs/rules/v1/params.json contract)
  const promoteOut = {
    version: artifactBody.version,
    published: artifactBody.published,
    params: artifactBody.params,
    sig,
  };

  // One shared variable for both write and hash — they can never drift.
  const promoteFileContent = JSON.stringify(promoteOut, null, 2) + "\n";

  try {
    mkdirSync(dirname(resolvedPromotePath), { recursive: true });
    const tmpPath = resolvedPromotePath + ".tmp";
    writeFileSync(tmpPath, promoteFileContent, "utf8");
    renameSync(tmpPath, resolvedPromotePath);
  } catch (err) {
    throw new CliError(
      `[orchestrate-cli] ERROR: Cannot write promote artifact to "${resolvedPromotePath}": ${err.message}`,
      3
    );
  }

  // ── 9. Write unsigned audit sidecar (write-always, R8-S2) ──────────────────
  // Slice 2 (rules-scope-normalization): `scopedAutoMerge`/`scopedAutoMergeCount`
  // land HERE, in the unsigned sidecar, only. The signed promote artifact stays
  // exactly {version, published, params, sig} (pinned above) — a scoped
  // candidate never reaches it, by construction of buildParams/runOrchestration.
  const reportOut = {
    generatedAt: published,
    autoMergeCount: autoMerge.length,
    quarantineCount: quarantine.length,
    passedArmDistribution, // #878 — rescue-arm counts over auto-merged candidates
    ingestStats: candidateReport.stats ?? null,  // null-safe: tolerates stats-less old candidates.json (#782)
    autoMerge: autoMergeAudit, // #878 — per-param { param, passedArm } accept trail
    scopedAutoMerge, // Slice 2 — full candidate objects that cleared every gate but carry a scope
    scopedAutoMergeCount: scopedAutoMerge.length, // Slice 2
    quarantine, // full QuarantineEntry[] with candidate + rejections
  };

  try {
    mkdirSync(dirname(resolvedReportPath), { recursive: true });
    writeFileSync(
      resolvedReportPath,
      JSON.stringify(reportOut, null, 2) + "\n",
      "utf8"
    );
  } catch (err) {
    throw new CliError(
      `[orchestrate-cli] ERROR: Cannot write quarantine report to "${resolvedReportPath}": ${err.message}`,
      3
    );
  }

  // ── 10. One-line JSON stdout summary (no key material) ──────────────────────
  // Hash is computed over the EXACT bytes written to disk (same string, same encoding).
  const sha256 = createHash("sha256")
    .update(promoteFileContent, "utf8")
    .digest("hex");

  console.log(
    JSON.stringify({
      promote: resolvedPromotePath,
      report: resolvedReportPath,
      version: artifactBody.version,
      autoMergeCount: autoMerge.length,
      quarantineCount: quarantine.length,
      scopedAutoMergeCount: scopedAutoMerge.length, // Slice 2
      passedArmDistribution, // #878
      sha256,
    })
  );
}

// ── main() entry ─────────────────────────────────────────────────────────────

async function main() {
  // Parse --version flag from argv
  const args = process.argv.slice(2);
  let versionArg;
  const vIdx = args.indexOf("--version");
  if (vIdx !== -1 && args[vIdx + 1] !== undefined) {
    versionArg = parseInt(args[vIdx + 1], 10);
    if (!Number.isInteger(versionArg)) {
      console.error(
        `[orchestrate-cli] ERROR: --version must be an integer, got "${args[vIdx + 1]}"`
      );
      process.exit(1);
    }
  }

  try {
    await runOrchestrateCli({ version: versionArg });
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(err.exitCode ?? 3);
  }
}

if (process.argv[1]?.endsWith("orchestrate-cli.mjs")) {
  main().catch((err) => {
    console.error(err.message ?? err);
    process.exit(err.exitCode ?? 3);
  });
}
