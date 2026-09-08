#!/usr/bin/env node
/**
 * MUGA: land-scoped — automatic landing for scope-admitted facts (#1221, ADR-0008)
 *
 * A weekly ingestion run's `quarantine-report.json` (the UNSIGNED sidecar
 * `orchestrate-cli.mjs` always writes) may carry `scopedAutoMerge[]` — gate-
 * admitted `(param, host)` candidates (ADR-0008, Path A). This tool is the
 * ONLY path that can turn one of those into a committed `scopedFacts[]` entry
 * in the normalized rules store, and it runs in
 * `.github/workflows/auto-ingest-rules.yml` like every other pipeline stage.
 *
 * ── Why this stopped requiring a person (#1229) ───────────────────────
 * It used to be deliberately unwired, on this reasoning: automatic landing
 * would commit host-scoped strip facts with no gate of their own, unlike the
 * signed global path which the corroboration gate (MIN_SIGNALS=2) protects.
 *
 * That asymmetry no longer exists. The corroboration gate is scope-aware: an
 * anchored candidate answers to SCOPED_MIN_SIGNALS, a threshold chosen for the
 * exact reason ADR-0008 gives — "a HOST-SCOPED one can be admitted on one,
 * because its blast radius is a single site". The scoped path now has a gate
 * built for it, so the argument for a human standing in for one is spent.
 *
 * What still guards this path, none of it human: the affiliate guard (absolute,
 * at ingestion, at signing and at the runtime), the remote denylist, the
 * functional-bias gate, and each host's own preserveParams. What a person was
 * adding on top was judgement about hosts nobody has preserve knowledge for —
 * which is the residual risk #1229 states plainly and which the broken-site
 * report closes, not review.
 *
 * ── Re-landing is a byte-level no-op ─────────────────────────────────
 * `tools/rule-ingestion/quarantine/` is gitignored, so every run rebuilds its
 * candidates from upstream and re-offers ALL of them, not just new ones. That
 * is what makes "land everything, then only ever see the delta" work without
 * any delta machinery: `withScopedFacts` dedupes on `(scope, param)` and pins
 * the provenance timestamps to the first landing, so a fact the store already
 * holds re-lands to identical bytes. Only genuinely new facts show up in the
 * weekly diff.
 *
 * This tool reports whether the store actually MOVED, rather than whether it
 * ran, so the workflow can skip an expensive no-op commit — see `changed`.
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
 * written, one log line.
 */

import { appendFileSync, readFileSync } from "node:fs";

import { GLOBAL_SCOPE, ACTIONS, withScopedFacts, serializeStore } from "../rules-store.mjs";
// The publication contract, imported rather than restated: `sign-rules.mjs`
// refuses a scoped fact on exactly these grounds, so a fact this step lets
// through and the signer rejects would make the WHOLE payload unsignable.
import {
  AFFILIATE_PARAM_GUARD,
  REMOTE_PARAM_DENYLIST,
  hostPreservesParam,
} from "../../src/lib/remote-rules.js";
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
 * Why a candidate the ingestion gates admitted still cannot be published.
 *
 * The EPIC C gates and the publication contract are not the same test, and they
 * were never meant to be. Gate 1 guards against known affiliate PROGRAMS and
 * documents that it deliberately does not consume `AFFILIATE_PARAM_GUARD`,
 * which is broader. `REMOTE_PARAM_DENYLIST` is not consulted at ingestion at
 * all. That gap was harmless while landing was manual — a person stood in it.
 *
 * Measured against the live quarantine, it is not harmless once landing is
 * automatic: of 1608 gate-admitted scoped facts, 36 param names are in
 * `AFFILIATE_PARAM_GUARD`, 18 are in `REMOTE_PARAM_DENYLIST`, and 8
 * `(param, host)` pairs collide with that host's own `preserveParams`.
 *
 * @param {{param: string, scope: string}} candidate
 * @returns {string|null} Why it cannot be published, or null if it can.
 */
function unpublishableReason({ param, scope }) {
  const lower = String(param).toLowerCase();

  // ABSOLUTE, and first because it carries the most specific diagnosis. A name
  // that is an affiliate param anywhere is stripped nowhere, scoped or not:
  // #1212 was an affiliate id applied to the wrong host, and a scoped fact
  // naming one is that catastrophe with a smaller blast radius, not a different
  // kind of thing.
  if (AFFILIATE_PARAM_GUARD.has(lower)) return "AFFILIATE_PARAM_GUARD";

  // Functional on ANY host (`action`, `code`, `email`, `redirect`...), so a
  // scope does not make them safe.
  if (REMOTE_PARAM_DENYLIST.has(lower)) return "REMOTE_PARAM_DENYLIST";

  // Shape is NOT filtered here. A malformed param means the REPORT is broken,
  // which is the same class as a candidate with no host scope: the store's own
  // validation refuses it and the run fails, rather than the pipeline quietly
  // discarding evidence that something upstream of it went wrong.

  // The host's OWN preserve list beats an upstream claim about that host.
  if (hostPreservesParam(scope, lower)) return `${scope} preserves it`;

  return null;
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
 * @returns {{written: boolean, landed: number, changed: boolean, added: number}}
 *   `landed` is how many facts were offered; `added` is how many were NEW.
 *   `changed` is whether the store moved at all — the signal the workflow
 *   routes on, because re-offering facts it already holds must not produce a
 *   commit.
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
    return { written: false, landed: 0, changed: false, added: 0 };
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

  // DROPS the unpublishable ones and lands the rest, rather than refusing the
  // run. Deliberately the opposite posture to the two refusals above, and to
  // `sign-rules.mjs`:
  //
  //   - a candidate with no host scope means the REPORT is malformed, so the
  //     whole run is suspect and refusing is right;
  //   - a hit here means upstream said something MUGA already knows better
  //     about, which is ordinary and expected at this volume. Refusing the run
  //     over one of 1608 facts would mean the weekly pipeline publishes nothing
  //     at all — the exact fragility #1246 had to remove from the signer.
  //
  // The signer's absolute refusal stays as the backstop, and can now only fire
  // if something bypassed this filter.
  const publishable = [];
  const dropped = [];
  for (const candidate of scopedAutoMerge) {
    const reason = unpublishableReason(candidate);
    if (reason) dropped.push(`${candidate.param}@${candidate.scope} (${reason})`);
    else publishable.push(candidate);
  }

  if (dropped.length > 0) {
    console.log(
      `[land-scoped] dropped ${dropped.length} gate-admitted fact(s) the payload cannot carry: ` +
        `${dropped.slice(0, 20).join(", ")}${dropped.length > 20 ? ", …" : ""}`
    );
  }

  if (publishable.length === 0) {
    console.log("[land-scoped] nothing publishable in this report — store unchanged.");
    return { written: false, landed: 0, changed: false, added: 0 };
  }

  const facts = publishable.map(toScopedFact);
  // withScopedFacts (rules-store.mjs) re-validates every fact on the way in —
  // a malformed param throws there too, so the loop above is not the only
  // guard. Nothing is written until this line returns.
  const store = loadStoreImpl();
  const nextStore = withScopedFacts(store, facts);

  // Compared on the SERIALIZED form, which is what actually gets committed.
  // A structural comparison would miss nothing today and everything the day
  // serialization changes; this asks the question the git diff will ask.
  const before = serializeStore(store);
  const after = serializeStore(nextStore);
  const changed = before !== after;
  const added = (nextStore.scopedFacts?.length ?? 0) - (store.scopedFacts?.length ?? 0);

  if (!changed) {
    console.log(
      `[land-scoped] ${facts.length} scoped fact(s) offered, all already landed — store unchanged.`
    );
    return { written: false, landed: facts.length, changed: false, added: 0 };
  }

  writeAllImpl(nextStore);
  console.log(
    `[land-scoped] landed ${facts.length} scoped fact(s); ${added} new to the store.`
  );
  return { written: true, landed: facts.length, changed: true, added };
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
    const result = runLandScoped({ reportPath });
    // Mirrors pipeline.mjs's `noop` convention so the workflow reads both
    // signals the same way. The global path and the scoped path move
    // independently — a week with no new global params can still have new
    // scoped facts, and gating the commit on the global signal alone would mean
    // they never land at all.
    if (process.env.GITHUB_OUTPUT) {
      appendFileSync(process.env.GITHUB_OUTPUT, `changed=${result.changed}\n`);
    }
    console.log(JSON.stringify(result));
  } catch (err) {
    console.error(err.message);
    process.exitCode = 1;
  }
}
