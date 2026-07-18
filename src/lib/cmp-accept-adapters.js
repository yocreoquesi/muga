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
 *   `@sync:cmp-accept-veto` / `@sync:cmp-accept-dispatch` content-script
 *   regions that hand-copy this module's pure functions (mirroring how
 *   `computeCookieGate` is mirrored into `@sync:cookie-gate`).
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
 * Tokens that mark a button as the FREE accept-and-continue control on a
 * consent-or-pay wall. DE + EN only this slice (see file docblock).
 *
 * KNOWN LIMITATION (documented, out of scope this slice): matching is plain
 * case-insensitive substring — a future locale token that happens to embed
 * one of these strings (e.g. French "continuer" embeds "continue") would
 * false-positive as ACCEPT. Widening past DE+EN requires checking new
 * tokens against this list for substring collisions before adding them.
 * @type {ReadonlyArray<string>}
 */
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

/**
 * Tokens that mark a button as a PAY/SUBSCRIBE control. Precedence: this
 * DENYLIST wins over every other classification — a button whose
 * accessible name contains any of these (or a currency/period symbol, see
 * CURRENCY_TOKENS / PERIOD_TOKENS below) is NEVER clicked, regardless of
 * whether it also contains an accept token (e.g. "Accept subscription").
 * @type {ReadonlyArray<string>}
 */
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

/**
 * Currency symbols. A locale-agnostic backstop: any button whose
 * accessible name contains one of these is treated as a pay control even
 * if no PAY_DENY_TOKENS literal matches (covers labels this slice's word
 * lists do not otherwise recognize).
 * @type {ReadonlyArray<string>}
 */
export const CURRENCY_TOKENS = Object.freeze(["€", "$", "£"]);

/**
 * Billing-period tokens. Same locale-agnostic backstop rationale as
 * CURRENCY_TOKENS — "/Monat", "/month", "/mo", "/Jahr" mark a price string
 * even without an explicit currency symbol next to them.
 * @type {ReadonlyArray<string>}
 */
export const PERIOD_TOKENS = Object.freeze(["/monat", "/month", "/mo", "/jahr"]);

/**
 * Tokens that mark a button as a settings/manage/preferences link rather
 * than a direct accept or reject action. Excluded from BOTH the accept and
 * reject candidate pools — clicking a settings link does not dismiss the
 * wall and is never the intended action here.
 * @type {ReadonlyArray<string>}
 */
export const SETTINGS_TOKENS = Object.freeze([
  "einstellungen",
  "settings",
  "manage",
  "options",
  "preferences",
  "customize",
]);

/**
 * Tokens that mark a button as a FREE reject / necessary-only control.
 * DE + EN only this slice, matching ACCEPT_TOKENS' scope. Presence of any
 * matching control anywhere on the wall means a free reject exists, so the
 * accept-click must never fire — see `hasFreeRejectControl` and L3 above.
 * @type {ReadonlyArray<string>}
 */
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

/**
 * True if `text` contains a currency symbol or billing-period token — the
 * locale-agnostic price backstop described in PAY_DENY_TOKENS' docblock.
 * @param {string} text - already-normalized (lowercased, trimmed) text.
 * @returns {boolean}
 */
function hasPriceIndicator(text) {
  return containsAnyToken(text, CURRENCY_TOKENS) || containsAnyToken(text, PERIOD_TOKENS);
}

/**
 * Closed classification enum for `classifyConsentButton`'s return value.
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
 * Pure button-text classifier (L4, PART A of the design — the crux of this
 * feature's safety model). Given a button's accessible name (accessible
 * name = aria-label, falling back to visible text — the caller supplies
 * whichever it already resolved), returns exactly one of BUTTON_KIND.
 *
 * PRECEDENCE (checked in this exact order, first match wins):
 *   1. PAY  — any PAY_DENY_TOKENS literal OR a price indicator
 *      (hasPriceIndicator) anywhere in the text. DENY WINS: this check
 *      runs BEFORE the accept check, so "Accept subscription — 4,99€/Monat"
 *      classifies as PAY, never ACCEPT, no matter how strong the accept
 *      wording also present.
 *   2. SETTINGS — any SETTINGS_TOKENS literal. Checked before REJECT/ACCEPT
 *      so "Cookie settings" or "Accept cookie settings" never fires either
 *      one — a settings link does not dismiss the wall.
 *   3. REJECT — any REJECT_TOKENS literal.
 *   4. ACCEPT — any ACCEPT_TOKENS literal.
 *   5. UNKNOWN — none of the above matched (an empty/blank text also lands
 *      here).
 *
 * Pure; never throws; a non-string input normalizes to "" and returns
 * UNKNOWN.
 *
 * @param {string} rawText
 * @returns {"pay"|"settings"|"reject"|"accept"|"unknown"}
 */
export function classifyConsentButton(rawText) {
  const text = normalizeButtonText(rawText);
  if (!text) return BUTTON_KIND.UNKNOWN;
  if (containsAnyToken(text, PAY_DENY_TOKENS) || hasPriceIndicator(text)) return BUTTON_KIND.PAY;
  if (containsAnyToken(text, SETTINGS_TOKENS)) return BUTTON_KIND.SETTINGS;
  if (containsAnyToken(text, REJECT_TOKENS)) return BUTTON_KIND.REJECT;
  if (containsAnyToken(text, ACCEPT_TOKENS)) return BUTTON_KIND.ACCEPT;
  return BUTTON_KIND.UNKNOWN;
}

/**
 * Closed result-status enum for `findFreeAcceptTarget`.
 * @type {Readonly<{SINGLE: "single", NOOP: "noop", AMBIGUOUS: "ambiguous"}>}
 */
export const ACCEPT_TARGET_STATUS = Object.freeze({
  SINGLE: "single",
  NOOP: "noop",
  AMBIGUOUS: "ambiguous",
});

/**
 * A candidate button as the caller (the content-script DOM scan) resolves
 * it — deliberately plain data, no DOM element, so this stays a pure,
 * exhaustively-unit-testable function (plain-data-in/plain-data-out).
 * @typedef {{text: string, actionable: boolean, ref?: *}} ConsentButtonCandidate
 */

/**
 * Pure button-discrimination decision (L4). Scans `candidates` for buttons
 * that classify as BUTTON_KIND.ACCEPT and are `actionable === true` (the
 * caller is responsible for resolving actionability — visible, not
 * disabled, in the layout — before calling this; a candidate that is not
 * exactly `actionable === true` is excluded outright, covering the "hidden
 * accept decoy" adversarial case).
 *
 * Returns:
 *   - `{status: "single", target}` — EXACTLY ONE actionable accept
 *     candidate survived. `target` is that candidate, unmodified.
 *   - `{status: "noop", target: null}` — ZERO candidates survived.
 *   - `{status: "ambiguous", target: null}` — MORE THAN ONE candidate
 *     survived. Ambiguity is a VETO, never a guess — the caller must NOOP.
 *
 * Pure; never throws; malformed/missing input resolves to NOOP.
 *
 * @param {ReadonlyArray<ConsentButtonCandidate>} [candidates]
 * @returns {{status: "single"|"noop"|"ambiguous", target: ConsentButtonCandidate|null}}
 */
export function findFreeAcceptTarget(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  const survivors = [];
  for (const candidate of list) {
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.actionable !== true) continue;
    if (classifyConsentButton(candidate.text) !== BUTTON_KIND.ACCEPT) continue;
    survivors.push(candidate);
  }
  if (survivors.length === 0) return { status: ACCEPT_TARGET_STATUS.NOOP, target: null };
  if (survivors.length > 1) return { status: ACCEPT_TARGET_STATUS.AMBIGUOUS, target: null };
  return { status: ACCEPT_TARGET_STATUS.SINGLE, target: survivors[0] };
}

/**
 * Pure last-resort gate (L3). True if any ACTIONABLE candidate on the wall
 * classifies as a free reject/necessary-only control. When true, the
 * accept-click must NEVER fire — a free reject always wins; it is the
 * reject engine's job, not this module's.
 *
 * Pure; never throws; malformed/missing input resolves to false
 * (conservative in the SAFE direction here: a caller that cannot determine
 * candidates at all has no evidence of a free reject, so this returns
 * false — but the caller's overall dispatch must independently require a
 * CONFIRMED consent-or-pay wall shape before ever reaching the click, see
 * `isPaywallFrame`).
 *
 * @param {ReadonlyArray<ConsentButtonCandidate>} [candidates]
 * @returns {boolean}
 */
export function hasFreeRejectControl(candidates) {
  const list = Array.isArray(candidates) ? candidates : [];
  for (const candidate of list) {
    if (!candidate || typeof candidate !== "object") continue;
    if (candidate.actionable !== true) continue;
    if (classifyConsentButton(candidate.text) === BUTTON_KIND.REJECT) return true;
  }
  return false;
}

/**
 * Pure consent-or-pay-wall frame-shape detection (PART B of the design).
 * This is a cheap PRE-FILTER, not the safety net by itself — the real
 * safety net is `hasFreeRejectControl` + `findFreeAcceptTarget`'s
 * exactly-one requirement, both of which still gate the actual click. This
 * function only decides whether the current frame LOOKS LIKE a
 * Sourcepoint-style consent-or-pay message iframe worth scanning at all.
 *
 * True only when the frame is a SUBFRAME (never the top frame — a
 * consent-or-pay dialog always renders in a child iframe per the real-site
 * probe, engram id 1333/1335) AND at least one of:
 *   - the frame's own URL matches the Sourcepoint message-iframe shape
 *     (`hasCsp=true` AND `consent/tcfv2` present, case-insensitively —
 *     these are query-string markers, not host-based, so they still match
 *     first-party CMP subdomains like sp-spiegel-de.spiegel.de or
 *     consent-cdn.zeit.de; do NOT filter on sp-prod.net/sourcepoint.com,
 *     that misses real deployments, engram id 1335's gotcha);
 *   - the frame's own hostname differs from the relayed top-frame
 *     hostname (a cross-origin child frame).
 *
 * `env.isTopFrame` must be exactly `true` or exactly `false` — an
 * undeterminable frame identity fails closed to false (never scanned).
 *
 * Pure; never throws.
 *
 * @param {{isTopFrame?: boolean, frameUrl?: string, frameHost?: string|null, topHost?: string|null}} [env]
 * @returns {boolean}
 */
export function isPaywallFrame(env) {
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
      // Fail-safe: treat as not exempt on any unexpected throw.
    }
  }
  return true;
}
// @sync:cmp-accept-gate:end

export { computeAcceptGate };
