/**
 * MUGA: Cookie Consent Minimizer — accept-when-necessary module
 * (cookie-consent-accept Slice 2a — Didomi-only pilot)
 *
 * Pure ES module. This is the ONLY file in the project where MUGA is
 * allowed to construct a consent-GRANTING call. It exists because the
 * project's 3-state `cookieConsentMode` pref includes an agreed opt-in
 * mode, "accept-when-necessary", that lets MUGA submit the strictly-
 * necessary-only minimum on a genuine hard wall — a page where NO reject
 * path exists at all, only some form of "accept" — so the user is not
 * stuck. This is NOT the default; the default mode ("reject-only") never
 * reaches this file's logic at all (see the double-gate below).
 *
 * ── Five independent safety layers (each sufficient alone) ─────────────
 *
 * L1 — File-scoped lexical purity: src/lib/cmp-adapters.js (the reject
 *   brain) and the reject regions of the two content scripts stay FOREVER
 *   free of any accept-family identifier — enforced by an absolute
 *   structural scan there. ALL accept logic lives here instead, plus the
 *   `@sync:cmp-accept` content-script region that hand-copies this
 *   module's pure functions (mirroring how `computeCookieGate` is mirrored
 *   into `@sync:cookie-gate`).
 *
 * L2 — Double-gate as a DATA invariant: `computeAcceptGate` below opens
 *   ONLY when BOTH `cookieConsentMode === "accept-when-necessary"` AND
 *   `cookieConsentAcceptConsented === true` (plus enabled/onboarded/not-
 *   exempt). Two independent prefs, not one enum value, so a corrupted or
 *   imported mode string alone can never open this gate — see
 *   settings-schema.js's `clampImportedCookieConsentMode` /
 *   `exportOnlyBoolean` for the import-time half of this guarantee.
 *
 * L3 — Reject-first ladder: `decideMinimumAccept` below only ever returns
 *   ACCEPT_MINIMUM when the caller's `decision.reason` is exactly
 *   `"no-reject-path"` — i.e. the reject ladder in cmp-adapters.js already
 *   ran FIRST, for this exact page, and confirmed there is truly no reject
 *   path. A successful reject, or plain uncertainty, never reaches this
 *   module's ACCEPT_MINIMUM branch.
 *
 * L4 — Minimum enforcement + broad-accept DENYLIST: `didomiAcceptAdapter`
 *   only ever constructs a payload that enables the vendor's OWN declared
 *   "required" ids and disables everything else the vendor's OWN registry
 *   reports — never a hardcoded id, never "everything enabled". A
 *   structural test (tests/unit/cmp-accept-adapters.test.mjs) scans this
 *   file for every broad-accept method identified across all 10 vendors
 *   this project has adapters for (see that test's own DENYLIST list for
 *   the exact literals — deliberately not repeated verbatim here so this
 *   docblock cannot itself trip that same scan) and fails the build if any
 *   appear.
 *
 * L5 — Fail-toward-NOOP everywhere: every function below returns a NOOP
 *   shape on any missing/malformed input, any thrown exemption predicate,
 *   or any thrown page-global call — never an accept.
 *
 * Slice 2a scope: Didomi is the ONLY accept-capable adapter today (see
 * ACCEPT_CAPABLE_ADAPTER_IDS below) — it is the only vendor with BOTH a
 * real hard-wall scenario and a generalizable, granular, necessary-only
 * construction (its own `getRequiredPurposeIds()` / `getRequiredVendorIds()`
 * getters). A last-resort accept-all path for vendors that expose no
 * granular control at all (OneTrust, CookieScript) is explicitly deferred
 * to a later slice, behind its own explicit per-decision safety review —
 * do not add it here without that review.
 *
 * Residual risk (stated honestly): this module's live behavior — does
 * Didomi's `setCurrentUserStatus` call actually dismiss a real hard wall
 * and grant zero non-essential — is NOT verifiable by unit tests or a
 * synthetic fixture; it is a real-EU-geo behavioral question. See the
 * prominent comment on didomiAcceptAdapter below and
 * docs/qa/cookie-consent-release-smoke.md — this mode must not be enabled
 * for real users before that smoke passes from a real EU vantage.
 */

/**
 * Closed action enum. Every member is a minimum-accept action. There is
 * intentionally no broad/all-consent member in this set, and there must
 * never be one — see the file docblock's L4 and the DENYLIST structural
 * test.
 * @type {Readonly<{ACCEPT_MINIMUM: "accept-minimum"}>}
 */
export const ACTIONS_ACCEPT = Object.freeze({
  ACCEPT_MINIMUM: "accept-minimum",
});

/**
 * Slice 2a scope: the only vendor id whose hard wall can ever resolve to
 * ACCEPT_MINIMUM. See the file docblock for why every other vendor is
 * either dead-code (reject and accept share one page global, so a hard
 * wall for reject is a hard wall for accept too) or deferred behind a
 * last-resort-only safety review.
 * @type {ReadonlySet<string>}
 */
const ACCEPT_CAPABLE_ADAPTER_IDS = new Set(["didomi"]);

/**
 * Pure decision function (L3). Given the reject ladder's decision for
 * this page (from `cmp-adapters.js`'s `decideAction`), the user's raw
 * mode pref, and the user's raw consent-gesture pref, decides whether a
 * minimum-accept action should be attempted.
 *
 * Returns ACCEPT_MINIMUM ONLY when every one of these holds:
 *   - `mode === "accept-when-necessary"` (not "reject-only", not "off",
 *     not any corrupted/unrecognized string);
 *   - `consented === true` (not truthy — exactly `true`);
 *   - `decision.reason === "no-reject-path"` (a genuine hard wall for
 *     THIS page — not "reject" (something already succeeded) and not
 *     "uncertain" (no confident detection at all));
 *   - `decision.adapterId` is in the accept-capable set (today: only
 *     `"didomi"`).
 *
 * Any other combination — including malformed input — resolves to NOOP.
 * Pure and never throws.
 *
 * @param {{reason?: string, adapterId?: string|null}|null|undefined} decision
 *   The result of cmp-adapters.js's decideAction() for this page.
 * @param {*} mode - The raw `cookieConsentMode` pref value.
 * @param {*} consented - The raw `cookieConsentAcceptConsented` pref value.
 * @returns {{action: "accept-minimum"|null, adapterId: string|null}}
 */
export function decideMinimumAccept(decision, mode, consented) {
  const d = decision && typeof decision === "object" ? decision : {};
  if (mode !== "accept-when-necessary") return { action: null, adapterId: null };
  if (consented !== true) return { action: null, adapterId: null };
  if (d.reason !== "no-reject-path") return { action: null, adapterId: null };
  if (!ACCEPT_CAPABLE_ADAPTER_IDS.has(d.adapterId)) return { action: null, adapterId: null };
  return { action: ACTIONS_ACCEPT.ACCEPT_MINIMUM, adapterId: d.adapterId };
}

/**
 * Pure double-gate (L2). Mirrors src/lib/cmp-adapters.js's
 * `computeCookieGate` shape, but for the accept path specifically — this
 * gate and the reject gate are DELIBERATELY separate functions/prefs (a
 * dedicated boolean, not a 4th enum value) so a corrupted or imported
 * mode string alone can never open this gate: BOTH
 * `cookieConsentMode === "accept-when-necessary"` AND
 * `cookieConsentAcceptConsented === true` must hold, in addition to the
 * usual enabled/onboarded/exemption checks every feature in this project
 * respects.
 *
 * This function's logic is hand-copied into the `@sync:cmp-accept`
 * regions of both content scripts (content/cookie-noise.js and
 * content/cookie-noise-mainworld.js), the same pattern
 * `computeCookieGate` uses for `@sync:cookie-gate` — kept in sync by
 * tests/unit/cookie-noise-sync.test.mjs.
 *
 * Fail-closed: a missing/false signal, or an unexpected throw from the
 * injected exemption predicate, returns false.
 *
 * @param {object|null|undefined} prefs Merged prefs (see PREF_DEFAULTS).
 * @param {{hostname?: string, isSiteFullyExempt?: (hostname: string, prefs: object) => boolean}} [deps]
 * @returns {boolean} true only when the accept gate should open.
 */
// @sync:cmp-accept-gate:start
function computeAcceptGate(prefs, deps) {
  if (!prefs) return false;
  if (prefs.enabled === false) return false;
  if (prefs.onboardingDone !== true) return false;
  if (prefs.cookieConsentMode !== "accept-when-necessary") return false;
  if (prefs.cookieConsentAcceptConsented !== true) return false;
  const isSiteFullyExempt = deps && deps.isSiteFullyExempt;
  if (typeof isSiteFullyExempt === "function") {
    try {
      if (isSiteFullyExempt(deps.hostname, prefs)) return false;
    } catch {
      // Fail-safe: treat as not exempt on any unexpected throw.
    }
  }
  return true;
}
// @sync:cmp-accept-gate:end

export { computeAcceptGate };

/**
 * Builds the Didomi minimum-consent payload (L4). Pure — never touches
 * `window`. Enables ONLY the ids the vendor's OWN page state reports as
 * required (`getRequiredPurposeIds()` / `getRequiredVendorIds()` in the
 * real call site), disables every other id the vendor's OWN registry
 * reports (`getPurposes()` / `getVendors()`) — NEVER a hardcoded id list,
 * NEVER "everything enabled".
 *
 * Widening is prevented by a defense-in-depth chain, NOT by this function
 * alone: the runtime seam `resolveDidomiMinimumStatus` parses the vendor's
 * REQUIRED getters STRICTLY (array-of-non-empty-strings-or-NOOP — see
 * `extractRequiredIds`) before this function ever runs, so a hostile
 * "required" shape (a flag-map, an array of registry objects, anything that
 * is not a clean id array) abandons the whole accept instead of reaching
 * here. On top of that, this function only ever enables ids it can also see
 * in the full registry (`allPurposeIds`/`allVendorIds`), so an id present
 * in `requiredPurposeIds`/`requiredVendorIds` but ABSENT from the registry
 * is never enabled. Strict required-parse + registry intersection +
 * NOOP-on-unexpected-shape is the actual guarantee.
 *
 * @param {{requiredPurposeIds?: string[], requiredVendorIds?: string[], allPurposeIds?: string[], allVendorIds?: string[]}} [input]
 * @returns {{purposes: {enabled: string[], disabled: string[]}, vendors: {enabled: string[], disabled: string[]}}}
 */
/**
 * Pure hard-wall + accept-capability detection (mirrors the reject
 * ladder's per-vendor detect() shape in cmp-adapters.js). Confirms BOTH:
 *   - a genuine Didomi hard wall for this page (global present, the
 *     reject function absent — the exact "no-reject-path" condition), and
 *   - every accept-specific signal this Slice's minimum-payload
 *     construction needs (`setCurrentUserStatus` plus both the required-
 *     ids getters and both the full-registry getters).
 *
 * Content scripts cannot import this module (AGENTS.md — no ES imports in
 * content scripts), so the block between the `@sync:cmp-accept` markers
 * below (this function AND `buildMinimumPayload` above it) is hand-copied,
 * modulo indentation, into content/cookie-noise-mainworld.js (Chrome MAIN
 * world) and content/cookie-noise.js (Firefox `wrappedJSObject` path).
 * Kept in sync by tests/unit/cookie-noise-sync.test.mjs.
 *
 * Pure: given the same signals it always returns the same result. Never
 * throws.
 *
 * @param {object|null|undefined} signals
 * @returns {boolean}
 */
// @sync:cmp-accept:start
function canAttemptDidomiMinimumAccept(signals) {
  const s = signals && typeof signals === "object" ? signals : {};
  if (s.hasDidomiGlobal !== true) return false;
  if (s.hasSetUserDisagreeToAllFn === true) return false;
  if (s.hasSetCurrentUserStatusFn !== true) return false;
  if (s.hasGetRequiredPurposeIdsFn !== true) return false;
  if (s.hasGetRequiredVendorIdsFn !== true) return false;
  if (s.hasGetPurposesFn !== true) return false;
  if (s.hasGetVendorsFn !== true) return false;
  return true;
}

// Broad, permissive normalizer for the vendor's FULL registry getters
// (getPurposes()/getVendors()): an array of id strings, an array of {id}
// objects, or an id-keyed object map all normalize to a plain array of id
// strings. This breadth is SAFE here because the "all" lists are only ever
// intersected against the strictly-parsed required set below — a broad read
// of the registry can never, by itself, widen consent. Never throws;
// unrecognized shapes resolve to an empty array (fail-closed).
function extractDidomiIds(value) {
  try {
    if (Array.isArray(value)) {
      const ids = [];
      for (const item of value) {
        if (typeof item === "string") ids.push(item);
        else if (item && typeof item.id === "string") ids.push(item.id);
      }
      return ids;
    }
    if (value && typeof value === "object") {
      return Object.keys(value);
    }
  } catch {
    // Fall through to the fail-closed empty array below.
  }
  return [];
}

// STRICT, fail-closed parser for the REQUIRED getters
// (getRequiredPurposeIds()/getRequiredVendorIds()). Didomi's real getters
// return a plain array of id strings (engram sdd/cookie-consent-accept
// probe, id 1324); this accepts ONLY that exact shape. Anything else — a
// flag-map object, an array of registry objects, an array with a non-string
// or empty-string member, null, a non-array — is UNRESOLVABLE and returns
// null so the caller abandons the entire accept rather than guessing a
// payload that could widen consent. Never throws.
function extractRequiredIds(value) {
  if (!Array.isArray(value)) return null;
  const ids = [];
  for (const item of value) {
    if (typeof item !== "string" || item.length === 0) return null;
    ids.push(item);
  }
  return ids;
}

function buildMinimumPayload(input) {
  const i = input && typeof input === "object" ? input : {};
  const allPurposeIds = Array.isArray(i.allPurposeIds) ? i.allPurposeIds : [];
  const allVendorIds = Array.isArray(i.allVendorIds) ? i.allVendorIds : [];
  const requiredPurposeIds = Array.isArray(i.requiredPurposeIds) ? i.requiredPurposeIds : [];
  const requiredVendorIds = Array.isArray(i.requiredVendorIds) ? i.requiredVendorIds : [];

  const enabledPurposes = allPurposeIds.filter((id) => requiredPurposeIds.includes(id));
  const enabledVendors = allVendorIds.filter((id) => requiredVendorIds.includes(id));
  const enabledPurposeSet = new Set(enabledPurposes);
  const enabledVendorSet = new Set(enabledVendors);

  return {
    purposes: {
      enabled: enabledPurposes,
      disabled: allPurposeIds.filter((id) => !enabledPurposeSet.has(id)),
    },
    vendors: {
      enabled: enabledVendors,
      disabled: allVendorIds.filter((id) => !enabledVendorSet.has(id)),
    },
  };
}

// Runtime seam the content-script dispatch regions call with the RAW return
// values of Didomi's four getters. Owns the fail-closed contract: the
// REQUIRED lists are parsed STRICTLY (extractRequiredIds); if EITHER is
// unresolvable the whole accept is abandoned (returns null → the caller must
// NOT call setCurrentUserStatus, leaving the banner as the safe outcome).
// A DEGENERATE full registry (both getPurposes() and getVendors() collapse
// to empty) also NOOPs — there is no valid minimum to construct, so the
// call must never fire with an all-empty payload. Returns a validly-
// constructed minimum payload otherwise. Pure; never throws (the getter
// calls themselves stay in the world-specific dispatch region, wrapped
// there).
function resolveDidomiMinimumStatus(raw) {
  const r = raw && typeof raw === "object" ? raw : {};
  const requiredPurposeIds = extractRequiredIds(r.requiredPurposeIds);
  const requiredVendorIds = extractRequiredIds(r.requiredVendorIds);
  if (requiredPurposeIds === null || requiredVendorIds === null) return null;
  const allPurposeIds = extractDidomiIds(r.allPurposeIds);
  const allVendorIds = extractDidomiIds(r.allVendorIds);
  if (allPurposeIds.length === 0 && allVendorIds.length === 0) return null;
  return buildMinimumPayload({ requiredPurposeIds, requiredVendorIds, allPurposeIds, allVendorIds });
}
// @sync:cmp-accept:end

/**
 * Invokes the caller-supplied accept call. Kept pure (no `window` access
 * here) by requiring the caller to inject the actual global call as a
 * zero-argument callback — mirrors `cmp-adapters.js`'s `reject()` helper
 * exactly. Never throws.
 *
 * @param {() => void} [callAccept]
 * @returns {{status: "accepted"|"noop"}}
 */
function accept(callAccept) {
  if (typeof callAccept !== "function") return { status: "noop" };
  try {
    callAccept();
    return { status: "accepted" };
  } catch {
    return { status: "noop" };
  }
}

/**
 * Didomi accept-when-necessary adapter (Slice 2a pilot — the only
 * accept-capable adapter today). The real call site (content scripts)
 * builds the payload from `window.Didomi.getRequiredPurposeIds()` /
 * `getRequiredVendorIds()` / `getPurposes()` / `getVendors()` and invokes
 * `window.Didomi.setCurrentUserStatus(payload)` through `accept()` above.
 *
 * ── HARD PRE-ENABLE GATE — DO NOT REMOVE THIS COMMENT ───────────────────
 * Didomi's live banner behavior is geo-gated and could NOT be verified
 * from a non-EU vantage (engram sdd/cookie-consent-accept/didomi-probe):
 * `setCurrentUserStatus` returned a stable, sync boolean and the exact
 * getter names were confirmed on 3 real production Didomi sites, but the
 * crux question — does calling it with the minimum payload actually
 * DISMISS a real hard wall AND grant ZERO non-essential purposes/vendors —
 * remains unverified because no real hard-wall session was observed from
 * that vantage. This adapter, and the "accept-when-necessary" mode as a
 * whole, MUST pass a real-EU-geo behavioral smoke test (a human, or a
 * CI runner with an EU vantage point, confirming a live Didomi hard wall
 * actually dismisses on the minimum payload and grants zero tracking)
 * BEFORE this mode is enabled for real users in a release. See
 * docs/qa/cookie-consent-release-smoke.md's "accept-when-necessary" item.
 *
 * @type {Readonly<{id: "didomi", buildMinimumPayload: typeof buildMinimumPayload, accept: typeof accept}>}
 */
export const didomiAcceptAdapter = Object.freeze({
  id: "didomi",
  buildMinimumPayload,
  accept,
});

export { canAttemptDidomiMinimumAccept, extractDidomiIds, extractRequiredIds, resolveDidomiMinimumStatus };
