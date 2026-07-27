/** MUGA: remote Tier 2 rules fetch / verify / validate / merge (#1027 Slice 2, PR B1)
 *
 * ES module, pure where possible, dependency-injected for testability.
 * No default exports (project convention).
 *
 * Background/service-worker module — sibling to `src/lib/remote-rules.js`.
 * Mirrors that module's fetch → parse → shape → verify → validate → merge
 * pipeline for a SEPARATE signed endpoint that delivers additional Tier 2
 * reject-only click rules (design ADR-3).
 *
 * REVISED ADR-6 (product-owner decision): this module REUSES the EXISTING
 * `TRUSTED_PUBLIC_KEYS` and `verifySignature` from remote-rules.js verbatim —
 * there is NO separate Tier2 signing key. The only required addition for
 * safely sharing one key across two payload types is a DOMAIN-TAGGED
 * canonical message (`canonicalTier2Message`, see below): it is structurally
 * distinct from params' `canonicalMessage`, so a validly-signed params
 * payload can never verify as a Tier2 payload and vice versa. Params'
 * `canonicalMessage` in remote-rules.js is left completely untouched — any
 * change there would invalidate already-published params signatures.
 *
 * B1 SCOPE (this file): fetch, verify, validate, and WRITE storage only.
 * Nothing in the extension reads `remoteTier2Rules` yet — PR B2 adds the
 * content-script read + CSS-parse filter + ADD-only merge + dispatch wiring.
 * B1 is intentionally inert in production until B2 (read path) and B3
 * (signed endpoint deployment) ship.
 *
 * Never-accept chain this module participates in (design, central table):
 *   - Closed 4-key rule shape (no field can express an accept action).
 *   - Runtime shape/cap/token validation (this file).
 *   - Ed25519 signature verification (reused key + verifySignature).
 *   - Version-monotonic + persistent floor + freshness guard.
 *   - ADD-only id-collision against bundled rules (bundled rules stay
 *     network-immutable).
 * The keystone layer — the runtime semantic click-veto — lives in
 * `src/lib/cmp-tier2-veto.js` (PR A, already on `main`) and runs content-side
 * at click time; it is NOT part of this file's responsibility.
 */

import { TRUSTED_PUBLIC_KEYS } from "./remote-rules-keys.js";
import { fetchWithCap, verifySignature, FETCH_TIMEOUT_MS, CLOCK_SKEW_TOLERANCE_MS } from "./remote-rules.js";
import { TIER2_RULES } from "./cmp-tier2-rules.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fetch endpoint — compile-time constant, NOT user-configurable. Sibling to
 * params.json, independent versioning/cadence/blast-radius (design ADR-3). */
export const REMOTE_TIER2_RULES_URL =
  "https://rules.muga.app/rules/v1/tier2.json";

/** Maximum response body size before rejection. Smaller than params' 50 KB
 * cap: the curated Tier2 rule set is small by design (design ADR-4). */
export const MAX_TIER2_PAYLOAD_BYTES = 32 * 1024; // 32 KB

/** Maximum number of rules accepted in one payload (design ADR-4). */
export const MAX_TIER2_RULES = 40;

/** Maximum selectors per `present` / `reject` / `openSettings` array. */
export const MAX_SELECTORS_PER_ARRAY = 5;

/** Maximum length of a single selector string. */
export const MAX_SELECTOR_LEN = 200;

/** Maximum length of a rule `id` string. */
export const MAX_TIER2_ID_LEN = 64;

/**
 * Payload freshness window in days — tighter than params' 180 days (design
 * ADR-4): CMP markup drifts faster and the curated set is small, so a
 * tighter window bounds replay/stale exposure. Ops must re-sign within it.
 */
export const STALE_DAYS_TIER2 = 60;

/** Allowed rule-id format: lowercase alphanumeric and hyphen only. */
export const TIER2_ID_FORMAT_RE = /^[a-z0-9-]+$/;

/**
 * Runtime token-scan pattern (design ADR-4/ADR-8). Weak tripwire — selectors
 * are decorative strings, this is belt-and-suspenders, never a standalone
 * guarantee. Any selector matching this MUST reject the WHOLE payload.
 * (This module is NOT in the closed-action `/allowall|accept/i` build-time
 * guard's scan scope — that guard scans exactly cmp-adapters.js and
 * cmp-tier2-rules.js, per tests/unit/cmp-adapters.test.mjs — so the literal
 * pattern string living here is not self-defeating.)
 */
export const TIER2_TOKEN_SCAN_RE = /allowall|accept/i;

/** Bundled Tier 2 rule ids — remote rules may never collide with these
 * (ADD-only merge, design ADR-5). Exported for reuse by PR B2/B3 tooling. */
export const BUNDLED_TIER2_IDS = new Set(TIER2_RULES.map((r) => r.id));

/** Exact top-level keys a Tier2 payload must have — no more, no fewer. */
const TIER2_PAYLOAD_KEYS = new Set(["schemaVersion", "version", "published", "rules", "sig"]);

/** Exact keys a single Tier2 rule must have — no more, no fewer. This is the
 * structural never-accept guarantee: no field can express an accept action,
 * and — critically — no `toggleScope` field can reach the LIVE content-side
 * `tier2FilterRemoteToggleScope` (src/content/cookie-noise.js), which would
 * otherwise activate a remote Save/toggle/lockedOn click surface. Exported so
 * the never-accept tripwire test (tests/unit/remote-tier2-rules.test.mjs)
 * can pin the exact 4-key set: widening it must fail RED and force a
 * deliberate re-review of the remote Save-click surface. */
export const TIER2_RULE_KEYS = new Set(["id", "present", "reject", "openSettings"]);

// ── Error codes ───────────────────────────────────────────────────────────────

/**
 * Frozen error-code dictionary, mirroring remote-rules.js's ERR style.
 * All errors surface via remoteTier2Meta.lastError in chrome.storage.local.
 * Console logging is the only reporting mechanism, same privacy posture as
 * the params pipeline.
 */
export const ERR = Object.freeze({
  NETWORK_ERROR:      "NETWORK_ERROR",
  SCHEMA_ERROR:       "SCHEMA_ERROR",
  VERIFY_FAILED:      "VERIFY_FAILED",
  DENYLIST_HIT:       "DENYLIST_HIT",
  OVER_CAP:           "OVER_CAP",
  VERSION_REGRESSION: "VERSION_REGRESSION",
  STALE_PAYLOAD:      "STALE_PAYLOAD",
  ID_COLLISION:       "ID_COLLISION",
});

// ── Storage key defaults ──────────────────────────────────────────────────────

/** Default remoteTier2Meta shape. version:0 is the sentinel for "no payload
 * ever accepted" — mirrors remote-rules.js's DEFAULT_META shape. */
const DEFAULT_TIER2_META = Object.freeze({
  version: 0,
  fetchedAt: null,
  ruleCount: 0,
  lastError: null,
  published: null,
});

// ── Module-level dedup guard ──────────────────────────────────────────────────

/** True while a Tier2 fetch is in progress. Reset on worker restart. Isolated
 * from remote-rules.js's own `_remoteFetchInFlight` — an in-flight Tier2
 * fetch never blocks (or is blocked by) a params fetch (design ADR-9,
 * "isolated failure domains"). */
let _tier2FetchInFlight = false;

// ── Pure primitives ───────────────────────────────────────────────────────────

/**
 * Returns the canonical signed message for a Tier2 payload.
 *
 * Format: `tier2|${version}|${published}|` + JSON.stringify of each rule's
 * fields as a positional array `[id, present, reject, openSettings]`.
 *
 * IMPORTANT (REVISED ADR-6 — domain separation):
 *   - The leading `tier2|` tag is REQUIRED and is what makes this message
 *     structurally distinct from params' `canonicalMessage` format
 *     (`${version}|${published}|${params.join(",")}`). Without it, a
 *     validly-signed params payload whose `version`/`published` happen to
 *     line up could theoretically be replayed against the Tier2 verifier —
 *     the tag closes that cross-type signature-replay path even though both
 *     payload types share the SAME signing key.
 *   - Positional arrays (not a delimiter-joined string) are used for the
 *     rules because `JSON.stringify` correctly escapes CSS selectors'
 *     special characters (`:`, `[`, `]`, `,`); a delimiter-joined canonical
 *     would be ambiguous for selector content.
 *   - `rules` order is preserved — NOT sorted. `published` is passed through
 *     verbatim — do NOT re-serialize. `tools/sign-tier2-rules.mjs` (PR B3)
 *     must build this exact byte-identical string.
 *
 * @param {number} version    - Payload version integer.
 * @param {string} published  - ISO-8601 published timestamp (verbatim).
 * @param {ReadonlyArray<{id: string, present: string[], reject: string[], openSettings: string[]}>} rules
 * @returns {string}
 */
export function canonicalTier2Message(version, published, rules) {
  const positional = rules.map((r) => [r.id, r.present, r.reject, r.openSettings]);
  return `tier2|${version}|${published}|${JSON.stringify(positional)}`;
}

/**
 * Validates the top-level shape of a parsed Tier2 payload object.
 * Mirrors remote-rules.js's `validatePayloadShape`, `hasOwnProperty`-exhaustive:
 * any unexpected top-level key rejects the whole payload.
 *
 * @param {unknown} obj - The parsed JSON value.
 * @returns {{ ok: boolean, code?: string }}
 */
export function validateTier2PayloadShape(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  /** @type {Record<string, unknown>} */
  const o = /** @type {Record<string, unknown>} */ (obj);

  const keys = Object.keys(o);
  if (keys.length !== TIER2_PAYLOAD_KEYS.size || !keys.every((k) => TIER2_PAYLOAD_KEYS.has(k))) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  if (typeof o.schemaVersion !== "number" || !Number.isInteger(o.schemaVersion) || o.schemaVersion !== 1) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  if (typeof o.version !== "number" || !Number.isInteger(o.version)) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  if (typeof o.published !== "string" || /** @type {string} */ (o.published).trim() === "") {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  if (!Array.isArray(o.rules)) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  // Every rule element must be a non-null object BEFORE canonicalTier2Message
  // maps over them (mirrors the params pipeline validating element types pre-
  // canonicalisation). Without this, a shape like `rules:[null]` reaches
  // canonicalTier2Message and throws on `null.id`, escaping the "no throw"
  // contract of runTier2RulesFetch. Fail closed at the shape gate instead.
  if (!o.rules.every((r) => r !== null && typeof r === "object" && !Array.isArray(r))) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  if (typeof o.sig !== "string") {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  return { ok: true };
}

/**
 * Validates Tier2 `rules` content: exact per-rule shape, id format/uniqueness,
 * selector array bounds, selector length, rule-count cap, the runtime
 * accept-token scan, version/freshness anti-rollback, and the ADD-only
 * bundled-id collision guard.
 *
 * Validation order (design ADR-4, this file's chosen granularity — reject the
 * WHOLE payload on any single violation, never a partial/silent fallback):
 *   1. Rule-count cap (OVER_CAP).
 *   2. Version monotonic: newVersion > floorVersion (VERSION_REGRESSION).
 *   3. Freshness window + future-date guard (STALE_PAYLOAD).
 *   4. Per rule: exact 4-key shape (SCHEMA_ERROR) → id format/length/uniqueness
 *      (SCHEMA_ERROR) → present/reject/openSettings array bounds and per-selector
 *      length (SCHEMA_ERROR) → per-selector token-scan (DENYLIST_HIT) →
 *      id-collision against bundled ids (ID_COLLISION).
 *
 * CSS parseability is deliberately NOT checked here — the service worker has
 * no DOM. That check runs content-side at gate-open (PR B2) plus a CI-side
 * syntactic pre-check (PR B3, design ADR-4/ADR-7).
 *
 * @param {unknown} rules - The `rules` array from the payload.
 * @param {{
 *   version: number,
 *   published: string,
 *   versionFloor: number,
 *   bundledIds: ReadonlySet<string>,
 *   nowMs: number,
 * }} opts
 * @returns {{ ok: boolean, code?: string, rules?: object[] }}
 */
export function validateTier2Rules(rules, { version, published, versionFloor, bundledIds, nowMs }) {
  if (!Array.isArray(rules) || rules.length > MAX_TIER2_RULES) {
    return { ok: false, code: ERR.OVER_CAP };
  }

  // Version monotonicity (VERSION_REGRESSION). Strictly greater-than, same as
  // remote-rules.js's validateParams — an equal version is also rejected,
  // forcing every publish to bump the version.
  if (typeof version !== "number" || !Number.isInteger(version) || version <= (versionFloor ?? 0)) {
    return { ok: false, code: ERR.VERSION_REGRESSION };
  }

  // Freshness (STALE_PAYLOAD) + future-date guard (#738-style, reused
  // CLOCK_SKEW_TOLERANCE_MS from remote-rules.js).
  if (typeof published !== "string") {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }
  const publishedMs = Date.parse(published);
  if (
    isNaN(publishedMs) ||
    (nowMs - publishedMs) > STALE_DAYS_TIER2 * 24 * 60 * 60 * 1000 ||
    (publishedMs - nowMs) > CLOCK_SKEW_TOLERANCE_MS
  ) {
    return { ok: false, code: ERR.STALE_PAYLOAD };
  }

  const seenIds = new Set();

  for (const rule of rules) {
    if (rule === null || typeof rule !== "object" || Array.isArray(rule)) {
      return { ok: false, code: ERR.SCHEMA_ERROR };
    }

    const keys = Object.keys(rule);
    if (keys.length !== TIER2_RULE_KEYS.size || !keys.every((k) => TIER2_RULE_KEYS.has(k))) {
      return { ok: false, code: ERR.SCHEMA_ERROR };
    }

    if (
      typeof rule.id !== "string" ||
      rule.id.length < 1 ||
      rule.id.length > MAX_TIER2_ID_LEN ||
      !TIER2_ID_FORMAT_RE.test(rule.id)
    ) {
      return { ok: false, code: ERR.SCHEMA_ERROR };
    }

    // Remote-vs-remote duplicate id within the same payload: a curated
    // payload never has dup ids; a dup means malformed/tampered input.
    if (seenIds.has(rule.id)) {
      return { ok: false, code: ERR.SCHEMA_ERROR };
    }
    seenIds.add(rule.id);

    // present / reject: 1..MAX_SELECTORS_PER_ARRAY, non-empty required.
    for (const field of ["present", "reject"]) {
      const arr = rule[field];
      if (!Array.isArray(arr) || arr.length < 1 || arr.length > MAX_SELECTORS_PER_ARRAY) {
        return { ok: false, code: ERR.SCHEMA_ERROR };
      }
      const selResult = _validateSelectors(arr);
      if (!selResult.ok) return selResult;
    }

    // openSettings: 0..MAX_SELECTORS_PER_ARRAY (empty = no two-step path).
    if (!Array.isArray(rule.openSettings) || rule.openSettings.length > MAX_SELECTORS_PER_ARRAY) {
      return { ok: false, code: ERR.SCHEMA_ERROR };
    }
    const openSettingsResult = _validateSelectors(rule.openSettings);
    if (!openSettingsResult.ok) return openSettingsResult;

    // ADD-only: a remote id colliding with a bundled id rejects the WHOLE
    // payload (design ADR-5) — the bundled rule set stays network-immutable.
    if (bundledIds && bundledIds.has(rule.id)) {
      return { ok: false, code: ERR.ID_COLLISION };
    }
  }

  return { ok: true, rules };
}

/**
 * Validates one selector array: per-selector length bound + the runtime
 * accept/allow-all token-scan. Shared helper for present/reject/openSettings.
 *
 * @param {unknown[]} selectors
 * @returns {{ ok: boolean, code?: string }}
 */
function _validateSelectors(selectors) {
  for (const sel of selectors) {
    if (typeof sel !== "string" || sel.length < 1 || sel.length > MAX_SELECTOR_LEN) {
      return { ok: false, code: ERR.SCHEMA_ERROR };
    }
    if (TIER2_TOKEN_SCAN_RE.test(sel)) {
      return { ok: false, code: ERR.DENYLIST_HIT };
    }
  }
  return { ok: true };
}

/**
 * Writes validated Tier2 rules and metadata to storage. Storage-ONLY — no DNR
 * analog exists for Tier2 (design ADR-3): the content script reads
 * `remoteTier2Rules` at gate-open (PR B2), there is no declarativeNetRequest
 * involvement.
 *
 * Fail-closed contract: this function is only ever called by
 * `runTier2RulesFetch` AFTER every prior validation stage has passed. Any
 * earlier-stage failure returns before this is ever invoked, so the cache
 * (`remoteTier2Rules` / `remoteTier2Meta`) is left byte-for-byte untouched on
 * failure — there is no partial-write path.
 *
 * @param {object[]} rules - Validated Tier2 rules.
 * @param {{ version: number, fetchedAt: string|null, ruleCount: number, lastError: null, published: string|null }} meta
 * @param {{ storage: object }} deps - Injected storage facade.
 * @returns {Promise<void>}
 */
export async function mergeIntoTier2Cache(rules, meta, { storage }) {
  // Defense-in-depth: assert MAX_TIER2_RULES before writing, even though
  // validateTier2Rules already enforces this cap on the input. Mirrors
  // remote-rules.js's mergeIntoCache guard — a future caller wiring this
  // differently must never bypass the contract.
  if (!Array.isArray(rules) || rules.length > MAX_TIER2_RULES) {
    throw new Error(
      `mergeIntoTier2Cache: rule count ${Array.isArray(rules) ? rules.length : "(not-array)"} exceeds MAX_TIER2_RULES (${MAX_TIER2_RULES})`,
    );
  }

  // Advance the persistent anti-rollback floor — survives a future
  // clear/disable cycle the same way remoteRulesVersionFloor does for params.
  const prev = await storage.get({ remoteTier2VersionFloor: 0 });
  const remoteTier2VersionFloor = Math.max(prev.remoteTier2VersionFloor ?? 0, meta?.version ?? 0);

  await storage.set({
    remoteTier2Rules: rules,
    remoteTier2Meta: meta,
    remoteTier2VersionFloor,
  });
}

/**
 * Top-level orchestrator for the Tier2 remote-rules fetch pipeline.
 *
 * Pipeline (design ADR-3, REVISED ADR-6):
 *   1. fetchWithCap (reused from remote-rules.js; MAX_TIER2_PAYLOAD_BYTES cap,
 *      FETCH_TIMEOUT_MS timeout, credentials:"omit"/cache:"no-store"/redirect:"error")
 *      → NETWORK_ERROR / OVER_CAP
 *   2. JSON.parse                                → SCHEMA_ERROR
 *   3. validateTier2PayloadShape                  → SCHEMA_ERROR
 *   4. verifySignature (reused) against the SAME  → VERIFY_FAILED
 *      TRUSTED_PUBLIC_KEYS, over canonicalTier2Message (domain-tagged)
 *   5. validateTier2Rules (caps/id/selectors/token-scan/version/freshness/
 *      ADD-only collision)                        → varies
 *   6. mergeIntoTier2Cache                         → writes state
 *
 * On any error: sets remoteTier2Meta.lastError and returns (no throw).
 * Previous remoteTier2Rules are left untouched on failure — fail-closed.
 *
 * deps:
 *   - fetchImpl: fetch function (default: globalThis.fetch)
 *   - subtle:    SubtleCrypto (default: globalThis.crypto.subtle)
 *   - nowMs:     current time in ms (default: Date.now())
 *   - storage:   object with { get, set, remove } (default: thin wrapper over chrome.storage.local)
 *   - trustedKeys: override trusted key array (default: TRUSTED_PUBLIC_KEYS, supports test injection)
 *
 * @param {object} deps
 * @returns {Promise<void>}
 */
export async function runTier2RulesFetch(deps = {}) {
  // Dedup guard — own module-level flag, isolated from remote-rules.js's
  // params dedup guard (design ADR-9, "isolated failure domains").
  if (_tier2FetchInFlight) return;

  _tier2FetchInFlight = true;

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const subtle = deps.subtle ?? globalThis.crypto?.subtle;
  const nowMs = deps.nowMs ?? Date.now();
  const storage = deps.storage ?? _defaultStorage();

  // Same test-only key override precedent as remote-rules.js (design §19.3):
  // globalThis.__MUGA_TRUSTED_KEYS__ when MUGA_TEST=1. Reused verbatim
  // instead of a separate Tier2 override per REVISED ADR-6 (one shared key).
  const trustedKeys =
    deps.trustedKeys ??
    (typeof process !== "undefined" && process.env?.MUGA_TEST === "1" && globalThis.__MUGA_TRUSTED_KEYS__
      ? globalThis.__MUGA_TRUSTED_KEYS__
      : TRUSTED_PUBLIC_KEYS);

  try {
    // 1. Fetch with cap
    let bodyBytes;
    try {
      bodyBytes = await fetchWithCap(REMOTE_TIER2_RULES_URL, {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_TIER2_PAYLOAD_BYTES,
        fetchImpl,
      });
    } catch (err) {
      const code = err.code || ERR.NETWORK_ERROR;
      await _writeTier2Error(code, storage);
      console.error("[MUGA] remote-tier2-rules:", code, err.message);
      return;
    }

    // 2. JSON.parse
    let obj;
    try {
      const text = typeof TextDecoder !== "undefined"
        ? new TextDecoder().decode(bodyBytes)
        : Buffer.from(bodyBytes).toString("utf8");
      obj = JSON.parse(text);
    } catch {
      await _writeTier2Error(ERR.SCHEMA_ERROR, storage);
      console.error("[MUGA] remote-tier2-rules:", ERR.SCHEMA_ERROR, "JSON.parse failed");
      return;
    }

    // 3. Shape validation
    const shapeResult = validateTier2PayloadShape(obj);
    if (!shapeResult.ok) {
      await _writeTier2Error(ERR.SCHEMA_ERROR, storage);
      console.error("[MUGA] remote-tier2-rules:", ERR.SCHEMA_ERROR, "invalid shape");
      return;
    }

    // 4. Signature verification — domain-tagged canonical message, SAME
    // trusted key set as params (REVISED ADR-6).
    const canonical = canonicalTier2Message(obj.version, obj.published, obj.rules);
    const verified = await verifySignature(canonical, obj.sig, trustedKeys, subtle);
    if (!verified) {
      await _writeTier2Error(ERR.VERIFY_FAILED, storage);
      console.error("[MUGA] remote-tier2-rules:", ERR.VERIFY_FAILED);
      return;
    }

    // 5. Read stored meta/floor and validate rules
    const stored = await storage.get({ remoteTier2Meta: { ...DEFAULT_TIER2_META }, remoteTier2VersionFloor: 0 });
    const storedMeta = stored.remoteTier2Meta ?? { ...DEFAULT_TIER2_META };
    const floorVersion = Math.max(storedMeta.version ?? 0, stored.remoteTier2VersionFloor ?? 0);

    const validResult = validateTier2Rules(obj.rules, {
      version: obj.version,
      published: obj.published,
      versionFloor: floorVersion,
      bundledIds: BUNDLED_TIER2_IDS,
      nowMs,
    });

    if (!validResult.ok) {
      await _writeTier2Error(validResult.code, storage);
      console.error("[MUGA] remote-tier2-rules:", validResult.code);
      return;
    }

    // 6. Merge into cache
    const nowIso = new Date(nowMs).toISOString();
    await mergeIntoTier2Cache(validResult.rules, {
      version: obj.version,
      fetchedAt: nowIso,
      ruleCount: validResult.rules.length,
      lastError: null,
      published: obj.published,
    }, { storage });

  } finally {
    _tier2FetchInFlight = false;
  }
}

/**
 * Factory that returns a thin facade over chrome.storage.local.
 * Used as default when no storage dep is injected (production path).
 * @returns {{ get: Function, set: Function, remove: Function }}
 */
function _defaultStorage() {
  return {
    get: (defaults) => new Promise((resolve, reject) => {
      chrome.storage.local.get(defaults, (result) => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve(result);
      });
    }),
    set: (items) => new Promise((resolve, reject) => {
      chrome.storage.local.set(items, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    }),
    remove: (keys) => new Promise((resolve, reject) => {
      chrome.storage.local.remove(keys, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    }),
  };
}

/**
 * Writes an error code to remoteTier2Meta.lastError without touching
 * remoteTier2Rules. Previous rules remain active — fail-closed.
 *
 * @param {string} code - One of the ERR.* codes.
 * @param {object} storage - Storage facade.
 * @returns {Promise<void>}
 */
async function _writeTier2Error(code, storage) {
  try {
    const stored = await storage.get({ remoteTier2Meta: { ...DEFAULT_TIER2_META } });
    const meta = { ...(stored.remoteTier2Meta ?? DEFAULT_TIER2_META), lastError: code };
    await storage.set({ remoteTier2Meta: meta });
  } catch {
    // Best-effort — do not throw from error handler
  }
}
