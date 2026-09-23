#!/usr/bin/env node
/**
 * MUGA — reconcile-net-change.mjs (#1344 T3.1: steady-state churn guard)
 *
 * `parseRemoveparamRules`'s design correction C1 folds a host-anchored
 * removeparam name back into promote's GLOBAL candidate pool on every run, by
 * design. `--prefer-anchors` (T3) correctly relocates it back out every time —
 * but that means in STEADY STATE (once #1344's candidates are relocated at
 * all), EVERY weekly run repeats the exact same cycle: promote re-adds the
 * same params (its own `noop` output reads `false` every week, because they
 * are genuinely absent from the CURRENT committed `params[]`), then
 * `--prefer-anchors` relocates the exact same params back out again (its own
 * `changed` output reads `true` every week, for the same reason in reverse).
 * Measured directly (T3.1 week-1/week-2 repro): the NET committed content —
 * `params[]`, `scoped[]`, and the whole store — is BYTE-IDENTICAL between the
 * two runs; only `params.json`'s `version`/`published` moved, and moved
 * TWICE (promote's own bump, then `--prefer-anchors`'s own bump on top of it).
 * Neither `noop` nor `--prefer-anchors`'s own `changed` can see that, because
 * each looks only at its OWN step's before/after, never at the run's net
 * effect against what is actually committed.
 *
 * This tool is the one step that DOES look at that: it compares the working
 * tree's `params.json` (ignoring the signing-flow fields `version`,
 * `published`, `sig` — those are metadata about WHEN, not WHAT) and
 * `rules.json` (byte-for-byte; it carries no signing-flow fields at all)
 * against what `HEAD` — the branch this run started from — actually has
 * committed.
 *
 *   - Identical: nothing publishable moved. Restores both files to HEAD's
 *     exact committed bytes (discarding whatever version bumps the pipeline,
 *     land-scoped or prefer-anchors made along the way) and reports
 *     `changed: false`, so the workflow's combined signal stays quiet and no
 *     version is spent, no signature is produced, no PR opens.
 *   - Different: something real changed. The version is set to EXACTLY
 *     `HEAD`'s version + 1 — a single bump, not one per step that happened to
 *     write this run — and `changed: true` is reported.
 *
 * Usage:
 *   node tools/rule-ingestion/reconcile-net-change.mjs
 *
 * Exit codes: 0 on success (either branch). 1 if HEAD's committed files or
 * the working tree files cannot be read/parsed, or a `git` command fails.
 */

import { readFileSync, writeFileSync, renameSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");

export const DEFAULT_PARAMS_PATH = resolve(REPO_ROOT, "tools", "rules-source", "params.json");
export const DEFAULT_STORE_PATH = resolve(REPO_ROOT, "tools", "rules-source", "rules.json");

/** Paths as `git show HEAD:<path>` expects them — always forward-slashed. */
const RELATIVE_PARAMS_PATH = "tools/rules-source/params.json";
const RELATIVE_STORE_PATH = "tools/rules-source/rules.json";

/** What `git checkout --` restores when nothing net changed. */
const RESTORE_PATH_SPEC = "tools/rules-source";

/**
 * Drops the signing-flow fields so two params.json snapshots compare on
 * CONTENT alone — the `params[]`/`scoped[]` the payload actually carries, not
 * when it happened to be stamped. `scoped` is normalized to `[]` when absent
 * (I1's absent-when-empty convention) so an empty array and a missing key
 * never register as a spurious difference.
 *
 * @param {{params: string[], scoped?: Array<{param: string, hosts: string[]}>}} paramsObj
 * @returns {{params: string[], scoped: Array<{param: string, hosts: string[]}>}}
 */
export function normalizeParamsForCompare(paramsObj) {
  return {
    params: paramsObj.params,
    scoped: paramsObj.scoped ?? [],
  };
}

/**
 * Whether the CONTENT — never the signing-flow metadata — differs between a
 * committed (`head*`) snapshot and the working tree's current (`current*`)
 * one.
 *
 * `rules.json` (the store) carries no signing-flow fields at all and
 * `serializeStore` is deterministic, so it compares byte-for-byte.
 *
 * @param {{headParamsText: string, currentParamsText: string, headStoreText: string, currentStoreText: string}} snapshots
 * @returns {{changed: boolean}}
 */
export function computeNetChange({ headParamsText, currentParamsText, headStoreText, currentStoreText }) {
  const headParams = normalizeParamsForCompare(JSON.parse(headParamsText));
  const currentParams = normalizeParamsForCompare(JSON.parse(currentParamsText));
  const paramsChanged = JSON.stringify(headParams) !== JSON.stringify(currentParams);
  const storeChanged = headStoreText !== currentStoreText;
  return { changed: paramsChanged || storeChanged };
}

/**
 * Rewrites ONLY the top-level `"version": N` field of a params.json TEXT,
 * byte-for-byte otherwise.
 *
 * Deliberately a surgical text replace, never `JSON.parse` + `JSON.stringify`
 * the whole object back out: `renderParamsFile` (tools/build-rules-store.mjs)
 * writes the `scoped` section in a deliberate one-fact-per-line compact
 * format specifically so a weekly diff stays readable, and re-serializing the
 * parsed object with the default 2-space indent would spread ~1000 facts back
 * over ~6800 lines — the exact churn that format exists to prevent.
 *
 * Anchored to the START of a line (`^`, multiline) so a `scoped` fact whose
 * OWN param happens to be named `"version"` (a real committed example:
 * `{"param":"version","hosts":["tally.so"]}`) is never mistaken for the
 * top-level field — that entry is compact JSON with no space after its `:`,
 * while the top-level field is `JSON.stringify(..., null, 2)`-formatted with
 * one, but matching by line-start position is the unambiguous invariant, not
 * incidental spacing.
 *
 * @param {string} paramsText
 * @param {number} version
 * @returns {string}
 * @throws {Error} If no top-level `"version"` field is found.
 */
export function withVersion(paramsText, version) {
  const next = paramsText.replace(/^(\s*"version":\s*)\d+/m, `$1${version}`);
  if (next === paramsText) {
    throw new Error(
      'reconcile-net-change: could not find a top-level "version" field to rewrite'
    );
  }
  return next;
}

/**
 * Core reconciliation. All I/O is injectable for unit tests.
 *
 * @param {object} [opts]
 * @param {string} [opts.paramsPath]
 * @param {string} [opts.storePath]
 * @param {(path: string) => string} [opts.readFile] Reads a working-tree file.
 * @param {(path: string, text: string) => void} [opts.writeFile] Writes a working-tree file.
 * @param {(relativePath: string) => string} [opts.readHead] Reads `HEAD:<relativePath>`.
 * @param {() => void} [opts.restore] Restores the working tree's rules-source files to HEAD.
 * @returns {{changed: boolean, version?: number}}
 */
export function runReconcile({
  paramsPath = DEFAULT_PARAMS_PATH,
  storePath = DEFAULT_STORE_PATH,
  readFile = (path) => readFileSync(path, "utf8"),
  writeFile = (path, text) => {
    writeFileSync(`${path}.tmp`, text, "utf8");
    renameSync(`${path}.tmp`, path);
  },
  readHead = (relativePath) =>
    execFileSync("git", ["show", `HEAD:${relativePath}`], { cwd: REPO_ROOT, encoding: "utf8" }),
  restore = () => {
    execFileSync("git", ["checkout", "--", RESTORE_PATH_SPEC], { cwd: REPO_ROOT });
  },
} = {}) {
  const headParamsText = readHead(RELATIVE_PARAMS_PATH);
  const headStoreText = readHead(RELATIVE_STORE_PATH);
  const currentParamsText = readFile(paramsPath);
  const currentStoreText = readFile(storePath);

  const { changed } = computeNetChange({
    headParamsText,
    currentParamsText,
    headStoreText,
    currentStoreText,
  });

  if (!changed) {
    restore();
    return { changed: false };
  }

  // A SINGLE bump over HEAD, however many steps in this run each bumped their
  // own +1 (promote and/or --prefer-anchors) — the run published exactly one
  // net change, so it gets exactly one version.
  const headVersion = JSON.parse(headParamsText).version;
  const targetVersion = headVersion + 1;
  const currentVersion = JSON.parse(currentParamsText).version;
  if (currentVersion !== targetVersion) {
    writeFile(paramsPath, withVersion(currentParamsText, targetVersion));
  }
  return { changed: true, version: targetVersion };
}

// ── CLI ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  try {
    const result = runReconcile();
    if (result.changed) {
      console.log(
        `[reconcile-net-change] net content differs from HEAD — version set to ${result.version}`
      );
    } else {
      console.log(
        "[reconcile-net-change] net content identical to HEAD (ignoring version/published/sig) " +
          "— restored tools/rules-source to HEAD, nothing to publish this run"
      );
    }
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\n`);
    }
  } catch (err) {
    console.error(`[reconcile-net-change] ${err.message}`);
    process.exitCode = 1;
  }
}
