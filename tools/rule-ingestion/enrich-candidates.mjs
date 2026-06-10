/** MUGA: Enrichment stage — aggregate discovered artifacts into per-param CSF and entropy (#798) */

/**
 * Pure enrichment stage that populates `crossSiteFrequency` and `entropy` on
 * candidate objects before the gate stack runs.
 *
 * Architecture (D1 — pure core + thin I/O wrapper):
 *   aggregateDiscovered(artifacts) → Map<param, {hosts, entSum, entCount}>
 *   enrichCandidates(candidates, artifacts) → new candidates[] (PURE)
 *   readVerifiedArtifacts(discoveredDir, {verify}) → artifacts[] (thin fs wrapper)
 *
 * `enrichCandidates` accepts the raw artifacts array so callers can compose
 * aggregation and enrichment in tests without touching the filesystem.
 *
 * Error semantics (D2 — fail-closed):
 *   JSON parse error → console.warn + skip (enrichment continues, spec §Malformed artifact skipped)
 *   verifyDiscovered failure → CliError exit 3 (fail-closed, defense in depth)
 *
 * Zero npm dependencies — node:fs and node:path only.
 *
 * Named exports only, no default export (project convention):
 *   aggregateDiscovered(artifacts)
 *   enrichCandidates(candidates, artifacts)
 *   readVerifiedArtifacts(discoveredDir, { verify })
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { verifyDiscovered } from "./discovered-verify.mjs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** @type {string} Module prefix for console warnings (matches project style). */
const LOG_PREFIX = "[enrich-candidates]";

// ---------------------------------------------------------------------------
// CliError — mirrors orchestrate-cli.mjs pattern (no shared helper — per ADR)
// ---------------------------------------------------------------------------

/**
 * CLI-boundary error carrying a numeric exit code.
 * Exit 3 is the canonical I/O / integrity error code (mirrors orchestrate-cli.mjs).
 *
 * @extends {Error}
 */
class CliError extends Error {
  /**
   * @param {string} message Human-readable error message.
   * @param {number} exitCode Process exit code (3 for integrity / I/O errors).
   */
  constructor(message, exitCode) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

// ---------------------------------------------------------------------------
// aggregateDiscovered — pure aggregation
// ---------------------------------------------------------------------------

/**
 * Aggregates a list of parsed discovered artifacts into a per-param lookup map.
 *
 * For each candidate across all artifacts:
 *   - `hosts` accumulates distinct `first_seen_on` hostnames (Set → CSF = hosts.size).
 *   - `entSum` and `entCount` accumulate `value_entropy` values so the caller can
 *     compute the arithmetic mean (entCount === 0 → entropy is null for that param).
 *
 * @param {object[]} artifacts - Array of parsed (but not necessarily signature-verified)
 *   artifact objects. Each must have a `candidates` array.
 * @returns {Map<string, {hosts: Set<string>, entSum: number, entCount: number}>}
 *   Per-param aggregate. Empty Map when `artifacts` is empty or contains no candidates.
 */
export function aggregateDiscovered(artifacts) {
  /** @type {Map<string, {hosts: Set<string>, entSum: number, entCount: number}>} */
  const map = new Map();

  for (const artifact of artifacts) {
    const candidates = artifact.candidates;
    if (!Array.isArray(candidates)) {
      continue;
    }

    for (const candidate of candidates) {
      const param = candidate.param;
      if (!param) {
        continue;
      }

      let entry = map.get(param);
      if (!entry) {
        entry = { hosts: new Set(), entSum: 0, entCount: 0 };
        map.set(param, entry);
      }

      // CSF: accumulate distinct first_seen_on hostnames (Set deduplicates automatically).
      if (candidate.first_seen_on) {
        entry.hosts.add(candidate.first_seen_on);
      }

      // Entropy: accumulate only when value_entropy is a finite number (field is optional).
      if (
        "value_entropy" in candidate &&
        typeof candidate.value_entropy === "number" &&
        Number.isFinite(candidate.value_entropy)
      ) {
        entry.entSum += candidate.value_entropy;
        entry.entCount += 1;
      }
    }
  }

  return map;
}

// ---------------------------------------------------------------------------
// enrichCandidates — PURE transform
// ---------------------------------------------------------------------------

/**
 * Produces a new candidates array with `entropy` and `crossSiteFrequency` populated
 * from the aggregated artifact map.
 *
 * Rules (spec §Entropy passthrough, §CSF semantics):
 *   - entropy     = arithmetic mean of value_entropy across artifacts for this param;
 *                   null when no artifact mentioning the param carries value_entropy.
 *   - crossSiteFrequency = count of distinct first_seen_on hostnames for this param;
 *                          null when the param is absent from all artifacts.
 *
 * This function is PURE: it never reads the filesystem. Pass the artifacts array
 * directly (obtained from readVerifiedArtifacts or from test fixtures).
 *
 * @param {object[]} candidates - Pipeline candidate objects (makeCandidate shape).
 * @param {object[]} artifacts  - Parsed artifact objects to aggregate.
 * @returns {object[]} New candidates array (never mutates input).
 */
export function enrichCandidates(candidates, artifacts) {
  const aggregate = aggregateDiscovered(artifacts);

  return candidates.map((candidate) => {
    const entry = aggregate.get(candidate.param);

    let entropy = null;
    let crossSiteFrequency = null;

    if (entry) {
      // crossSiteFrequency: count of distinct hostnames. null when 0 (should not occur
      // if the param is in the map, but guard defensively).
      crossSiteFrequency = entry.hosts.size > 0 ? entry.hosts.size : null;

      // entropy: mean of value_entropy values; null when no artifact carried the field.
      entropy = entry.entCount > 0 ? entry.entSum / entry.entCount : null;
    }

    return { ...candidate, entropy, crossSiteFrequency };
  });
}

// ---------------------------------------------------------------------------
// readVerifiedArtifacts — thin I/O wrapper
// ---------------------------------------------------------------------------

/**
 * Reads every `*.json` file in `discoveredDir`, verifies each artifact, and
 * returns the successfully verified artifacts as a parsed array.
 *
 * Error semantics (D2 — fail-closed):
 *   JSON parse error  → logs a warning and skips the file (enrichment continues).
 *   verify() failure  → throws CliError(exit 3) — fail-closed for integrity protection.
 *
 * The `verify` option is injectable for tests (avoids Ed25519 key setup in unit tests).
 * Default: verifyDiscovered from discovered-verify.mjs.
 *
 * @param {string} discoveredDir - Directory path to scan for `*.json` files.
 * @param {object} [opts] - Optional overrides.
 * @param {function} [opts.verify=verifyDiscovered] - Verification function.
 *   Signature: (artifact: object) => { ok: boolean, code: string }
 * @returns {object[]} Array of verified artifact objects. Empty array when no files found.
 * @throws {CliError} exitCode 3 when any artifact fails verification (signature tamper).
 */
export function readVerifiedArtifacts(discoveredDir, { verify = verifyDiscovered } = {}) {
  /** @type {string[]} */
  let files;

  files = readdirSync(discoveredDir).filter((f) => f.endsWith(".json"));

  if (files.length === 0) {
    return [];
  }

  /** @type {object[]} */
  const results = [];

  for (const file of files) {
    const filePath = join(discoveredDir, file);

    // Step 1: Parse JSON — warn + skip on malformed input (spec §Malformed artifact skipped).
    let artifact;
    try {
      artifact = JSON.parse(readFileSync(filePath, "utf8"));
    } catch (err) {
      console.warn(
        `${LOG_PREFIX} WARN: Skipping ${file} — JSON parse error: ${err.message}`
      );
      continue;
    }

    // Step 2: Verify signature and shape — fail-closed on any failure (D2).
    const result = verify(artifact);
    if (!result.ok) {
      throw new CliError(
        `${LOG_PREFIX} ERROR: Artifact ${file} failed verification (${result.code}). ` +
          `Aborting enrichment — possible tampering detected. Exit 3.`,
        3
      );
    }

    results.push(artifact);
  }

  return results;
}
