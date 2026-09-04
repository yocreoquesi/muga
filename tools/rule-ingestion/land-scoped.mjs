#!/usr/bin/env node
/**
 * MUGA: land-scoped — manual, reviewed landing for scope-admitted facts (#1221, ADR-0008)
 *
 * A weekly ingestion run's `quarantine-report.json` (the UNSIGNED sidecar
 * `orchestrate-cli.mjs` always writes) may carry `scopedAutoMerge[]` — gate-
 * admitted `(param, host)` candidates (ADR-0008, Path A). This tool is the
 * ONLY path that can turn one of those into a committed `scopedFacts[]` entry
 * in the normalized rules store.
 *
 * It is DELIBERATELY NEVER wired into `.github/workflows/auto-ingest-rules.yml`.
 * That workflow squash-auto-merges its own PR (`gh pr merge --squash --auto`),
 * so automatic landing would commit unreviewed host-scoped strip facts to
 * `main` with no human in the loop — a materially different risk than the
 * signed global path, which the corroboration gate (MIN_SIGNALS=2) already
 * protects. A host-scoped fact needs a person to look at it once.
 *
 * All store I/O is delegated to `tools/build-rules-store.mjs` (`loadStore`,
 * `writeAll`) so file access stays in the one module that owns it, and so
 * running this tool re-proves `domain-rules.json`/`params.json` byte identity
 * as a side effect (`writeAll` renders both projections before writing
 * anything).
 *
 * Usage:
 *   node tools/rule-ingestion/land-scoped.mjs --report <quarantine-report.json>
 *
 * Refuses to write (throws, nothing written) when:
 *   - a candidate carries no host scope, or `scope: "*"` (GLOBAL_SCOPE)
 *   - a candidate's param fails the store's own validation (`withScopedFacts`
 *     re-validates every fact via `rules-store.mjs`'s `validateScopedFact`)
 *
 * An empty (or absent) `scopedAutoMerge` is a clean no-op: exit 0, nothing
 * written, one log line. Given today's live data (MIN_SIGNALS=2 unchanged,
 * ClearURLs unscoped, `discovered/` empty) this is the expected outcome — see
 * the near-zero-yield framing recorded in PR A and the design.
 */

import { readFileSync } from "node:fs";

import { GLOBAL_SCOPE, ACTIONS, withScopedFacts } from "../rules-store.mjs";
import { loadStore, writeAll } from "../build-rules-store.mjs";

/**
 * Converts one `scopedAutoMerge` candidate (the shape `orchestrate.mjs`
 * produces: `{ param, scope, signals, firstSeenAt, ... }`) into the store's
 * scoped-fact shape.
 *
 * @param {{param: string, scope: string, signals?: string[], firstSeenAt?: string}} candidate
 * @returns {{scope: string, param: string, action: string, provenance: object}}
 */
function toScopedFact(candidate) {
  return {
    scope: candidate.scope,
    param: candidate.param,
    action: ACTIONS.STRIP,
    provenance: {
      signals: candidate.signals ?? [],
      firstSeenAt: candidate.firstSeenAt ?? null,
      admittedAt: new Date().toISOString(),
    },
  };
}

/**
 * Core landing logic. I/O is injectable so this is unit-testable without the
 * filesystem or the real committed store.
 *
 * @param {object} opts
 * @param {string} opts.reportPath Path to a `quarantine-report.json`.
 * @param {function(string): object} [opts.readReport] Injectable report reader.
 * @param {function(): object} [opts.loadStoreImpl] Injectable store loader (default: build-rules-store's loadStore).
 * @param {function(object): void} [opts.writeAllImpl] Injectable store+artifact writer (default: build-rules-store's writeAll).
 * @returns {{written: boolean, landed: number}}
 * @throws {Error} On a candidate with no host scope, `scope: GLOBAL_SCOPE`, or a fact `withScopedFacts` rejects.
 */
export function runLandScoped(opts) {
  const {
    reportPath,
    readReport = (path) => JSON.parse(readFileSync(path, "utf8")),
    loadStoreImpl = loadStore,
    writeAllImpl = writeAll,
  } = opts;
  const report = readReport(reportPath);
  const scopedAutoMerge = report.scopedAutoMerge ?? [];

  if (scopedAutoMerge.length === 0) {
    console.log("[land-scoped] scopedAutoMerge is empty — nothing to land.");
    return { written: false, landed: 0 };
  }

  // Refuse BEFORE building anything: a report mixing one bad candidate with
  // nine good ones must land NONE of them, not nine — partial landing from an
  // unreviewed sidecar is its own kind of silent corruption.
  for (const candidate of scopedAutoMerge) {
    if (typeof candidate.scope !== "string" || candidate.scope.length === 0) {
      throw new Error(
        `[land-scoped] refusing to land: candidate "${candidate.param}" has no host scope`
      );
    }
    if (candidate.scope === GLOBAL_SCOPE) {
      throw new Error(
        `[land-scoped] refusing to land: candidate "${candidate.param}" carries scope ` +
          `"${GLOBAL_SCOPE}" (GLOBAL_SCOPE) — a scoped fact must name a real host`
      );
    }
  }

  const facts = scopedAutoMerge.map(toScopedFact);
  // withScopedFacts (rules-store.mjs) re-validates every fact on the way in —
  // a malformed param throws there too, so the loop above is not the only
  // guard. Nothing is written until this line returns.
  const nextStore = withScopedFacts(loadStoreImpl(), facts);
  writeAllImpl(nextStore);

  console.log(`[land-scoped] landed ${facts.length} scoped fact(s) into the store.`);
  return { written: true, landed: facts.length };
}

// ── CLI ──────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const idx = argv.indexOf("--report");
  if (idx === -1 || argv[idx + 1] === undefined) {
    throw new Error(
      "[land-scoped] usage: node tools/rule-ingestion/land-scoped.mjs --report <quarantine-report.json>"
    );
  }
  return { reportPath: argv[idx + 1] };
}

if (process.argv[1]?.endsWith("land-scoped.mjs")) {
  try {
    const { reportPath } = parseArgs(process.argv.slice(2));
    runLandScoped({ reportPath });
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
