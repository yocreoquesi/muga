/**
 * MUGA — PARAM_PAIRS bounded scoping classifier (#530, slice 1 of PRD #529).
 *
 * Pure decision module — no DOM, no storage, no network, no clock. Given a
 * URL and the user's prefs, returns the lists of params that should be
 * stripped, preserved, and a per-param reasoning trail.
 *
 * ── Bounded scoping ──────────────────────────────────────────────────────
 * Some parameters are intrinsically ambiguous: `pid` is a Facebook tracking
 * pixel id on one site and a project id on GitHub. Stripping `pid` globally
 * would break functional URLs. Bounded scoping is the answer:
 *
 *   "Strip an ambiguous param ONLY when a definitive tracker proves the URL
 *    came from a marketing pipeline."
 *
 * The definitive trackers (ANCHOR_TRACKERS) are click ids and UTM tags that
 * carry no functional meaning in any sane URL — their presence proves intent
 * to track. When any anchor is present in a URL, the bounded params
 * (PARAM_PAIRS) get stripped along with it. When no anchor is present, the
 * bounded params are preserved (functional URL protected).
 *
 * ── Forward compatibility ─────────────────────────────────────────────────
 * This implements what will be formalized as the CAPS Contextual conformance
 * level (tracked in muga#541, caps-spec follow-up). The function shape
 * `(url, prefs) → { stripParams, preserveParams, ruleHits }` is deliberately
 * tracker-agnostic so future per-domain or per-anchor pairs can be added
 * without rewriting cleaner.js integration.
 *
 * ── Affiliate precedence ──────────────────────────────────────────────────
 * If a param is BOTH in PARAM_PAIRS and in the host's affiliate param set
 * (passed via `prefs._affiliateParamSet`), the affiliate wins. cleaner.js
 * already protects affiliate params in its strip phase; classify() honors
 * the same precedence so callers can rely on a single decision.
 *
 * ── Experimental shape-based heuristic (#544) ─────────────────────────────
 * `classifyByShape(url, prefs)` is a multi-signal heuristic that strips
 * params whose VALUE SHAPE matches a tracker pattern. ALL FOUR signals
 * must hit (multi-signal AND): suspicious key prefix, value length > 16,
 * Shannon entropy > 4.0, and base64 / hex / uuid charset.
 *
 * False-positive risk is real (auth tokens, session IDs LOOK like
 * trackers), so the heuristic ships behind `experimentalParamClassesEnabled`,
 * default false. With the flag OFF, behaviour is byte-identical to the
 * #530 baseline. A small `SHAPE_KEY_ALLOWLIST` of well-known oauth /
 * session keys is ALWAYS exempt, regardless of value shape — this is
 * the safety net that protects login flows from accidental breakage.
 */

/**
 * Ambiguous params that get stripped only in the presence of an anchor.
 * Listed in their canonical "wild" casing — comparison is case-insensitive
 * downstream, but tests should be able to confirm intent at a glance.
 *
 * @type {string[]}
 */
export const PARAM_PAIRS = [
  "pid",      // Facebook pixel id / generic "partner id" — also project id on GitHub
  "icid",     // Internal Campaign ID — generic CMS marketing
  "icmp",     // Internal Campaign — generic CMS marketing
  "CMP",      // Campaign — generic newsletter param
  "NLID",     // Newsletter ID — generic newsletter param
  "soc_src",  // Social source — generic social-share tracking
];

/**
 * Definitive trackers whose presence proves the URL came from a marketing
 * pipeline. The set is intentionally narrow and high-confidence: every entry
 * carries no legitimate functional meaning on a clean URL.
 *
 * @type {Set<string>}
 */
export const ANCHOR_TRACKERS = new Set([
  // Google / Meta / Microsoft click ids
  "gclid",
  "fbclid",
  "msclkid",
  "dclid",
  "twclid",
  "gbraid",
  "wbraid",
  // UTM core
  "utm_source",
  "utm_medium",
  "utm_campaign",
  // Mailchimp campaign / email ids
  "mc_eid",
  "mc_cid",
]);

// Lowercased mirror of PARAM_PAIRS for O(1) case-insensitive lookup.
const PARAM_PAIRS_LOWER = new Set(PARAM_PAIRS.map(p => p.toLowerCase()));

// ── Experimental shape-based heuristic (#544) ──────────────────────────────

import { valueEntropy } from "./cross-site-frequency.js";

/**
 * Suspicious key-prefix patterns. The shape heuristic ONLY fires when the
 * param key matches one of these — even a perfect tracker-shaped value on a
 * key like `title` or `q` is left alone.
 *
 * Each entry is a RegExp anchored to the END of the (lowercased) key so e.g.
 * `*_id` matches `click_id`, `affiliate_id`, `visitor_id`, but NOT `idea`.
 *
 * @type {RegExp[]}
 */
export const SHAPE_SUSPICIOUS_KEY_PATTERNS = [
  /_id$/,        // `click_id`, `affiliate_id`, `visitor_id`, `ad_id` …
  /clid$/,       // `gclid`, `fbclid`, `msclkid`, `dclid` (anchor families)
  /_token$/,     // `tracker_token`, `ad_token`, `visitor_token` …
  /_uid$/,       // `ad_uid`, `partner_uid`, `visitor_uid` …
  /_session$/,   // `tracker_session`, `partner_session` …
];

/** Minimum value length for a shape match. Below this, even a high-entropy
 *  base64 string is too short to confidently classify as a tracker (#544). */
export const SHAPE_VALUE_LENGTH_MIN = 16;

/** Minimum Shannon entropy (bits/symbol) for a shape match. UUIDs / base64
 *  tokens routinely sit > 4; sequential numeric IDs / repeated chars stay
 *  well below. (#544) */
export const SHAPE_VALUE_ENTROPY_MIN = 4.0;

// Charset shape predicates. Deliberately permissive — any value whose chars
// fit one of these alphabets passes the charset signal. Combined with the
// length, entropy, and key-prefix signals, this is enough to distinguish
// tracker tokens from human-typed values like "My Article Title".
const SHAPE_BASE64_RE = /^[A-Za-z0-9+/=_-]+$/;
const SHAPE_HEX_RE    = /^[0-9a-f]+$/i;
const SHAPE_UUID_RE   = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Allowlist of well-known auth / oauth / session key names. These are
 * NEVER stripped by the shape heuristic, even when all four signals fire.
 *
 * Why each is here:
 *   - `state`, `nonce`           — OAuth 2.0 / OIDC anti-CSRF tokens; stripping breaks login
 *   - `code`                     — OAuth 2.0 authorization code; stripping aborts the exchange
 *   - `csrf`, `csrf_token`,
 *     `_csrf`                    — generic anti-CSRF tokens used by Rails / Django / Express
 *   - `oauth_token`,
 *     `oauth_verifier`           — OAuth 1.0a tokens
 *   - `access_token`,
 *     `refresh_token`,
 *     `id_token`                 — OAuth 2.0 / OIDC bearer + refresh + identity tokens
 *   - `session_id`, `sessionid`,
 *     `jsessionid`, `phpsessid`,
 *     `aspsessionid`, `sid`      — language/framework session-cookie variants used in URLs
 *
 * Membership is case-insensitive (compared lowercased); the Set itself is
 * stored lowercased for O(1) lookup in the hot path.
 *
 * @type {Set<string>}
 */
export const SHAPE_KEY_ALLOWLIST = new Set([
  "state",
  "code",
  "nonce",
  "csrf",
  "csrf_token",
  "_csrf",
  "oauth_token",
  "oauth_verifier",
  "access_token",
  "refresh_token",
  "id_token",
  "session_id",
  "sessionid",
  "jsessionid",
  "phpsessid",
  "sid",
  "aspsessionid",
]);

/**
 * Returns true iff the param's value matches the four-signal tracker shape.
 *
 * Charset gate is checked first (cheap regex). UUID-shape is treated as a
 * sufficient signal on its own — UUIDs are universally structured high-
 * entropy identifiers, but their entropy in bits/symbol is bounded below
 * 4.0 by the fixed hyphen positions and the 16-character hex alphabet.
 * Forcing the global entropy threshold against UUIDs would reject every
 * real UUID, which is the opposite of what the heuristic needs.
 *
 * Hex strings face the same alphabet ceiling (max entropy = log2(16) = 4.0
 * exactly), so hex matches use a relaxed `> 3.5` threshold — high enough
 * to reject `aaaa…` / sequential numbers, low enough to accept any
 * realistic random hex ID.
 *
 * Base64 (the broadest alphabet, 64+ symbols) keeps the strict `> 4.0`
 * threshold per spec — it's the only path where the value could plausibly
 * be a human-readable string and we need the strongest entropy guard.
 *
 * @param {string} value
 * @returns {boolean}
 */
function valueMatchesTrackerShape(value) {
  if (typeof value !== "string") return false;
  if (value.length <= SHAPE_VALUE_LENGTH_MIN) return false;
  if (SHAPE_UUID_RE.test(value)) return true;
  if (SHAPE_HEX_RE.test(value)) {
    return valueEntropy(value) > 3.5;
  }
  if (SHAPE_BASE64_RE.test(value)) {
    return valueEntropy(value) > SHAPE_VALUE_ENTROPY_MIN;
  }
  return false;
}

/**
 * Returns true iff the (lowercased) key matches any suspicious-prefix pattern.
 *
 * @param {string} keyLower
 * @returns {boolean}
 */
function keyMatchesSuspiciousPattern(keyLower) {
  for (const re of SHAPE_SUSPICIOUS_KEY_PATTERNS) {
    if (re.test(keyLower)) return true;
  }
  return false;
}

/**
 * EXPERIMENTAL (#544): Multi-signal shape-based param heuristic.
 *
 * Activates ONLY when `prefs.experimentalParamClassesEnabled === true`.
 * With the flag OFF (default), returns an empty result — the cleaner
 * pipeline behaves identically to the #530 baseline.
 *
 * A param is reported in `stripParams` iff ALL of the following hold:
 *   1. The param key is NOT in `SHAPE_KEY_ALLOWLIST` (auth/session safety net)
 *   2. The param key is NOT in the host's `_affiliateParamSet` (affiliate wins)
 *   3. The param key matches a `SHAPE_SUSPICIOUS_KEY_PATTERNS` entry
 *   4. The param value's length > `SHAPE_VALUE_LENGTH_MIN`
 *   5. The param value's charset matches base64 / hex / uuid
 *   6. The param value's Shannon entropy > `SHAPE_VALUE_ENTROPY_MIN`
 *
 * Returns the same shape as `classify()` so callers can merge results.
 *
 * @param {string} url
 * @param {object} [prefs]
 * @returns {{ stripParams: string[], preserveParams: string[], ruleHits: Array<{ param: string, reason: string }> }}
 */
export function classifyByShape(url, prefs) {
  const empty = { stripParams: [], preserveParams: [], ruleHits: [] };
  if (!prefs || prefs.experimentalParamClassesEnabled !== true) return empty;
  if (typeof url !== "string" || !url) return empty;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return empty;
  }

  const affiliateSet =
    prefs._affiliateParamSet instanceof Set ? prefs._affiliateParamSet : null;

  const stripParams = [];
  const ruleHits = [];
  const seen = new Set();

  // Firefox Xray: searchParams.entries() iterator is not iterable in the
  // content-script sandbox (throws "not iterable"); collect via forEach. (#1009)
  const paramEntries = [];
  parsed.searchParams.forEach((v, k) => paramEntries.push([k, v]));
  for (const [name, value] of paramEntries) {
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    // Allowlist + affiliate guards run BEFORE the expensive shape checks
    // — both are O(1) and dominate the false-positive risk surface.
    if (SHAPE_KEY_ALLOWLIST.has(lower)) continue;
    if (affiliateSet && affiliateSet.has(lower)) continue;
    if (!keyMatchesSuspiciousPattern(lower)) continue;
    if (!valueMatchesTrackerShape(value)) continue;

    seen.add(lower);
    stripParams.push(name);
    ruleHits.push({
      param: name,
      reason: "shape-heuristic: suspicious key + tracker-shaped value (experimental, #544)",
    });
  }

  return { stripParams, preserveParams: [], ruleHits };
}

/**
 * Classifies a URL's params into strip/preserve buckets using bounded scoping.
 *
 * @param {string} url
 *   The URL to classify. Non-string or unparseable input returns an empty
 *   result (defensive — never throws).
 * @param {object} [prefs]
 *   User preferences. Recognized keys:
 *     - `_affiliateParamSet`: optional `Set<string>` of lowercased affiliate
 *       param names for the URL's host. When a PARAM_PAIRS entry is also in
 *       this set, the affiliate wins (param goes to preserveParams, NOT
 *       stripParams).
 *
 * @returns {{
 *   stripParams: string[],
 *   preserveParams: string[],
 *   ruleHits: Array<{ param: string, reason: string }>
 * }}
 *   `stripParams` are param names (in their original casing as they appeared
 *   in the URL) that the caller should remove. `preserveParams` are PARAM_PAIRS
 *   entries that the classifier explicitly chose to keep (only populated when
 *   affiliate precedence overrides). `ruleHits` is a parallel reasoning log
 *   for debugging and future telemetry.
 */
export function classify(url, prefs) {
  const empty = { stripParams: [], preserveParams: [], ruleHits: [] };
  if (typeof url !== "string" || !url) return empty;

  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return empty;
  }

  // #544: shape heuristic runs in parallel with bounded scoping. Hits get
  // MERGED into the bounded-scope result so a single classify() call surfaces
  // both signals. Cheap when the flag is OFF — the helper short-circuits on
  // the first prefs check.
  const shape = classifyByShape(url, prefs);

  // Firefox Xray: searchParams.keys() iterator is not iterable in content
  // scripts; collect via forEach. (#1009)
  const params = [];
  parsed.searchParams.forEach((_v, k) => params.push(k));
  if (params.length === 0) {
    // Even on a bare URL, shape can never fire (no params), so empty stays empty.
    return empty;
  }

  // CAPS-Contextual short-circuit (issue #543, SPEC §3.2 step 6): when the
  // URL's host is a network-redirect (the cleaner sets this when
  // detectWrapper() returns non-null on a URL we couldn't unwrap), the
  // bounded-scope rule MUST NOT fire — even if an anchor co-occurs with a
  // PARAM_PAIRS entry. The shape heuristic (#544) is independent of the
  // contextual rule and is allowed to run when its experimental flag is on.
  const skipBoundedScope = !!(prefs && prefs._skipBoundedScope);

  // Detect anchor presence (case-insensitive — params are conventionally
  // lowercase but the URL spec is case-sensitive, so we normalize for the
  // check while keeping original casing in the output).
  let hasAnchor = false;
  for (const name of params) {
    if (ANCHOR_TRACKERS.has(name.toLowerCase())) {
      hasAnchor = true;
      break;
    }
  }

  if (!hasAnchor || skipBoundedScope) {
    // No bounded-scope hits, but shape may still have fired (#544). When
    // the flag is OFF, shape is empty and this just returns the same
    // `empty` shape as before — preserving #530 byte-identical behaviour.
    if (shape.stripParams.length === 0) return empty;
    return {
      stripParams: [...shape.stripParams],
      preserveParams: [],
      ruleHits: [...shape.ruleHits],
    };
  }

  const affiliateSet =
    prefs && prefs._affiliateParamSet instanceof Set
      ? prefs._affiliateParamSet
      : null;

  const stripParams = [];
  const preserveParams = [];
  const ruleHits = [];
  const seen = new Set();

  for (const name of params) {
    const lower = name.toLowerCase();
    if (!PARAM_PAIRS_LOWER.has(lower)) continue;
    if (seen.has(lower)) continue;
    seen.add(lower);

    if (affiliateSet && affiliateSet.has(lower)) {
      preserveParams.push(name);
      ruleHits.push({
        param: name,
        reason: "affiliate-precedence: param is an affiliate param for this host",
      });
      continue;
    }

    stripParams.push(name);
    ruleHits.push({
      param: name,
      reason: "bounded-scope: anchor tracker co-occurred",
    });
  }

  // Merge shape-heuristic hits (#544). De-dupe on lowercased name so the
  // same param surfacing in both signals shows up once in stripParams. The
  // bounded-scope `seen` set already tracks lowercased names, so reuse it.
  for (let i = 0; i < shape.stripParams.length; i++) {
    const name = shape.stripParams[i];
    const lower = name.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    stripParams.push(name);
    ruleHits.push(shape.ruleHits[i]);
  }

  return { stripParams, preserveParams, ruleHits };
}
