/** MUGA: remote rules fetch / verify / validate / merge
 *
 * ES module, pure where possible, dependency-injected for testability.
 * No default exports (project convention).
 *
 * Per design §1.1 and ADR-D1: every external dependency is injectable via
 * `runRemoteRulesFetch(deps)` so tests can run with node:test and in-memory fakes.
 *
 * Security invariants (REQ-SECURITY-1 through REQ-SECURITY-4):
 *   - JSON.parse only. No eval, no Function(), no dynamic script.
 *   - 50 KB body cap enforced via streaming reader (ADR-D4).
 *   - 15-second timeout via AbortController.
 *   - fetch uses credentials:"omit", cache:"no-store", redirect:"error".
 */

import { TRUSTED_PUBLIC_KEYS } from "./remote-rules-keys.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Fetch endpoint — compile-time constant, NOT user-configurable (REQ-FETCH-2). */
export const REMOTE_RULES_URL =
  "https://yocreoquesi.github.io/muga/rules/v1/params.json";

/** chrome.alarms name for the weekly fetch alarm (REQ-FETCH-1). */
export const REMOTE_ALARM_NAME = "muga-remote-rules";

/** DNR rule ID for remote params. MUST NOT be 1000 (custom params). (REQ-MERGE-2) */
export const REMOTE_RULE_ID = 1001;

/** Maximum response body size before rejection (REQ-SECURITY-4, REQ-FETCH-4). */
export const MAX_PAYLOAD_BYTES = 50 * 1024; // 50 KB

/** Fetch timeout in milliseconds (REQ-FETCH-5). */
export const FETCH_TIMEOUT_MS = 15_000;

/** Alarm period in minutes — 7 days (REQ-FETCH-1). */
export const ALARM_PERIOD_MIN = 10_080;

/** Alarm initial delay in minutes — 1 hour (REQ-FETCH-1). */
export const ALARM_DELAY_MIN = 60;

/** Maximum accepted remote params after filtering (REQ-VALIDATE-6). */
export const MAX_PARAM_COUNT = 500;

/** Maximum length per param string (REQ-VALIDATE-3). */
export const MAX_PARAM_LEN = 64;

/** Payload freshness window in days (REQ-VALIDATE-8). */
export const STALE_DAYS = 180;

/** Allowed param format (REQ-VALIDATE-2). */
export const PARAM_FORMAT_RE = /^[a-zA-Z0-9_.\-]+$/;

// ── Error codes ───────────────────────────────────────────────────────────────

/**
 * Frozen error-code dictionary.
 * All errors surface via remoteRulesMeta.lastError in chrome.storage.local.
 * Console logging is the only reporting mechanism (REQ-PRIV-4).
 */
export const ERR = Object.freeze({
  NETWORK_ERROR:      "NETWORK_ERROR",
  SCHEMA_ERROR:       "SCHEMA_ERROR",
  VERIFY_FAILED:      "VERIFY_FAILED",
  INVALID_FORMAT:     "INVALID_FORMAT",
  DENYLIST_HIT:       "DENYLIST_HIT",
  OVER_CAP:           "OVER_CAP",
  VERSION_REGRESSION: "VERSION_REGRESSION",
  STALE_PAYLOAD:      "STALE_PAYLOAD",
});

// ── Denylist + affiliate guard sets ──────────────────────────────────────────
//
// Both are case-insensitive compared (we lowercase params before checking).
// Maintenance rule: adding entries is ALWAYS safe (stricter). Removing anything
// requires proposal + review (weakening). Err on the side of bigger. (Design §9)

/**
 * Common legitimate query keys that a remote payload must NEVER add to the
 * strip list. Protecting these prevents breaking searches, OAuth flows, deep links.
 * (REQ-VALIDATE-4)
 */
export const REMOTE_PARAM_DENYLIST = Object.freeze(new Set([
  // Search / navigation
  "q", "query", "search", "s", "keyword", "keywords",
  // Identity / session
  "id", "uid", "user", "userid", "session", "sid", "token", "access_token",
  "api_key", "apikey", "key", "hash", "code", "auth", "signature",
  // Pagination / ordering
  "page", "p", "pg", "offset", "limit", "size", "per_page",
  "sort", "order", "orderby", "dir", "direction",
  // Filtering / view
  "filter", "type", "category", "cat", "tag", "tab", "view", "mode", "format",
  "output", "action", "op", "method",
  // Locale / time
  "lang", "locale", "hl", "tz", "timezone", "region", "country",
  "from", "to", "date", "year", "month", "day", "time", "t",
  // OAuth / redirect
  "state", "redirect", "redirect_uri", "return", "return_to", "return_url",
  "url", "next", "continue", "callback", "error", "error_description",
  // Media / layout
  "v", "w", "h", "width", "height", "color", "theme",
]));

/**
 * Affiliate attribution params — protecting affiliate economics (REQ-VALIDATE-5).
 * A compromised endpoint must never add these to the strip list.
 */
export const AFFILIATE_PARAM_GUARD = Object.freeze(new Set([
  // Amazon
  "tag", "ascsubtag", "associatetag", "linkcode", "creativeasin",
  // eBay
  "campid", "mkevt", "mkcid", "mkrid", "toolid", "customid",
  // Booking / travel
  "aid", "subid", "sid", "affiliate_id",
  // Awin / Impact / generic
  "awc", "irclickid", "irgwc", "clickid", "click_id",
  // Hotmart
  "hmkeyword",
  // TikTok / Instagram shopping
  "afsrc", "af_id",
  // Generic partner / ref family
  "partner", "partnerid", "affid", "aff_id", "refcode",
]));

// ── Storage key defaults ──────────────────────────────────────────────────────

/**
 * Default remoteRulesMeta shape (design §8).
 * version:0 is the sentinel for "no payload ever accepted".
 */
const DEFAULT_META = Object.freeze({
  version: 0,
  fetchedAt: null,
  paramCount: 0,
  lastError: null,
  published: null,
});

// ── Module-level dedup guard ──────────────────────────────────────────────────

/** True while a fetch is in progress. Reset on worker restart. (REQ-FETCH-3, SC-10, SC-11) */
let _remoteFetchInFlight = false;

// ── Cached CryptoKey imports ──────────────────────────────────────────────────

/** Module-scope cache of imported CryptoKey objects (design §1.1, cold-start amortisation). */
let _importedKeysCache = null;
/** Tracks the base64 key strings used to build _importedKeysCache for cache invalidation. */
let _importedKeysSig = null;

/**
 * Imports raw Ed25519 public keys from base64 strings into CryptoKey objects.
 * Results are cached for the service-worker lifetime using the key strings as
 * a cache key — so different key arrays never share the cache.
 *
 * @param {string[]} base64Keys - Array of base64-encoded raw 32-byte Ed25519 public keys.
 * @param {SubtleCrypto} subtle - Web Crypto SubtleCrypto interface.
 * @returns {Promise<CryptoKey[]>}
 */
async function importTrustedKeys(base64Keys, subtle) {
  const keySig = base64Keys.join("|");
  if (_importedKeysCache && _importedKeysSig === keySig) {
    return _importedKeysCache;
  }

  const keys = await Promise.all(
    base64Keys.map(async (b64) => {
      // Standard base64 → Uint8Array (32 bytes for Ed25519)
      const raw = Uint8Array.from(
        typeof atob === "function"
          ? atob(b64).split("").map(c => c.charCodeAt(0))
          : Buffer.from(b64, "base64")
      );
      return subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    })
  );
  _importedKeysCache = keys;
  _importedKeysSig = keySig;
  return keys;
}

// ── Pure primitives ───────────────────────────────────────────────────────────

/**
 * Returns the canonical signed message for a payload.
 *
 * Format: `${version}|${published}|${params.join(",")}`
 *
 * IMPORTANT (design §2):
 *   - params order is preserved — NOT sorted
 *   - published is passed through verbatim — do NOT re-serialize
 *   - version is stringified by coercion — no leading zeros
 *
 * @param {number}   version   - Payload version integer.
 * @param {string}   published - ISO-8601 published timestamp (verbatim).
 * @param {string[]} params    - Params array (order-sensitive).
 * @returns {string}
 */
export function canonicalMessage(version, published, params) {
  return `${version}|${published}|${params.join(",")}`;
}

/**
 * Verifies an Ed25519 signature against an array of trusted public keys.
 * Returns true if ANY key validates. No keyId — iteration only. (ADR-D2)
 *
 * Signature encoding: base64url (URL-safe, no padding). Internally normalised
 * to standard base64 before verification. (design §2)
 *
 * @param {string}       canonical   - The canonical message string to verify.
 * @param {string}       sigBase64   - The signature in base64url encoding.
 * @param {string[]}     trustedKeys - Array of base64-encoded raw Ed25519 public keys.
 * @param {SubtleCrypto} subtle      - Web Crypto SubtleCrypto interface.
 * @returns {Promise<boolean>}
 */
export async function verifySignature(canonical, sigBase64, trustedKeys, subtle) {
  if (!trustedKeys || trustedKeys.length === 0) return false;

  try {
    // Normalise base64url → standard base64 with padding (design §2)
    const stdB64 = sigBase64
      .replace(/-/g, "+")
      .replace(/_/g, "/");
    const padded = stdB64 + "=".repeat((4 - stdB64.length % 4) % 4);

    const sigBytes = Uint8Array.from(
      typeof atob === "function"
        ? atob(padded).split("").map(c => c.charCodeAt(0))
        : Buffer.from(padded, "base64")
    );

    const msgBytes = typeof TextEncoder !== "undefined"
      ? new TextEncoder().encode(canonical)
      : Buffer.from(canonical, "utf8");

    const cryptoKeys = await importTrustedKeys(trustedKeys, subtle);

    for (const key of cryptoKeys) {
      try {
        const ok = await subtle.verify("Ed25519", key, sigBytes, msgBytes);
        if (ok) return true;
      } catch {
        // This key failed to verify — try next
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Validates the top-level shape of a parsed payload object.
 * Returns { ok: true } on success or { ok: false, code: ERR.SCHEMA_ERROR } on failure.
 * Does NOT validate params content — that is validateParams's job. (REQ-VALIDATE-1)
 *
 * @param {unknown} obj - The parsed JSON value.
 * @returns {{ ok: boolean, code?: string }}
 */
export function validatePayloadShape(obj) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  // version: must be an integer
  if (
    !Object.prototype.hasOwnProperty.call(obj, "version") ||
    typeof obj.version !== "number" ||
    !Number.isInteger(obj.version)
  ) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  // published: must be a string
  if (
    !Object.prototype.hasOwnProperty.call(obj, "published") ||
    typeof obj.published !== "string"
  ) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  // params: must be an array of strings
  if (
    !Object.prototype.hasOwnProperty.call(obj, "params") ||
    !Array.isArray(obj.params) ||
    !obj.params.every(p => typeof p === "string")
  ) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  // sig: must be a string
  if (
    !Object.prototype.hasOwnProperty.call(obj, "sig") ||
    typeof obj.sig !== "string"
  ) {
    return { ok: false, code: ERR.SCHEMA_ERROR };
  }

  return { ok: true };
}

/**
 * Validates payload params against content rules.
 *
 * Validation order (design §6, steps 5–11):
 *   1. Per-param format regex (INVALID_FORMAT)
 *   2. Per-param length bounds [1, 64] (INVALID_FORMAT)
 *   3. Denylist match, case-insensitive (DENYLIST_HIT)
 *   4. Affiliate-guard match, case-insensitive (DENYLIST_HIT)
 *   5. Version monotonic: newVersion > stored.version (VERSION_REGRESSION)
 *   6. Freshness: newPublished within 180 days (STALE_PAYLOAD)
 *   7. Post-filter count ≤ 500 (OVER_CAP)
 *
 * Caller is responsible for passing newVersion and newPublished via the opts object.
 * The stored object provides the previously accepted version (0 if none).
 *
 * Returns { ok: true, accepted: string[] } or { ok: false, code: string }.
 *
 * @param {string[]} params      - The params from the payload.
 * @param {{ version: number, published: string|null }} stored - Previously stored meta.
 * @param {number}   nowMs       - Current time in ms (injectable for tests).
 * @param {{ newVersion?: number, newPublished?: string }} [opts] - Payload metadata.
 * @returns {{ ok: boolean, code?: string, accepted?: string[] }}
 */
export function validateParams(params, stored, nowMs, opts = {}) {
  const newVersion = opts.newVersion ?? (params._version ?? 0);
  const newPublished = opts.newPublished ?? null;

  // 1+2. Per-param format and length checks (INVALID_FORMAT)
  for (const param of params) {
    if (typeof param !== "string" || param.length < 1 || param.length > MAX_PARAM_LEN) {
      return { ok: false, code: ERR.INVALID_FORMAT };
    }
    if (!PARAM_FORMAT_RE.test(param)) {
      return { ok: false, code: ERR.INVALID_FORMAT };
    }
  }

  // 3+4. Denylist and affiliate-guard checks (case-insensitive, DENYLIST_HIT)
  for (const param of params) {
    const lower = param.toLowerCase();
    if (REMOTE_PARAM_DENYLIST.has(lower) || AFFILIATE_PARAM_GUARD.has(lower)) {
      return { ok: false, code: ERR.DENYLIST_HIT };
    }
  }

  // 5. Version monotonicity (VERSION_REGRESSION)
  const storedVersion = stored?.version ?? 0;
  if (newVersion <= storedVersion) {
    return { ok: false, code: ERR.VERSION_REGRESSION };
  }

  // 6. Freshness (STALE_PAYLOAD)
  if (newPublished) {
    const publishedMs = Date.parse(newPublished);
    if (isNaN(publishedMs) || (nowMs - publishedMs) > STALE_DAYS * 24 * 60 * 60 * 1000) {
      return { ok: false, code: ERR.STALE_PAYLOAD };
    }
  }

  // 7. Post-filter count (OVER_CAP) — checked before dedup to be consistent
  if (params.length > MAX_PARAM_COUNT) {
    return { ok: false, code: ERR.OVER_CAP };
  }

  return { ok: true, accepted: params };
}

/**
 * Silently removes params already present in the built-in TRACKING_PARAMS set.
 * This is a dedup filter, NOT a payload rejection trigger. (REQ-VALIDATE-9, ADR-D9)
 *
 * Comparison is case-insensitive: the built-in set is expected to contain lowercased strings.
 *
 * @param {string[]} params     - Accepted remote params to filter.
 * @param {Set<string>} builtinSet - Set of built-in tracking params (lowercased).
 * @returns {string[]} Filtered params with built-in duplicates removed.
 */
export function filterAgainstBuiltin(params, builtinSet) {
  return params.filter(p => !builtinSet.has(p.toLowerCase()));
}

/**
 * Fetches the remote rules URL with streaming 50 KB cap and timeout.
 *
 * Design constraints (design §7, ADR-D4):
 *   - Reads via getReader() accumulating bytes; aborts when over cap.
 *   - Does NOT trust Content-Length (can be missing, chunked, or forged).
 *   - AbortController for timeout.
 *   - credentials:"omit", cache:"no-store", redirect:"error" (REQ-PRIV-2).
 *
 * On success: returns Uint8Array of response body bytes.
 * On failure (timeout, network error, non-200, over-cap): throws an Error
 *   whose message contains the appropriate error code.
 *
 * @param {string} url - The URL to fetch (should be REMOTE_RULES_URL).
 * @param {{ timeoutMs: number, maxBytes: number, fetchImpl: Function }} opts
 * @returns {Promise<Uint8Array>}
 */
export async function fetchWithCap(url, { timeoutMs, maxBytes, fetchImpl }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);

  try {
    let res;
    try {
      res = await fetchImpl(url, {
        credentials: "omit",
        cache: "no-store",
        redirect: "error",
        signal: ac.signal,
      });
    } catch (err) {
      const msg = err?.name === "AbortError" ? ERR.NETWORK_ERROR : ERR.NETWORK_ERROR;
      const e = new Error(msg);
      e.code = ERR.NETWORK_ERROR;
      throw e;
    }

    if (!res.ok) {
      const e = new Error(`${ERR.NETWORK_ERROR}: HTTP ${res.status}`);
      e.code = ERR.NETWORK_ERROR;
      throw e;
    }

    // Early Content-Length hint (not trusted for the cap, but avoids reading a known-large body)
    const cl = res.headers?.get?.("content-length");
    if (cl && Number(cl) > maxBytes) {
      ac.abort();
      const e = new Error(ERR.OVER_CAP);
      e.code = ERR.OVER_CAP;
      throw e;
    }

    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
      let chunk;
      try {
        chunk = await reader.read();
      } catch (err) {
        const e = new Error(ERR.NETWORK_ERROR);
        e.code = ERR.NETWORK_ERROR;
        throw e;
      }

      if (chunk.done) break;

      total += chunk.value.byteLength;
      if (total > maxBytes) {
        try { ac.abort(); } catch { /* ignore */ }
        try { reader.cancel(); } catch { /* ignore */ }
        const e = new Error(ERR.OVER_CAP);
        e.code = ERR.OVER_CAP;
        throw e;
      }
      chunks.push(chunk.value);
    }

    // Flatten into a single Uint8Array (design §7)
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Writes accepted params and metadata to storage, and updates DNR rule 1001.
 *
 * Per design §4.3 step 7 and REQ-MERGE-1/2:
 *   - Writes remoteParams + remoteRulesMeta to chrome.storage.local (via storage facade).
 *   - Calls dnr.updateDynamicRules to add/replace rule 1001.
 *   - Does NOT touch remoteRulesEnabled (sync) or customParams.
 *
 * @param {string[]} accepted - Validated and deduped remote params.
 * @param {{ version: number, fetchedAt: string|null, paramCount: number, lastError: null, published: string|null }} meta
 * @param {{ storage: object, dnr: object }} deps - Injected storage and DNR facades.
 * @returns {Promise<void>}
 */
export async function mergeIntoCache(accepted, meta, { storage, dnr }) {
  await storage.set({
    remoteParams: accepted,
    remoteRulesMeta: meta,
  });
  await dnr.updateDynamicRules({
    removeRuleIds: [REMOTE_RULE_ID],
    addRules: [buildRemoteDnrRule(accepted)],
  });
}

/**
 * Clears remote params from storage and removes DNR rule 1001.
 * Called when the user disables remote rules (REQ-OPT-5, SC-03).
 *
 * IMPORTANT: MUST NOT remove rule 1000 (custom params). (REQ-MERGE-4)
 *
 * @param {{ storage: object, dnr: object }} deps - Injected storage and DNR facades.
 * @returns {Promise<void>}
 */
export async function clearRemoteCache({ storage, dnr }) {
  await storage.remove(["remoteParams", "remoteRulesMeta"]);
  await dnr.updateDynamicRules({
    removeRuleIds: [REMOTE_RULE_ID],
    addRules: [],
  });
}

/**
 * Builds the DNR rule object for remote params.
 * Mirrors the DYNAMIC_RULE_ID = 1000 pattern for custom params. (design §12)
 *
 * @param {string[]} params - Lowercase, deduped, validated array (≤ 500 entries).
 * @returns {object} DNR rule object with id REMOTE_RULE_ID (1001).
 */
export function buildRemoteDnrRule(params) {
  return {
    id: REMOTE_RULE_ID,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        transform: {
          queryTransform: {
            removeParams: params,
          },
        },
      },
    },
    condition: {
      resourceTypes: ["main_frame", "sub_frame"],
    },
  };
}

/**
 * Top-level orchestrator for the remote-rules fetch pipeline.
 *
 * Validation order (design §6):
 *   1. fetchWithCap (size cap + timeout)  → NETWORK_ERROR / OVER_CAP
 *   2. JSON.parse                          → SCHEMA_ERROR
 *   3. validatePayloadShape                → SCHEMA_ERROR
 *   4. verifySignature                     → VERIFY_FAILED
 *   5. validateParams (version + freshness + format + denylist + count) → varies
 *   6. filterAgainstBuiltin                → silent dedup
 *   7. mergeIntoCache                      → writes state
 *
 * On any error: sets remoteRulesMeta.lastError and returns (no throw).
 * Previous remoteParams are left untouched on failure (ADR-D9, REQ-FETCH-4).
 *
 * deps:
 *   - fetchImpl: fetch function (default: globalThis.fetch)
 *   - subtle:    SubtleCrypto (default: globalThis.crypto.subtle)
 *   - nowMs:     current time in ms (default: Date.now())
 *   - storage:   object with { get, set, remove } (default: thin wrapper over chrome.storage.local)
 *   - dnr:       object with { updateDynamicRules } (default: thin wrapper over chrome.declarativeNetRequest)
 *   - trustedKeys: override trusted key array (default: TRUSTED_PUBLIC_KEYS, supports test injection)
 *
 * @param {object} deps
 * @returns {Promise<void>}
 */
export async function runRemoteRulesFetch(deps = {}) {
  // Dedup guard — dropped if a fetch is already in progress (REQ-FETCH-3, SC-11)
  if (_remoteFetchInFlight) return;

  _remoteFetchInFlight = true;

  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const subtle = deps.subtle ?? globalThis.crypto?.subtle;
  const nowMs = deps.nowMs ?? Date.now();
  const storage = deps.storage ?? _defaultStorage();
  const dnr = deps.dnr ?? _defaultDnr();

  // Test-only key override: globalThis.__MUGA_TRUSTED_KEYS__ when MUGA_TEST=1 (design §19.3)
  const trustedKeys =
    deps.trustedKeys ??
    (typeof process !== "undefined" && process.env?.MUGA_TEST === "1" && globalThis.__MUGA_TRUSTED_KEYS__
      ? globalThis.__MUGA_TRUSTED_KEYS__
      : TRUSTED_PUBLIC_KEYS);

  // Invalidate key cache when overriding trusted keys in tests
  if (deps.trustedKeys) {
    _importedKeysCache = null;
    _importedKeysSig = null;
  }

  try {
    // 1. Fetch with cap
    let bodyBytes;
    try {
      bodyBytes = await fetchWithCap(REMOTE_RULES_URL, {
        timeoutMs: FETCH_TIMEOUT_MS,
        maxBytes: MAX_PAYLOAD_BYTES,
        fetchImpl,
      });
    } catch (err) {
      const code = err.code === ERR.OVER_CAP ? ERR.NETWORK_ERROR : ERR.NETWORK_ERROR;
      await _writeError(code, storage);
      console.error("[MUGA] remote-rules:", code, err.message);
      return;
    }

    // 2. JSON.parse
    let obj;
    try {
      const text = typeof TextDecoder !== "undefined"
        ? new TextDecoder().decode(bodyBytes)
        : Buffer.from(bodyBytes).toString("utf8");
      obj = JSON.parse(text);
    } catch (err) {
      await _writeError(ERR.SCHEMA_ERROR, storage);
      console.error("[MUGA] remote-rules:", ERR.SCHEMA_ERROR, "JSON.parse failed");
      return;
    }

    // 3. Shape validation
    const shapeResult = validatePayloadShape(obj);
    if (!shapeResult.ok) {
      await _writeError(ERR.SCHEMA_ERROR, storage);
      console.error("[MUGA] remote-rules:", ERR.SCHEMA_ERROR, "invalid shape");
      return;
    }

    // 4. Signature verification
    const canonical = canonicalMessage(obj.version, obj.published, obj.params);
    const verified = await verifySignature(canonical, obj.sig, trustedKeys, subtle);
    if (!verified) {
      await _writeError(ERR.VERIFY_FAILED, storage);
      console.error("[MUGA] remote-rules:", ERR.VERIFY_FAILED);
      return;
    }

    // 5. Read stored meta and validate params
    const stored = await storage.get({ remoteRulesMeta: { ...DEFAULT_META } });
    const storedMeta = stored.remoteRulesMeta ?? { ...DEFAULT_META };

    const validResult = validateParams(
      obj.params,
      { version: storedMeta.version, published: storedMeta.published },
      nowMs,
      { newVersion: obj.version, newPublished: obj.published }
    );

    if (!validResult.ok) {
      await _writeError(validResult.code, storage);
      console.error("[MUGA] remote-rules:", validResult.code);
      return;
    }

    // 6. Silent dedup against built-in params
    // Import TRACKING_PARAMS lazily to avoid circular deps — cleaner.js imports affiliates.js
    let builtinSet;
    try {
      const { TRACKING_PARAMS } = await import("./affiliates.js");
      builtinSet = new Set(TRACKING_PARAMS.map(p => p.toLowerCase()));
    } catch {
      // If affiliates.js unavailable (e.g. in some test envs), skip dedup
      builtinSet = new Set();
    }
    const accepted = filterAgainstBuiltin(validResult.accepted, builtinSet);

    // 7. Merge into cache
    const nowIso = new Date(nowMs).toISOString();
    await mergeIntoCache(accepted, {
      version: obj.version,
      fetchedAt: nowIso,
      paramCount: accepted.length,
      lastError: null,
      published: obj.published,
    }, { storage, dnr });

  } finally {
    _remoteFetchInFlight = false;
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
 * Factory that returns a thin facade over chrome.declarativeNetRequest.
 * Used as default when no dnr dep is injected (production path).
 * @returns {{ updateDynamicRules: Function }}
 */
function _defaultDnr() {
  return {
    updateDynamicRules: (opts) => new Promise((resolve, reject) => {
      chrome.declarativeNetRequest.updateDynamicRules(opts, () => {
        if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
        else resolve();
      });
    }),
  };
}

/**
 * Writes an error code to remoteRulesMeta.lastError without touching remoteParams.
 * Previous params remain active (REQ-FETCH-4).
 *
 * @param {string} code - One of the ERR.* codes.
 * @param {object} storage - Storage facade.
 * @returns {Promise<void>}
 */
async function _writeError(code, storage) {
  try {
    const stored = await storage.get({ remoteRulesMeta: { ...DEFAULT_META } });
    const meta = { ...(stored.remoteRulesMeta ?? DEFAULT_META), lastError: code };
    await storage.set({ remoteRulesMeta: meta });
  } catch {
    // Best-effort — do not throw from error handler
  }
}

/**
 * Factory that creates an orchestrator object for testing.
 * Returns { run, clear, status } bound to the provided deps.
 *
 * @param {object} deps - Same shape as runRemoteRulesFetch deps.
 * @returns {{ run: Function, clear: Function, status: Function }}
 */
export function createRemoteRulesOrchestrator(deps) {
  return {
    run: () => runRemoteRulesFetch(deps),
    clear: () => clearRemoteCache(deps),
    status: async () => {
      const stored = await deps.storage.get({ remoteRulesMeta: { ...DEFAULT_META } });
      return stored.remoteRulesMeta ?? { ...DEFAULT_META };
    },
  };
}
