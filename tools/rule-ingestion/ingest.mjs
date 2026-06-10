/**
 * MUGA: rule-ingestion entry point (#773).
 *
 * Runs the enabled source adapters, quarantines each raw download, and folds the
 * normalized param sets into the common candidate format (candidate.mjs).
 *
 * Clean-room flow per adapter:
 *   fetchRaw() → write raw bytes to quarantine/<id>.raw  (gitignored, ephemeral)
 *             → parse() into literal param-name facts
 *   mergeCandidates() → derived candidate set
 *
 * The candidate report is written INTO quarantine/ too: it is a working artifact
 * for the EPIC C gates / human review to promote params into TRACKING_PARAMS —
 * not a committed product of this stage. Raw upstream never leaves quarantine,
 * and quarantine never reaches the repo or the bundle (verify-quarantine.mjs).
 *
 * Run with: node tools/rule-ingestion/ingest.mjs   (npm run ingest:rules)
 *
 * runIngestion() is exported with injectable fetch + dirs so it is unit-testable
 * without the network or the real filesystem layout.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { ENABLED_ADAPTERS } from "./adapters/index.mjs";
import { mergeCandidates } from "./candidate.mjs";

/**
 * Sentinel error class for adapter programming-contract violations.
 * Re-thrown immediately (not recorded as a transient failure) because these
 * are bugs in the adapter code itself, not transient upstream problems.
 */
class AdapterContractError extends Error {
  constructor(adapterId, detail) {
    super(`[runIngestion] Adapter "${adapterId}" violated its contract: ${detail}`);
    this.code = "ADAPTER_CONTRACT";
    this.adapterId = adapterId;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUARANTINE_DIR = resolve(__dirname, "quarantine");

/**
 * Fetch + quarantine + normalize every adapter into a candidate set.
 *
 * Per-adapter isolation (#813): each adapter is wrapped in try/catch.
 * A failing adapter records { adapterId, status:'failed', error, admitted:0 }
 * in stats and contributes zero params — the loop continues with remaining
 * adapters. If EVERY adapter fails, runIngestion throws with exitCode:1
 * so the scheduled CI run goes RED instead of silently green.
 *
 * @param {object} [opts]
 * @param {import("./adapters/index.mjs").Adapter[]} [opts.adapters] Defaults to ENABLED_ADAPTERS.
 * @param {typeof fetch} [opts.fetchImpl] Injectable fetch for testing.
 * @param {string} [opts.quarantineDir] Working dir for raw downloads.
 * @param {string} [opts.now] ISO timestamp override for deterministic output.
 * @returns {Promise<{ candidates: object[], stats: { adapters: object[], failedAdapters: number, merged: { emptyDropped: number, total: number } } }>}
 */
export async function runIngestion({
  adapters = ENABLED_ADAPTERS,
  fetchImpl = fetch,
  quarantineDir = QUARANTINE_DIR,
  now,
} = {}) {
  mkdirSync(quarantineDir, { recursive: true });

  const results = [];
  const adapterStats = [];
  let failedAdapters = 0;

  for (const adapter of adapters) {
    try {
      const raw = await adapter.fetchRaw({ fetchImpl });

      // Guard: raw must be a string or Buffer — null/undefined from garbage upstream
      // responses would cause writeFileSync to throw a TypeError, which would previously
      // be re-thrown (crashing the run) due to the `instanceof TypeError` proxy below.
      // Instead, record it as a failed adapter with a clear diagnostic.
      if (raw == null || (typeof raw !== "string" && !Buffer.isBuffer(raw))) {
        failedAdapters++;
        adapterStats.push({
          adapterId: adapter.id,
          status: "failed",
          error: `ADAPTER_BAD_PAYLOAD: ${adapter.id} fetchRaw returned non-string (got ${raw === null ? "null" : typeof raw})`,
          admitted: 0,
          skipped: 0,
          affiliateExcluded: 0,
        });
        continue;
      }

      // Raw bytes land in quarantine ONLY — gitignored, never committed/bundled.
      writeFileSync(resolve(quarantineDir, `${adapter.id}.raw`), raw, "utf8");

      const parseResult = adapter.parse(raw);
      // Programming-contract check: parse() must return { params: Set, ... }.
      // This is a sentinel throw (AdapterContractError) so the catch below can
      // distinguish it from transient I/O / upstream errors. Only AdapterContractError
      // is re-thrown; everything else (including I/O TypeErrors on garbage input) is
      // recorded as a transient failure. (FIX-2: replaces `instanceof TypeError` proxy.)
      if (!parseResult || !(parseResult.params instanceof Set)) {
        throw new AdapterContractError(
          adapter.id,
          `parse() must return { params: Set, skipped, affiliateExcluded } — got ${typeof parseResult}`
        );
      }

      const { params, skipped = 0, affiliateExcluded = 0 } = parseResult;
      results.push({ id: adapter.id, params });
      adapterStats.push({
        adapterId: adapter.id,
        status: "ok",
        admitted: params.size,   // per-adapter count BEFORE cross-adapter dedup
        skipped,
        affiliateExcluded,
      });
    } catch (err) {
      // Re-throw ONLY the named contract-violation sentinel — these are adapter bugs,
      // not transient failures. Everything else (network errors, I/O TypeErrors from
      // garbage payloads, parse internals, etc.) is recorded in stats and the loop
      // continues with remaining adapters.
      if (err.code === "ADAPTER_CONTRACT") throw err;

      // Transient adapter failure (network error, timeout, HTTP 5xx, parse crash, etc.):
      // record it in stats and continue with remaining adapters.
      // NOT a silent skip — the failure is visible in the run stats and report.
      failedAdapters++;
      adapterStats.push({
        adapterId: adapter.id,
        status: "failed",
        error: err.message ?? String(err),
        admitted: 0,
        skipped: 0,
        affiliateExcluded: 0,
      });
    }
  }

  // All-adapters-failed → hard failure: the run must go RED, not silently green.
  // exitCode:1 mirrors the "validation / bad-JSON / empty-source" convention
  // from pipeline.mjs and orchestrate-cli.mjs (exit code comment at top of pipeline.mjs).
  if (failedAdapters === adapters.length && adapters.length > 0) {
    const failureList = adapterStats.map((a) => `${a.adapterId}: ${a.error}`).join("; ");
    const err = new Error(
      `[runIngestion] All adapters failed — ingestion aborted. Failures: ${failureList}`
    );
    // @ts-expect-error — intentional Error extension: exitCode signals process exit code to CLI callers
    err.exitCode = 1;
    throw err;
  }

  const { candidates, emptyDropped } = mergeCandidates(results, { now });
  return {
    candidates,
    stats: {
      adapters: adapterStats,
      failedAdapters,
      merged: { emptyDropped, total: candidates.length }, // total = unique candidates after cross-adapter dedup (NOT sum of per-adapter admitted)
    },
  };
}

async function main() {
  const { candidates, stats } = await runIngestion();
  const report = {
    generatedAt: new Date().toISOString(),
    adapters: ENABLED_ADAPTERS.map((a) => ({
      id: a.id,
      name: a.name,
      license: a.license,
      url: a.url,
    })),
    candidateCount: candidates.length,
    candidates,
    stats,
  };
  const outPath =
    process.env.CANDIDATES_PATH || resolve(QUARANTINE_DIR, "candidates.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2) + "\n", "utf8");
  console.log(
    `Ingestion: ${candidates.length} candidate(s) from ${ENABLED_ADAPTERS.length} adapter(s) → ${outPath}`,
  );
}

if (process.argv[1]?.endsWith("ingest.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
