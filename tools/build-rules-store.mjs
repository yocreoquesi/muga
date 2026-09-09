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
  emitScoped,
  importArtifacts,
  parseStore,
  serializeStore,
  withScopedFacts,
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
