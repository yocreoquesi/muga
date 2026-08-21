/**
 * MUGA: build-rules-store — the I/O wrapper around tools/rules-store.mjs
 *
 * `rules-store.mjs` is pure so its projections can be proven byte-identical in a
 * unit test without touching disk. Everything that reads or writes a file lives
 * here, so the purity guarantee has exactly one place it could be broken.
 *
 * ── Modes ─────────────────────────────────────────────────────────────
 *
 *   node tools/build-rules-store.mjs --import
 *       Artifacts → store. The one-time bootstrap, and the way to re-sync if a
 *       writer that has not been retargeted yet edits an artifact directly.
 *
 *   node tools/build-rules-store.mjs
 *       Store → artifacts. This is the direction that matters: the store is the
 *       source, the artifacts are projections.
 *
 *   node tools/build-rules-store.mjs --check
 *       Emit and COMPARE, writing nothing. A developer affordance — the
 *       enforcement lives in tests/unit/rules-store-roundtrip.test.mjs, which
 *       runs under `npm test` in CI and locally, matching how
 *       generate-strip-table.mjs is guarded by strip-table-generated.test.mjs.
 *
 * ── Why params.json is read before it is written ──────────────────────
 *
 * `params.json` carries `version` and `published` alongside `params`, and those
 * belong to the signing flow. Rewriting the whole object from the store would
 * author fields this tool has no business authoring — a regenerated `published`
 * would invalidate a signature for no reason. So the existing file is read and
 * only its `params` array is replaced.
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  emitDomainRules,
  emitParams,
  importArtifacts,
  parseStore,
  serializeStore,
} from "./rules-store.mjs";

export { withDomainRules, withGlobalParams } from "./rules-store.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

export const STORE_PATH = path.join(REPO_ROOT, "tools", "rules-source", "rules.json");
export const DOMAIN_RULES_PATH = path.join(REPO_ROOT, "src", "rules", "domain-rules.json");
export const PARAMS_PATH = path.join(REPO_ROOT, "tools", "rules-source", "params.json");

/** Reads a UTF-8 file verbatim — no normalization, so byte comparisons stay honest. */
function read(file) {
  return readFileSync(file, "utf8");
}

/**
 * Writes UTF-8 with the string's own line endings.
 *
 * The emitters build LF explicitly and `.gitattributes` pins
 * `src/rules/domain-rules.json` to `eol=lf` so the web-engine byte-identity
 * mirror holds on every platform. Node does not translate line endings, but
 * saying so here is cheaper than rediscovering it on a Windows checkout with
 * `core.autocrlf=true`.
 */
function write(file, contents) {
  // Atomic: write beside the target, then rename over it. `promote-rules.mjs`
  // runs unattended every Sunday and has always written this way, so delegating
  // its writes here must not quietly downgrade that guarantee — a half-written
  // params.json would be served to every user by the publish workflow.
  writeFileSync(`${file}.tmp`, contents, "utf8");
  renameSync(`${file}.tmp`, file);
}

/** Renders params.json with a replaced `params` array, preserving every other field. */
function renderParamsFile(existingText, params) {
  const current = JSON.parse(existingText);
  return `${JSON.stringify({ ...current, params }, null, 2)}\n`;
}

/** Artifacts → store. */
export function runImport() {
  const domainRules = JSON.parse(read(DOMAIN_RULES_PATH));
  const params = JSON.parse(read(PARAMS_PATH)).params;
  const store = importArtifacts(domainRules, params);
  write(STORE_PATH, serializeStore(store));
  return { entries: store.entries.length };
}

/**
 * Store → artifact contents, as strings. Shared by the write and check paths so
 * they can never diverge.
 */
export function renderArtifacts(store = parseStore(read(STORE_PATH)), paramsMeta = null) {
  const base = paramsMeta
    ? JSON.stringify({ ...JSON.parse(read(PARAMS_PATH)), ...paramsMeta })
    : read(PARAMS_PATH);
  return {
    domainRules: emitDomainRules(store),
    params: renderParamsFile(base, emitParams(store)),
  };
}

/**
 * Persists a store and both of its projections.
 *
 * Everything is RENDERED BEFORE ANYTHING IS WRITTEN. `emitDomainRules` throws on
 * an entry the legacy schema cannot represent, and a throw partway through the
 * writes would leave the store updated with artifacts that no longer match it —
 * drift committed by the very run that was supposed to prevent it.
 *
 * @param {object} store
 * @param {{version?: number, published?: string}|null} [paramsMeta]
 *   Overrides for params.json's signing-flow fields. `promote-rules.mjs` owns
 *   the version bump; the store deliberately does not model those fields.
 */
export function writeAll(store, paramsMeta = null) {
  const rendered = renderArtifacts(store, paramsMeta);
  const serialized = serializeStore(store);

  write(STORE_PATH, serialized);
  write(DOMAIN_RULES_PATH, rendered.domainRules);
  write(PARAMS_PATH, rendered.params);
}

/** Reads and validates the committed store. */
export function loadStore() {
  return parseStore(read(STORE_PATH));
}

/** Store → artifacts, written to disk. */
export function runBuild() {
  writeAll(loadStore());
}

/**
 * Compares projections against what is committed.
 *
 * @returns {string[]} Paths that have drifted — empty when everything matches.
 */
export function runCheck() {
  const rendered = renderArtifacts();
  const drifted = [];
  if (rendered.domainRules !== read(DOMAIN_RULES_PATH)) drifted.push(DOMAIN_RULES_PATH);
  if (rendered.params !== read(PARAMS_PATH)) drifted.push(PARAMS_PATH);
  return drifted;
}

// ── CLI ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    if (process.argv.includes("--import")) {
      const { entries } = runImport();
      console.log(`[rules-store] imported ${entries} entries into ${STORE_PATH}`);
    } else if (process.argv.includes("--check")) {
      const drifted = runCheck();
      if (drifted.length > 0) {
        for (const file of drifted) {
          console.error(
            `[rules-store] ${path.relative(REPO_ROOT, file)} has drifted from the store — ` +
              `run \`npm run build:rules-store\``
          );
        }
        process.exitCode = 1;
      }
    } else {
      runBuild();
      console.log("[rules-store] projections written");
    }
  } catch (err) {
    // Report the message, not the stack: emitDomainRules throws a diagnosis
    // naming the offending scope and params, and a stack buries it.
    console.error(`[rules-store] ${err.message}`);
    process.exitCode = 1;
  }
}
