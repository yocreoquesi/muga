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

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUARANTINE_DIR = resolve(__dirname, "quarantine");

/**
 * Fetch + quarantine + normalize every adapter into a candidate set.
 *
 * @param {object} [opts]
 * @param {import("./adapters/index.mjs").Adapter[]} [opts.adapters] Defaults to ENABLED_ADAPTERS.
 * @param {typeof fetch} [opts.fetchImpl] Injectable fetch for testing.
 * @param {string} [opts.quarantineDir] Working dir for raw downloads.
 * @param {string} [opts.now] ISO timestamp override for deterministic output.
 * @returns {Promise<object[]>} Candidates (see candidate.mjs).
 */
export async function runIngestion({
  adapters = ENABLED_ADAPTERS,
  fetchImpl = fetch,
  quarantineDir = QUARANTINE_DIR,
  now,
} = {}) {
  mkdirSync(quarantineDir, { recursive: true });

  const results = [];
  for (const adapter of adapters) {
    const raw = await adapter.fetchRaw({ fetchImpl });
    // Raw bytes land in quarantine ONLY — gitignored, never committed/bundled.
    writeFileSync(resolve(quarantineDir, `${adapter.id}.raw`), raw, "utf8");
    results.push({ id: adapter.id, params: adapter.parse(raw) });
  }

  return mergeCandidates(results, { now });
}

async function main() {
  const candidates = await runIngestion();
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
