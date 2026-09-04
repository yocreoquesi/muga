/**
 * MUGA: rules-store — the normalized rule store and its projections
 *
 * MUGA's rule knowledge lives in several shapes that cannot express the same
 * things. `src/rules/domain-rules.json` knows about hosts but requires a
 * non-empty `preserveParams` on every entry, so it cannot say "this param is a
 * tracker on this host" for a host with nothing to preserve. The global list in
 * `tools/rules-source/params.json` knows about params but not about hosts, so a
 * fact learned about one site is published against every site — the failure that
 * stripped ShareASale's `u` (#1212) and that #1217 measured across the list.
 *
 * This module introduces ONE normalized store where a rule is a triple:
 *
 *     { scope, param, action }
 *
 * `scope` is a hostname suffix or GLOBAL_SCOPE; `action` says what to do. The
 * two are INDEPENDENT — a host-scoped strip needs no sibling preserve — which is
 * the coupling `domain-rules.json` cannot shed and the reason this store exists.
 *
 * ── Slice 1 is deliberately inert ─────────────────────────────────────
 *
 * Nothing here changes what the extension loads. The store is build-time only;
 * `src/rules/domain-rules.json` remains the shipped artifact and is now
 * PROJECTED from the store, byte for byte. The proof is a round-trip test, not
 * an argument: import the committed artifacts, emit them again, compare bytes.
 * If the bytes match, the extension cannot have changed.
 *
 * That is also why `emitDomainRules` THROWS on a store entry the legacy schema
 * cannot represent instead of quietly dropping it or inventing an empty
 * `preserveParams`. The throw is the visible seam where the old coupling shows
 * through; a silent workaround would hide exactly the debt this store is here
 * to retire.
 *
 * ── Pure module guarantees ────────────────────────────────────────────
 *
 *   - No DOM, no chrome.*, no network, no clock, no Math.random
 *   - No filesystem access (tools/build-rules-store.mjs owns all I/O)
 *   - No mutation of any argument
 *
 * Purity is what lets the round-trip test compare emitted STRINGS without
 * touching disk, which is how losslessness gets proven rather than eyeballed.
 *
 * ── Slice 2 adds `scopedFacts[]`, a sibling of `entries[]` ────────────
 *
 * A gate-admitted host-scoped candidate (ADR-0008, Path A) cannot land in
 * `entries[]`: `groupByScope`/`emitDomainRules` read that array, and a fresh
 * host-scoped strip with no sibling preserve entry throws by design (the seam
 * documented above). `scopedFacts` is a TOP-LEVEL SIBLING the projections never
 * read, so it never reaches that throw and never changes what
 * `domain-rules.json` or `params.json` contain.
 *
 * It is absent when empty, so a store that has landed nothing carries the same
 * bytes it always did. `serializeStore` MUST emit it when present — an unknown
 * top-level key is otherwise silently destroyed by the very next
 * `promote-rules.mjs` or `harvest-preserve.mjs` round trip, because both go
 * through `serializeStore` and it writes only the keys it knows about.
 */

// ── Schema ───────────────────────────────────────────────────────────

/** Store format version. Bump only on a breaking shape change. */
export const SCHEMA_VERSION = 1;

/** Scope value meaning "every host". */
export const GLOBAL_SCOPE = "*";

/**
 * Actions this slice may emit.
 *
 * `referral` and `unwrap` are part of the target model (they are how
 * `referralMarketing` and the wrapper rules fold in) but nothing projects them
 * yet, so emitting one would produce a store no generator can render. They are
 * reserved and rejected rather than silently accepted.
 */
export const ACTIONS = Object.freeze({ STRIP: "strip", PRESERVE: "preserve" });

/** Reserved for later slices — rejected on construction until a projection exists. */
export const RESERVED_ACTIONS = Object.freeze(["referral", "unwrap"]);

/** @type {Set<string>} */
const VALID_ACTIONS = new Set(Object.values(ACTIONS));

// ── Entry construction ───────────────────────────────────────────────

/**
 * Builds one validated store entry.
 *
 * @param {object} spec
 * @param {string} spec.scope  Hostname suffix, or GLOBAL_SCOPE.
 * @param {string} spec.param  Param name, lowercased by the caller's source.
 * @param {string} spec.action One of ACTIONS.
 * @returns {{scope: string, param: string, action: string}}
 * @throws {Error} On an empty field, an unknown action, or a reserved action.
 */
export function makeEntry({ scope, param, action }) {
  return validateEntry({ scope, param, action });
}

/**
 * The single validation path for an entry, wherever it came from.
 *
 * Extracted because `makeEntry` guards only the CONSTRUCTION path, and the path
 * that matters most is the other one: the store is the source of truth, so it is
 * read from disk far more often than it is built in memory. A review of this
 * module found that a hand-edited `action: "referral"` sailed through
 * `parseStore` and was then rendered by `emitDomainRules` as a `stripParams`
 * entry — silently turning a param that exists to be PRESERVED into one to be
 * stripped, which is the one direction that costs a creator real money.
 *
 * @param {{scope: string, param: string, action: string}} entry
 * @param {string} [where] Context for the error message.
 * @returns {{scope: string, param: string, action: string}}
 * @throws {Error} On an empty field, an unknown action, or a reserved action.
 */
function validateEntry({ scope, param, action }, where = "entry") {
  if (typeof scope !== "string" || scope.length === 0) {
    throw new Error(`rules-store: ${where} needs a scope (param: ${String(param)})`);
  }
  if (typeof param !== "string" || param.length === 0) {
    throw new Error(`rules-store: ${where} needs a param (scope: ${scope})`);
  }
  if (RESERVED_ACTIONS.includes(action)) {
    throw new Error(
      `rules-store: action "${action}" is reserved for a later slice and has no ` +
        `projection yet (${scope} / ${param})`
    );
  }
  if (!VALID_ACTIONS.has(action)) {
    throw new Error(
      `rules-store: unknown action "${String(action)}" (${scope} / ${param})`
    );
  }
  return { scope, param, action };
}

/**
 * The validation path for a `scopedFacts[]` entry (Slice 2, rules-scope-
 * normalization), wherever it came from — construction (`withScopedFacts`) or
 * disk (`parseStore`).
 *
 * Deliberately NARROWER than `validateEntry`: a scoped fact can never carry
 * GLOBAL_SCOPE (that is what `entries[]` is for) and can never carry an action
 * other than STRIP — a scoped PRESERVE has no projection to render it, and
 * nothing in this slice produces one.
 *
 * @param {{scope: string, param: string, action: string, provenance?: object}} fact
 * @param {string} [where] Context for the error message.
 * @returns {{scope: string, param: string, action: string, provenance?: object}}
 * @throws {Error} On an empty/GLOBAL_SCOPE scope, an empty param, or a non-STRIP action.
 */
function validateScopedFact({ scope, param, action, provenance }, where = "scopedFacts entry") {
  if (typeof scope !== "string" || scope.length === 0) {
    throw new Error(`rules-store: ${where} needs a scope (param: ${String(param)})`);
  }
  if (scope === GLOBAL_SCOPE) {
    throw new Error(
      `rules-store: ${where} cannot use GLOBAL_SCOPE ("${GLOBAL_SCOPE}") — a scoped fact ` +
        `must name a real host (param: ${param})`
    );
  }
  if (typeof param !== "string" || param.length === 0) {
    throw new Error(`rules-store: ${where} needs a param (scope: ${scope})`);
  }
  if (action !== ACTIONS.STRIP) {
    throw new Error(
      `rules-store: ${where} action must be "${ACTIONS.STRIP}" (scope: ${scope}, param: ` +
        `${param}, got: "${String(action)}")`
    );
  }
  return { scope, param, action, ...(provenance ? { provenance } : {}) };
}

// ── Import: artifacts → store ────────────────────────────────────────

/**
 * Folds the committed artifacts into the normalized store.
 *
 * Two things are carried as explicit projection metadata rather than inferred
 * on the way out, because inferring them loses information:
 *
 *   1. `note` is per-DOMAIN in `domain-rules.json` but the store's unit is a
 *      per-param triple, so the note has nowhere to live on an entry.
 *   2. Whether `stripParams` was ABSENT or an EMPTY ARRAY. The committed file
 *      contains both — 45 entries omit the key and 36 carry `[]` — and they are
 *      different bytes. A generator that normalised them would rewrite 36
 *      entries on its first run and bury any real change in the noise.
 *
 * Entry ORDER is the store's own order: domains appear in first-appearance
 * order, and within a domain the preserve names precede the strip names in
 * their original sequence. Nothing else records it, so nothing else has to.
 *
 * @param {Array<{domain: string, preserveParams?: string[], stripParams?: string[], note?: string}>} domainRules
 * @param {string[]} globalParams  The `params` array from params.json.
 * @returns {{schemaVersion: number, entries: Array, projection: object}}
 */
export function importArtifacts(domainRules, globalParams) {
  const entries = [];
  const scopes = {};

  for (const rule of domainRules) {
    const scope = rule.domain;
    scopes[scope] = {
      // `stripParams: []` and a missing `stripParams` are different bytes.
      emitStripParams: Object.hasOwn(rule, "stripParams"),
      ...(Object.hasOwn(rule, "note") ? { note: rule.note } : {}),
    };
    for (const param of rule.preserveParams ?? []) {
      entries.push(makeEntry({ scope, param, action: ACTIONS.PRESERVE }));
    }
    for (const param of rule.stripParams ?? []) {
      entries.push(makeEntry({ scope, param, action: ACTIONS.STRIP }));
    }
  }

  for (const param of globalParams) {
    entries.push(makeEntry({ scope: GLOBAL_SCOPE, param, action: ACTIONS.STRIP }));
  }

  return { schemaVersion: SCHEMA_VERSION, entries, projection: { scopes } };
}

// ── Updates: the writers' entry points ───────────────────────────────

/**
 * Returns a NEW store whose GLOBAL strip list is `params`, leaving every
 * host-scoped entry and all projection metadata untouched.
 *
 * Surgical on purpose. Rebuilding the whole store with `importArtifacts` from
 * the current artifacts would be equivalent TODAY, because the store holds
 * nothing the artifacts cannot express — and it would silently become data loss
 * the moment Slice 2 adds a host-scoped strip that `domain-rules.json` cannot
 * represent. A writer must only ever replace the axis it owns.
 *
 * @param {object} store
 * @param {string[]} params
 * @returns {object}
 */
export function withGlobalParams(store, params) {
  const kept = store.entries.filter((e) => e.scope !== GLOBAL_SCOPE);
  const globals = params.map((param) =>
    makeEntry({ scope: GLOBAL_SCOPE, param, action: ACTIONS.STRIP })
  );
  return { ...store, entries: [...kept, ...globals] };
}

/**
 * Returns a NEW store whose HOST-SCOPED entries and projection metadata come
 * from `domainRules`, leaving the global list untouched.
 *
 * The mirror of withGlobalParams, and the same warning applies in reverse: this
 * replaces every host-scoped entry, so a caller must pass the COMPLETE domain
 * rule set, not a delta. `harvest-preserve.mjs` does exactly that — it reads the
 * full projection, merges into it, and hands back the whole thing.
 *
 * SLICE 2 NOTE: once the store carries host-scoped facts that `domain-rules.json`
 * cannot express, a caller that derives `domainRules` from the projection will no
 * longer be handing back everything it is about to replace. This function is
 * where that breaks, and it should grow a merge rather than a replace then.
 *
 * @param {object} store
 * @param {Array<{domain: string, preserveParams?: string[], stripParams?: string[], note?: string}>} domainRules
 * @returns {object}
 */
export function withDomainRules(store, domainRules) {
  const globals = store.entries.filter((e) => e.scope === GLOBAL_SCOPE);
  const rebuilt = importArtifacts(domainRules, []);
  return {
    ...store,
    entries: [...rebuilt.entries, ...globals],
    projection: rebuilt.projection,
  };
}

/**
 * Returns a NEW store whose `scopedFacts[]` merges `facts` into whatever the
 * store already carries, deduping on `(scope, param)` and UNIONING
 * `provenance.signals` on a collision (the same corroboration semantics
 * `mergeCandidates` already uses for `signals[]`).
 *
 * Surgical, like `withGlobalParams`: it only ever replaces the axis it owns.
 * `entries[]` and `projection` are untouched — this is preserved automatically
 * by the `{...store}` spread, not by an explicit copy, which is why
 * `withGlobalParams`/`withDomainRules` preserving `scopedFacts` in return is a
 * pinned test rather than an edit: both already spread the whole store.
 *
 * Absent-when-empty (I1) is enforced here, not left to the caller: an empty
 * result DELETES the key rather than setting `[]`, so a store that has landed
 * nothing serializes identically to one that never called this at all.
 *
 * @param {object} store
 * @param {Array<{scope: string, param: string, action: string, provenance?: object}>} facts
 * @returns {object}
 * @throws {Error} Via validateScopedFact — GLOBAL_SCOPE, a non-STRIP action, or a malformed param.
 */
export function withScopedFacts(store, facts) {
  const byKey = new Map();

  for (const raw of [...(store.scopedFacts ?? []), ...facts]) {
    const fact = validateScopedFact(raw);
    const key = `${fact.scope}\0${fact.param}`;
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, fact);
      continue;
    }
    const signals = new Set([
      ...(existing.provenance?.signals ?? []),
      ...(fact.provenance?.signals ?? []),
    ]);
    byKey.set(key, {
      ...existing,
      ...fact,
      provenance: { ...existing.provenance, ...fact.provenance, signals: [...signals].sort() },
    });
  }

  const scopedFacts = [...byKey.values()].sort(
    (a, b) => a.scope.localeCompare(b.scope) || a.param.localeCompare(b.param)
  );

  const next = { ...store };
  if (scopedFacts.length > 0) next.scopedFacts = scopedFacts;
  else delete next.scopedFacts;
  return next;
}

// ── Projection: store → domain-rules.json ────────────────────────────

/**
 * Groups host-scoped entries by scope, preserving first-appearance order.
 *
 * @param {object} store
 * @returns {Map<string, {preserve: string[], strip: string[]}>}
 */
function groupByScope(store) {
  const grouped = new Map();
  for (const entry of store.entries) {
    if (entry.scope === GLOBAL_SCOPE) continue;
    if (!grouped.has(entry.scope)) grouped.set(entry.scope, { preserve: [], strip: [] });
    const bucket = grouped.get(entry.scope);
    if (entry.action === ACTIONS.PRESERVE) bucket.preserve.push(entry.param);
    else if (entry.action === ACTIONS.STRIP) bucket.strip.push(entry.param);
    // No catch-all: an unrecognised action must never fall into the strip
    // bucket. validateEntry rejects one before it reaches here, and this
    // branch stays explicit so a future action cannot be silently mis-filed.
    else throw new Error(`rules-store: unroutable action "${entry.action}" (${entry.scope} / ${entry.param})`);
  }
  return grouped;
}

/**
 * Renders `src/rules/domain-rules.json` from the store.
 *
 * Key order is `domain, preserveParams, stripParams, note` because that is the
 * order in the committed file and `JSON.stringify` follows insertion order.
 * `stripParams` is emitted only when the projection metadata says the source
 * carried the key.
 *
 * @param {object} store
 * @returns {string} File contents, LF endings, trailing newline.
 * @throws {Error} When an entry cannot be represented in the legacy schema.
 */
export function emitDomainRules(store) {
  const grouped = groupByScope(store);
  const out = [];

  for (const [scope, { preserve, strip }] of grouped) {
    if (preserve.length === 0) {
      // The legacy schema requires a non-empty preserveParams on every entry,
      // so a host-scoped strip with nothing to preserve has no representation.
      // Fail loudly and name it: synthesising `preserveParams: []` would ship a
      // silently different file, and dropping the entry would lose a rule.
      // Slice 2 removes this constraint; until then it must stay visible.
      throw new Error(
        `rules-store: scope "${scope}" has strip entries (${strip.join(", ")}) but no ` +
          `preserve entries. domain-rules.json cannot represent that — every entry ` +
          `requires a non-empty preserveParams.`
      );
    }

    const meta = store.projection?.scopes?.[scope] ?? {};
    const record = { domain: scope, preserveParams: preserve };
    if (meta.emitStripParams) record.stripParams = strip;
    if (Object.hasOwn(meta, "note")) record.note = meta.note;
    out.push(record);
  }

  return `${JSON.stringify(out, null, 2)}\n`;
}

// ── Projection: store → the global params array ──────────────────────

/**
 * Extracts the global strip list.
 *
 * Returns the array only. `version`, `published` and `sig` belong to the
 * signing flow (`tools/sign-rules.mjs`) and this module must never author them
 * — a regenerated `published` would invalidate a signature for no reason.
 *
 * @param {object} store
 * @returns {string[]}
 */
export function emitParams(store) {
  return store.entries
    .filter((e) => e.scope === GLOBAL_SCOPE && e.action === ACTIONS.STRIP)
    .map((e) => e.param);
}

// ── Store serialization ──────────────────────────────────────────────

/**
 * Serializes the store with ONE ENTRY PER LINE.
 *
 * `JSON.stringify(store, null, 2)` would spread ~1500 entries over ~7500 lines,
 * so adding a single param would produce a diff nobody can read — and this file
 * is regenerated by the weekly ingestion run, where reviewability is the whole
 * point of the PR. One line per entry makes a rule change a one-line diff.
 *
 * @param {object} store
 * @returns {string} LF endings, trailing newline.
 */
export function serializeStore(store) {
  const lines = [
    "{",
    `  "schemaVersion": ${store.schemaVersion},`,
    `  "projection": ${JSON.stringify(store.projection, null, 2).split("\n").join("\n  ")},`,
    `  "entries": [`,
  ];
  const entries = store.entries.map((e) => `    ${JSON.stringify(e)}`);
  lines.push(entries.join(",\n"));

  // `scopedFacts` is absent-when-empty (I1): a store that has landed nothing
  // serializes to the exact same bytes it always did. This is the line that
  // makes C4 hold — a segment `serializeStore` does not emit is destroyed by
  // the very next promote/harvest round trip, silently.
  if (store.scopedFacts && store.scopedFacts.length > 0) {
    lines.push("  ],", `  "scopedFacts": [`);
    const facts = store.scopedFacts.map((f) => `    ${JSON.stringify(f)}`);
    lines.push(facts.join(",\n"));
  }

  lines.push("  ]", "}");
  return `${lines.join("\n")}\n`;
}

/**
 * Parses a serialized store. Plain JSON — the line layout is a writing
 * convention, not a format.
 *
 * @param {string} text
 * @returns {object}
 */
export function parseStore(text) {
  const store = JSON.parse(text);
  if (store.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(
      `rules-store: schemaVersion ${store.schemaVersion} is not ${SCHEMA_VERSION}`
    );
  }
  if (!Array.isArray(store.entries)) {
    throw new Error("rules-store: store has no entries array");
  }
  // Validate on the way IN, not only on the way out. Everything downstream
  // (groupByScope, emitDomainRules, emitParams) assumes a known action; an
  // unknown one would be swept into the strip bucket by the else branch.
  store.entries.forEach((entry, i) => validateEntry(entry, `entries[${i}]`));

  if (store.scopedFacts !== undefined) {
    if (!Array.isArray(store.scopedFacts)) {
      throw new Error("rules-store: scopedFacts must be an array when present");
    }
    store.scopedFacts.forEach((fact, i) => validateScopedFact(fact, `scopedFacts[${i}]`));
  }

  return store;
}
