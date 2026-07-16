/**
 * MUGA: Cookie Consent Minimizer — CMP adapter registry (#1027)
 *
 * Pure ES module. NOT loaded as a content script — content scripts cannot
 * use ES module imports (see AGENTS.md). Its logic is inlined into the two
 * content-script shells (content/cookie-noise-mainworld.js and
 * content/cookie-noise.js), the same pattern src/lib/dom-link-rewriter.js
 * uses with content/dom-link-rewriter.js. Unit-tested directly here; the
 * content-script copies are checked against this file by a dedicated sync
 * test (tests/unit/cookie-noise-sync.test.mjs).
 *
 * Scope: Tier 1 only (API adapters — calling a page-authored global
 * directly, e.g. `window.OneTrust.RejectAll()`). A Tier 2 registry slot
 * exists (declarative click-rule adapters, Consent-O-Matic-style) but
 * ships EMPTY in this slice — see design decisions.
 *
 * ── The ethical spine (never-auto-*-the-user's-consent-away rule) ─────────
 *
 * MUGA minimizes cookie-consent noise ONLY where a safe reject / necessary-
 * only path can be confirmed. On a hard wall — only a broad consent-
 * granting action is exposed, no reject path — MUGA does NOTHING and
 * leaves the banner for the user. It NEVER programmatically invokes a
 * consent-granting action on the user's behalf: that would add tracking
 * (the opposite of denoise), produce legally invalid consent, and be a
 * trust-destroying capability for an extension whose whole premise is user
 * control.
 *
 * Structural enforcement: this file's source — including every comment —
 * intentionally avoids the word this rule forbids (the word for "granting
 * broad consent", spelled with a leading letter this docblock also avoids
 * for the same reason). `ACTIONS` below is a CLOSED set containing only
 * the reject-family action. A dedicated structural test statically scans
 * this file (and the content-script copies) for that forbidden word and
 * fails the build if it ever appears — see the STRUCTURAL guard describe
 * block in tests/unit/cmp-adapters.test.mjs. Do not introduce that word
 * into this file, ever, including in comments.
 */

/**
 * @typedef {object} CmpSignals
 * @property {boolean} [hasOneTrustGlobal] - `typeof window.OneTrust === "object"`.
 * @property {boolean} [hasRejectAllFn] - `typeof window.OneTrust.RejectAll === "function"`.
 *   Mandatory signal: without this, no reject action can be confirmed.
 * @property {boolean} [hasBannerDom] - `#onetrust-banner-sdk` or
 *   `#onetrust-consent-sdk` present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasActiveGroupsGlobal] - `typeof window.OnetrustActiveGroups === "string"`.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasRejectHandlerDom] - `#onetrust-reject-all-handler`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCookiebotGlobal] - `typeof window.Cookiebot === "object"`.
 * @property {boolean} [hasSubmitCustomConsentFn] - `typeof window.Cookiebot.submitCustomConsent === "function"`.
 *   Mandatory signal: without this, no reject action can be confirmed.
 * @property {boolean} [hasCybotDialogDom] - `#CybotCookiebotDialog` present
 *   in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasConsentObjectGlobal] - `typeof window.Cookiebot.consent === "object"`.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasResponseBooleanGlobal] - `typeof window.Cookiebot.hasResponse === "boolean"`.
 *   Secondary/corroborating signal.
 */

/**
 * Closed action enum. Every member is a reject-family call. There is
 * intentionally no consent-granting member in this set, and there must
 * never be one — see the file docblock.
 * @type {Readonly<{REJECT_ALL: "reject-all"}>}
 */
export const ACTIONS = Object.freeze({
  REJECT_ALL: "reject-all",
});

/**
 * OneTrust multi-signal detection + confidence gate. Requires the
 * mandatory RejectAll function signal PLUS at least one corroborating
 * secondary signal before reaching the acting confidence — a bare
 * global-name match (some other script defining `window.OneTrust`) or
 * bare DOM markup (a banner present but the API not yet initialized) is
 * NOT enough on its own. Fail-closed: anything short of full
 * corroboration returns a confidence below the threshold.
 *
 * Content scripts cannot import this module (AGENTS.md — no ES imports
 * in content scripts), so this exact block (from the start marker to the
 * end marker) is hand-copied, byte-for-byte modulo indentation, into
 * content/cookie-noise-mainworld.js and content/cookie-noise.js. Do not
 * edit one copy without the other two — tests/unit/cookie-noise-sync.test.mjs
 * fails the build if they drift.
 *
 * The same shape (mandatory reject-function signal + >=1 corroborating
 * secondary signal) is reused verbatim for the Cookiebot adapter below
 * (#1118) — same fail-closed confidence gate, same threshold.
 */
// @sync:cmp-adapters:start
const CONFIDENCE_THRESHOLD = 1;

function detectOneTrust(signals) {
  if (!signals || signals.hasOneTrustGlobal !== true || signals.hasRejectAllFn !== true) {
    return 0;
  }
  const secondary =
    (signals.hasBannerDom === true ? 1 : 0) +
    (signals.hasActiveGroupsGlobal === true ? 1 : 0) +
    (signals.hasRejectHandlerDom === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectOneTrust(signals) {
  return detectOneTrust(signals) >= CONFIDENCE_THRESHOLD;
}

function detectCookiebot(signals) {
  if (!signals || signals.hasCookiebotGlobal !== true || signals.hasSubmitCustomConsentFn !== true) {
    return 0;
  }
  const secondary =
    (signals.hasCybotDialogDom === true ? 1 : 0) +
    (signals.hasConsentObjectGlobal === true ? 1 : 0) +
    (signals.hasResponseBooleanGlobal === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectCookiebot(signals) {
  return detectCookiebot(signals) >= CONFIDENCE_THRESHOLD;
}
// @sync:cmp-adapters:end

/**
 * Invokes the caller-supplied reject call. Kept pure (no `window` access
 * here) by requiring the caller to inject the actual global call as a
 * zero-argument callback — the content-script shell is the one place that
 * touches the vendor CMP global directly (e.g. `window.OneTrust.RejectAll`,
 * `window.Cookiebot.submitCustomConsent`). Never throws.
 *
 * @param {() => void} [callRejectAll]
 * @returns {{status: "rejected"|"noop"}}
 */
function reject(callRejectAll) {
  if (typeof callRejectAll !== "function") return { status: "noop" };
  try {
    callRejectAll();
    return { status: "rejected" };
  } catch {
    return { status: "noop" };
  }
}

/** @type {Readonly<{id: "onetrust", tier: 1, detect: typeof detectOneTrust, canReject: typeof canRejectOneTrust, reject: typeof reject}>} */
export const oneTrustAdapter = Object.freeze({
  id: "onetrust",
  tier: 1,
  detect: detectOneTrust,
  canReject: canRejectOneTrust,
  reject,
});

/**
 * Cookiebot Tier 1 adapter (#1118). The reject call
 * (`Cookiebot.submitCustomConsent(false, false, false)`) is invoked by the
 * caller-supplied callback via the shared `reject()` helper above — this
 * adapter definition never touches `window` itself. Necessary cookies are
 * implicit/always-on in Cookiebot's model and are not one of the three
 * positional booleans, so this call has no code path that can grant broad
 * consent.
 * @type {Readonly<{id: "cookiebot", tier: 1, detect: typeof detectCookiebot, canReject: typeof canRejectCookiebot, reject: typeof reject}>}
 */
export const cookiebotAdapter = Object.freeze({
  id: "cookiebot",
  tier: 1,
  detect: detectCookiebot,
  canReject: canRejectCookiebot,
  reject,
});

/** Tier 1 registry: API adapters that call a page-authored global directly. */
export const TIER1 = Object.freeze([oneTrustAdapter, cookiebotAdapter]);

/**
 * Tier 2 registry: declarative click-rule adapters (Consent-O-Matic-style).
 * Ships EMPTY in this slice — the dispatcher below already iterates it so
 * a later slice can populate it with zero dispatcher rewrite.
 */
export const TIER2 = Object.freeze([]);

/**
 * Two-tier pure decision function. Tries every Tier 1 adapter, then every
 * Tier 2 adapter (empty today), and returns the first confirmed reject
 * action. When nothing can confidently reject, distinguishes two NOOP
 * reasons for observability/testing: `"no-reject-path"` when the OneTrust
 * global is present but its reject function is not (a hard wall), and
 * `"uncertain"` for everything else (no CMP detected, or insufficient
 * corroboration — fail-closed).
 *
 * Pure: given the same signals it always returns the same result. Never
 * throws.
 *
 * @param {CmpSignals} signals
 * @returns {{action: "reject-all"|null, reason: "reject"|"no-reject-path"|"uncertain", adapterId: string|null}}
 */
export function decideAction(signals) {
  const s = signals && typeof signals === "object" ? signals : {};

  for (const adapter of TIER1) {
    if (adapter.canReject(s)) {
      return { action: ACTIONS.REJECT_ALL, reason: "reject", adapterId: adapter.id };
    }
  }
  for (const adapter of TIER2) {
    if (adapter.canReject(s)) {
      return { action: ACTIONS.REJECT_ALL, reason: "reject", adapterId: adapter.id };
    }
  }

  if (s.hasOneTrustGlobal === true && s.hasRejectAllFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: null };
  }
  if (s.hasCookiebotGlobal === true && s.hasSubmitCustomConsentFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: null };
  }
  return { action: null, reason: "uncertain", adapterId: null };
}

/**
 * Pure disabled-state gate for the Cookie Consent Minimizer (#1027).
 * Decides whether the isolated-world gatekeeper (content/cookie-noise.js)
 * should open the gate, from the user's prefs plus injected environment
 * dependencies. Kept pure (no `window`/`location` access) so every
 * branch — feature off, pre-onboarding, pref off, per-site exemption,
 * all-pass — is unit-tested directly here instead of only structurally in
 * a content script that Node cannot import.
 *
 * Content scripts cannot import this module (AGENTS.md — no ES imports in
 * content scripts), so the block between the `@sync:cookie-gate` markers
 * is hand-copied, modulo indentation, into content/cookie-noise.js. Do not
 * edit one copy without the other — tests/unit/cookie-noise-sync.test.mjs
 * fails the build if they drift.
 *
 * Fail-closed: a missing/false signal, or an unexpected throw from the
 * injected exemption predicate, returns false.
 *
 * @param {object|null|undefined} prefs Merged prefs (see PREF_DEFAULTS).
 * @param {{hostname?: string, isSiteFullyExempt?: (hostname: string, prefs: object) => boolean}} [deps]
 *   Environment hooks the content-script call site injects: the current
 *   hostname and the cleaner's per-site exemption predicate.
 * @returns {boolean} true only when the gate should open.
 */
// @sync:cookie-gate:start
function computeCookieGate(prefs, deps) {
  if (!prefs) return false;
  if (prefs.enabled === false) return false;
  if (prefs.onboardingDone !== true) return false;
  if (prefs.cookieConsentMinimizerEnabled !== true) return false;
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
// @sync:cookie-gate:end

export { computeCookieGate };
