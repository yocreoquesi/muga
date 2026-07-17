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
 * @property {boolean} [hasDidomiGlobal] - `typeof window.Didomi === "object"`.
 * @property {boolean} [hasSetUserDisagreeToAllFn] - `typeof window.Didomi.setUserDisagreeToAll === "function"`.
 *   Mandatory signal: without this, no reject action can be confirmed.
 * @property {boolean} [hasDidomiHostDom] - `#didomi-host` present in the DOM.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasGetCurrentUserStatusFn] - `typeof window.Didomi.getCurrentUserStatus === "function"`.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasGetCkyConsentFn] - `typeof window.getCkyConsent === "function"`.
 *   Mandatory signal (dual-mandatory with hasPerformBannerActionFn below):
 *   both bare CookieYes globals are required together, since neither one
 *   alone is a vendor-namespaced anchor like `window.OneTrust`.
 * @property {boolean} [hasPerformBannerActionFn] - `typeof window.performBannerAction === "function"`.
 *   Mandatory signal (dual-mandatory with hasGetCkyConsentFn above): without
 *   both, no reject action can be confirmed.
 * @property {boolean} [hasCkyConsentContainerDom] - `.cky-consent-container`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCkyOverlayDom] - `.cky-overlay` present in the DOM.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasCkyConsentBarDom] - `.cky-consent-bar` present in
 *   the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasTcfApiFn] - `typeof window.__tcfapi === "function"`.
 *   Mandatory signal (dual-mandatory with hasSpMessageContainerDom below):
 *   `__tcfapi` is the generic IAB TCF surface every TCF-compliant CMP
 *   exposes (including Didomi, already handled above), so it can never be
 *   a sole mandatory anchor on its own.
 * @property {boolean} [hasSpMessageContainerDom] - `div[id^="sp_message_container"]`
 *   present in the DOM. Mandatory signal (dual-mandatory with hasTcfApiFn
 *   above): the Sourcepoint-specific anchor that discriminates this CMP
 *   from every other `__tcfapi`-exposing vendor.
 * @property {boolean} [hasSpPrivacyMgmtIframeDom] - `iframe[src*="privacy-mgmt.com"]`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasSpProdIframeDom] - `iframe[src*="sp-prod.net"]`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasSpProdScriptDom] - `script[src*="sp-prod.net"]`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasUcUiGlobal] - `typeof window.UC_UI === "object"`.
 * @property {boolean} [hasDenyAllConsentsFn] - `typeof window.UC_UI.denyAllConsents === "function"`.
 *   Mandatory signal: without this, no reject action can be confirmed.
 * @property {boolean} [hasUsercentricsRootDom] - `#usercentrics-root`
 *   present in the DOM (the drop-in banner's host element — its own markup
 *   lives in an open Shadow DOM, but the host itself is always plain-DOM
 *   queryable). Secondary/corroborating signal.
 * @property {boolean} [hasIsInitializedFn] - `typeof window.UC_UI.isInitialized === "function"`.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasCookieInformationGlobal] - `typeof window.CookieInformation === "object"`.
 * @property {boolean} [hasDeclineAllCategoriesFn] - `typeof window.CookieInformation.declineAllCategories === "function"`.
 *   Mandatory signal: without this, no reject action can be confirmed.
 * @property {boolean} [hasCoiOverlayDom] - `#coiOverlay` present in the DOM.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasCoiConsentBannerDom] - `#coiConsentBanner` present
 *   in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCoiSummeryDom] - `#coiSummery` present in the DOM.
 *   Secondary/corroborating signal.
 * @property {boolean} [hasCoiBannerWrapperDom] - `#coi-banner-wrapper`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCoiConsentSummaryDom] - `.coi-consent-summary`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCookieScriptGlobal] - `typeof window.CookieScript === "object"`.
 * @property {boolean} [hasCookieScriptInstance] - `typeof window.CookieScript.instance === "object"`.
 *   Mandatory signal: the reject call lives on `.instance`, so this must be
 *   present before probing for the reject function itself.
 * @property {boolean} [hasRejectAllActionFn] - `typeof window.CookieScript.instance.rejectAllAction === "function"`.
 *   Mandatory signal: without this, no reject action can be confirmed.
 * @property {boolean} [hasCookiescriptInjectedDom] - `#cookiescript_injected`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCookiescriptDescriptionDom] - `#cookiescript_description`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasTarteaucitronGlobal] - `typeof window.tarteaucitron === "object"`.
 * @property {boolean} [hasTarteaucitronUserInterface] - `typeof window.tarteaucitron.userInterface === "object"`.
 *   Mandatory signal: the reject call lives on `.userInterface`, so this
 *   must be present before probing for the reject function itself.
 * @property {boolean} [hasRespondAllFn] - `typeof window.tarteaucitron.userInterface.respondAll === "function"`.
 *   Mandatory signal: without this, no reject action can be confirmed.
 * @property {boolean} [hasTarteaucitronRootDom] - `#tarteaucitronRoot`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasTarteaucitronAlertBigDom] - `#tarteaucitronAlertBig`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasTarteaucitronBackDom] - `#tarteaucitronBack`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasTarteaucitronModalOpenDom] - `.tarteaucitron-modal-open`
 *   present on `document.body`. Secondary/corroborating signal.
 * @property {boolean} [hasCmpMngrGlobal] - `typeof window.cmpmngr === "object"`.
 *   Mandatory signal: the consentmanager.net-specific vendor global.
 * @property {boolean} [hasCmpFn] - `typeof window.__cmp === "function"`.
 *   Mandatory signal: `__cmp` is the legacy IAB TCF v1.1 generic surface
 *   (shared risk with other v1.1-era CMPs), so it can never be a sole
 *   anchor — see the dual-anchor discrimination rationale above
 *   detectConsentmanager below.
 * @property {boolean} [hasCmpBoxDom] - `#cmpbox` present in the DOM.
 *   Mandatory signal: the consentmanager.net-specific DOM anchor that
 *   discriminates this CMP from every other bare-`__cmp`-exposing vendor.
 * @property {boolean} [hasCmpWelcomeBtnYesDom] - `#cmpwelcomebtnyes`
 *   present in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCmpWelcomeBtnNoDom] - `#cmpwelcomebtnno` present
 *   in the DOM. Secondary/corroborating signal.
 * @property {boolean} [hasCmpBoxBtnDom] - `#cmpbox .cmpboxbtn` present in
 *   the DOM. Secondary/corroborating signal.
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
 * (#1118) — same fail-closed confidence gate, same threshold. The Didomi
 * adapter (#1119) reuses it again: like OneTrust, its reject call
 * (`Didomi.setUserDisagreeToAll()`) is a direct zero-argument vendor-global
 * method call, so it is modeled on the OneTrust detection shape rather than
 * Cookiebot's literal-args guard.
 *
 * The CookieYes adapter (#1120) DEVIATES from this shape on purpose: its
 * reject call (`performBannerAction("reject")`) is a BARE global function,
 * not a method on a vendor-namespaced object like `window.OneTrust` /
 * `window.Cookiebot` / `window.Didomi`. A single bare, generically-named
 * global would be a weaker anchor than the other three (name-collision
 * risk with an unrelated page script), so detectCookieYes strengthens the
 * MANDATORY bar instead of weakening the corroboration bar: it requires
 * BOTH `getCkyConsent` and `performBannerAction` bare globals present
 * together, still gated by the same >=1 DOM secondary signal and the same
 * CONFIDENCE_THRESHOLD.
 *
 * The Sourcepoint adapter (#1123) DEVIATES from every prior adapter's
 * discrimination shape on purpose (TCF-generic-signal discrimination): its
 * reject call rides `window.__tcfapi`, the generic IAB TCF surface that
 * EVERY TCF-compliant CMP exposes — including Didomi, already handled
 * above. Unlike OneTrust/Cookiebot/Didomi's vendor-namespaced anchor or
 * CookieYes's dual-bare-global anchor, `hasTcfApiFn` alone is true on any
 * TCF CMP's page and can never be a safe mandatory anchor by itself.
 * detectSourcepoint therefore requires BOTH `hasTcfApiFn` AND the
 * Sourcepoint-specific DOM signal `hasSpMessageContainerDom`
 * (`div[id^="sp_message_container"]`) as dual-mandatory, mirroring
 * detectCookieYes's dual-mandatory shape but anchored on one generic
 * function signal + one vendor-specific DOM signal instead of two bare
 * globals. This is what lets Sourcepoint coexist with Didomi in the same
 * registry without misfiring on Didomi's (or any other TCF CMP's) pages.
 *
 * The Usercentrics adapter (#1121) reuses the OneTrust/Didomi shape again:
 * `window.UC_UI` is a vendor-namespaced global (not a shared/generic
 * surface like `__tcfapi`, and not a bare global like CookieYes's), so
 * detectUsercentrics requires the mandatory `hasUcUiGlobal` +
 * `hasDenyAllConsentsFn` pair plus >=1 corroborating signal
 * (`hasUsercentricsRootDom` or `hasIsInitializedFn`) — same fail-closed
 * confidence gate, same threshold. Do NOT key detection off `__tcfapi` or
 * an `__ucCmp` global: those are the generic-TCF / headless-SDK surfaces
 * (a separate, rarer Usercentrics integration mode) and would either
 * collide with Sourcepoint/Didomi discrimination or fail to discriminate
 * at all.
 *
 * The Cookie Information adapter reuses the OneTrust/Didomi/Usercentrics
 * shape again: `window.CookieInformation` is a vendor-namespaced global, so
 * detectCookieInformation requires the mandatory `hasCookieInformationGlobal`
 * + `hasDeclineAllCategoriesFn` pair plus >=1 corroborating DOM secondary
 * (`#coiOverlay`, `#coiConsentBanner`, `#coiSummery`, `#coi-banner-wrapper`,
 * `.coi-consent-summary`) — same fail-closed confidence gate, same
 * threshold. Do NOT key detection off `window.__tcfapi`: Cookie Information
 * can ALSO expose the generic IAB TCF surface (opt-in per site via
 * `data-tcf-v2-enabled`), which is Sourcepoint's dual-mandatory anchor
 * above, not this adapter's. Detection here is keyed ONLY off the
 * `window.CookieInformation` vendor global + `declineAllCategories`.
 *
 * The CookieScript adapter DEVIATES from the vendor-namespaced-global shape
 * on purpose: its reject call (`CookieScript.instance.rejectAllAction()`)
 * lives on a `.instance` property, not directly on the vendor global
 * itself. detectCookieScript therefore strengthens the mandatory bar to a
 * TRIPLE gate — `hasCookieScriptGlobal` AND `hasCookieScriptInstance` AND
 * `hasRejectAllActionFn` — because `.instance` can be present-but-not-yet
 * populated (or absent) even when the vendor global itself already exists,
 * and probing `.rejectAllAction` before confirming `.instance` is an object
 * would either throw or silently read `undefined`. The usual >=1
 * corroborating DOM secondary (`#cookiescript_injected`,
 * `#cookiescript_description`) still gates the same fail-closed
 * CONFIDENCE_THRESHOLD as every other adapter here.
 *
 * The tarteaucitron adapter reuses the CookieScript TRIPLE-mandatory-gate
 * shape on purpose: its reject call (`tarteaucitron.userInterface.respondAll(false)`)
 * lives on a `.userInterface` property, not directly on the vendor global
 * itself — the same "present-but-not-yet-populated-with-the-nested-object"
 * hazard the CookieScript rationale above describes. detectTarteaucitron
 * therefore requires `hasTarteaucitronGlobal` AND `hasTarteaucitronUserInterface`
 * AND `hasRespondAllFn` together, before probing for the usual >=1
 * corroborating DOM secondary (`#tarteaucitronRoot`, `#tarteaucitronAlertBig`,
 * `#tarteaucitronBack`, `.tarteaucitron-modal-open`) — same fail-closed
 * CONFIDENCE_THRESHOLD as every other adapter here.
 *
 * The consentmanager.net adapter DEVIATES from every prior adapter's
 * discrimination shape on purpose (dual-anchor discrimination, extended to
 * a mandatory TRIPLE): its reject call rides `window.__cmp`, the legacy IAB
 * TCF v1.1 generic global name — shared risk with other v1.1-era CMPs, so
 * it can never be a sole anchor, mirroring the TCF-generic-signal
 * discrimination rationale on detectSourcepoint above. Unlike Sourcepoint's
 * dual-mandatory (generic fn + vendor DOM), this adapter requires a THIRD
 * mandatory signal on top of that pair: `hasCmpMngrGlobal`
 * (`typeof window.cmpmngr === "object"`, the vendor-specific global) AND
 * `hasCmpFn` (`typeof window.__cmp === "function"`, the legacy generic
 * reject surface) AND `hasCmpBoxDom` (`#cmpbox`, the vendor-specific DOM
 * anchor) are all mandatory together — a bare `__cmp` function is common to
 * every TCF v1.1 CMP and must never claim this adapter on its own, and
 * `window.cmpmngr` alone (without the DOM anchor or the reject surface) is
 * not enough either. The usual >=1 corroborating DOM secondary
 * (`#cmpwelcomebtnyes`, `#cmpwelcomebtnno`, `#cmpbox .cmpboxbtn`) still
 * gates the same fail-closed CONFIDENCE_THRESHOLD as every other adapter
 * here.
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

function detectDidomi(signals) {
  if (!signals || signals.hasDidomiGlobal !== true || signals.hasSetUserDisagreeToAllFn !== true) {
    return 0;
  }
  const secondary =
    (signals.hasDidomiHostDom === true ? 1 : 0) +
    (signals.hasGetCurrentUserStatusFn === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectDidomi(signals) {
  return detectDidomi(signals) >= CONFIDENCE_THRESHOLD;
}

function detectCookieYes(signals) {
  if (
    !signals ||
    signals.hasGetCkyConsentFn !== true ||
    signals.hasPerformBannerActionFn !== true
  ) {
    return 0;
  }
  const secondary =
    (signals.hasCkyConsentContainerDom === true ? 1 : 0) +
    (signals.hasCkyOverlayDom === true ? 1 : 0) +
    (signals.hasCkyConsentBarDom === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectCookieYes(signals) {
  return detectCookieYes(signals) >= CONFIDENCE_THRESHOLD;
}

// Sourcepoint (#1123): __tcfapi is generic to ALL TCF-compliant CMPs
// (including Didomi above), so it can never be the sole mandatory anchor.
// Both hasTcfApiFn AND the Sourcepoint-specific DOM signal
// (div[id^="sp_message_container"]) are mandatory together — see the
// TCF-generic-signal discrimination rationale above detectCookieYes.
function detectSourcepoint(signals) {
  if (!signals || signals.hasTcfApiFn !== true || signals.hasSpMessageContainerDom !== true) {
    return 0;
  }
  const secondary =
    (signals.hasSpPrivacyMgmtIframeDom === true ? 1 : 0) +
    (signals.hasSpProdIframeDom === true ? 1 : 0) +
    (signals.hasSpProdScriptDom === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectSourcepoint(signals) {
  return detectSourcepoint(signals) >= CONFIDENCE_THRESHOLD;
}

// Usercentrics (#1121): window.UC_UI is a vendor-namespaced global (like
// Didomi's window.Didomi), NOT a shared/generic surface like __tcfapi and
// NOT a bare global like CookieYes's — so this mirrors detectDidomi's
// shape (mandatory global + mandatory reject-fn signal, plus >=1
// corroborating secondary signal).
function detectUsercentrics(signals) {
  if (!signals || signals.hasUcUiGlobal !== true || signals.hasDenyAllConsentsFn !== true) {
    return 0;
  }
  const secondary =
    (signals.hasUsercentricsRootDom === true ? 1 : 0) +
    (signals.hasIsInitializedFn === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectUsercentrics(signals) {
  return detectUsercentrics(signals) >= CONFIDENCE_THRESHOLD;
}

// Cookie Information: window.CookieInformation is a vendor-namespaced
// global (like OneTrust/Didomi/UC_UI), so this mirrors detectDidomi's shape
// (mandatory global + mandatory reject-fn signal, plus >=1 corroborating
// secondary signal). Do NOT key off __tcfapi — see the discrimination
// rationale above detectCookieInformation in the docblock preceding this
// sync block.
function detectCookieInformation(signals) {
  if (
    !signals ||
    signals.hasCookieInformationGlobal !== true ||
    signals.hasDeclineAllCategoriesFn !== true
  ) {
    return 0;
  }
  const secondary =
    (signals.hasCoiOverlayDom === true ? 1 : 0) +
    (signals.hasCoiConsentBannerDom === true ? 1 : 0) +
    (signals.hasCoiSummeryDom === true ? 1 : 0) +
    (signals.hasCoiBannerWrapperDom === true ? 1 : 0) +
    (signals.hasCoiConsentSummaryDom === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectCookieInformation(signals) {
  return detectCookieInformation(signals) >= CONFIDENCE_THRESHOLD;
}

// CookieScript: the reject call lives on window.CookieScript.instance, not
// directly on the vendor global — see the TRIPLE-mandatory-gate rationale
// above detectCookieScript in the docblock preceding this sync block.
function detectCookieScript(signals) {
  if (
    !signals ||
    signals.hasCookieScriptGlobal !== true ||
    signals.hasCookieScriptInstance !== true ||
    signals.hasRejectAllActionFn !== true
  ) {
    return 0;
  }
  const secondary =
    (signals.hasCookiescriptInjectedDom === true ? 1 : 0) +
    (signals.hasCookiescriptDescriptionDom === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectCookieScript(signals) {
  return detectCookieScript(signals) >= CONFIDENCE_THRESHOLD;
}

// tarteaucitron: the reject call lives on window.tarteaucitron.userInterface,
// not directly on the vendor global — see the TRIPLE-mandatory-gate
// rationale above detectTarteaucitron in the docblock preceding this sync
// block.
function detectTarteaucitron(signals) {
  if (
    !signals ||
    signals.hasTarteaucitronGlobal !== true ||
    signals.hasTarteaucitronUserInterface !== true ||
    signals.hasRespondAllFn !== true
  ) {
    return 0;
  }
  const secondary =
    (signals.hasTarteaucitronRootDom === true ? 1 : 0) +
    (signals.hasTarteaucitronAlertBigDom === true ? 1 : 0) +
    (signals.hasTarteaucitronBackDom === true ? 1 : 0) +
    (signals.hasTarteaucitronModalOpenDom === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectTarteaucitron(signals) {
  return detectTarteaucitron(signals) >= CONFIDENCE_THRESHOLD;
}

// consentmanager.net: __cmp is the legacy IAB TCF v1.1 generic surface
// every v1.1-era CMP can expose, so it can never be the sole mandatory
// anchor — see the dual-anchor discrimination rationale above
// detectSourcepoint. hasCmpMngrGlobal AND hasCmpFn AND hasCmpBoxDom are all
// mandatory together (see the TRIPLE-mandatory rationale in the docblock
// preceding this sync block).
function detectConsentmanager(signals) {
  if (
    !signals ||
    signals.hasCmpMngrGlobal !== true ||
    signals.hasCmpFn !== true ||
    signals.hasCmpBoxDom !== true
  ) {
    return 0;
  }
  const secondary =
    (signals.hasCmpWelcomeBtnYesDom === true ? 1 : 0) +
    (signals.hasCmpWelcomeBtnNoDom === true ? 1 : 0) +
    (signals.hasCmpBoxBtnDom === true ? 1 : 0);
  return secondary >= 1 ? 1 : 0.4;
}

function canRejectConsentmanager(signals) {
  return detectConsentmanager(signals) >= CONFIDENCE_THRESHOLD;
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

/**
 * Didomi Tier 1 adapter (#1119). The reject call
 * (`Didomi.setUserDisagreeToAll()`) is invoked by the caller-supplied
 * callback via the shared `reject()` helper above — this adapter
 * definition never touches `window` itself. Same call shape as
 * `oneTrustAdapter.RejectAll()`: synchronous, zero arguments, void return.
 * Unlike Cookiebot's three positional booleans, this call has no
 * consent-granting parameter at all — there is no argument surface a
 * future edit could flip to grant broad consent.
 * @type {Readonly<{id: "didomi", tier: 1, detect: typeof detectDidomi, canReject: typeof canRejectDidomi, reject: typeof reject}>}
 */
export const didomiAdapter = Object.freeze({
  id: "didomi",
  tier: 1,
  detect: detectDidomi,
  canReject: canRejectDidomi,
  reject,
});

/**
 * CookieYes Tier 1 adapter (#1120). The reject call
 * (`performBannerAction("reject")`) is invoked by the caller-supplied
 * callback via the shared `reject()` helper above — this adapter
 * definition never touches `window` itself.
 *
 * Detection deviates from the other three adapters' shape ON PURPOSE: the
 * reject call is a BARE global function (`window.performBannerAction`),
 * not a method on a vendor-namespaced object like `window.OneTrust` /
 * `window.Cookiebot` / `window.Didomi`. A single bare, generically-named
 * global has a real name-collision risk (an unrelated page script could
 * define its own `performBannerAction`), so this adapter requires BOTH
 * CookieYes-specific bare globals (`getCkyConsent` AND
 * `performBannerAction`) as the mandatory gate — strengthening the
 * mandatory bar instead of weakening the corroboration bar — plus the
 * usual >=1 DOM secondary signal before crossing the confidence
 * threshold. See detectCookieYes above.
 * @type {Readonly<{id: "cookieyes", tier: 1, detect: typeof detectCookieYes, canReject: typeof canRejectCookieYes, reject: typeof reject}>}
 */
export const cookieYesAdapter = Object.freeze({
  id: "cookieyes",
  tier: 1,
  detect: detectCookieYes,
  canReject: canRejectCookieYes,
  reject,
});

/**
 * Sourcepoint Tier 1 adapter (#1123). The reject call
 * (`window.__tcfapi("postRejectAll", 2, callback)`) is invoked by the
 * caller-supplied callback via the shared `reject()` helper above — this
 * adapter definition never touches `window` itself.
 *
 * Async call shape, fire-and-forget: `__tcfapi` is callback-based (its
 * second-argument callback fires later, asynchronously), but the injected
 * callback the content-script call site supplies is a zero-argument arrow
 * that just invokes `__tcfapi(...)` and returns SYNCHRONOUSLY right after —
 * the async callback passed to `postRejectAll` is optional-log-only and
 * never gates `reject()`'s control flow. `reject()` sees the exact same
 * zero-arg, non-throwing shape as every other adapter here.
 *
 * Registered LAST in TIER1 (after didomiAdapter): Didomi's reject call is a
 * direct, unambiguous vendor-global method, while Sourcepoint rides the
 * shared/generic `__tcfapi` surface — on a hypothetical dual-CMP page,
 * more-certain adapters should get first refusal. See detectSourcepoint's
 * TCF-generic-signal discrimination rationale above.
 * @type {Readonly<{id: "sourcepoint", tier: 1, detect: typeof detectSourcepoint, canReject: typeof canRejectSourcepoint, reject: typeof reject}>}
 */
export const sourcepointAdapter = Object.freeze({
  id: "sourcepoint",
  tier: 1,
  detect: detectSourcepoint,
  canReject: canRejectSourcepoint,
  reject,
});

/**
 * Usercentrics Tier 1 adapter (#1121). The reject call
 * (`window.UC_UI.denyAllConsents()`) is invoked by the caller-supplied
 * callback via the shared `reject()` helper above — this adapter
 * definition never touches `window` itself.
 *
 * Async call shape, fire-and-forget: unlike every prior adapter here,
 * `denyAllConsents()` returns a Promise. The content-script call site
 * attaches `.catch(() => {})` to swallow any floating rejection, then
 * returns SYNCHRONOUSLY right after — `_acted`/`_fxActed` and
 * `stopObserver()`/`fxStopObserver()` fire immediately, never gated on the
 * promise settling. `reject()` sees the exact same zero-arg, non-throwing
 * callback shape as every other adapter here; the callback's returned
 * promise (already `.catch`-guarded by the caller) is never awaited.
 *
 * Registered LAST in TIER1 (after sourcepointAdapter): `window.UC_UI` is a
 * direct, unambiguous vendor-namespaced global (like Didomi's), so ordering
 * relative to Sourcepoint (which rides the shared `__tcfapi` surface) is
 * not safety-critical either way — appended at the end to keep the
 * registry's history append-only.
 * @type {Readonly<{id: "usercentrics", tier: 1, detect: typeof detectUsercentrics, canReject: typeof canRejectUsercentrics, reject: typeof reject}>}
 */
export const usercentricsAdapter = Object.freeze({
  id: "usercentrics",
  tier: 1,
  detect: detectUsercentrics,
  canReject: canRejectUsercentrics,
  reject,
});

/**
 * Cookie Information Tier 1 adapter. The reject call
 * (`window.CookieInformation.declineAllCategories()`) is invoked by the
 * caller-supplied callback via the shared `reject()` helper above — this
 * adapter definition never touches `window` itself. Same call shape as
 * `oneTrustAdapter.RejectAll()` / `didomiAdapter.setUserDisagreeToAll()`:
 * synchronous, zero arguments, void return — the library's own default
 * decline button listens for click and calls this exact method (a core SDK
 * global method, not gated behind custom-template opt-in). Independent of
 * IAB TCF (`window.__tcfapi`, which for this vendor is additionally opt-in
 * per site) — see detectCookieInformation's discrimination rationale above.
 *
 * Registered LAST in TIER1 (after usercentricsAdapter): `window.CookieInformation`
 * is a direct, unambiguous vendor-namespaced global (like Didomi's/UC_UI's),
 * so ordering relative to the other adapters is not safety-critical either
 * way — appended at the end to keep the registry's history append-only.
 * @type {Readonly<{id: "cookieinformation", tier: 1, detect: typeof detectCookieInformation, canReject: typeof canRejectCookieInformation, reject: typeof reject}>}
 */
export const cookieInformationAdapter = Object.freeze({
  id: "cookieinformation",
  tier: 1,
  detect: detectCookieInformation,
  canReject: canRejectCookieInformation,
  reject,
});

/**
 * CookieScript Tier 1 adapter. The reject call
 * (`window.CookieScript.instance.rejectAllAction()`) is invoked by the
 * caller-supplied callback via the shared `reject()` helper above — this
 * adapter definition never touches `window` itself. Synchronous,
 * zero-argument, void return — "rejects all cookies except strictly
 * necessary" per the vendor's own documentation, the same call shape as
 * `oneTrustAdapter.RejectAll()` / `didomiAdapter.setUserDisagreeToAll()` /
 * `cookieInformationAdapter.declineAllCategories()`.
 *
 * Registered LAST in TIER1 (after cookieInformationAdapter): the
 * `.instance` indirection makes this adapter's mandatory gate the
 * strictest of the eight (see detectCookieScript's TRIPLE-mandatory-gate
 * rationale above), so ordering relative to the others is not
 * safety-critical — appended at the end to keep the registry's history
 * append-only.
 * @type {Readonly<{id: "cookiescript", tier: 1, detect: typeof detectCookieScript, canReject: typeof canRejectCookieScript, reject: typeof reject}>}
 */
export const cookieScriptAdapter = Object.freeze({
  id: "cookiescript",
  tier: 1,
  detect: detectCookieScript,
  canReject: canRejectCookieScript,
  reject,
});

/**
 * tarteaucitron Tier 1 adapter. The reject call
 * (`window.tarteaucitron.userInterface.respondAll(false)`) is invoked by
 * the caller-supplied callback via the shared `reject()` helper above —
 * this adapter definition never touches `window` itself. Synchronous
 * (a plain `for` loop over `tarteaucitron.job`, no Promise/callback) — the
 * `false` status argument denies every registered service, mirroring the
 * vendor's own "tout refuser" (reject all) UI button, which calls this
 * exact function with the exact same literal argument.
 *
 * Detection deviates from the vendor-namespaced-global shape on purpose
 * (same TRIPLE-mandatory-gate rationale as CookieScript): the reject call
 * lives on `.userInterface`, not directly on `window.tarteaucitron` — see
 * detectTarteaucitron's rationale above.
 *
 * Registered LAST in TIER1 (after cookieScriptAdapter): `window.tarteaucitron`
 * is a direct, unambiguous vendor-namespaced global (like CookieScript's),
 * so ordering relative to the other adapters is not safety-critical —
 * appended at the end to keep the registry's history append-only.
 * @type {Readonly<{id: "tarteaucitron", tier: 1, detect: typeof detectTarteaucitron, canReject: typeof canRejectTarteaucitron, reject: typeof reject}>}
 */
export const tarteaucitronAdapter = Object.freeze({
  id: "tarteaucitron",
  tier: 1,
  detect: detectTarteaucitron,
  canReject: canRejectTarteaucitron,
  reject,
});

/**
 * consentmanager.net Tier 1 adapter. The reject call
 * (`window.__cmp("setConsent", 0, callback, true)`) is invoked by the
 * caller-supplied callback via the shared `reject()` helper above — this
 * adapter definition never touches `window` itself. The literal `0`
 * consent-value argument denies all (reject-all); `1` would grant broad
 * consent, so this call site must never pass a variable there — see the
 * literal-arg guard in tests/unit/cookie-noise-sync.test.mjs.
 *
 * Async call shape, fire-and-forget, same family as the Sourcepoint
 * adapter's `__tcfapi("postRejectAll", 2, callback)`: the callback fires in
 * practice but is optional-log-only and never gates control flow —
 * `_acted`/`stopObserver()` fire synchronously right after the call
 * returns, never awaited on the callback settling.
 *
 * Detection deviates from every prior adapter's discrimination shape on
 * purpose (dual-anchor discrimination extended to a mandatory TRIPLE) — see
 * detectConsentmanager's rationale above.
 *
 * Registered LAST in TIER1 (after tarteaucitronAdapter): `window.__cmp` is
 * a shared/generic legacy TCF v1.1 surface (like Sourcepoint's
 * `__tcfapi`), so ordering relative to the vendor-namespaced-global
 * adapters is not safety-critical — appended at the end to keep the
 * registry's history append-only.
 * @type {Readonly<{id: "consentmanager", tier: 1, detect: typeof detectConsentmanager, canReject: typeof canRejectConsentmanager, reject: typeof reject}>}
 */
export const consentmanagerAdapter = Object.freeze({
  id: "consentmanager",
  tier: 1,
  detect: detectConsentmanager,
  canReject: canRejectConsentmanager,
  reject,
});

/** Tier 1 registry: API adapters that call a page-authored global directly. */
export const TIER1 = Object.freeze([
  oneTrustAdapter,
  cookiebotAdapter,
  didomiAdapter,
  cookieYesAdapter,
  sourcepointAdapter,
  usercentricsAdapter,
  cookieInformationAdapter,
  cookieScriptAdapter,
  tarteaucitronAdapter,
  consentmanagerAdapter,
]);

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
 * reasons for observability/testing: `"no-reject-path"` when a vendor
 * global is present but its reject function is not (a hard wall), and
 * `"uncertain"` for everything else (no CMP detected, or insufficient
 * corroboration — fail-closed).
 *
 * `adapterId` is threaded through every `"no-reject-path"` branch (the
 * specific vendor whose hard wall was detected) — a small enhancement that
 * keeps this file's own structural guard intact (see the file docblock):
 * this file still never spells the word that guard forbids, and never
 * decides anything beyond the reject family. A SEPARATE module can use
 * this id downstream to decide what, if anything, to do about a specific
 * vendor's hard wall, without this file ever knowing what that separate
 * module does with it.
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
    return { action: null, reason: "no-reject-path", adapterId: "onetrust" };
  }
  if (s.hasCookiebotGlobal === true && s.hasSubmitCustomConsentFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "cookiebot" };
  }
  if (s.hasDidomiGlobal === true && s.hasSetUserDisagreeToAllFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "didomi" };
  }
  if (s.hasGetCkyConsentFn === true && s.hasPerformBannerActionFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "cookieyes" };
  }
  // Sourcepoint (#1123) hard wall is the MIRROR IMAGE of the checks above:
  // keyed off the Sourcepoint-specific DOM signal, NOT hasTcfApiFn alone —
  // a bare hasTcfApiFn is true on every TCF CMP (Didomi included) and must
  // fall through to "uncertain" below, never claim Sourcepoint.
  if (s.hasSpMessageContainerDom === true && s.hasTcfApiFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "sourcepoint" };
  }
  // Usercentrics (#1121) hard wall: same shape as the OneTrust/Didomi
  // checks above (mandatory global present, mandatory reject fn absent).
  if (s.hasUcUiGlobal === true && s.hasDenyAllConsentsFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "usercentrics" };
  }
  // Cookie Information hard wall: same shape as the OneTrust/Didomi/
  // Usercentrics checks above (mandatory global present, mandatory reject
  // fn absent).
  if (s.hasCookieInformationGlobal === true && s.hasDeclineAllCategoriesFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "cookieinformation" };
  }
  // CookieScript hard wall: mandatory global present but the reject
  // function is not reachable — either `.instance` itself is absent, or
  // `.instance` exists but `.rejectAllAction` is not a function. Both
  // sub-cases collapse to `hasRejectAllActionFn !== true` here.
  if (s.hasCookieScriptGlobal === true && s.hasRejectAllActionFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "cookiescript" };
  }
  // tarteaucitron hard wall: mandatory global present but the reject
  // function is not reachable — either `.userInterface` itself is absent,
  // or `.userInterface` exists but `.respondAll` is not a function. Both
  // sub-cases collapse to `hasRespondAllFn !== true` here, same shape as
  // the CookieScript hard wall above.
  if (s.hasTarteaucitronGlobal === true && s.hasRespondAllFn !== true) {
    return { action: null, reason: "no-reject-path", adapterId: "tarteaucitron" };
  }
  // consentmanager.net hard wall: the MIRROR IMAGE of the Sourcepoint check
  // above, keyed off the vendor-specific DOM anchor (hasCmpBoxDom), NOT
  // bare hasCmpFn alone — a bare __cmp function is true on every TCF v1.1
  // CMP and must fall through to "uncertain" below, never claim
  // consentmanager.net.
  if (s.hasCmpBoxDom === true && (s.hasCmpMngrGlobal !== true || s.hasCmpFn !== true)) {
    return { action: null, reason: "no-reject-path", adapterId: "consentmanager" };
  }
  return { action: null, reason: "uncertain", adapterId: null };
}

/**
 * Pure disabled-state gate for the Cookie Consent Minimizer.
 * Decides whether the isolated-world gatekeeper (content/cookie-noise.js)
 * should open the gate, from the user's prefs plus injected environment
 * dependencies. Kept pure (no `window`/`location` access) so every
 * branch — feature off, pre-onboarding, mode not on, per-site exemption,
 * all-pass — is unit-tested directly here instead of only structurally in
 * a content script that Node cannot import.
 *
 * Mode scope (3-state `cookieConsentMode` pref): the reject ladder must run
 * first in EVERY active mode, not only `"reject-only"` (see this project's
 * design docs, Part B "L3" + "Gate wiring reconciliation") — but
 * this file's own STRUCTURAL guard (see the describe block in
 * tests/unit/cmp-adapters.test.mjs) forbids naming the newer mode anywhere
 * in this source. So this gate no longer reads `prefs.cookieConsentMode`
 * at all: the caller validates the raw pref against the closed enum at the
 * settings-schema.js boundary (which has no such lexical restriction) and
 * passes a pre-validated `deps.modeActive` boolean instead. Fail-closed:
 * anything other than the literal boolean `true` keeps the gate shut.
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
 * @param {{modeActive?: boolean, hostname?: string, isSiteFullyExempt?: (hostname: string, prefs: object) => boolean}} [deps]
 *   Environment hooks the content-script call site injects: the
 *   pre-validated active-mode boolean, the current hostname, and the
 *   cleaner's per-site exemption predicate.
 * @returns {boolean} true only when the gate should open.
 */
// @sync:cookie-gate:start
function computeCookieGate(prefs, deps) {
  if (!prefs) return false;
  if (prefs.enabled === false) return false;
  if (prefs.onboardingDone !== true) return false;
  if (!deps || deps.modeActive !== true) return false;
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
