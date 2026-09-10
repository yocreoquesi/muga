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
 * `emitDomainRules` used to THROW on a scope with strips and no preserves, as
 * the visible seam of that coupling. #1328 retired it: entries that exist only
 * to add a host-anchored strip are now normal, and `preserveParams: []` is
 * their honest projection. The "an entry must actually do something" invariant
 * now lives where it can fail, asserted against the committed artifact.
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
 * ── `entries[]` may carry a path-prefix predicate (#1326) ─────────────
 *
 * A STRIP entry may carry an optional `pathPrefixes: string[]` — literal path
 * prefixes (e.g. `"/search"`), never a regex. Absent on every entry this
 * schema predates, so importing and re-emitting the committed artifacts is
 * byte-identical without it: this is additive, not a version bump. Restricted
 * to STRIP (a path-scoped PRESERVE has no projection anywhere in this file)
 * and validated on both construction and `parseStore`, the same two paths
 * every other field on an entry is validated on.
 *
 * `groupByScope`/`emitDomainRules` project it into a domain's own
 * `pathStrips: [{ pathPrefixes, params }]` — entries sharing the identical
 * pathPrefixes array (same prefixes, same order) group into one entry, the
 * same way the DNR generator groups domains sharing an identical removeParams
 * set. `tools/generate-rules.mjs` is what turns that into an actual DNR rule;
 * this module only carries the fact.
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

/**
 * Hostname shape a `scopedFacts[]` scope must have.
 *
 * Deliberately identical to `SCOPED_HOST_RE` in `src/lib/remote-rules.js` and
 * `tools/sign-rules.mjs`: a scoped fact's whole purpose is to reach the signed
 * payload and then a DNR `requestDomains` entry, so anything this accepts and
 * those two reject would land in the store and die silently at publication.
 * Not imported from there because this module is the tooling's own boundary and
 * has no browser-targeted imports; the three are pinned together by test.
 *
 * Note this is NARROWER than an `entries[]` scope, which is a hostname SUFFIX
 * matched by `cleaner.js` and never leaves the bundle.
 */
const SCOPED_HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Param-name shape a `scopedFacts[]` entry must have — identical to
 * `PARAM_FORMAT_RE` in `src/lib/remote-rules.js`, and enforced here for the
 * reason that regex exists: `canonicalScopedMessage` uses `@`, `+`, `,` and `|`
 * as separators, so a name carrying one would let two different fact sets
 * serialise to the same string and share a signature.
 */
const SCOPED_PARAM_RE = /^[a-zA-Z0-9_.\-]+$/;

/**
 * Shape an `entries[]` path-prefix predicate must have (#1326).
 *
 * Deliberately a LITERAL prefix, never a regex: #1094 and #1109 were both an
 * over-matching host regex, and a path predicate is a bigger surface than a
 * host one. Must start with "/" (a path, not a bare segment) and contain only
 * URL path characters — no query (`?`), fragment (`#`), or wildcard (`*`).
 * See docs/adr/0010-path-scoped-param-rules.md for what a literal prefix
 * gives up against a regex, and why that tradeoff was chosen anyway.
 */
const PATH_PREFIX_RE = /^\/[A-Za-z0-9_\-./]*$/;

/**
 * Validates a `pathPrefixes` array (#1326): non-empty, every element a
 * literal path prefix.
 *
 * @param {unknown} pathPrefixes
 * @param {string} where
 * @param {string} scope
 * @param {string} param
 * @throws {Error} On a non-array, an empty array, or a malformed prefix.
 */
function validatePathPrefixes(pathPrefixes, where, scope, param) {
  if (!Array.isArray(pathPrefixes) || pathPrefixes.length === 0) {
    throw new Error(
      `rules-store: ${where} pathPrefixes must be a non-empty array (${scope} / ${param})`
    );
  }
  for (const prefix of pathPrefixes) {
    if (typeof prefix !== "string" || !PATH_PREFIX_RE.test(prefix)) {
      throw new Error(
        `rules-store: ${where} pathPrefixes entry ${JSON.stringify(prefix)} is not a literal ` +
          `path prefix starting with "/" (${scope} / ${param})`
      );
    }
  }
}

// ── Entry construction ───────────────────────────────────────────────

/**
 * Builds one validated store entry.
 *
 * @param {object} spec
 * @param {string} spec.scope  Hostname suffix, or GLOBAL_SCOPE.
 * @param {string} spec.param  Param name, lowercased by the caller's source.
 * @param {string} spec.action One of ACTIONS.
 * @param {string[]} [spec.pathPrefixes] Literal path prefixes (#1326).
 *   STRIP-only — see PATH_PREFIX_RE.
 * @returns {{scope: string, param: string, action: string, pathPrefixes?: string[]}}
 * @throws {Error} On an empty field, an unknown action, a reserved action, or
 *   a malformed/misplaced pathPrefixes.
 */
export function makeEntry({ scope, param, action, pathPrefixes }) {
  return validateEntry({ scope, param, action, pathPrefixes });
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
 * @param {{scope: string, param: string, action: string, pathPrefixes?: string[]}} entry
 * @param {string} [where] Context for the error message.
 * @returns {{scope: string, param: string, action: string, pathPrefixes?: string[]}}
 * @throws {Error} On an empty field, an unknown action, a reserved action, or
 *   a malformed/misplaced pathPrefixes.
 */
function validateEntry({ scope, param, action, pathPrefixes }, where = "entry") {
  if (typeof scope !== "string" || scope.length === 0) {
    throw new Error(`rules-store: ${where} needs a scope (param: ${String(param)})`);
  }
  if (typeof param !== "string" || param.length === 0) {
    throw new Error(`rules-store: ${where} needs a param (scope: ${scope})`);
  }
  if (!SCOPED_PARAM_RE.test(param)) {
    throw new Error(
      `rules-store: ${where} param "${param}" is not a valid param name (scope: ${scope}). ` +
        "`canonicalScopedMessage` separates facts with @ + , and | — a name containing " +
        "one would let two different fact sets serialise identically and share a signature"
    );
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
  if (pathPrefixes !== undefined) {
    if (action !== ACTIONS.STRIP) {
      throw new Error(
        `rules-store: ${where} pathPrefixes is only valid on a "${ACTIONS.STRIP}" entry ` +
          `(${scope} / ${param}, action: "${action}")`
      );
    }
    validatePathPrefixes(pathPrefixes, where, scope, param);
    return { scope, param, action, pathPrefixes: [...pathPrefixes] };
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
  if (!SCOPED_HOST_RE.test(scope)) {
    throw new Error(
      `rules-store: ${where} scope "${scope}" is not a plain hostname (param: ${param}). ` +
        "A scoped fact is published to the signed payload and becomes a DNR " +
        "`requestDomains` entry, and neither can express a wildcard anchor like " +
        '"amazon.*" or a truncated one like "www.ebay." — upstream writes those, and ' +
        "they have to be enumerated into real hosts before they can land"
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
    // #1326: one entry per (pathPrefixes-group, param), in the artifact's own
    // group and param order — groupByScope's Map re-groups them identically,
    // which is what makes this direction round-trip.
    for (const group of rule.pathStrips ?? []) {
      for (const param of group.params ?? []) {
        entries.push(
          makeEntry({ scope, param, action: ACTIONS.STRIP, pathPrefixes: group.pathPrefixes })
        );
      }
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
 * IDEMPOTENT: re-landing a fact the store already holds returns a byte-identical
 * store. That is a requirement, not a nicety — the weekly run re-derives every
 * candidate from scratch and re-lands all of them, so anything that moved on a
 * re-land would churn the whole segment every week. See the timestamp handling
 * below.
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
      provenance: {
        ...existing.provenance,
        ...fact.provenance,
        signals: [...signals].sort(),
        // FIRST LANDING WINS on both timestamps. `tools/rule-ingestion/quarantine/`
        // is gitignored, so every run rebuilds its candidates from upstream and
        // stamps them with that run's clock — `firstSeenAt` from
        // `candidate.mjs`, `admittedAt` from `land-scoped.mjs`. Letting the new
        // values win would make both mean "the last time a workflow ran", which
        // is not information, AND would rewrite every landed fact on every
        // weekly run: a diff of the whole segment, and a fresh `scopedSig` over
        // an unchanged rule set. This store IS the persistence the quarantine
        // deliberately lacks, so re-landing an unchanged fact must be a no-op
        // down to the byte.
        //
        // `signals` is unioned rather than pinned because a second adapter
        // reporting the same fact is genuine new information.
        ...(existing.provenance?.firstSeenAt
          ? { firstSeenAt: existing.provenance.firstSeenAt }
          : {}),
        ...(existing.provenance?.admittedAt
          ? { admittedAt: existing.provenance.admittedAt }
          : {}),
      },
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
 * A STRIP entry carrying `pathPrefixes` (#1326) does NOT join `strip` — it
 * buckets into `pathStrips`, keyed by the exact `pathPrefixes` array (same
 * prefixes, same order) so entries sharing one predicate group into one
 * `{pathPrefixes, params}` record, the same way the DNR generator groups
 * domains sharing an identical removeParams set. Insertion order of both the
 * outer Map and each inner `pathStrips` Map is entries[]'s own order, which is
 * what keeps `emitDomainRules` deterministic.
 *
 * @param {object} store
 * @returns {Map<string, {preserve: string[], strip: string[], pathStrips: Map<string, {pathPrefixes: string[], params: string[]}>}>}
 */
function groupByScope(store) {
  const grouped = new Map();
  for (const entry of store.entries) {
    if (entry.scope === GLOBAL_SCOPE) continue;
    if (!grouped.has(entry.scope)) {
      grouped.set(entry.scope, { preserve: [], strip: [], pathStrips: new Map() });
    }
    const bucket = grouped.get(entry.scope);
    if (entry.action === ACTIONS.PRESERVE) bucket.preserve.push(entry.param);
    else if (entry.action === ACTIONS.STRIP) {
      if (entry.pathPrefixes) {
        const key = JSON.stringify(entry.pathPrefixes);
        if (!bucket.pathStrips.has(key)) {
          bucket.pathStrips.set(key, { pathPrefixes: entry.pathPrefixes, params: [] });
        }
        bucket.pathStrips.get(key).params.push(entry.param);
      } else {
        bucket.strip.push(entry.param);
      }
    }
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
 */
export function emitDomainRules(store) {
  const grouped = groupByScope(store);
  const out = [];

  for (const [scope, { preserve, strip, pathStrips }] of grouped) {
    // A scope with strips and nothing to preserve used to THROW here, on the
    // reasoning that the legacy schema required a non-empty preserveParams and
    // that emitting `[]` would ship a silently different file. That reasoning
    // was sound while every entry existed to preserve something. The comment
    // said so itself: "Slice 2 removes this constraint; until then it must stay
    // visible." This is that removal (#1328).
    //
    // What changed: #1323 and #1324 added entries whose whole purpose is a
    // host-anchored STRIP. They have no natural preserve list, so 60 of them
    // carried `["q"]` invented purely to satisfy the constraint. `q` is not in
    // TRACKING_PARAMS, so it preserved nothing; it was data written to pass a
    // check. The constraint stopped describing the schema and started shaping
    // the data, which is when a guard has to go.
    //
    // `[]` is representable and always was: the cleaner reads
    // `(rule.preserveParams || [])`, so an empty list and an absent key behave
    // identically. Emitting it is no longer a silent difference, it is the
    // honest projection of a scope that only strips. The round-trip test still
    // proves losslessness by bytes, which is what actually protects the shipped
    // artifact.
    //
    // No replacement guard here: `groupByScope` only yields scopes that HAVE
    // entries, and an entry's action is validated to be preserve or strip, so a
    // scope with neither cannot reach this loop. A throw for it would be
    // unreachable, and an unreachable throw reads as a guarantee while
    // guaranteeing nothing. The "preserve or strip" invariant is asserted where
    // it can actually fail, against the committed artifact, in
    // domain-rules.test.mjs and config-integrity.test.mjs.

    const meta = store.projection?.scopes?.[scope] ?? {};
    const record = { domain: scope, preserveParams: preserve };
    if (meta.emitStripParams) record.stripParams = strip;
    // #1326: additive. Absent whenever a scope has no path-scoped strip, so
    // every pre-existing entry (none of which had one) re-emits byte-identical.
    if (pathStrips.size > 0) record.pathStrips = [...pathStrips.values()];
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

/**
 * Extracts the host-scoped strip facts, in the shape the signed payload's
 * `scoped` section uses (#1221).
 *
 * The store is SCOPE-major — one fact per `(scope, param)` pair, because that
 * is the unit `land-scoped.mjs` admits and the unit provenance hangs off. The
 * payload is PARAM-major — `{param, hosts[]}` — because that is what
 * `canonicalScopedMessage` signs and what the runtime validates per host. This
 * is the one place that pivot happens, so the store never has to model the
 * payload's shape and the payload never has to carry provenance.
 *
 * Provenance is deliberately dropped: the payload is served to every user on
 * every fetch, and which upstream lists corroborated a fact is repository
 * history, not something worth spending bytes on for 630 hosts.
 *
 * Deterministic — params sorted, hosts sorted and deduped within a param — so
 * an unchanged store re-renders byte-identical bytes and re-signs to an
 * identical `scopedSig`.
 *
 * @param {object} store
 * @returns {Array<{param: string, hosts: string[]}>}
 */
export function emitScoped(store) {
  const hostsByParam = new Map();

  for (const fact of store.scopedFacts ?? []) {
    if (fact.action !== ACTIONS.STRIP) continue;
    let hosts = hostsByParam.get(fact.param);
    if (!hosts) { hosts = new Set(); hostsByParam.set(fact.param, hosts); }
    hosts.add(fact.scope);
  }

  return [...hostsByParam.keys()]
    .sort()
    .map((param) => ({ param, hosts: [...hostsByParam.get(param)].sort() }));
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
