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
 *   node tools/build-rules-store.mjs --prefer-anchors
 *       #1344: relocates a qualifying param (host-anchored in domain-rules.json,
 *       absent from TRACKING_PARAMS, still published globally) from the global
 *       list to its own anchors, when the anchored facts fit the publish budget.
 *       Re-runnable at any time — the predicate is derived from the store on
 *       every run, never a hardcoded list — and a no-op writes nothing. Bumps
 *       params.json's version by hand when it changes `params[]`, matching the
 *       precedent set by #1342 (8502bd8).
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
  ACTIONS,
  GLOBAL_SCOPE,
  emitDomainRules,
  emitParams,
  emitScoped,
  importArtifacts,
  parseStore,
  serializeStore,
  withGlobalParams,
  withScopedFacts,
} from "./rules-store.mjs";
import { TRACKING_PARAMS } from "../src/lib/affiliates-data.js";
import { AFFILIATE_PARAM_GUARD, REMOTE_PARAM_DENYLIST } from "../src/lib/remote-rules.js";

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

/**
 * How many bytes of published payload the scoped section may occupy.
 *
 * SEPARATE from the runtime's `MAX_PAYLOAD_BYTES` on purpose, and deliberately
 * smaller. That constant is compiled into every installed build; this one is
 * what we actually serve. Serving above the bound the DEPLOYED fleet carries
 * makes those installs reject the whole payload — the global rules included —
 * until they auto-update, so the two numbers move at different times: the
 * runtime bound rises with a release, this one rises once that release has
 * adoption.
 *
 * Set to the pre-#1229 runtime bound, which is what the fleet carries today.
 * Raising it is a one-line change and needs no client work.
 *
 * ── What it should become, and what has to happen first ───────────
 *
 * TARGET: 384 KB, once a release carrying MAX_PAYLOAD_BYTES = 512 KB has
 * adoption. That is 75% of the runtime cap, leaving margin for the signer's two
 * signatures and for a payload that grows between publishes, and it is ~6.8x
 * the 56 KB the ENTIRE AdGuard Filter 17 host-anchored import signs to
 * (measured 2026-09-09).
 *
 * NOT YET. v3.0.0 — which is every install today — carries the OLD 50 KB
 * runtime bound: the raise to 256 KB landed in #1250, after that tag, and 512 KB
 * after that again. Publishing above 50 KB before those builds are out there
 * makes the whole payload OVER_CAP for everyone, global params included, and
 * the channel stops updating until they auto-update. Cleaning keeps working
 * (ADR-D9), but nothing new arrives.
 *
 * So the order is: release → adoption → this number. Not the other way round.
 */
export const PUBLISH_PAYLOAD_BUDGET_BYTES = 50 * 1024;

/**
 * Trims the scoped section to what the published payload can carry.
 *
 * The store keeps every landed fact — this only decides what is SERVED. Facts
 * are dropped from the end of an already-sorted list, so the published set is
 * deterministic and grows monotonically as the budget rises: raising the budget
 * publishes more, it never reshuffles what was already out there.
 *
 * Measured against the SIGNED, COMPACT payload - what `fetchWithCap` actually
 * streams - and NOT against this pretty-printed source. The two differ by
 * roughly 2x, and budgeting against the wrong one errs in the direction that
 * takes the channel down.
 *
 * @param {Array<{param: string, hosts: string[]}>} scoped
 * @param {number} baseBytes Compact size of the payload without the scoped section.
 * @param {number} budget
 * @returns {{published: Array, dropped: number}}
 */
function fitScopedToBudget(scoped, baseBytes, budget) {
  const published = [];
  let used = baseBytes + SCOPED_SECTION_OVERHEAD_BYTES;

  for (const fact of scoped) {
    const cost = JSON.stringify(fact).length + 2; // entry + separator
    if (used + cost > budget) break;
    used += cost;
    published.push(fact);
  }

  return { published, dropped: scoped.length - published.length };
}

/**
 * Slack for the `"scoped":[...]` wrapper plus the `sig` and `scopedSig` the
 * signer adds after this file is written (~88 base64 chars each). Generous on
 * purpose: overshooting takes the whole channel down for installed builds,
 * while undershooting costs a handful of facts that publish on the next run.
 */
const SCOPED_SECTION_OVERHEAD_BYTES = 512;

/**
 * Drops the scoped facts whose param is ALREADY in the global strip list.
 *
 * Such a fact publishes nothing: the payload's global rule (`buildRemoteDnrRule`,
 * id 1001) carries no `requestDomains` and no `excludedRequestDomains`, so it
 * removes its params on every main_frame host — including the ones the scoped
 * fact names. The entry is not wrong, it is INERT, and it spends bytes from a
 * bounded budget that real facts are being cut from (#1278).
 *
 * PROJECTION-TIME, not store-time, and that is the whole design:
 *
 *   - The store must keep every landed fact. Params leave the global list on
 *     their own — the #1221 preserveParams sweep and #1263's affiliate sweep
 *     both remove them — and when one does, its scoped fact has to start
 *     publishing again. Deleting it here would make that silently impossible.
 *   - `fitScopedToBudget` already lives here, so both decisions about what is
 *     SERVED (as opposed to what is KNOWN) stay in one place.
 *
 * Not the same thing as a preserve collision. A `(param, host)` pair the host
 * itself preserves never reaches the store: `land-scoped.mjs` refuses it at
 * landing ("the host's OWN preserve list beats an upstream claim"). So a fact
 * filtered here is one the global rule genuinely covers, never one that would
 * have re-enabled stripping where a per-host rule deliberately preserves.
 *
 * @param {Array<{param: string, hosts: string[]}>} scoped
 * @param {string[]} params The GLOBAL strip list this payload publishes.
 * @returns {Array<{param: string, hosts: string[]}>}
 */
function withoutGloballyShadowed(scoped, params) {
  const global = new Set(params);
  return scoped.filter((fact) => !global.has(fact.param));
}

// ── #1344: prefer a param's own anchors over a blanket global entry ──────────
//
// #1342 fixed the half of this circularity that was a leaked defect (a param
// already removed from the BUNDLED global list, but still published globally
// by the remote channel). What is left is a standing shape the pipeline
// creates on its own: `parseRemoveparamRules`' design correction C1 folds a
// host-anchored name into the global candidate pool by design (C1 is still
// right — see tools/import-upstream.mjs), so the bundled artifact can anchor
// a param to a host in `domain-rules.json` while the very same run keeps
// publishing it globally in `tools/rules-source/params.json`. The global
// entry then shadows the param's own scoped facts as "inert" (see
// `withoutGloballyShadowed` above), which is backwards: the bundled artifact
// already said this param belongs at specific hosts.
//
// `params[]` published-but-not-in-TRACKING_PARAMS is NORMAL (that is the
// whole point of the remote channel — it adds to the bundled list) and is not
// touched here. Only a param the bundled artifact has ALREADY anchored
// qualifies.

const TRACKING_PARAMS_SET = new Set(TRACKING_PARAMS);

/** Lower-cased union of the two gates a relocation must never cross (#1322). */
const NEVER_RELOCATE = new Set(
  [...AFFILIATE_PARAM_GUARD, ...REMOTE_PARAM_DENYLIST].map((p) => p.toLowerCase())
);

/**
 * Params the bundled artifact has anchored to at least one host via a plain
 * (non path-scoped) STRIP entry.
 *
 * Read LIVE from the store's own entries, never a hardcoded list: hardcoding
 * would go stale the moment #1228 or #1338 moves another param off
 * TRACKING_PARAMS, which is exactly the circularity this exists to close.
 * Path-scoped entries (`pathPrefixes`, ADR-0010) are excluded on purpose —
 * they are a distinct mechanism, already kept out of the global pool at
 * ingestion (#1326's `pathAnchorSkipped`) and out of this channel entirely by
 * ADR-0010 decision 5, so they carry no `stripParams` shape for this
 * predicate to read.
 *
 * @param {object} store
 * @returns {Set<string>}
 */
function hostAnchoredStripParams(store) {
  const set = new Set();
  for (const entry of store.entries) {
    if (
      entry.scope !== GLOBAL_SCOPE &&
      entry.action === ACTIONS.STRIP &&
      !entry.pathPrefixes
    ) {
      set.add(entry.param);
    }
  }
  return set;
}

/**
 * Decides which qualifying params relocate from the global list to their own
 * anchors, and returns a NEW store with exactly those removed from the
 * global entries — nothing else. A param that does not qualify, or that
 * qualifies but cannot be safely relocated, is provably untouched: this
 * function only ever calls `withGlobalParams` with a SUBSET of the store's
 * existing global params, never adds one, and never touches a host-scoped
 * entry or a scopedFacts record.
 *
 * ── The safety property (not optional) ────────────────────────────────
 *
 * A param must never end up stripped nowhere in this channel. Relocating it
 * means: remove the global entry, and its own scoped facts (already landed —
 * this never invents one) stop being shadowed and enter the publish budget
 * fit. If those facts do not survive that fit — the budget is genuinely
 * full — dropping the global entry anyway would leave the param covered by
 * neither, turning a coverage improvement into a coverage regression. So a
 * candidate whose own facts do not make the cut stays global instead,
 * unconditionally.
 *
 * ── How: extend the existing budget mechanism, not a second one ────────
 *
 * `withoutGloballyShadowed`/`fitScopedToBudget` already decide what the
 * publish budget can carry, greedily, from an already-sorted list. This
 * reuses both, unmodified, inside a small fixed-point loop: start by
 * assuming every qualifying candidate relocates, run the real fit, and
 * revert any candidate whose OWN record did not survive it. Reverting only
 * ever adds a few bytes back to `params[]` (never removes budget already
 * spent on a non-candidate fact), so the set of survivors can only shrink
 * between iterations — the loop provably terminates and cannot cycle.
 *
 * @param {object} store
 * @param {string} paramsFileText The committed params.json text, read only
 *   to size the byte budget the exact way `renderParamsFile` does — this
 *   never authors `version`/`published`/`sig`.
 * @returns {{
 *   store: object,
 *   relocated: string[],
 *   stayedGlobalForBudget: string[],
 *   bytesRemaining: number|null,
 * }}
 */
export function computeAnchorPreference(store, paramsFileText) {
  const hostAnchored = hostAnchoredStripParams(store);
  const globalParams = emitParams(store);
  const scoped = emitScoped(store);

  const candidates = globalParams.filter(
    (param) =>
      hostAnchored.has(param) &&
      !TRACKING_PARAMS_SET.has(param) &&
      !NEVER_RELOCATE.has(param.toLowerCase())
  );

  if (candidates.length === 0) {
    return { store, relocated: [], stayedGlobalForBudget: [], bytesRemaining: null };
  }

  const current = JSON.parse(paramsFileText);
  let relocated = new Set(candidates);
  let finalParams = globalParams.filter((param) => !relocated.has(param));
  let published = [];

  for (;;) {
    const bare = { ...current, params: finalParams };
    delete bare.scoped;
    const baseBytes = JSON.stringify(bare).length;

    const publishable = withoutGloballyShadowed(scoped, finalParams);
    published = fitScopedToBudget(publishable, baseBytes, PUBLISH_PAYLOAD_BUDGET_BYTES).published;
    const publishedParams = new Set(published.map((fact) => fact.param));

    const newlyUnfit = [...relocated].filter((param) => !publishedParams.has(param));
    if (newlyUnfit.length === 0) break;
    for (const param of newlyUnfit) relocated.delete(param);
    finalParams = globalParams.filter((param) => !relocated.has(param));
  }

  const stayedGlobalForBudget = candidates.filter((param) => !relocated.has(param)).sort();

  const finalBare = { ...current, params: finalParams };
  delete finalBare.scoped;
  const usedBytes =
    JSON.stringify(finalBare).length +
    SCOPED_SECTION_OVERHEAD_BYTES +
    published.reduce((sum, fact) => sum + JSON.stringify(fact).length + 2, 0);

  return {
    store: relocated.size > 0 ? withGlobalParams(store, finalParams) : store,
    relocated: [...relocated].sort(),
    stayedGlobalForBudget,
    bytesRemaining: PUBLISH_PAYLOAD_BUDGET_BYTES - usedBytes,
  };
}

/**
 * Applies `computeAnchorPreference` to the committed store and, if anything
 * relocated, writes the result — including a hand version bump, since a
 * changed `params[]` makes every installed build reject the payload as
 * `VERSION_REGRESSION` otherwise (precedent: #1342, 8502bd8). A no-op run
 * (nothing qualifies, or every candidate stays global for budget reasons)
 * writes nothing and bumps nothing, so re-running this is always safe.
 *
 * @returns {{relocated: string[], stayedGlobalForBudget: string[], bytesRemaining: number|null}}
 */
export function runPreferAnchors() {
  const store = loadStore();
  const result = computeAnchorPreference(store, read(PARAMS_PATH));

  if (result.relocated.length === 0) {
    return result;
  }

  const current = JSON.parse(read(PARAMS_PATH));
  writeAll(result.store, { version: current.version + 1 });
  return result;
}

/**
 * Renders params.json with a replaced `params` array and `scoped` section,
 * preserving every other field.
 *
 * `scoped` is ABSENT-WHEN-EMPTY, matching the store's own I1 convention and,
 * more importantly, the payload contract: `runRemoteRulesFetch` treats a
 * missing scoped section as "no scoped facts" and behaves exactly as it did
 * before #1221, while `sign-rules.mjs` only signs a section that is a non-empty
 * array. An empty `scoped: []` would be a third state neither of them needs,
 * and it would rewrite today's committed bytes for no behavioural change.
 */
function renderParamsFile(existingText, params, scoped) {
  const current = JSON.parse(existingText);
  const next = { ...current, params };
  if (scoped.length === 0) {
    delete next.scoped;
    return `${JSON.stringify(next, null, 2)}\n`;
  }

  // ONE FACT PER LINE, for the same reason `serializeStore` writes one store
  // entry per line: at this size the default 2-space expansion spreads ~1000
  // facts over ~6800 lines, and a weekly run that adds three of them produces a
  // diff nobody can read. Compacted, a new fact is a one-line diff — which is
  // the whole point of re-offering the backlog every week and only committing
  // the delta.
  //
  // Formatting is free to change: `canonicalScopedMessage` signs VALUES, not
  // the file's bytes, so the signature is unaffected.
  // What the DEPLOYED fleet can actually fetch, not what the store holds.
  const bare = { ...next };
  delete bare.scoped;

  // Shadowed facts are removed BEFORE the fit, not after: the point is to hand
  // their bytes to facts the budget is currently cutting (#1278).
  const publishable = withoutGloballyShadowed(scoped, params);
  const shadowed = scoped.length - publishable.length;
  const { published, dropped } = fitScopedToBudget(
    publishable,
    JSON.stringify(bare).length,
    PUBLISH_PAYLOAD_BUDGET_BYTES,
  );

  if (shadowed > 0) {
    console.log(
      `[rules-store] ${shadowed} of ${scoped.length} scoped fact(s) name a param the global ` +
        "list already strips everywhere — inert, so they are not published. They stay in the " +
        "store and publish themselves if the param ever leaves the global list."
    );
  }

  if (dropped > 0) {
    console.warn(
      `[rules-store] ${dropped} of ${publishable.length} publishable scoped fact(s) exceed the ` +
        `${PUBLISH_PAYLOAD_BUDGET_BYTES}-byte publish budget and are NOT in this payload. ` +
        "They stay in the store and publish themselves once the budget rises."
    );
  }

  if (published.length === 0) {
    delete next.scoped;
    return `${JSON.stringify(next, null, 2)}\n`;
  }

  const SENTINEL = "__MUGA_SCOPED_FACTS__";
  next.scoped = SENTINEL;
  const block = `[\n${published.map((f) => `    ${JSON.stringify(f)}`).join(",\n")}\n  ]`;
  return `${JSON.stringify(next, null, 2).replace(`"${SENTINEL}"`, block)}\n`;
}

/** Artifacts → store. */
export function runImport() {
  const store = buildImportedStore(
    JSON.parse(read(DOMAIN_RULES_PATH)),
    JSON.parse(read(PARAMS_PATH)).params,
    existingScopedFacts(),
  );
  write(STORE_PATH, serializeStore(store));
  return { entries: store.entries.length, scopedFacts: store.scopedFacts?.length ?? 0 };
}

/**
 * The pure core of `runImport`, so the carry-forward below can be tested
 * without writing over the committed store.
 *
 * `entries[]` is rebuilt from the artifacts, which are authoritative for it.
 * `scopedFacts[]` is NOT: params.json's `scoped` section is a projection OF it,
 * and a lossy one — the pivot to `{param, hosts[]}` drops provenance, so
 * reconstructing facts from it would silently discard which upstream lists
 * corroborated each one. The already-landed facts are carried forward untouched
 * instead. Without this an import would delete every landed fact, and the very
 * next `--check` would report params.json as drifted with nothing in the diff
 * to explain why.
 *
 * @param {Array<object>} domainRules  domain-rules.json, parsed.
 * @param {string[]} params            params.json's `params` array.
 * @param {Array<object>} landed       Scoped facts already in the store.
 * @returns {object}
 */
export function buildImportedStore(domainRules, params, landed) {
  const rebuilt = importArtifacts(domainRules, params);
  return landed.length > 0 ? withScopedFacts(rebuilt, landed) : rebuilt;
}

/** The committed store's scoped facts, or `[]` when there is no store yet. */
function existingScopedFacts() {
  try {
    return parseStore(read(STORE_PATH)).scopedFacts ?? [];
  } catch {
    // No store on disk yet — the bootstrap case this command exists for.
    return [];
  }
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
    params: renderParamsFile(base, emitParams(store), emitScoped(store)),
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
    } else if (process.argv.includes("--prefer-anchors")) {
      const { relocated, stayedGlobalForBudget, bytesRemaining } = runPreferAnchors();
      if (relocated.length === 0) {
        console.log(
          "[rules-store] #1344: nothing relocated — no qualifying param, or every candidate " +
            "stayed global for budget reasons"
        );
      } else {
        console.log(
          `[rules-store] #1344: relocated ${relocated.length} param(s) to their anchors: ` +
            relocated.join(", ")
        );
      }
      if (stayedGlobalForBudget.length > 0) {
        console.log(
          `[rules-store] #1344: ${stayedGlobalForBudget.length} qualifying param(s) stayed ` +
            `global — their anchored facts did not fit the publish budget: ${stayedGlobalForBudget.join(", ")}`
        );
      }
      if (bytesRemaining !== null) {
        console.log(`[rules-store] #1344: ${bytesRemaining} byte(s) left in the publish budget`);
      }
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
