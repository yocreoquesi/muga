/**
 * MUGA — moat-expansion ClearURLs moat adapter (#793).
 *
 * Fetches ClearURLs referralMarketing signals for affiliate-moat gap analysis.
 * This adapter is the SEMANTIC INVERSE of tools/rule-ingestion/adapters/clearurls.mjs:
 *   - rule-ingestion EXCLUDES referralMarketing (affiliate preserve)
 *   - moat-expansion EXTRACTS referralMarketing as the primary signal
 *
 * License context: ClearURLs rules database is LGPL-3.0. We extract
 * referralMarketing tuples as facts (signals-not-copies). Raw file is
 * quarantined and never committed. See tools/rule-ingestion/PROVENANCE.md.
 *
 * Exit code contract (via CliError):
 *   1 — unexpected JSON shape / validation failure
 *   2 — fetch / network failure (non-2xx or thrown error)
 *   3 — I/O write failure (quarantine path unwritable)
 *
 * Public API (named exports only — no default):
 *   fetchRaw({ fetchImpl, url, timeoutMs, quarantinePath })
 *     → Promise<string> — raw JSON text; writes to quarantine before returning
 *   extractReferralSignals(rawText)
 *     → Array<{provider, urlPattern, referralMarketing[]}> — PURE
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { CliError } from "../cli-error.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Canonical upstream URL for ClearURLs rules (data.min.json, master branch).
const SOURCE_URL =
  "https://raw.githubusercontent.com/ClearURLs/Rules/master/data.min.json";

const USER_AGENT =
  "muga-moat-expansion/1.0 (+https://github.com/yocreoquesi/muga)";

// Production default quarantine path (relative to this adapter file).
const DEFAULT_QUARANTINE_PATH = resolve(
  __dirname,
  "../quarantine/clearurls.raw"
);

// ── fetchRaw ─────────────────────────────────────────────────────────────────

/**
 * Fetch the raw ClearURLs rules JSON and write it to the quarantine path.
 *
 * The quarantine directory is created at runtime via mkdirSync (recursive)
 * if it does not exist — mirrors the rule-ingestion convention.
 * The quarantine file is overwritten on each run (no archival of raw bytes).
 *
 * Fail-closed contract: on ANY failure (network, non-2xx, I/O), this
 * function throws a CliError with the appropriate exit code. No partial
 * output is produced.
 *
 * @param {object} [opts]
 * @param {typeof fetch} [opts.fetchImpl] Injectable fetch (default: global fetch). Required for tests.
 * @param {string} [opts.url] Override the upstream URL. Default: SOURCE_URL.
 * @param {number} [opts.timeoutMs] Abort timeout in ms. Default: 30000.
 * @param {string} [opts.quarantinePath] Override the quarantine file path. Default: production path.
 * @returns {Promise<string>} Raw rules JSON text (after writing to quarantine).
 * @throws {CliError} exitCode 2 on fetch/network failure; exitCode 3 on I/O failure.
 */
export async function fetchRaw({
  fetchImpl = globalThis.fetch,
  url = SOURCE_URL,
  timeoutMs = 30_000,
  quarantinePath = DEFAULT_QUARANTINE_PATH,
} = {}) {
  const controller = new AbortController();

  let timer;
  /** @type {Promise<never>} */
  const timeoutPromise = new Promise((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(
        new CliError(
          `[moat-expansion] fetchRaw timeout after ${timeoutMs}ms`,
          2
        )
      );
    }, timeoutMs);
  });

  let rawText;
  try {
    const res = await Promise.race([
      fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT },
        signal: controller.signal,
      }),
      timeoutPromise,
    ]);

    if (!res.ok) {
      throw new CliError(
        `[moat-expansion] fetchRaw: upstream returned ${res.status} ${res.statusText}`,
        2
      );
    }

    rawText = await res.text();
  } catch (err) {
    if (err instanceof CliError) throw err;
    // Network errors, AbortErrors, and other fetch-layer throws → exit 2
    throw new CliError(
      `[moat-expansion] fetchRaw: fetch failed — ${err.message}`,
      2
    );
  } finally {
    clearTimeout(timer);
  }

  // Write raw bytes to quarantine (create dir if needed).
  try {
    mkdirSync(dirname(quarantinePath), { recursive: true });
    writeFileSync(quarantinePath, rawText, "utf8");
  } catch (err) {
    throw new CliError(
      `[moat-expansion] fetchRaw: cannot write quarantine file "${quarantinePath}": ${err.message}`,
      3
    );
  }

  return rawText;
}

// ── extractReferralSignals ────────────────────────────────────────────────────

/**
 * Extract referralMarketing tuples from a ClearURLs rules JSON string.
 *
 * PURE function — no I/O, no side effects. Deterministic on identical input.
 *
 * Extraction rules:
 *   1. Parse JSON. Throw CliError(1) on invalid JSON.
 *   2. Validate providers key is a non-null object. Throw CliError(1) if absent/wrong type.
 *   3. For each provider, collect { provider, urlPattern, referralMarketing[] }.
 *   4. EXCLUDE providers where referralMarketing is empty or absent.
 *   5. Return the filtered array (order matches key-iteration order of providers object).
 *
 * @param {string} rawText Raw ClearURLs rules JSON string.
 * @returns {Array<{provider: string, urlPattern: string, referralMarketing: string[]}>}
 * @throws {CliError} exitCode 1 on invalid JSON or unexpected shape.
 */
export function extractReferralSignals(rawText) {
  let data;
  try {
    data = JSON.parse(rawText);
  } catch (err) {
    throw new CliError(
      `[moat-expansion] extractReferralSignals: invalid JSON — ${err.message}`,
      1
    );
  }

  // Validate shape: providers must be a non-null, non-array object.
  if (
    !data ||
    typeof data !== "object" ||
    !("providers" in data) ||
    !data.providers ||
    typeof data.providers !== "object" ||
    Array.isArray(data.providers)
  ) {
    throw new CliError(
      "[moat-expansion] extractReferralSignals: unexpected shape — missing or invalid 'providers' key",
      1
    );
  }

  const result = [];

  for (const [provider, entry] of Object.entries(data.providers)) {
    // Skip providers with absent or empty referralMarketing
    if (!Array.isArray(entry?.referralMarketing) || entry.referralMarketing.length === 0) {
      continue;
    }

    result.push({
      provider,
      urlPattern: typeof entry.urlPattern === "string" ? entry.urlPattern : "",
      referralMarketing: entry.referralMarketing.slice(), // defensive copy
    });
  }

  return result;
}
