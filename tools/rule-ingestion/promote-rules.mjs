/**
 * MUGA — promote-rules.mjs (EPIC C, issue #780, v2.3.0)
 *
 * Consumes a signed promote-candidates.json artifact, verifies its Ed25519
 * signature FAIL-CLOSED, skips params colliding with domain preserveParams,
 * and merges surviving params into tools/rules-source/params.json.
 *
 * Usage (manual / CI):
 *   node tools/rule-ingestion/promote-rules.mjs
 *   npm run promote:rules
 *
 * Public API (named exports only — NO default export):
 *   PromoteError          — class extends Error { exitCode }
 *   loadPreservedSet      — (domainRules) → Set<string>
 *   computeMerge          — (currentParams, cleanParams) → { merged, changed }
 *   runPromote            — async ({ promotePath, sourcePath, domainRulesPath,
 *                             trustedKeys?, subtle?, now? }) → result
 *   main                  — guarded entry (mirrors ingest.mjs pattern)
 *
 * Exit codes:
 *   0 — success-merged | success-noop
 *   1 — validation (stale, malformed source, bad schema)
 *   2 — VERIFY_FAILED (fail-closed — bad/missing signature)
 *   3 — I/O (missing/unreadable promote or source file, malformed promote JSON)
 */

import { readFileSync, writeFileSync, renameSync } from "node:fs";

import { emitParams, parseStore, serializeStore, withGlobalParams } from "../rules-store.mjs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifySignature,
  PARAM_FORMAT_RE,
  MAX_PARAM_LEN,
  MIN_PARAM_LEN,
  REMOTE_PARAM_DENYLIST,
  AFFILIATE_PARAM_GUARD,
} from "../../src/lib/remote-rules.js";
import { TRUSTED_PUBLIC_KEYS } from "../../src/lib/remote-rules-keys.js";
import { canonicalMessage } from "./orchestrate.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Constants ─────────────────────────────────────────────────────────────────

/** Freshness window in days — mirror remote-rules.js STALE_DAYS */
const STALE_DAYS = 180;

/**
 * Upper bound on how far a payload's `published` date may lead the current
 * clock. Without it, a future-dated artifact makes (now - published) negative —
 * never exceeding STALE_DAYS — so it would read as "fresh" forever, defeating
 * the replay/restamp defense. Mirrors remote-rules.js CLOCK_SKEW_TOLERANCE_MS.
 * 24 h absorbs legitimate clock skew.
 */
const CLOCK_SKEW_TOLERANCE_MS = 24 * 60 * 60 * 1000;

// ── Production default paths ──────────────────────────────────────────────────

const DEFAULT_PROMOTE_PATH = resolve(
  __dirname,
  "promote/promote-candidates.json"
);
const DEFAULT_SOURCE_PATH = resolve(
  __dirname,
  "../../tools/rules-source/params.json"
);
const DEFAULT_STORE_PATH = resolve(
  __dirname,
  "../../tools/rules-source/rules.json"
);
const DEFAULT_DOMAIN_RULES_PATH = resolve(
  __dirname,
  "../../src/rules/domain-rules.json"
);

// ── PromoteError ──────────────────────────────────────────────────────────────

/**
 * Structured error with an exit code for process.exitCode assignment.
 * Mirrors orchestrate-cli.mjs CliError.
 */
export class PromoteError extends Error {
  /**
   * @param {string} message
   * @param {number} exitCode  0|1|2|3
   */
  constructor(message, exitCode) {
    super(message);
    this.name = "PromoteError";
    this.exitCode = exitCode;
  }
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Builds the union of all `preserveParams` across every domain entry.
 * Entries that omit `preserveParams` are safely skipped via `?? []`.
 *
 * @param {Array<{ domain: string, preserveParams?: string[] }>} domainRules
 * @returns {Set<string>}
 */
export function loadPreservedSet(domainRules) {
  return new Set(domainRules.flatMap((d) => d.preserveParams ?? []));
}

/**
 * Merges cleanParams into currentParams: dedup via Set + sort localeCompare.
 * Returns `changed:false` when the result is identical to currentParams.
 *
 * @param {string[]} currentParams
 * @param {string[]} cleanParams    — already filtered (no preserveParams collisions)
 * @returns {{ merged: string[], changed: boolean }}
 */
export function computeMerge(currentParams, cleanParams) {
  const merged = [...new Set([...currentParams, ...cleanParams])].sort((a, b) =>
    a.localeCompare(b)
  );
  const changed =
    merged.length !== currentParams.length ||
    merged.some((p, i) => p !== currentParams[i]);
  return { merged, changed };
}

// ── Core (testable) ───────────────────────────────────────────────────────────

/**
 * Verifies the signed promote artifact, resolves preserveParams collisions,
 * and merges surviving params into the source params.json.
 *
 * All I/O paths and crypto dependencies are injectable for unit tests.
 *
 * @param {object} [opts]
 * @param {string}          [opts.promotePath]    Path to promote-candidates.json.
 * @param {string}          [opts.sourcePath]     Path to tools/rules-source/params.json.
 * @param {string}          [opts.domainRulesPath] Path to src/rules/domain-rules.json.
 * @param {string}          [opts.storePath]      Path to tools/rules-source/rules.json,
 *                                                the normalized source the artifact projects from.
 * @param {readonly string[]} [opts.trustedKeys]  Defaults to TRUSTED_PUBLIC_KEYS.
 * @param {SubtleCrypto}    [opts.subtle]         Defaults to globalThis.crypto?.subtle.
 * @param {Date}            [opts.now]            Defaults to new Date().
 *
 * @returns {Promise<{
 *   verified: boolean,
 *   merged: string[],
 *   skipped: Array<{ param: string, reason: string }>,
 *   written: boolean,
 *   noop: boolean,
 *   version: number,
 *   published: string | null,
 *   reason?: string,
 * }>}
 *
 * @throws {PromoteError} on fail-closed or validation errors.
 */
export async function runPromote({
  promotePath = DEFAULT_PROMOTE_PATH,
  sourcePath = DEFAULT_SOURCE_PATH,
  domainRulesPath = DEFAULT_DOMAIN_RULES_PATH,
  storePath = DEFAULT_STORE_PATH,
  trustedKeys = TRUSTED_PUBLIC_KEYS,
  subtle = globalThis.crypto?.subtle,
  now = new Date(),
} = {}) {
  // ── Step 0: Refuse an incoherent path set ─────────────────────────────────
  //
  // params.json is a PROJECTION of the store, so the two must describe the same
  // world. A caller that redirects sourcePath at a fixture while leaving
  // storePath at its default would read a temp artifact and write the
  // REPOSITORY's store -- which is exactly what happened the first time this
  // retarget ran against the existing test suite: `npm test` silently rewrote
  // tools/rules-source/rules.json.
  //
  // Fail closed and loudly. A silent repo mutation from a unit test is the kind
  // of fault that is discovered by `git status` days later, if at all.
  if (sourcePath !== DEFAULT_SOURCE_PATH && storePath === DEFAULT_STORE_PATH) {
    throw new PromoteError(
      "CONFIG_ERROR: sourcePath was overridden but storePath was not — refusing " +
        "to write the repository store from a run pointed at a different params.json",
      2
    );
  }

  // ── Step 1: Read + parse source params.json ───────────────────────────────
  let current;
  try {
    const raw = readFileSync(sourcePath, "utf8");
    current = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new PromoteError(
        `MALFORMED_SOURCE: params.json is not valid JSON — ${err.message}`,
        1
      );
    }
    throw new PromoteError(
      `IO_ERROR: cannot read source params.json at ${sourcePath} — ${err.message}`,
      3
    );
  }

  // Validate source schema
  if (!Number.isInteger(current.version)) {
    throw new PromoteError(
      `SCHEMA_ERROR: params.json.version must be an integer, got ${typeof current.version}`,
      1
    );
  }
  if (typeof current.published !== "string") {
    throw new PromoteError(
      `SCHEMA_ERROR: params.json.published must be a string, got ${typeof current.published}`,
      1
    );
  }
  if (!Array.isArray(current.params)) {
    throw new PromoteError(
      `SCHEMA_ERROR: params.json.params must be an array`,
      1
    );
  }

  // ── Step 2: Read + parse promote artifact ─────────────────────────────────
  let art;
  try {
    const raw = readFileSync(promotePath, "utf8");
    art = JSON.parse(raw);
  } catch (err) {
    if (err instanceof SyntaxError) {
      throw new PromoteError(
        `IO_ERROR: promote artifact is not valid JSON — ${err.message}`,
        3
      );
    }
    throw new PromoteError(
      `IO_ERROR: cannot read promote artifact at ${promotePath} — ${err.message}`,
      3
    );
  }

  // Validate artifact schema (missing required fields → exit 1)
  if (
    art.version === undefined ||
    art.published === undefined ||
    !Array.isArray(art.params)
  ) {
    throw new PromoteError(
      `SCHEMA_ERROR: promote artifact is missing required fields (version, published, params)`,
      1
    );
  }
  // Validate that every element in art.params is a string (non-string elements
  // indicate a malformed/tampered artifact — reject before signature check)
  if (!art.params.every((p) => typeof p === "string")) {
    throw new PromoteError(
      `SCHEMA_ERROR: promote artifact params must be an array of strings`,
      1
    );
  }

  // ── Step 3: Verify Ed25519 signature FAIL-CLOSED ──────────────────────────
  // Build canonical from artifact fields (what was signed)
  const canonical = canonicalMessage(art.version, art.published, art.params);
  let ok;
  try {
    // sig: null or missing → verifySignature returns false, but we treat it as fail-closed
    const sigValue = art.sig ?? "";
    ok = await verifySignature(canonical, sigValue, trustedKeys, subtle);
  } catch {
    ok = false;
  }
  if (!ok) {
    throw new PromoteError(
      `VERIFY_FAILED: promote artifact signature invalid or missing`,
      2
    );
  }

  // ── Step 4: Freshness check (STALE_DAYS=180 + future-skew guard) ────────────
  const artPublishedMs = Date.parse(art.published);
  if (
    Number.isNaN(artPublishedMs) ||
    now.getTime() - artPublishedMs > STALE_DAYS * 864e5 ||
    artPublishedMs - now.getTime() > CLOCK_SKEW_TOLERANCE_MS
  ) {
    throw new PromoteError(
      `STALE_ARTIFACT: promote artifact published ${art.published} is outside the accepted freshness window`,
      1
    );
  }

  // Informational log: artifact version looks stale relative to source
  if (art.version <= current.version) {
    console.log(
      `[promote-rules] INFO: artifact.version (${art.version}) <= source.version (${current.version}) — artifact may be stale; proceeding on params delta`
    );
  }

  // ── Step 4b: Param format + denylist + affiliate-guard validation ───────────
  // Applied after sig/freshness so we don't expose format info on unsigned data.
  // Mirrors the REQ-VALIDATE-2/3/4/5 checks in remote-rules.js validateParams.
  //
  // PARAM_FORMAT_ERROR (length/regex) → fatal throw: a malformed param name is an
  // anomaly class distinct from guard/denylist collisions and is kept as exit-1.
  //
  // DENYLIST_HIT / AFFILIATE_GUARD_HIT → SKIP (issue #898): these params are
  // dropped from the promoted artifact and recorded in skipped[]. Aborting the
  // whole run over a single guard-colliding candidate (e.g. `clickid` from
  // AdGuard upstream) discards all ~179 other valid candidates — pure brittleness.
  // Any AFFILIATE_PARAM_GUARD param is rejected by validateParams on fetch and can
  // never be delivered via remote rules; promoting it is a no-op. Skipping is the
  // safe (cheap) direction under the asymmetric-risk principle.
  const guardSkipped = [];
  for (const param of art.params) {
    if (param.length < 1 || param.length > MAX_PARAM_LEN || !PARAM_FORMAT_RE.test(param)) {
      throw new PromoteError(
        `PARAM_FORMAT_ERROR: promote artifact param "${param}" fails format validation (regex or length)`,
        1
      );
    }
    const lower = param.toLowerCase();
    if (REMOTE_PARAM_DENYLIST.has(lower)) {
      console.log(
        `[promote-rules] skip: ${param} is in REMOTE_PARAM_DENYLIST — excluded from promote (issue #898)`
      );
      guardSkipped.push({ param, reason: "REMOTE_PARAM_DENYLIST" });
      continue;
    }
    if (AFFILIATE_PARAM_GUARD.has(lower)) {
      console.log(
        `[promote-rules] skip: ${param} is in AFFILIATE_PARAM_GUARD — excluded from promote (issue #898)`
      );
      guardSkipped.push({ param, reason: "AFFILIATE_PARAM_GUARD" });
      continue;
    }
  }

  // Build the filtered param list: exclude guard/denylist hits found above.
  const filteredArtParams = art.params.filter(
    (p) => !guardSkipped.some((s) => s.param === p)
  );

  // ── Step 5: Build preservedSet + partition art.params ─────────────────────
  // FAIL-CLOSED: missing/unreadable domain-rules.json → exit 3 (I/O); non-array
  // content → exit 1 (validation). No silent empty-set fallback — we cannot
  // safely check preserveParams collisions without the safety list.
  let domainRules;
  try {
    const raw = readFileSync(domainRulesPath, "utf8");
    domainRules = JSON.parse(raw);
  } catch (err) {
    throw new PromoteError(
      `IO_ERROR: cannot read domain-rules.json at ${domainRulesPath} — ${err.message}`,
      3
    );
  }
  if (!Array.isArray(domainRules)) {
    throw new PromoteError(
      `SCHEMA_ERROR: domain-rules.json must be an array, got ${typeof domainRules}`,
      1
    );
  }

  const preservedSet = loadPreservedSet(domainRules);
  // Pre-populate skipped with guard/denylist hits from step 4b (#898).
  const skipped = [...guardSkipped];
  const cleanParams = [];

  for (const param of filteredArtParams) {
    if (preservedSet.has(param)) {
      console.log(
        `[promote-rules] skip: ${param} collides with preserveParams — excluded from merge`
      );
      skipped.push({ param, reason: "collides with preserveParams" });
    } else if (param.length < MIN_PARAM_LEN) {
      // The floor #1218 put on signing and on the runtime validator, but not
      // here. promote kept admitting these, so every non-noop weekly run wrote
      // them into params.json and then died at `sign-rules.mjs` -- the job could
      // only ever succeed when it had nothing to do.
      //
      // Checked AFTER the preserve collision so a short name that is also a
      // preserveParams entry keeps reporting the more specific reason, matching
      // how the denylist and affiliate guard outrank this check upstream.
      //
      // The names this catches are not harmless: the auto-merge list contains
      // `u`, ShareASale's affiliate id and the exact param of #1212. A
      // two-character name is host-scoped upstream; applied globally it is the
      // bug this floor exists to prevent.
      console.log(
        `[promote-rules] skip: ${param} is shorter than ${MIN_PARAM_LEN} characters — excluded from merge`
      );
      skipped.push({ param, reason: "shorter than MIN_PARAM_LEN" });
    } else {
      cleanParams.push(param);
    }
  }

  // ── Step 6: Compute merge ─────────────────────────────────────────────────
  // Sort currentParams before passing so a hand-unsorted source doesn't produce
  // a spurious change detection (FIX-5: idempotency vs unsorted source).
  const sortedCurrentParams = [...current.params].sort((a, b) =>
    a.localeCompare(b)
  );
  const { merged, changed } = computeMerge(sortedCurrentParams, cleanParams);

  // ── Step 7: No-op path ───────────────────────────────────────────────────
  if (!changed) {
    console.log(
      `[promote-rules] no-op: merged params identical to current — no write, no version bump`
    );
    return {
      verified: true,
      merged,
      skipped,
      written: false,
      noop: true,
      version: current.version,
      published: current.published,
    };
  }

  // ── Step 8: Write — ONLY reached after verify+freshness+merge produce change
  const newVersion = current.version + 1;
  const newPublished = now.toISOString();
  // The normalized store is the SOURCE; params.json is its projection. Writing
  // the artifact alone would recreate the two-sources problem the store exists
  // to remove, and the next run's drift test would fail on drift this job
  // introduced itself.
  //
  // `version` and `published` stay owned HERE: the store deliberately does not
  // model signing-flow fields, and a regenerated `published` would invalidate a
  // signature for no reason.
  const nextStore = withGlobalParams(
    parseStore(readFileSync(storePath, "utf8")),
    merged
  );
  const storePayload = serializeStore(nextStore);
  const payload = JSON.stringify(
    { version: newVersion, published: newPublished, params: emitParams(nextStore) },
    null,
    2
  ) + "\n";

  // Both payloads are rendered ABOVE, before either is written. parseStore
  // validates every entry and can throw; a throw between these two writes would
  // leave the store and the artifact disagreeing -- committed drift from the one
  // run that must never produce it.
  writeFileSync(storePath + ".tmp", storePayload, "utf8");
  renameSync(storePath + ".tmp", storePath);
  writeFileSync(sourcePath + ".tmp", payload, "utf8");
  renameSync(sourcePath + ".tmp", sourcePath);

  console.log(
    `[promote-rules] wrote ${sourcePath}: version ${current.version} → ${newVersion}, ` +
      `${merged.length} params (+${merged.length - current.params.length} net), ` +
      `${skipped.length} skipped`
  );

  return {
    verified: true,
    merged,
    skipped,
    written: true,
    noop: false,
    version: newVersion,
    published: newPublished,
  };
}

// ── Guarded main() ────────────────────────────────────────────────────────────

/**
 * CLI entry point. Resolves default paths, runs promote, prints summary JSON,
 * sets process.exitCode.
 *
 * Guard mirrors ingest.mjs:83 — only runs when this file is the entry point.
 */
async function main() {
  let result;
  try {
    result = await runPromote();
    const { written, version, merged, skipped, noop } = result;
    console.log(
      JSON.stringify({
        written,
        version,
        mergedCount: merged.length,
        skippedCount: skipped.length,
        noop,
      })
    );
    process.exitCode = 0;
  } catch (err) {
    if (err instanceof PromoteError) {
      console.error(`[promote-rules] ERROR (exit ${err.exitCode}): ${err.message}`);
      process.exitCode = err.exitCode;
    } else {
      console.error(`[promote-rules] UNEXPECTED ERROR: ${err.message}`);
      process.exitCode = 3;
    }
  }
}

if (process.argv[1]?.endsWith("promote-rules.mjs")) {
  main().catch((err) => {
    console.error(err);
    process.exit(3);
  });
}
