/**
 * MUGA: Cookie Consent Minimizer — accept-when-necessary module
 * (cookie-consent-paywall-accept)
 *
 * Pure ES module. This is the ONLY file in the project where MUGA is
 * allowed to construct a consent-GRANTING action. It exists because the
 * project's 3-state `cookieConsentMode` pref includes an agreed opt-in
 * mode, "accept-when-necessary", that lets MUGA click through a genuine
 * consent-or-pay wall's free "Accept all" button when the ONLY free path
 * through the wall is to accept — so the user is not forced to either pay
 * or lose the content. This is NOT the default; the default mode
 * ("reject-only") never reaches this file's logic at all (see the
 * double-gate below).
 *
 * ── HONEST FRAMING (read this before touching anything here) ───────────
 *
 * A prior design (cookie-consent-accept Slice 2a) attempted a
 * "necessary-only minimum" construction via a vendor JS API. A research
 * spike (engram id 1331, "DIDOMI-ACCEPT-NOT-VIABLE") proved that path dead
 * on three independent, compounding grounds: no real hard wall for that
 * vendor ever lacks a reject function; the vendor's "required" getters mean
 * "consent-gated", not "necessary/exempt"; and the grant call silently
 * no-ops on real deployments. That whole code path — the vendor-specific
 * minimum-payload decision, capability detection, payload construction, the
 * vendor getters, and the MAIN-world accept dispatch fork — is RETIRED and
 * deleted.
 *
 * The replacement mechanism is a DOM `element.click()` on a consent-or-pay
 * wall's own free "Accept all & continue" button (proven viable + reachable
 * — engram id 1333, id 1335). This is a DIFFERENT safety shape, not a
 * smaller version of the old one:
 *
 *   - On a true consent-or-pay wall, the ONLY free path is "Accept ALL &
 *     continue" — there is no necessary-only option to submit. When this
 *     feature fires, it GRANTS BROAD ADVERTISING/TRACKING CONSENT. That is
 *     the honest tradeoff of the feature, not a bug: the alternative is the
 *     user pays or is denied the content entirely.
 *   - The DENYLIST inverts: it no longer forbids "accept-all" (accept-all
 *     IS the action) — it forbids the PAY/SUBSCRIBE button. Safety is now
 *     "positively identify the FREE-accept button, and NEVER the button
 *     that commits the user to a subscription."
 *
 * ── Five independent safety layers (each sufficient alone) ─────────────
 *
 * L1 — File-scoped lexical purity: src/lib/cmp-adapters.js (the reject
 *   brain) and the reject regions of the two content scripts stay FOREVER
 *   free of any accept-family identifier — enforced by an absolute
 *   structural scan there. ALL accept logic lives here instead, plus the
 *   `@sync:cmp-accept-veto` content-script region (content/cookie-noise.js
 *   only — this mechanism has no MAIN-world copy) that hand-copies this
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
 * L3 — Last-resort-only: `hasFreeRejectControl` scans the SAME wall for any
 *   free reject/necessary-only control before the accept-click is ever
 *   attempted. If one exists, the accept-click NEVER fires — a free reject
 *   is always preferred and is the reject engine's job, not this module's.
 *
 * L4 — Button-discrimination DENYLIST (the crux, see PART A below):
 *   `findFreeAcceptTarget` clicks a button ONLY when exactly one candidate
 *   classifies as a free-accept control and ZERO candidates that could be
 *   confused for it survive. A pay/subscribe token anywhere in the button's
 *   accessible name VETOES that candidate outright — deny-wins precedence,
 *   checked before any accept token. Ambiguity (zero or more than one
 *   surviving candidate) also VETOES — never guesses.
 *
 * L5 — Fail-toward-NOOP everywhere: every function below returns a NOOP/
 *   veto shape on any missing/malformed input or any thrown predicate —
 *   never a click.
 *
 * Slice scope: DE + EN button-text tokens only (the real-site probes that
 * proved this mechanism viable — zeit.de, spiegel.de — are German-language
 * Sourcepoint consent-or-pay walls). Widening locale coverage is a later
 * slice, each addition reviewed the same way the DE/EN tokens were.
 *
 * Residual risk (stated honestly): this module's live in-extension
 * behavior — does the DOM click actually dismiss a real hard wall from
 * inside the extension's content script — is proven only by a throwaway
 * Playwright probe (id 1333), not by an in-extension run. See
 * docs/qa/cookie-consent-release-smoke.md — this mode must not be enabled
 * for real users before a real-EU headed smoke test passes.
 */

// ── PART A — word lists (DATA, not code) ────────────────────────────────
//
// Kept as flat, frozen arrays of lowercase substrings so the matching logic
// below never needs its own vendor-specific branching. Widening locale
// coverage in a later slice means appending to these arrays, not editing
// the matching functions.

/**
 * A candidate button as the caller (the content-script DOM scan) resolves
 * it — deliberately plain data, no DOM element, so this stays a pure,
 * exhaustively-unit-testable function (plain-data-in/plain-data-out).
 * @typedef {{text: string, actionable: boolean, ref?: *}} ConsentButtonCandidate
 */

// Everything in this fenced block — the word-list DATA and the four
// discrimination functions — is a hand-maintained COPY, byte-identical
// (modulo indentation and the `export` keyword, which content scripts
// cannot use — stripped by the comparison test), of the same block in
// content/cookie-noise.js (content scripts cannot use ES module imports —
// AGENTS.md). Kept in sync by tests/unit/cookie-noise-sync.test.mjs.
//
// classifyConsentButton's internal branches return PLAIN STRING LITERALS
// ("pay"/"settings"/"reject"/"accept"/"unknown") rather than referencing
// the BUTTON_KIND enum declared further below (same for
// findFreeAcceptTarget's "single"/"noop"/"ambiguous" vs ACCEPT_TARGET_STATUS)
// — those enums exist for external callers/tests only, so this block's own
// source text carries no enum-object dependency to copy along.
//
// ACCEPT_TOKENS: the FREE accept-and-continue control on a consent-or-pay
// wall. DE + EN only this slice (see file docblock). KNOWN LIMITATION
// (documented, out of scope this slice): matching is plain case-insensitive
// substring — a future locale token that happens to embed one of these
// strings (e.g. French "continuer" embeds "continue") would false-positive
// as ACCEPT; widening past DE+EN requires checking new tokens against this
// list for substring collisions first.
// PAY_DENY_TOKENS: the PAY/SUBSCRIBE control DENYLIST. Precedence: this
// wins over every other classification — a button whose accessible name
// contains any of these (or a CURRENCY_TOKENS/PERIOD_TOKENS symbol) is
// NEVER clicked, even if it also contains an accept token (e.g. "Accept
// subscription"). CURRENCY_TOKENS/PERIOD_TOKENS: a locale-agnostic price
// backstop covering labels the literal word lists do not otherwise
// recognize. SETTINGS_TOKENS: excluded from BOTH the accept and reject
// pools — a settings link does not dismiss the wall. REJECT_TOKENS: a FREE
// reject/necessary-only control; presence anywhere on the wall means the
// accept-click must never fire (see hasFreeRejectControl, L3).
// @sync:cmp-accept-veto:start
export const ACCEPT_TOKENS = Object.freeze([
  "accept",
  "agree",
  "consent",
  "continue",
  "zustimmen",
  "einwilligen",
  "akzeptieren",
  "und weiter",
  "annehmen",
]);

export const PAY_DENY_TOKENS = Object.freeze([
  "abo",
  "abonnieren",
  "abonnement",
  "pur",
  "subscribe",
  "subscription",
  "pay",
  "bezahlen",
  "kaufen",
  "zahlungspflichtig",
]);

export const CURRENCY_TOKENS = Object.freeze(["€", "$", "£"]);
export const PERIOD_TOKENS = Object.freeze(["/monat", "/month", "/mo", "/jahr"]);

export const SETTINGS_TOKENS = Object.freeze([
  "einstellungen",
  "settings",
  "manage",
  "options",
  "preferences",
  "customize",
]);

export const REJECT_TOKENS = Object.freeze([
  "ablehnen",
  "nur notwendige",
  "reject",
  "decline",
  "necessary only",
]);

function normalizeButtonText(rawText) {
  return typeof rawText === "string" ? rawText.trim().toLowerCase() : "";
}

function containsAnyToken(text, tokens) {
  for (const token of tokens) {
    if (text.includes(token)) return true;
  }
  return false;
}

function hasPriceIndicator(text) {
  return containsAnyToken(text, CURRENCY_TOKENS) || containsAnyToken(text, PERIOD_TOKENS);
}

function classifyConsentButton(rawText) {
  const text = normalizeButtonText(rawText);
  if (!text) return "unknown";
  if (containsAnyToken(text, PAY_DENY_TOKENS) || hasPriceIndicator(text)) return "pay";
  if (containsAnyToken(text, SETTINGS_TOKENS)) return "settings";
  if (containsAnyToken(text, REJECT_TOKENS)) return "reject";
  if (containsAnyToken(text, ACCEPT_TOKENS)) return "accept";
  return "unknown";
}

function findFreeAcceptTarget(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const survivors = [];
  for (const candidate of list) {
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.actionable !== true) continue;
    if (classifyConsentButton(candidate.text) !== "accept") continue;
    survivors.push(candidate);
  }
  if (survivors.length === 0) return { status: "noop", target: null };
  if (survivors.length > 1) return { status: "ambiguous", target: null };
  return { status: "single", target: survivors[0] };
}

function hasFreeRejectControl(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const candidate of list) {
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.actionable !== true) continue;
    if (classifyConsentButton(candidate.text) === "reject") return true;
  }
  return false;
}

// isPaywallFrame (PART B of the design): a cheap PRE-FILTER, not the safety
// net by itself — the real safety net is hasFreeRejectControl +
// findFreeAcceptTarget's exactly-one requirement above, both of which still
// gate the actual click. This only decides whether the current frame LOOKS
// LIKE a Sourcepoint-style consent-or-pay message iframe worth scanning at
// all: true only when the frame is a SUBFRAME (never the top frame — a
// consent-or-pay dialog always renders in a child iframe per the real-site
// probe, engram id 1333/1335) AND at least one of: the frame's own URL
// matches the Sourcepoint message-iframe shape (hasCsp=true AND
// consent/tcfv2 present, case-insensitively — query-string markers, not
// host-based, so they still match first-party CMP subdomains like
// sp-spiegel-de.spiegel.de or consent-cdn.zeit.de; do NOT filter on
// sp-prod.net/sourcepoint.com, that misses real deployments, engram id
// 1335's gotcha); or the frame's own hostname differs from the relayed
// top-frame hostname (a cross-origin child frame). env.isTopFrame must be
// exactly true or exactly false — an undeterminable frame identity fails
// closed to false (never scanned). Pure; never throws.
function isPaywallFrame(env) {
  const e = env && typeof env === "object" ? env : {};
  if (e.isTopFrame !== false) return false; // never the top frame; fail-closed on unknown identity
  const urlLower = typeof e.frameUrl === "string" ? e.frameUrl.toLowerCase() : "";
  const urlMatch = urlLower.includes("hascsp=true") && urlLower.includes("consent/tcfv2");
  const hostMismatch =
    typeof e.frameHost === "string" &&
    e.frameHost.length > 0 &&
    typeof e.topHost === "string" &&
    e.topHost.length > 0 &&
    e.frameHost !== e.topHost;
  return urlMatch || hostMismatch;
}
// @sync:cmp-accept-veto:end

/**
 * Closed classification enum for `classifyConsentButton`'s return value
 * ("pay"/"settings"/"reject"/"accept"/"unknown" — see the fenced block
 * above; this enum is metadata for external callers/tests, not referenced
 * internally by that block, see its own leading comment for why).
 * @type {Readonly<{PAY: "pay", SETTINGS: "settings", REJECT: "reject", ACCEPT: "accept", UNKNOWN: "unknown"}>}
 */
export const BUTTON_KIND = Object.freeze({
  PAY: "pay",
  SETTINGS: "settings",
  REJECT: "reject",
  ACCEPT: "accept",
  UNKNOWN: "unknown",
});

/**
 * Closed result-status enum for `findFreeAcceptTarget` ("single"/"noop"/
 * "ambiguous" — same metadata-only relationship to the fenced block above
 * as BUTTON_KIND).
 * @type {Readonly<{SINGLE: "single", NOOP: "noop", AMBIGUOUS: "ambiguous"}>}
 */
export const ACCEPT_TARGET_STATUS = Object.freeze({
  SINGLE: "single",
  NOOP: "noop",
  AMBIGUOUS: "ambiguous",
});

export { classifyConsentButton, findFreeAcceptTarget, hasFreeRejectControl, isPaywallFrame };

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
 * This function's logic is hand-copied into the `@sync:cmp-accept-gate`
 * region of content/cookie-noise.js, the same pattern `computeCookieGate`
 * uses for `@sync:cookie-gate` — kept in sync by
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
      // FAIL-CLOSED: an exemption predicate that throws leaves the site's
      // exempt/not-exempt status UNRESOLVED. A consent-GRANTING gate must
      // never open on an unresolved signal, so an unexpected throw keeps the
      // gate shut (returns false) — the safe direction for the highest-stakes
      // action in the project.
      return false;
    }
  }
  return true;
}
// @sync:cmp-accept-gate:end

export { computeAcceptGate };
