/**
 * MUGA: verify-quarantine — CI gate for the rule-ingestion quarantine zone (#772).
 *
 * Asserts that raw upstream data can never be committed to the repo or shipped
 * in the extension bundle. The quarantine working dir holds the literal bytes of
 * upstream tracker lists during ingestion; those bytes are signals only and must
 * stay ephemeral (see tools/rule-ingestion/README.md for the clean-room rationale).
 *
 * Three invariants, any failure exits non-zero:
 *
 *   1. NO TRACKED FILES — `git ls-files` reports nothing under quarantine/.
 *   2. GITIGNORED       — the quarantine path is listed in .gitignore.
 *   3. OUTSIDE src/     — the bundle is built from src/ only, so a quarantine
 *                         path outside src/ physically cannot reach dist/.
 *
 * Run with: node tools/rule-ingestion/verify-quarantine.mjs  (npm run verify:quarantine)
 *
 * Pure helpers are exported for unit testing; the git invocation and process
 * exit live in main() so the module is import-safe.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** Repo-relative quarantine working dir. Trailing slash = directory match. */
export const QUARANTINE_PATH = "tools/rule-ingestion/quarantine/";

/**
 * Invariant 2: is the quarantine path gitignored?
 *
 * Matches the directory pattern with or without a trailing slash and tolerates
 * a leading `/` anchor, so `tools/rule-ingestion/quarantine/`,
 * `/tools/rule-ingestion/quarantine`, etc. all count.
 *
 * @param {string} gitignoreText Raw .gitignore contents.
 * @param {string} [quarantinePath=QUARANTINE_PATH] Path to look for.
 * @returns {boolean}
 */
export function isGitignored(gitignoreText, quarantinePath = QUARANTINE_PATH) {
  const bare = quarantinePath.replace(/\/+$/, "");
  for (const rawLine of gitignoreText.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const normalized = line.replace(/^\/+/, "").replace(/\/+$/, "");
    if (normalized === bare) return true;
  }
  return false;
}

/**
 * Invariant 3: does the quarantine path live outside src/?
 *
 * @param {string} [quarantinePath=QUARANTINE_PATH] Path to check.
 * @returns {boolean} True when the path is NOT under src/.
 */
export function isOutsideSrc(quarantinePath = QUARANTINE_PATH) {
  const normalized = quarantinePath.replace(/^\/+/, "");
  return !normalized.startsWith("src/");
}

/**
 * Invariant 1: list git-tracked files under the quarantine path.
 *
 * @param {string} [quarantinePath=QUARANTINE_PATH] Path to scan.
 * @returns {string[]} Tracked file paths (empty when the invariant holds).
 */
export function listTrackedQuarantineFiles(quarantinePath = QUARANTINE_PATH) {
  const out = execSync(`git ls-files -- "${quarantinePath}"`, {
    encoding: "utf8",
  });
  return out
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

function main() {
  const errors = [];

  const tracked = listTrackedQuarantineFiles();
  if (tracked.length > 0) {
    errors.push(
      `Quarantine contains ${tracked.length} tracked file(s) — raw upstream must never be committed:\n` +
        tracked.map((f) => `  - ${f}`).join("\n"),
    );
  }

  const gitignore = readFileSync(".gitignore", "utf8");
  if (!isGitignored(gitignore)) {
    errors.push(`Quarantine path '${QUARANTINE_PATH}' is not listed in .gitignore.`);
  }

  if (!isOutsideSrc()) {
    errors.push(
      `Quarantine path '${QUARANTINE_PATH}' is under src/ — it could be bundled into dist/.`,
    );
  }

  if (errors.length > 0) {
    console.error("Quarantine invariant violation(s):\n");
    console.error(errors.join("\n\n"));
    process.exit(1);
  }

  console.log("Quarantine gate OK: no tracked raw upstream, gitignored, outside src/.");
}

if (process.argv[1]?.endsWith("verify-quarantine.mjs")) {
  main();
}
