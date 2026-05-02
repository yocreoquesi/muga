/**
 * MUGA: Cross-Site Frequency Tracker (#446 base, #532 graduation pipeline)
 *
 * Tracks URL parameters seen across visited first-party domains so the
 * popup can flag those that look like cross-site identifiers — params
 * that show up against MANY different domains AND with MANY different
 * values. That shape is the fingerprint of a tracking ID; a search
 * query, by contrast, has many values but few domains.
 *
 * ── Graduation pipeline (issue #532) ──────────────────────────────────
 *
 * Each tracked param carries an explicit lifecycle state:
 *
 *   observed  → seen on at least one first-party domain. Default state.
 *   suspicious → meets the original B16 thresholds (≥3 domains AND
 *                ≥3 distinct value-hashes). `getFlagged()` continues to
 *                surface this set so consumers (popup) keep working.
 *   candidate  → strong cross-site-tracker signal: ≥5 domains AND
 *                ≥10 value-hashes AND running-mean entropy > 3.0 AND
 *                param name length ≥ 4. The length guard exists because
 *                PRD #529 explicitly rejects 3-letter generic params
 *                (id, pid, ref) that are too noisy to graduate.
 *
 * State is computed LAZILY on read (inside `getState` and `getFlagged`).
 * The hot `observe()` path stays cheap — it only updates the running-mean
 * entropy (O(1)) and the LRU bookkeeping. Promotion is a function of the
 * stored counts + entropyAvg, NEVER of the order in which observations
 * arrived. That keeps the data future-proof: a stricter threshold can be
 * applied retroactively without re-running the whole event log.
 *
 * ── Privacy contract ──────────────────────────────────────────────────
 *
 *   - LOCAL ONLY. All state lives in chrome.storage.local. Nothing is
 *     transmitted, ever.
 *   - VALUES ARE HASHED (SHA-256). The tracker NEVER persists the raw
 *     value — only a hash, which means we can compare-for-equality
 *     across observations without retaining the source string.
 *   - HAS ITS OWN PREF TOGGLE (`crossSiteFrequencyEnabled`). Even
 *     though the data is local-only, the user can opt out: a local
 *     map of "params seen on which domains" is sensitive enough that
 *     a toggle is the right default.
 *   - LRU-CAPPED at MAX_TRACKED_PARAMS unique paramNames. Beyond that,
 *     the least-recently-touched entry is evicted. This bounds storage
 *     and prevents pathological growth on sites that mint a new param
 *     name every page load.
 *
 * ── Threshold semantics ───────────────────────────────────────────────
 *
 * A paramName is FLAGGED when it has been observed against:
 *   - DOMAIN_THRESHOLD (3) or more distinct first-party domains, AND
 *   - VALUE_THRESHOLD (3) or more distinct value-hashes.
 *
 * The AND is mandatory. A search query like `q` will pile up many
 * distinct values on a handful of domains (search engines, e-commerce
 * search) — high values, low domains. A session-id like `sid` will
 * pile up many domains with the same value — high domains, low
 * values. Only a true cross-site identifier crosses both axes.
 *
 * ── Hash collision rule ───────────────────────────────────────────────
 *
 * The tracker's identity for a value IS the hash. If two raw values
 * happen to share a hash, they count as the SAME value. SHA-256
 * collisions are not adversarially reachable in practice; this trade-
 * off lets us avoid persisting the raw value entirely. We'd rather
 * under-count a flag than ever store user-controlled bytes.
 *
 * ── Storage adapter ───────────────────────────────────────────────────
 *
 * The pure module accepts an injected storage adapter so tests can run
 * against an in-memory map and production wires the chrome.storage.local
 * adapter. The shape is intentionally tiny:
 *
 *   adapter.get() : Promise<{ params?: Record<string, Entry> }>
 *   adapter.set(state) : Promise<void>
 *
 * where Entry = { domains: string[], values: string[], lastSeen: number }.
 *
 * The hasher is also injectable so tests get determinism (no SubtleCrypto
 * round-trip). The production path uses SHA-256 via SubtleCrypto, which
 * is available in MV3 service workers AND in popup contexts.
 */

/** Distinct first-party domains required before a param can be flagged (suspicious). */
export const DOMAIN_THRESHOLD = 3;
/** Distinct value-hashes required before a param can be flagged (suspicious). */
export const VALUE_THRESHOLD = 3;
/** Hard cap on tracked paramNames. LRU-evicts the least-recently-touched entry. */
export const MAX_TRACKED_PARAMS = 1000;

// ── Graduation thresholds (issue #532) ───────────────────────────────────────
//
// "candidate" is a STRONGER signal than "suspicious". A param earns it only
// when ALL FOUR conditions hold simultaneously. Tunable; bumping any of
// these tightens the funnel without breaking the lifecycle.

/** Distinct first-party domains required to graduate from suspicious → candidate. */
export const CANDIDATE_DOMAIN_THRESHOLD = 5;
/** Distinct value-hashes required to graduate from suspicious → candidate. */
export const CANDIDATE_VALUE_THRESHOLD = 10;
/**
 * Running-mean Shannon entropy required for graduation. UUIDs / base64 tokens
 * routinely sit above 4. A value of 3.0 cleanly excludes sequential numeric
 * IDs and short codes while keeping real cross-site identifiers in scope.
 */
export const CANDIDATE_ENTROPY_THRESHOLD = 3.0;
/**
 * Minimum param-name length for graduation. PRD #529 explicitly rejects
 * 3-letter generic params (id, pid, ref) — they are too noisy across the
 * web to deserve "candidate" status, even when they meet the other floors.
 */
export const CANDIDATE_NAME_LENGTH_MIN = 4;

// ── Shannon entropy helper ───────────────────────────────────────────────────

/**
 * Shannon entropy of `s` in bits-per-symbol. Used by the graduation pipeline
 * to distinguish high-entropy tracking IDs (UUIDs, base64 tokens — entropy
 * routinely above 4) from low-entropy enumerated IDs (sequential integers,
 * short codes — entropy near 0–2).
 *
 * Returns 0 for empty / nullish / single-symbol inputs (no information).
 *
 * @param {string|null|undefined} s
 * @returns {number} entropy in bits per symbol; 0 ≤ result ≤ log2(|alphabet|)
 */
export function valueEntropy(s) {
  if (s === null || s === undefined) return 0;
  const str = String(s);
  const n = str.length;
  if (n <= 1) return 0;
  const freq = new Map();
  for (const ch of str) freq.set(ch, (freq.get(ch) || 0) + 1);
  let h = 0;
  for (const c of freq.values()) {
    const p = c / n;
    h -= p * Math.log2(p);
  }
  return h;
}

// ── Storage adapters ─────────────────────────────────────────────────────────

/**
 * In-memory storage adapter for tests. Each call to createInMemoryAdapter()
 * returns a fresh, isolated store — important so tests don't leak state.
 *
 * @returns {{ get: () => Promise<object>, set: (state: object) => Promise<void> }}
 */
export function createInMemoryAdapter() {
  let _state = { params: {} };
  return {
    get: async () => {
      // Return a deep-enough copy so callers can't mutate _state directly.
      return JSON.parse(JSON.stringify(_state));
    },
    set: async (state) => {
      _state = JSON.parse(JSON.stringify(state));
    },
  };
}

/**
 * chrome.storage.local-backed adapter for production. Lives in `local` —
 * NEVER sync — because per-domain frequency data is privacy-sensitive
 * and would also blow past sync's 100 KB quota at the LRU cap.
 *
 * Feature-detected: returns null if chrome.storage.local is unavailable
 * (e.g., during unit tests that didn't stub the API). Callers MUST
 * tolerate a null return and skip wiring the tracker entirely.
 *
 * @returns {{ get: () => Promise<object>, set: (state: object) => Promise<void> } | null}
 */
export function createChromeLocalAdapter() {
  if (typeof chrome === "undefined" || !chrome.storage || !chrome.storage.local) {
    return null;
  }
  const KEY = "crossSiteFreq";
  return {
    get: async () => {
      try {
        const r = await new Promise((resolve, reject) => {
          chrome.storage.local.get({ [KEY]: { params: {} } }, (result) => {
            if (chrome.runtime?.lastError) reject(chrome.runtime.lastError);
            else resolve(result);
          });
        });
        return r[KEY] || { params: {} };
      } catch (err) {
        // Best-effort: if storage is unhappy, return an empty shape so the
        // tracker fails open (no flags, no crashes).
        console.error("[MUGA] cross-site-frequency get:", err);
        return { params: {} };
      }
    },
    set: async (state) => {
      try {
        await new Promise((resolve, reject) => {
          chrome.storage.local.set({ [KEY]: state }, () => {
            if (chrome.runtime?.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        });
      } catch (err) {
        console.error("[MUGA] cross-site-frequency set:", err);
      }
    },
  };
}

// ── Default hasher (SubtleCrypto, when available) ────────────────────────────

/**
 * SHA-256 hasher backed by SubtleCrypto. Used in production. Tests inject
 * a deterministic stub so they don't depend on Web Crypto.
 *
 * @param {string} input
 * @returns {Promise<string>} hex-encoded digest, or "" when SubtleCrypto
 *                            is missing (e.g., obscure runtimes).
 */
export async function defaultHasher(input) {
  if (typeof crypto === "undefined" || !crypto.subtle) return "";
  const bytes = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest("SHA-256", bytes);
  // hex-encode without pulling a dependency
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Tracker ──────────────────────────────────────────────────────────────────

/**
 * Creates a tracker bound to a storage adapter and a hasher. The tracker
 * is the only thing callers should hold — it wraps the adapter + hasher
 * + enabled-flag so the caller never has to thread them through.
 *
 * @param {object}   options
 * @param {object}   options.adapter — { get, set } (see in-memory / chrome adapters)
 * @param {Function} options.hasher  — async (string) => string
 * @param {boolean}  [options.enabled=true]
 * @returns {{
 *   observe: (domain: string, paramName: string, value: string) => Promise<void>,
 *   getFlagged: () => Promise<Array<{ param: string, domains: number, values: number, state: string }>>,
 *   getState: (paramName: string) => Promise<"observed"|"suspicious"|"candidate">,
 *   setEnabled: (next: boolean) => void,
 * }}
 */
export function createTracker({ adapter, hasher, enabled = true }) {
  let _enabled = enabled !== false;

  /**
   * Records that `paramName=value` was seen on `domain`. No-op when the
   * tracker is disabled. Touches `lastSeen` on every observation so the
   * LRU has fresh information to choose its eviction victim.
   *
   * Maintains a running-mean entropy for the param so graduation decisions
   * can be made cheaply at read time (see graduate() / getState()). Running
   * mean keeps observe() at O(1) — no per-observation array growth, no
   * recomputation over historical values.
   */
  async function observe(domain, paramName, value) {
    if (!_enabled) return;
    if (!domain || !paramName) return;

    const rawValue = String(value ?? "");
    const hash = await hasher(rawValue);
    const state = await adapter.get();
    state.params = state.params || {};
    const now = Date.now();
    let entry = state.params[paramName];
    if (!entry) {
      // firstSeen pinned at creation; never moves. lastSeen + count + entropyAvg
      // evolve with every observation. count is a separate field because we need
      // it to update the running mean, and `values.length` would only reflect
      // DISTINCT values (re-observations would never adjust the mean).
      entry = { domains: [], values: [], firstSeen: now, lastSeen: now, count: 0, entropyAvg: 0 };
      state.params[paramName] = entry;
    }
    if (!entry.domains.includes(domain)) entry.domains.push(domain);
    if (!entry.values.includes(hash)) entry.values.push(hash);
    // Backfill defensive defaults for entries persisted by an older version of
    // this module (pre-#532). Cheap and idempotent.
    if (typeof entry.firstSeen !== "number") entry.firstSeen = now;
    if (typeof entry.count !== "number") entry.count = 0;
    if (typeof entry.entropyAvg !== "number") entry.entropyAvg = 0;
    // Running-mean update: new_avg = old_avg + (sample - old_avg) / n.
    // Done on EVERY observation (including re-observations of the same value)
    // because a param dominated by repeated low-entropy values should see its
    // running mean drift down, not stay frozen at the first sample.
    const sample = valueEntropy(rawValue);
    entry.count += 1;
    entry.entropyAvg = entry.entropyAvg + (sample - entry.entropyAvg) / entry.count;
    // Touch on every observation, including no-op re-observations, so the
    // LRU correctly reflects "params I keep seeing", not just first-seen.
    entry.lastSeen = now;

    // LRU enforcement. Eviction triggers AFTER insertion so a write that
    // happens to be the cap+1 unique param doesn't get dropped before its
    // own lastSeen lands. We then drop the entry with the OLDEST lastSeen.
    const names = Object.keys(state.params);
    if (names.length > MAX_TRACKED_PARAMS) {
      let oldestName = null;
      let oldestSeen = Infinity;
      for (const n of names) {
        const s = state.params[n].lastSeen ?? 0;
        if (s < oldestSeen) {
          oldestSeen = s;
          oldestName = n;
        }
      }
      if (oldestName !== null) delete state.params[oldestName];
    }

    await adapter.set(state);
  }

  /**
   * Pure function: derive the lifecycle state of a single entry from its
   * stored counts + entropyAvg + name. Lives outside observe() so promotion
   * is purely a read-side concern — observe stays cheap and storage stays
   * a pure event log we can re-evaluate against new thresholds at any time.
   *
   * @param {string} name — param name (used for the length guard)
   * @param {object|undefined} entry — stored entry, or undefined
   * @returns {"observed"|"suspicious"|"candidate"}
   */
  function graduate(name, entry) {
    if (!entry) return "observed";
    const dCount = entry.domains?.length ?? 0;
    const vCount = entry.values?.length ?? 0;
    if (dCount < DOMAIN_THRESHOLD || vCount < VALUE_THRESHOLD) return "observed";
    // At least suspicious. Check whether it also crosses the candidate bar.
    const eAvg = typeof entry.entropyAvg === "number" ? entry.entropyAvg : 0;
    const nameLen = (name || "").length;
    if (
      dCount >= CANDIDATE_DOMAIN_THRESHOLD &&
      vCount >= CANDIDATE_VALUE_THRESHOLD &&
      eAvg > CANDIDATE_ENTROPY_THRESHOLD &&
      nameLen >= CANDIDATE_NAME_LENGTH_MIN
    ) {
      return "candidate";
    }
    return "suspicious";
  }

  /**
   * Returns the list of params that meet BOTH B16 thresholds — i.e. anything
   * that has graduated to suspicious or higher. Each entry carries the param
   * name, the (deduped) counts, and the current lifecycle state so the popup
   * can tell the user "uid: 4 domains, 7 values" and (#532) optionally render
   * a different badge for `candidate` entries without re-reading storage.
   */
  async function getFlagged() {
    const stateObj = await adapter.get();
    const params = stateObj.params || {};
    const out = [];
    for (const [name, entry] of Object.entries(params)) {
      const lifecycle = graduate(name, entry);
      if (lifecycle === "suspicious" || lifecycle === "candidate") {
        out.push({
          param: name,
          domains: entry.domains?.length ?? 0,
          values: entry.values?.length ?? 0,
          state: lifecycle,
        });
      }
    }
    return out;
  }

  /**
   * Returns the lifecycle state of `paramName`. Unknown params resolve to
   * `"observed"` (defensive default — never throws, never returns undefined).
   *
   * @param {string} paramName
   * @returns {Promise<"observed"|"suspicious"|"candidate">}
   */
  async function getState(paramName) {
    const stateObj = await adapter.get();
    const entry = stateObj.params?.[paramName];
    return graduate(paramName, entry);
  }

  /**
   * Flips the enabled flag at runtime. Used when the user toggles the
   * pref in Options without reloading the popup. Disabling does NOT
   * wipe storage — that would be a separate `clear()` operation.
   */
  function setEnabled(next) {
    _enabled = next !== false;
  }

  return { observe, getFlagged, getState, setEnabled };
}
