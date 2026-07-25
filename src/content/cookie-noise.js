/**
 * MUGA: Cookie Consent Minimizer — isolated-world gatekeeper (#1027)
 *
 * Reads the user's prefs, computes the disabled-state gate, and controls
 * the MAIN-world caller (content/cookie-noise-mainworld.js, Chrome MV3
 * only) via a nonce-gated CustomEvent handshake on a channel SEPARATE
 * from `muga:history-gate` — this feature's pref (`cookieConsentMode`,
 * default "reject-only" for new installs) is independent from
 * `activeDefenseEnabled` (default ON); sharing a gate would conflate two
 * independent opt-ins.
 *
 * On Firefox MV2 (no `world: "MAIN"` support) this script ALSO performs
 * the reject call directly, reaching the page's real OneTrust object via
 * `window.wrappedJSObject` — no cross-world event bridge is needed there
 * because gatekeeper and caller share the same world. Dormant on Chrome.
 *
 * The detection + confidence-gate logic below is a hand-maintained COPY
 * of the block in src/lib/cmp-adapters.js between the `@sync` markers
 * (content scripts cannot use ES module imports — see AGENTS.md). Kept in
 * sync by tests/unit/cookie-noise-sync.test.mjs. Same ethical-spine rule
 * as that file applies here: this source, including every comment,
 * intentionally avoids the word for "granting broad consent" — do not
 * introduce it. See src/lib/cmp-adapters.js's docblock for the full
 * rationale and the structural guard that enforces it.
 *
 * Runs in the isolated world (Chrome + Firefox). In the TOP frame, listed
 * after content/cleaner-bundle.js in the manifest so `window.__mugaCleaner`
 * is already attached when the gate first opens (needed for the
 * `isSiteFullyExempt` per-site exemption check). `window.__mugaCleaner` is
 * NOT attached in child frames (cleaner-bundle.js stays top-frame-only) —
 * computeGate() below resolves the TOP frame's real hostname instead (see
 * the `@sync:frame-host` block) and checks the exemption with a
 * per-frame-safe, prefs-only copy of the real predicate (see the
 * `@sync:site-exempt` block), so a user's per-site pause is still honored
 * inside a cross-origin consent-or-pay dialog iframe
 * (cookie-consent-all-frames FIX A). Fail-closed: an undeterminable
 * top-frame hostname is treated as exempt rather than risk opening the
 * gate against the user's pause.
 *
 * Cross-origin-iframe scope (deliberate, scoped change): this script is
 * registered `all_frames: true` in the manifest, IN ITS OWN dedicated
 * content_scripts entry — every other content script stays top-frame-only.
 * A real-site frame-location probe found that consent-or-pay wall dialogs
 * (Sourcepoint's `sp_message_container` message iframe, hosted on a
 * dedicated cross-origin subdomain) render in a CROSS-ORIGIN CHILD FRAME,
 * not the top frame — so a top-frame-only script can never reach the
 * dialog's own buttons. The previous same-frame-only guard below (an early
 * return keyed on frame identity) was REMOVED for this reason. `all_frames`
 * is not a new permission — MUGA already holds `<all_urls>` host
 * permission, which already covers every frame; no new user-facing
 * permission prompt results from this change. The module now runs once
 * per frame (ads, embeds, same-origin iframes, cross-origin consent
 * iframes) — see the bounded give-up window
 * below and the defensive try/catch wrapper immediately below, both of
 * which keep this cheap and safe when a frame has no matching CMP.
 */

(function () {
  "use strict";

  try {
  if (window.__mugaCookieNoiseGate) return;
  window.__mugaCookieNoiseGate = true;

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

  // ── Nonce handshake (separate channel: muga:cookie-gate) ────────────────
  // Mirrors the #811 pattern from history-defuser.js on its own channel.
  // The nonce lives only in this closure — no global property stores it.
  const _nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(_nonceBytes);
  const _nonce = Array.from(_nonceBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  function dispatchNonceOnce() {
    try {
      document.dispatchEvent(new CustomEvent("muga:cookie-gate:nonce", {
        detail: { nonce: _nonce },
      }));
    } catch {
      // document detached — silent
    }
  }
  dispatchNonceOnce();

  function dispatchGate(enabled) {
    try {
      document.dispatchEvent(new CustomEvent("muga:cookie-gate", {
        detail: { enabled: !!enabled, nonce: _nonce },
      }));
    } catch {
      // document detached or CustomEvent unavailable — silent. Harmless
      // no-op on Firefox too, where no MAIN-world listener exists at all.
    }
  }

  // ── Firefox MV2 direct reject path (no world:"MAIN" available) ──────────
  //
  // Firefox content scripts can reach the page's real objects via
  // `window.wrappedJSObject` (the CSP-immune pattern already proven by
  // history-defuser.js's page-world history wrap). No `exportFunction` is
  // needed here — we only READ `wrappedJSObject.OneTrust` and CALL its
  // `RejectAll` method, we don't install anything onto the page.
  let _fxGateOpen = false;
  let _fxActed = false;
  let _fxObserver = null;

  function fxCollectSignals() {
    let hasOneTrustGlobal = false;
    let hasRejectAllFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const ot = wrapped && wrapped.OneTrust;
      hasOneTrustGlobal = typeof ot === "object" && ot !== null;
      hasRejectAllFn = hasOneTrustGlobal && typeof ot.RejectAll === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasBannerDom = false;
    let hasRejectHandlerDom = false;
    try {
      hasBannerDom = !!(
        document.getElementById("onetrust-banner-sdk") ||
        document.getElementById("onetrust-consent-sdk")
      );
      hasRejectHandlerDom = !!document.getElementById("onetrust-reject-all-handler");
    } catch {
      // ignore
    }
    let hasActiveGroupsGlobal = false;
    try {
      hasActiveGroupsGlobal = typeof window.wrappedJSObject.OnetrustActiveGroups === "string";
    } catch {
      // ignore
    }
    let hasCookiebotGlobal = false;
    let hasSubmitCustomConsentFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cb = wrapped && wrapped.Cookiebot;
      hasCookiebotGlobal = typeof cb === "object" && cb !== null;
      hasSubmitCustomConsentFn = hasCookiebotGlobal && typeof cb.submitCustomConsent === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCybotDialogDom = false;
    try {
      hasCybotDialogDom = !!document.getElementById("CybotCookiebotDialog");
    } catch {
      // ignore
    }
    let hasConsentObjectGlobal = false;
    let hasResponseBooleanGlobal = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cb = wrapped && wrapped.Cookiebot;
      hasConsentObjectGlobal = hasCookiebotGlobal && typeof cb.consent === "object";
      hasResponseBooleanGlobal = hasCookiebotGlobal && typeof cb.hasResponse === "boolean";
    } catch {
      // ignore
    }
    let hasDidomiGlobal = false;
    let hasSetUserDisagreeToAllFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const di = wrapped && wrapped.Didomi;
      hasDidomiGlobal = typeof di === "object" && di !== null;
      hasSetUserDisagreeToAllFn = hasDidomiGlobal && typeof di.setUserDisagreeToAll === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasDidomiHostDom = false;
    try {
      hasDidomiHostDom = !!document.getElementById("didomi-host");
    } catch {
      // ignore
    }
    let hasGetCurrentUserStatusFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const di = wrapped && wrapped.Didomi;
      hasGetCurrentUserStatusFn = hasDidomiGlobal && typeof di.getCurrentUserStatus === "function";
    } catch {
      // ignore
    }
    // CookieYes (#1120): unlike the three adapters above, the reject call
    // is a BARE global (`wrappedJSObject.performBannerAction`), not a
    // method on a vendor-namespaced object. Both bare globals are checked
    // directly — see the dual-mandatory-signal rationale on
    // detectCookieYes in cookie-noise-mainworld.js / cmp-adapters.js.
    let hasGetCkyConsentFn = false;
    let hasPerformBannerActionFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      hasGetCkyConsentFn = wrapped && typeof wrapped.getCkyConsent === "function";
      hasPerformBannerActionFn = wrapped && typeof wrapped.performBannerAction === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCkyConsentContainerDom = false;
    let hasCkyOverlayDom = false;
    let hasCkyConsentBarDom = false;
    try {
      hasCkyConsentContainerDom = !!document.querySelector(".cky-consent-container");
      hasCkyOverlayDom = !!document.querySelector(".cky-overlay");
      hasCkyConsentBarDom = !!document.querySelector(".cky-consent-bar");
    } catch {
      // ignore
    }
    // Sourcepoint (#1123): __tcfapi is the generic IAB TCF surface every
    // TCF-compliant CMP exposes (including Didomi above), so it can never
    // be the sole mandatory anchor on its own — see the dual-mandatory
    // rationale on detectSourcepoint above. Reached via wrappedJSObject,
    // same Xray-safety pattern as the other Firefox signal reads above.
    let hasTcfApiFn = false;
    try {
      hasTcfApiFn = typeof window.wrappedJSObject.__tcfapi === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasSpMessageContainerDom = false;
    let hasSpPrivacyMgmtIframeDom = false;
    let hasSpProdIframeDom = false;
    let hasSpProdScriptDom = false;
    try {
      hasSpMessageContainerDom = !!document.querySelector('div[id^="sp_message_container"]');
      hasSpPrivacyMgmtIframeDom = !!document.querySelector('iframe[src*="privacy-mgmt.com"]');
      hasSpProdIframeDom = !!document.querySelector('iframe[src*="sp-prod.net"]');
      hasSpProdScriptDom = !!document.querySelector('script[src*="sp-prod.net"]');
    } catch {
      // ignore
    }
    // Usercentrics (#1121): window.UC_UI is the drop-in banner's
    // vendor-namespaced global, reached via wrappedJSObject — same
    // Xray-safety pattern as the other Firefox signal reads above. Do NOT
    // key off __tcfapi or an __ucCmp global — those are the generic-TCF /
    // headless-SDK surfaces, not this signal.
    let hasUcUiGlobal = false;
    let hasDenyAllConsentsFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const uc = wrapped && wrapped.UC_UI;
      hasUcUiGlobal = typeof uc === "object" && uc !== null;
      hasDenyAllConsentsFn = hasUcUiGlobal && typeof uc.denyAllConsents === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasUsercentricsRootDom = false;
    try {
      hasUsercentricsRootDom = !!document.getElementById("usercentrics-root");
    } catch {
      // ignore
    }
    let hasIsInitializedFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const uc = wrapped && wrapped.UC_UI;
      hasIsInitializedFn = hasUcUiGlobal && typeof uc.isInitialized === "function";
    } catch {
      // ignore
    }
    // Cookie Information: window.CookieInformation is a vendor-namespaced
    // global, reached via wrappedJSObject — same Xray-safety pattern as the
    // other Firefox signal reads above. Do NOT key off the generic __tcfapi
    // surface (hasTcfApiFn, already collected above) — this vendor's TCF
    // surface is opt-in per site and is Sourcepoint's dual-mandatory
    // anchor, not this adapter's.
    let hasCookieInformationGlobal = false;
    let hasDeclineAllCategoriesFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const ci = wrapped && wrapped.CookieInformation;
      hasCookieInformationGlobal = typeof ci === "object" && ci !== null;
      hasDeclineAllCategoriesFn = hasCookieInformationGlobal && typeof ci.declineAllCategories === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCoiOverlayDom = false;
    let hasCoiConsentBannerDom = false;
    let hasCoiSummeryDom = false;
    let hasCoiBannerWrapperDom = false;
    let hasCoiConsentSummaryDom = false;
    try {
      hasCoiOverlayDom = !!document.getElementById("coiOverlay");
      hasCoiConsentBannerDom = !!document.getElementById("coiConsentBanner");
      hasCoiSummeryDom = !!document.getElementById("coiSummery");
      hasCoiBannerWrapperDom = !!document.getElementById("coi-banner-wrapper");
      hasCoiConsentSummaryDom = !!document.querySelector(".coi-consent-summary");
    } catch {
      // ignore
    }
    // CookieScript: the reject call lives on window.CookieScript.instance,
    // not directly on the vendor global, reached via wrappedJSObject — same
    // Xray-safety pattern as the other Firefox signal reads above. The
    // vendor global itself can be EITHER an object OR a callable function
    // with `.instance` hung off it (real-site verification found
    // cookie-script.com ships the function-shaped variant) — allow both
    // shapes for the global itself; `.instance` and `.rejectAllAction`
    // remain the real, strictly object/function-typed discriminators, so
    // this does not loosen detection against any other CMP.
    let hasCookieScriptGlobal = false;
    let hasCookieScriptInstance = false;
    let hasRejectAllActionFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cs = wrapped && wrapped.CookieScript;
      hasCookieScriptGlobal = (typeof cs === "object" || typeof cs === "function") && cs !== null;
      const instance = hasCookieScriptGlobal && cs.instance;
      hasCookieScriptInstance = typeof instance === "object" && instance !== null;
      hasRejectAllActionFn = hasCookieScriptInstance && typeof instance.rejectAllAction === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCookiescriptInjectedDom = false;
    let hasCookiescriptDescriptionDom = false;
    try {
      hasCookiescriptInjectedDom = !!document.getElementById("cookiescript_injected");
      hasCookiescriptDescriptionDom = !!document.getElementById("cookiescript_description");
    } catch {
      // ignore
    }
    // tarteaucitron: the reject call lives on window.tarteaucitron.userInterface,
    // not directly on the vendor global, reached via wrappedJSObject — same
    // Xray-safety pattern as the other Firefox signal reads above. Null-safe
    // staged checks, not a naive chained typeof — hasTarteaucitronUserInterface
    // must be confirmed an object BEFORE probing .respondAll.
    let hasTarteaucitronGlobal = false;
    let hasTarteaucitronUserInterface = false;
    let hasRespondAllFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const tac = wrapped && wrapped.tarteaucitron;
      hasTarteaucitronGlobal = typeof tac === "object" && tac !== null;
      const ui = hasTarteaucitronGlobal && tac.userInterface;
      hasTarteaucitronUserInterface = typeof ui === "object" && ui !== null;
      hasRespondAllFn = hasTarteaucitronUserInterface && typeof ui.respondAll === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasTarteaucitronRootDom = false;
    let hasTarteaucitronAlertBigDom = false;
    let hasTarteaucitronBackDom = false;
    let hasTarteaucitronModalOpenDom = false;
    try {
      hasTarteaucitronRootDom = !!document.getElementById("tarteaucitronRoot");
      hasTarteaucitronAlertBigDom = !!document.getElementById("tarteaucitronAlertBig");
      hasTarteaucitronBackDom = !!document.getElementById("tarteaucitronBack");
      hasTarteaucitronModalOpenDom = !!(document.body && document.body.classList.contains("tarteaucitron-modal-open"));
    } catch {
      // ignore
    }
    // consentmanager.net: window.cmpmngr is the vendor-specific global,
    // window.__cmp is the legacy IAB TCF v1.1 generic reject surface,
    // reached via wrappedJSObject — same Xray-safety pattern as the other
    // Firefox signal reads above. Do NOT key detection off __cmp alone —
    // see the dual-anchor discrimination rationale above detectConsentmanager.
    let hasCmpMngrGlobal = false;
    let hasCmpFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const cm = wrapped && wrapped.cmpmngr;
      hasCmpMngrGlobal = typeof cm === "object" && cm !== null;
      hasCmpFn = wrapped && typeof wrapped.__cmp === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
    }
    let hasCmpBoxDom = false;
    let hasCmpWelcomeBtnYesDom = false;
    let hasCmpWelcomeBtnNoDom = false;
    let hasCmpBoxBtnDom = false;
    try {
      hasCmpBoxDom = !!document.getElementById("cmpbox");
      hasCmpWelcomeBtnYesDom = !!document.getElementById("cmpwelcomebtnyes");
      hasCmpWelcomeBtnNoDom = !!document.getElementById("cmpwelcomebtnno");
      hasCmpBoxBtnDom = !!document.querySelector("#cmpbox .cmpboxbtn");
    } catch {
      // ignore
    }
    return {
      hasOneTrustGlobal,
      hasRejectAllFn,
      hasBannerDom,
      hasActiveGroupsGlobal,
      hasRejectHandlerDom,
      hasCookiebotGlobal,
      hasSubmitCustomConsentFn,
      hasCybotDialogDom,
      hasConsentObjectGlobal,
      hasResponseBooleanGlobal,
      hasDidomiGlobal,
      hasSetUserDisagreeToAllFn,
      hasDidomiHostDom,
      hasGetCurrentUserStatusFn,
      hasGetCkyConsentFn,
      hasPerformBannerActionFn,
      hasCkyConsentContainerDom,
      hasCkyOverlayDom,
      hasCkyConsentBarDom,
      hasTcfApiFn,
      hasSpMessageContainerDom,
      hasSpPrivacyMgmtIframeDom,
      hasSpProdIframeDom,
      hasSpProdScriptDom,
      hasUcUiGlobal,
      hasDenyAllConsentsFn,
      hasUsercentricsRootDom,
      hasIsInitializedFn,
      hasCookieInformationGlobal,
      hasDeclineAllCategoriesFn,
      hasCoiOverlayDom,
      hasCoiConsentBannerDom,
      hasCoiSummeryDom,
      hasCoiBannerWrapperDom,
      hasCoiConsentSummaryDom,
      hasCookieScriptGlobal,
      hasCookieScriptInstance,
      hasRejectAllActionFn,
      hasCookiescriptInjectedDom,
      hasCookiescriptDescriptionDom,
      hasTarteaucitronGlobal,
      hasTarteaucitronUserInterface,
      hasRespondAllFn,
      hasTarteaucitronRootDom,
      hasTarteaucitronAlertBigDom,
      hasTarteaucitronBackDom,
      hasTarteaucitronModalOpenDom,
      hasCmpMngrGlobal,
      hasCmpFn,
      hasCmpBoxDom,
      hasCmpWelcomeBtnYesDom,
      hasCmpWelcomeBtnNoDom,
      hasCmpBoxBtnDom,
    };
  }

  // Post-reject dismissal confirmation (#1123 / reject() honesty follow-up).
  // PURELY OBSERVATIONAL: the reject has already fired and _fxActed/
  // fxStopObserver have already run — this never changes that. Vendor
  // banners clear ASYNCHRONOUSLY (the SDK reacts to the reject call on a
  // later task), so this polls a bounded window for the banner to disappear
  // and warns ONCE if it never does — surfacing a silent "API fired but did
  // not dismiss" drift (the exact gap the Sourcepoint DOM-click fallback
  // exists for). Fail-safe: any error in the banner check is treated as
  // "gone" (no spurious warning).
  const REJECT_CONFIRM_WINDOW_MS = 3000;
  const REJECT_CONFIRM_INTERVAL_MS = 250;
  function confirmRejectDismissal(adapterId, isBannerGone) {
    const deadline = Date.now() + REJECT_CONFIRM_WINDOW_MS;
    const tick = () => {
      let gone = true;
      try {
        gone = !!isBannerGone();
      } catch {
        gone = true;
      }
      if (gone) return; // confirmed dismissal — stay silent
      if (Date.now() >= deadline) {
        try {
          console.warn(
            "[MUGA] cookie-consent: " + adapterId +
            " reject fired but its banner did not clear within " +
            REJECT_CONFIRM_WINDOW_MS + "ms (possible vendor-API drift)"
          );
        } catch {
          // console unavailable — nothing else to do.
        }
        return;
      }
      setTimeout(tick, REJECT_CONFIRM_INTERVAL_MS);
    };
    tick();
  }

  // Selector-driven "is the banner gone" predicate shared by every Tier-1
  // adapter's confirmRejectDismissal() call below. "Gone" = no element
  // matching `selector` has a layout box (removed from the DOM counts as
  // gone; hidden via display:none/visibility etc. also collapses
  // getClientRects() to empty, so that counts as gone too).
  function bannerGoneBy(selector) {
    return () => {
      const nodes = document.querySelectorAll(selector);
      for (const el of nodes) {
        try {
          if (!el.getClientRects || el.getClientRects().length > 0) return false;
        } catch {
          return false;
        }
      }
      return true; // no element, or all matched elements have no layout box
    };
  }

  function fxRunDispatcher() {
    if (_fxActed || !_fxGateOpen) return;
    const signals = fxCollectSignals();
    if (canRejectOneTrust(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.OneTrust.RejectAll();
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("onetrust", bannerGoneBy("#onetrust-banner-sdk"));
      fxStopObserver();
      return;
    }
    // Tier 1: Cookiebot API adapter (#1118). Same literal-false-only reject
    // call as the Chrome MAIN-world caller — see cookie-noise-mainworld.js.
    if (canRejectCookiebot(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.Cookiebot.submitCustomConsent(false, false, false);
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("cookiebot", bannerGoneBy("#CybotCookiebotDialog"));
      fxStopObserver();
      return;
    }
    // Tier 1: Didomi API adapter (#1119). Same zero-argument, synchronous
    // reject-call shape as OneTrust.RejectAll() — see cookie-noise-mainworld.js.
    if (canRejectDidomi(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.Didomi.setUserDisagreeToAll();
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("didomi", bannerGoneBy("#didomi-host"));
      fxStopObserver();
      return;
    }
    // Tier 1: CookieYes API adapter (#1120). Same dual-mandatory-signal
    // detection and literal "reject"-only argument as the Chrome
    // MAIN-world caller — see cookie-noise-mainworld.js.
    if (canRejectCookieYes(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.performBannerAction("reject");
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("cookieyes", bannerGoneBy(".cky-consent-container, .cky-consent-bar"));
      fxStopObserver();
      return;
    }
    // Tier 1: Sourcepoint API adapter (#1123). Same fire-and-forget,
    // synchronous _fxActed + fxStopObserver() shape as the Chrome
    // MAIN-world caller — see cookie-noise-mainworld.js. postRejectAll's
    // async callback is optional-log-only and never gates control flow.
    if (canRejectSourcepoint(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.__tcfapi("postRejectAll", 2, (success) => {
          void success; // fire-and-forget — log only, never gates control flow
        });
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // Tier 1: Usercentrics API adapter (#1121). Same fire-and-forget,
    // synchronous _fxActed + fxStopObserver() shape as the Chrome
    // MAIN-world caller — see cookie-noise-mainworld.js. denyAllConsents()
    // returns a Promise; .catch(() => {}) swallows any floating rejection
    // and the promise is never awaited.
    if (canRejectUsercentrics(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.UC_UI.denyAllConsents().catch(() => {});
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("usercentrics", bannerGoneBy("#usercentrics-root"));
      fxStopObserver();
      return;
    }
    // Tier 1: Cookie Information API adapter. Same zero-argument,
    // synchronous reject-call shape as OneTrust.RejectAll() /
    // Didomi.setUserDisagreeToAll() — see cookie-noise-mainworld.js.
    if (canRejectCookieInformation(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.CookieInformation.declineAllCategories();
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal(
        "cookieinformation",
        bannerGoneBy("#coiOverlay, #coiConsentBanner, #coiSummery, #coi-banner-wrapper")
      );
      fxStopObserver();
      return;
    }
    // Tier 1: CookieScript API adapter. Same zero-argument, synchronous
    // reject-call shape as the adapters above — see cookie-noise-mainworld.js.
    if (canRejectCookieScript(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.CookieScript.instance.rejectAllAction();
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("cookiescript", bannerGoneBy("#cookiescript_injected"));
      fxStopObserver();
      return;
    }
    // Tier 1: tarteaucitron API adapter. Same zero-argument-shape family as
    // the adapters above, except respondAll takes one literal argument:
    // `false` denies every registered service — see
    // cookie-noise-mainworld.js for the full rationale.
    if (canRejectTarteaucitron(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.tarteaucitron.userInterface.respondAll(false);
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("tarteaucitron", bannerGoneBy("#tarteaucitronRoot, #tarteaucitronAlertBig"));
      fxStopObserver();
      return;
    }
    // Tier 1: consentmanager.net API adapter. Same literal-`0`,
    // fire-and-forget shape as the Chrome MAIN-world caller — see
    // cookie-noise-mainworld.js. setConsent's callback is optional-log-only
    // and never gates control flow.
    if (canRejectConsentmanager(signals)) {
      _fxActed = true;
      try {
        window.wrappedJSObject.__cmp("setConsent", 0, () => {}, true);
      } catch {
        // A throwing page global must never break the page.
      }
      confirmRejectDismissal("consentmanager", bannerGoneBy("#cmpbox"));
      fxStopObserver();
      return;
    }
  }

  // Bounded give-up window (#1027) — Firefox mirror of the MAIN-world
  // caller's give-up (see content/cookie-noise-mainworld.js for the full
  // rationale). Most pages never show a OneTrust banner; without a give-up
  // the observer + dispatcher would run per-mutation for the whole page
  // lifetime. Fail-closed: giving up just disconnects, never acts.
  const FX_GIVE_UP_AFTER_DOM_READY_MS = 10000;
  let _fxGiveUpArmed = false;
  let _fxGiveUpTimer = null;
  // Unconditional fallback timer (FIX C) — see fxArmGiveUp() below.
  let _fxGiveUpFallbackTimer = null;

  function fxArmGiveUp() {
    if (_fxGiveUpArmed) return;
    _fxGiveUpArmed = true;
    const schedule = () => {
      _fxGiveUpTimer = setTimeout(() => {
        _fxGiveUpTimer = null;
        if (!_fxActed) fxStopObserver();
      }, FX_GIVE_UP_AFTER_DOM_READY_MS);
    };
    if (document.readyState === "loading") {
      // Bounded fallback (FIX C, all_frames:true): a frame that never
      // reaches DOMContentLoaded at all (e.g. a pending subresource that
      // never settles in a sandboxed child frame) would otherwise never
      // arm `schedule` above, leaving the observer running for the whole
      // page lifetime. This fallback fires unconditionally on the SAME
      // give-up window, independent of `schedule`'s own timer — both just
      // call the idempotent fxStopObserver(), so no harm if
      // DOMContentLoaded eventually does fire and both timers end up
      // disconnecting.
      _fxGiveUpFallbackTimer = setTimeout(() => {
        _fxGiveUpFallbackTimer = null;
        if (!_fxActed) fxStopObserver();
      }, FX_GIVE_UP_AFTER_DOM_READY_MS);
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  }

  function fxStartObserver() {
    if (_fxObserver || _fxActed) return;
    if (!document || !document.documentElement) return;
    try {
      _fxObserver = new MutationObserver(() => fxRunDispatcher());
      _fxObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _fxObserver = null;
    }
    fxArmGiveUp();
  }

  function fxStopObserver() {
    if (_fxGiveUpTimer !== null) {
      clearTimeout(_fxGiveUpTimer);
      _fxGiveUpTimer = null;
    }
    if (_fxGiveUpFallbackTimer !== null) {
      clearTimeout(_fxGiveUpFallbackTimer);
      _fxGiveUpFallbackTimer = null;
    }
    // Reset so a later gate reopen (Settings toggle) arms a fresh window.
    _fxGiveUpArmed = false;
    if (!_fxObserver) return;
    try {
      _fxObserver.disconnect();
    } catch {
      // already disconnected
    }
    _fxObserver = null;
  }

  let _isFirefox = false;
  try {
    const mv = chrome.runtime.getManifest && chrome.runtime.getManifest().manifest_version;
    _isFirefox = mv === 2;
  } catch {
    // leave false — the Chrome MAIN-world path stays the default assumption.
  }

  // ── Disabled-state gate (prefs) ──────────────────────────────────────────
  // Inline copy of computeCookieGate from src/lib/cmp-adapters.js — content
  // scripts cannot use ES module imports (AGENTS.md). Kept byte-identical
  // (modulo indentation) to the library copy by
  // tests/unit/cookie-noise-sync.test.mjs. The pure helper takes injected
  // deps so it stays unit-testable in src/lib/; the thin call site below
  // supplies this world's real location + cleaner exemption predicate. The
  // `modeActive` deps field is a boolean already pre-validated upstream
  // (background/service-worker.js, via settings-schema.js's closed-enum
  // check) — this gate never reads or compares the raw mode string itself.
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

  // Content scripts cannot import ES modules (AGENTS.md), so this pure
  // helper is hand-copied, byte-identical (modulo indentation), from
  // src/lib/frame-host.js. Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. Resolves the TOP frame's real
  // hostname (cookie-consent-all-frames FIX A) — needed because
  // `location.hostname` inside a cross-origin consent-or-pay dialog iframe
  // is the CMP vendor's OWN host, not the paused site's.
  // @sync:frame-host:start
  function resolveTopFrameHostname(env) {
    const e = env && typeof env === "object" ? env : {};

    if (e.isTopFrame === true) {
      return typeof e.hostname === "string" && e.hostname.length > 0 ? e.hostname : null;
    }

    // Child frame: only Chrome/Edge expose `location.ancestorOrigins` (a
    // DOMStringList of ancestor frame origins, outermost-last — the LAST
    // entry is always the top frame's origin, regardless of nesting depth).
    // Firefox has no equivalent API — an absent or empty list is
    // UNDETERMINABLE, not "no ancestors", and must fail closed to `null`.
    const ancestorOrigins = e.ancestorOrigins;
    const length =
      ancestorOrigins && typeof ancestorOrigins.length === "number" ? ancestorOrigins.length : 0;
    if (length === 0) return null;

    const topOrigin = ancestorOrigins[length - 1];
    if (typeof topOrigin !== "string" || topOrigin.length === 0) return null;

    try {
      const hostname = new URL(topOrigin).hostname;
      return hostname.length > 0 ? hostname : null;
    } catch {
      // Malformed origin string — never throw, fail closed instead.
      return null;
    }
  }
  // @sync:frame-host:end

  // Content scripts cannot import ES modules (AGENTS.md), so these four
  // functions are hand-copied, byte-identical (modulo indentation and the
  // `export` keyword, which content scripts cannot use), from
  // src/lib/cleaner.js. Kept in sync by tests/unit/cookie-noise-sync.test.mjs.
  // Deliberately PREFS-ONLY (no `window`/`document` access) so this copy is
  // safe to run in a child frame, unlike `window.__mugaCleaner.isSiteFullyExempt`
  // (never attached outside the top frame — see computeGate() below).
  // @sync:site-exempt:start
  /**
   * Parses a blacklist/whitelist entry string into a structured object.
   * Supported formats:
   *   "amazon.es"                      → { domain: "amazon.es", param: null, value: null }
   *   "amazon.es::tag::youtuber-21"    → { domain: "amazon.es", param: "tag", value: "youtuber-21" }
   *
   * @param {string} entry
   * @returns {{ domain: string, param: string|null, value: string|null }}
   */
  function parseListEntry(entry) {
    const parts = entry.split("::");
    return {
      domain: parts[0]?.trim().replace(/^www\./, "").toLowerCase() || "",
      // Lowercase the param KEY: tracker param names are lowercase in practice and
      // the match sites compare it directly, so a mixed-case entry (e.g. "Tag")
      // otherwise silently never matched a real "tag" query param (audit #1048).
      // The VALUE stays case-sensitive (affiliate tag values are matched verbatim).
      param:  parts[1]?.trim().toLowerCase() || null,
      value:  parts[2]?.trim() || null,
    };
  }

  /**
   * Strips a single trailing dot from a hostname (#1095).
   *
   * `amazon.com.` is a valid FQDN — the trailing dot denotes the DNS root —
   * and browsers/resolvers treat it as IDENTICAL to `amazon.com`. Every
   * host-matching helper in this module already strips a leading `www.`
   * before comparing; without the same treatment for a trailing dot, a page
   * on `www.amazon.com.` bypassed affiliate-pattern lookup entirely
   * (`getPatternsForHost` found zero patterns, so stripAllAffiliates left a
   * foreign tag completely untouched) and slipped past domain-only
   * whitelist/blacklist/pause-by-site entries for `amazon.com`.
   *
   * @param {string} hostname
   * @returns {string}
   */
  function stripTrailingDot(hostname) {
    return hostname.endsWith(".") ? hostname.slice(0, -1) : hostname;
  }

  /**
   * Returns true if a host matches a parsed list entry's domain.
   */
  function domainMatches(hostname, entryDomain) {
    const host = stripTrailingDot(hostname).replace(/^www\./, "");
    return host === entryDomain || host.endsWith("." + entryDomain);
  }

  /**
   * Returns true if a hostname is FULLY EXEMPT from MUGA - the single
   * choke-point predicate that governs every cleaning mechanism, present and
   * future (#allowlist-full-inert). Originally added as
   * isSiteExemptFromActiveDefense (#1006) to cover only the four active-defense
   * content scripts (window.name defuser, history defuser, DOM link rewriter,
   * click rewriter), all of which gate on a single muga:history-gate event.
   * Renamed and promoted to the general-purpose exemption check consulted by
   * processUrl (JS cleaning, #allowlist-full-inert) and by the service worker's
   * DNR allow-rule sync (network-layer cleaning) - so "domain is allowlisted"
   * now means MUGA has literally no effect on that domain through ANY path,
   * not a per-mechanism opt-out that has to be re-added every time a new
   * mechanism ships.
   *
   * A site counts as exempt when a DOMAIN-ONLY whitelist entry matches the
   * host (bare "example.com"). A param-scoped entry ("example.com::tag::x")
   * does NOT count - that only protects one affiliate value, it is not a
   * "leave this site alone" signal. (The legacy `example.com::disabled`
   * per-site-pause blacklist syntax was removed entirely - a domain is
   * exempted ONLY via a domain-only whitelist entry now.)
   *
   * Reuses parseListEntry/domainMatches rather than reimplementing domain
   * matching (a separate cleanup is tracked in #1005).
   *
   * Defensive: returns false for any falsy or malformed input so a missing or
   * corrupt prefs object never accidentally grants an exemption. Fail-safe
   * direction matters here: MUGA must stay ACTIVE unless we are sure the user
   * opted the site out - a bug in this predicate must never globally disable
   * cleaning.
   *
   * @param {string} hostname - the current page's hostname.
   * @param {{ whitelist?: string[], blacklist?: string[] }} prefs
   * @returns {boolean}
   */
  function isSiteFullyExempt(hostname, prefs) {
    if (!hostname || typeof hostname !== "string" || !prefs || typeof prefs !== "object") return false;

    const whitelist = Array.isArray(prefs.whitelist) ? prefs.whitelist : [];
    for (const raw of whitelist) {
      let entry;
      try {
        entry = parseListEntry(raw);
      } catch {
        continue;
      }
      if (!entry.domain || entry.param) continue;
      if (domainMatches(hostname, entry.domain)) return true;
    }

    return false;
  }
  // @sync:site-exempt:end

  function computeGate(prefs) {
    // isSiteFullyExempt is a standalone function on __mugaCleaner (no `this`
    // dependency — see src/lib/cleaner.js), so passing the reference detached
    // is safe. modeActive is precomputed by the service worker's getPrefs
    // response (see the @sync:cookie-gate comment above) — read verbatim,
    // never recomputed here.
    let isTopFrame = true;
    try {
      isTopFrame = window.top === window.self;
    } catch {
      // An unexpected/sandboxed frame shape that cannot even report its own
      // top-frame identity — treat as a child frame so the fail-closed path
      // below runs instead of trusting this frame's own (possibly
      // CMP-vendor) hostname.
      isTopFrame = false;
    }

    if (isTopFrame) {
      const cleaner = window.__mugaCleaner;
      return computeCookieGate(prefs, {
        modeActive: !!(prefs && prefs.modeActive === true),
        hostname: location.hostname,
        isSiteFullyExempt:
          cleaner && typeof cleaner.isSiteFullyExempt === "function" ? cleaner.isSiteFullyExempt : null,
      });
    }

    // Child frame (e.g. a cross-origin consent-or-pay dialog iframe):
    // `window.__mugaCleaner` is never attached here (cleaner-bundle.js
    // stays top-frame-only) and `location.hostname` is the CMP vendor's OWN
    // host, not the paused site's — so the top-frame branch above cannot be
    // reused as-is. Resolve the REAL top-frame hostname instead (see the
    // @sync:frame-host block above) and check the per-site exemption with a
    // per-frame-safe, prefs-only copy of the real predicate (see the
    // @sync:site-exempt block above) instead of window.__mugaCleaner.
    let ancestorOrigins = null;
    try {
      ancestorOrigins = location.ancestorOrigins;
    } catch {
      ancestorOrigins = null;
    }
    const topHostname = resolveTopFrameHostname({ isTopFrame: false, ancestorOrigins });
    return computeCookieGate(prefs, {
      modeActive: !!(prefs && prefs.modeActive === true),
      hostname: topHostname,
      // FAIL-CLOSED: an undeterminable top host (topHostname === null — no
      // location.ancestorOrigins support, e.g. Firefox, or an empty list)
      // is treated as EXEMPT — the gate stays shut rather than risk opening
      // it against the user's own per-site pause.
      isSiteFullyExempt: (hostname, prefsArg) =>
        hostname === null ? true : isSiteFullyExempt(hostname, prefsArg),
    });
  }

  // ── DOM candidate collection (shared by the Sourcepoint reject-click fallback) ─
  //
  // These candidate-scanning primitives were originally written for the
  // consent-or-pay-wall accept-click mechanism (cookie-consent-paywall-accept),
  // which has been REMOVED — MUGA never clicks a consent-granting control on
  // the user's behalf. They are KEPT here, unmodified, because the Sourcepoint
  // reject-click DOM fallback (runSpRejectClickDispatcher, further below)
  // reuses this SAME neutral DOM candidate scanner (collectAcceptCandidates)
  // to find its own "Reject all" (spChoice "13") / "Options" (spChoice "12")
  // targets — this scanner only enumerates buttons/links and their
  // sp_choice_type_<N> class + actionability; it does not decide what to
  // click. The "accept"-prefixed names are a leftover from the retired
  // feature (a follow-up rename is tracked separately, out of scope for this
  // removal so the diff stays limited to deleting the accept-click DECISION
  // logic).
  //
  // `a[href]` is included so a reject rendered as a plain anchor (not a
  // <button> or role=button) is still collected.
  // NOTE: this scan sees only this document's OWN (light-DOM) nodes;
  // controls inside a closed shadow root are NOT reachable from a content
  // script and are therefore invisible to this collector.
  const ACCEPT_CANDIDATE_SELECTOR =
    'button, a[href], a[role="button"], [role="button"], input[type="button"], input[type="submit"]';

  function acceptAccessibleName(el) {
    try {
      const aria = typeof el.getAttribute === "function" ? el.getAttribute("aria-label") : null;
      if (typeof aria === "string" && aria.trim().length > 0) return aria;
      if (typeof el.value === "string" && el.value.trim().length > 0) return el.value;
      return typeof el.textContent === "string" ? el.textContent : "";
    } catch {
      return "";
    }
  }

  // The control's FULL text: accessible name + value + visible textContent,
  // concatenated. Retained from the retired accept-click mechanism — no
  // longer consumed by anything in this file (the reject-click resolvers
  // below only need `text`/`spChoice`/`actionable`), but kept on the
  // candidate shape rather than special-cased out, per the file-header note
  // above. Never throws.
  function acceptFullText(el) {
    try {
      const parts = [];
      const aria = typeof el.getAttribute === "function" ? el.getAttribute("aria-label") : null;
      if (typeof aria === "string") parts.push(aria);
      if (typeof el.value === "string") parts.push(el.value);
      if (typeof el.textContent === "string") parts.push(el.textContent);
      return parts.join(" ");
    } catch {
      return "";
    }
  }

  // Actionability = connected to the layout (getClientRects non-empty —
  // false for display:none/detached) and not disabled. A CSS-hidden decoy
  // (visibility:hidden or opacity:0 with layout box) can still have
  // non-empty client rects; getClientRects().length===0 catches the common
  // display:none / detached-node case, which is the shape a hostile page
  // would use to hide a decoy button from view without removing it. This
  // mirrors the same conservative bar every other DOM-driven signal in this
  // file uses — never throws.
  function isAcceptCandidateActionable(el) {
    try {
      if (el.disabled === true) return false;
      if (typeof el.getClientRects === "function" && el.getClientRects().length === 0) return false;
      return true;
    } catch {
      return false;
    }
  }

  // The Sourcepoint decision-button marker: the "<N>" suffix of the element's
  // `sp_choice_type_<N>` class ("11"/"12"/"13"/"9"/"link"/…), or "" when the
  // element carries no such class (an incidental link, NOT a decision control).
  // findSpRejectTarget / findSpOpenSettingsTarget (below) scope their own
  // decisions to elements where this is non-empty ("13"/"12" respectively),
  // so incidental privacy/imprint/FAQ/login links never enter their veto.
  // Never throws.
  function acceptSpChoice(el) {
    try {
      const cls = typeof el.getAttribute === "function" ? el.getAttribute("class") : null;
      if (typeof cls !== "string" || cls.length === 0) return "";
      for (const token of cls.split(/\s+/)) {
        if (token.indexOf("sp_choice_type_") === 0) return token.slice("sp_choice_type_".length);
      }
      return "";
    } catch {
      return "";
    }
  }

  // The candidate's raw `id` attribute, or "" when absent/unreadable. Retained
  // from the retired accept-click mechanism (it used to key its own Didomi
  // decision-button resolver off the `didomi-notice-` id prefix) — no longer
  // consumed by anything in this file, but kept on the candidate shape rather
  // than special-cased out, per the file-header note above. Never throws.
  function acceptElementId(el) {
    try {
      const id = typeof el.getAttribute === "function" ? el.getAttribute("id") : el.id;
      return typeof id === "string" ? id : "";
    } catch {
      return "";
    }
  }

  function collectAcceptCandidates() {
    const candidates = [];
    try {
      const nodes = document.querySelectorAll(ACCEPT_CANDIDATE_SELECTOR);
      for (const el of nodes) {
        candidates.push({
          text: acceptAccessibleName(el),
          fullText: acceptFullText(el),
          spChoice: acceptSpChoice(el),
          id: acceptElementId(el),
          actionable: isAcceptCandidateActionable(el),
          ref: el,
        });
      }
    } catch {
      // document not ready / detached — leave candidates empty (NOOP).
    }
    return candidates;
  }

  // ── Sourcepoint reject-click dispatch (DOM fallback for postRejectAll) ────
  //
  // Real-site verification found the __tcfapi postRejectAll call above does
  // not dismiss Sourcepoint's own UI on real deployments even when the call
  // fires without throwing — a gap the Tier-1 API adapter's confidence gate
  // alone cannot close (see findSpRejectTarget's rationale, hand-copied from
  // src/lib/cmp-adapters.js below). This is a SEPARATE, additive action: a
  // DOM `element.click()` on the wall's own "Reject all" control, reusing
  // the SAME neutral DOM candidate scanner the consent-or-pay accept-click
  // feature already collects (collectAcceptCandidates — it only enumerates
  // buttons/links and their sp_choice_type_<N> class; it does not decide
  // what to click, findSpRejectTarget does, and that resolver only ever
  // recognizes "13"). Runs for BOTH browsers, in every frame
  // (all_frames:true already covers this file) — a DOM click needs neither
  // a page-authored global nor the MAIN world. Gated by the SAME reject
  // master gate (computeGate) as the Tier-1 API ladder above, so it never
  // runs outside the reject-only feature's own enabled/onboarded/not-exempt
  // gate. Marks itself acted ONLY after a real click on a confirmed single
  // target — never on mere detection, so a no-op is never reported as a
  // success.

  // @sync:cmp-sp-reject-click:start
  const SP_REJECT_ALL_CHOICE = "13";

  function findSpRejectTarget(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    const matches = [];
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (candidate.spChoice !== SP_REJECT_ALL_CHOICE) continue;
      if (candidate.actionable !== true) continue;
      matches.push(candidate);
    }
    if (matches.length === 0) return { status: "noop", target: null };
    if (matches.length > 1) return { status: "ambiguous", target: null };
    return { status: "single", target: matches[0] };
  }

  // SP multi-layer: some walls expose ONLY a "12" ("Options"/"Manage") control,
  // with the real "Reject all" one layer deeper inside the panel it opens.
  // Resolves the SINGLE actionable "12" to click, but ONLY on an options-ONLY
  // wall — i.e. when NO other actionable decision control (a broad-consent "11",
  // a pay "9", a direct reject "13", or any other sp_choice button) is present. A
  // wall that also shows broad-consent/pay/reject is a consent-or-pay wall, not
  // the options-only shape this deep-reject traversal targets, so it is left
  // alone (the reject engine's direct "13" path and the separate consent-or-pay
  // feature own those). Opening a settings panel never grants consent
  // (monotone-safe); the deeper "13" is clicked by findSpRejectTarget on the next
  // observer pass. Incidental non-decision candidates (no sp_choice class, e.g.
  // privacy/imprint links) are ignored. Any ambiguity (zero, or more than one
  // actionable "12") is a NOOP. Pure; never throws.
  const SP_OPEN_SETTINGS_CHOICE = "12";

  function findSpOpenSettingsTarget(candidates) {
    const list = Array.isArray(candidates) ? candidates : [];
    const options = [];
    let otherActionableDecision = false;
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      if (candidate.actionable !== true) continue;
      if (typeof candidate.spChoice !== "string" || candidate.spChoice.length === 0) continue;
      if (candidate.spChoice === SP_OPEN_SETTINGS_CHOICE) {
        options.push(candidate);
      } else {
        // Any OTHER actionable sp_choice decision control (broad-consent "11",
        // pay "9", direct reject "13", …) means this is NOT an options-only wall.
        otherActionableDecision = true;
      }
    }
    if (otherActionableDecision) return { status: "noop", target: null };
    if (options.length === 0) return { status: "noop", target: null };
    if (options.length > 1) return { status: "ambiguous", target: null };
    return { status: "single", target: options[0] };
  }
  // @sync:cmp-sp-reject-click:end

  // ── Tier 2 declarative reject-click rule data (#1027, Slice 1) ────────────
  //
  // Hand-copied, byte-for-byte modulo indentation (and the `export` keyword,
  // which content scripts cannot use — see the site-exempt precedent above),
  // from src/lib/cmp-tier2-rules.js. Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. See that file's docblock for the
  // full reject-only-vocabulary rationale and the seed-candidate
  // verification notes — not repeated here to avoid a second place that can
  // drift out of prose sync with the data itself.
  // @sync:cmp-tier2-rules:start
  const TIER2_RULES = Object.freeze([
    /**
     * Complianz (cmplz) — API-less, WordPress plugin. Real-site verification
     * (doaj.org, 2026-07) confirmed a direct first-layer reject control:
     * `.cmplz-deny` inside `#cmplz-cookiebanner-container`.
     *
     * Complianz's "manage options" / "save preferences" panel was
     * DELIBERATELY NOT modeled as an `openSettings` two-step hop: that panel's
     * save action commits whatever categories are CURRENTLY checked, which is
     * not guaranteed to be reject/necessary-only — the toggles' default state
     * is theme/installation-dependent, so clicking "save" there could commit
     * an unknown consent state. That is not an unambiguous reject path, so
     * this rule stays single-layer for Slice 1 and relies solely on the
     * direct `.cmplz-deny` control (fail-closed no-op if that control is
     * absent on a given installation).
     */
    Object.freeze({
      id: "complianz",
      present: Object.freeze(["#cmplz-cookiebanner-container"]),
      reject: Object.freeze([".cmplz-deny"]),
      openSettings: Object.freeze([]),
    }),

    /**
     * Cookie Notice (dFactory) — API-less, WordPress plugin. Refuse control:
     * `#cn-refuse-cookie` (also reachable via
     * `.cn-set-cookie[data-cookie-set="refuse"]`, kept as a single curated
     * selector for now — see the id-selector precedent above). The refuse
     * button is an admin-optional setting: not every installation renders it.
     * That is fine — the fail-closed 0-match branch already no-ops gracefully
     * when it is absent, exactly like every other rule here.
     */
    Object.freeze({
      id: "cookie-notice",
      present: Object.freeze(["#cookie-notice"]),
      reject: Object.freeze(["#cn-refuse-cookie"]),
      openSettings: Object.freeze([]),
    }),
  ]);
  // @sync:cmp-tier2-rules:end

  // ── Tier 2 fail-closed reject resolution (#1027, Slice 1) ─────────────────
  //
  // Hand-copied, byte-for-byte modulo indentation, from
  // src/lib/cmp-adapters.js. Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. See that file's docblock
  // (immediately above `resolveTier2Reject`) for the full fail-closed
  // contract rationale — byte-identical shape/return-type contract to
  // findSpRejectTarget above. Pure; never throws.
  // @sync:cmp-tier2:start
  function resolveTier2Reject(presentMatched, rejectCandidates) {
    if (presentMatched !== true) return { status: "noop", target: null };
    const list = Array.isArray(rejectCandidates) ? rejectCandidates : [];
    // Filter malformed entries (null/non-object) so garbage fails CLOSED to
    // noop, byte-identical to findSpRejectTarget — a null/non-element never
    // becomes a "single" clickable target the PR-2 dispatcher would trust.
    const matches = [];
    for (const candidate of list) {
      if (!candidate || typeof candidate !== "object") continue;
      matches.push(candidate);
    }
    if (matches.length === 0) return { status: "noop", target: null };
    if (matches.length > 1) return { status: "ambiguous", target: null };
    return { status: "single", target: matches[0] };
  }
  // @sync:cmp-tier2:end

  // ── Tier 2 runtime semantic click-veto (#1027, Slice 2 / PR A) ────────────
  //
  // Hand-copied, byte-for-byte modulo indentation, from
  // src/lib/cmp-tier2-veto.js. Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. See that file's docblock for the
  // full load-bearing-safety-piece rationale, the BUNDLED-never-remote
  // word-list distribution decision, and the guard-exemption note — not
  // repeated here to avoid a second place that can drift out of prose sync
  // with the data itself. Pure; never throws. Wired into
  // runTier2RejectDispatcher below, immediately before both the reject and
  // openSettings `.click()` calls.
  // @sync:cmp-tier2-veto:start

  /**
   * NFC-normalizes, lowercases, and whitespace-collapses `raw` into `name`;
   * `folded` additionally strips Unicode combining diacritical marks (NFD +
   * `/\p{Diacritic}/gu` removal) so accented and de-accented variants of the
   * same word both match. Never throws — a non-string or unnormalizable input
   * degrades to `{ name: "", folded: "" }`, which the empty-name veto branch
   * in computeClickVeto below already treats as VETO.
   * @param {*} raw
   * @returns {{ name: string, folded: string }}
   */
  function normalizeAccessibleName(raw) {
    const input = typeof raw === "string" ? raw : "";
    let name = "";
    try {
      name = input.normalize("NFC").toLowerCase().replace(/\s+/g, " ").trim();
    } catch {
      name = "";
    }
    let folded = name;
    try {
      folded = name.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim();
    } catch {
      folded = name;
    }
    return { name, folded };
  }

  // Accept/agree words across every covered locale (en/es/de/fr/it/ja/pt).
  // THIS IS THE VETO'S TEETH — see the file docblock's guard-exemption note
  // above and the teeth test in tests/unit/cmp-tier2-veto.test.mjs. Any word
  // here matching a candidate's accessible name is an ABSOLUTE veto,
  // role-independent — it wins over every allowlist match below. Every entry
  // is already lowercase and diacritic-normalized (no combining marks), the
  // same shape normalizeAccessibleName produces, so a bare `folded` substring
  // check is always sufficient regardless of the source text's own accents.
  const DENY_WORDS = Object.freeze([
    // en
    "accept",
    "accept all",
    "allow",
    "allow all",
    "agree",
    "i agree",
    // es
    "aceptar",
    "aceptar todo",
    "aceptar todas",
    // de
    "akzeptieren",
    "alle akzeptieren",
    "zustimmen",
    // fr
    "accepter",
    "tout accepter",
    // it
    "accetta",
    "accetta tutti",
    // pt
    "aceitar",
    "aceitar tudo",
    // ja
    "同意",
    "同意する",
    "すべてに同意",
  ]);

  // Reject/decline/necessary-only words — REQUIRED positive match for a
  // `role: "reject"` candidate (see computeClickVeto's precedence below).
  // DISJOINT from DENY_WORDS by construction (asserted by the teeth test).
  const REJECT_WORDS = Object.freeze([
    // en
    "reject",
    "reject all",
    "decline",
    "decline all",
    "refuse",
    "necessary only",
    "only necessary",
    // es
    "rechazar",
    "rechazar todo",
    "solo necesarias",
    // de
    "ablehnen",
    "alle ablehnen",
    "nur notwendige",
    // fr
    "refuser",
    "tout refuser",
    // it
    "rifiuta",
    "solo necessari",
    // pt
    "recusar",
    "somente necessarios",
    // ja
    "拒否",
    "すべて拒否",
  ]);

  // Settings/preferences/manage words — REQUIRED positive match for a
  // `role: "openSettings"` candidate. DISJOINT from DENY_WORDS by
  // construction (asserted by the teeth test).
  const SETTINGS_WORDS = Object.freeze([
    // en
    "settings",
    "preferences",
    "manage",
    "manage options",
    "customize",
    "more options",
    // es
    "ajustes",
    "preferencias",
    "gestionar",
    // de
    "einstellungen",
    "verwalten",
    // fr
    "gerer",
    "personnaliser",
    // it
    "impostazioni",
    "personalizza",
    // pt
    "gerenciar",
    // ja
    "設定",
    "環境設定",
  ]);

  /**
   * The veto's bundled word lists (see the file docblock's "Word-list
   * distribution" section — BUNDLED, never remote). Passed explicitly into
   * computeClickVeto (dependency-injected, not read as a module-level
   * implicit global) so the pure function stays trivially testable with
   * adversarial fixtures.
   */
  const VETO_WORDS = Object.freeze({
    deny: DENY_WORDS,
    reject: REJECT_WORDS,
    settings: SETTINGS_WORDS,
  });

  /**
   * True when the normalized `w` occurs as a substring of either `name` or
   * `folded` — substring (not word-boundary/token) matching is deliberate: it
   * is the safe/greedy direction for the absolute DENY set ("Accept only
   * necessary" must veto on the substring "accept" even though "necessary" is
   * a reject hint) and is the only workable form for CJK scripts, which have
   * no word boundaries. Never throws.
   * @param {string} name
   * @param {string} folded
   * @param {ReadonlyArray<string>} words
   * @returns {boolean}
   */
  function matchesAny(name, folded, words) {
    const list = Array.isArray(words) ? words : [];
    for (const w of list) {
      if (typeof w !== "string" || w.length === 0) continue;
      if (name.indexOf(w) !== -1 || folded.indexOf(w) !== -1) return true;
    }
    return false;
  }

  /**
   * The semantic click-veto (LOAD-BEARING — see the file docblock). Decides
   * whether a candidate control is safe to click, given its full accessible
   * name and the ROLE the dispatcher intends to use it for.
   *
   * Precedence, evaluated strictly in order — first hit returns:
   *   1. Empty/whitespace-only `accessibleName` -> VETO ("empty-name").
   *      Covers icon-only / no-text controls and detached/hostile elements.
   *   2. Any `wordLists.deny` entry matches -> VETO ("accept-word"). Absolute
   *      and role-independent — wins over every allowlist match below.
   *   3. Role-specific positive gate (the required word must be PRESENT):
   *      - `role === "reject"` requires a `wordLists.reject` match, else
   *        VETO ("no-reject-word").
   *      - `role === "openSettings"` requires a `wordLists.settings` match,
   *        else VETO ("no-settings-word").
   *      - any other role -> VETO ("unknown-role").
   *   4. Otherwise -> ALLOW ("ok").
   *
   * The only allow path is: non-empty name AND no accept word AND the role's
   * required positive word present. Absence of signal always resolves to "do
   * not click" — fail-closed by construction. Pure; never throws.
   * @param {*} accessibleName
   * @param {"reject"|"openSettings"} role
   * @param {{ deny: ReadonlyArray<string>, reject: ReadonlyArray<string>, settings: ReadonlyArray<string> }} wordLists
   * @returns {ClickVetoResult}
   */
  function computeClickVeto(accessibleName, role, wordLists) {
    const { name, folded } = normalizeAccessibleName(accessibleName);
    if (name.length === 0) return { allow: false, reason: "empty-name" };

    const lists = wordLists && typeof wordLists === "object" ? wordLists : {};
    if (matchesAny(name, folded, lists.deny)) return { allow: false, reason: "accept-word" };

    if (role === "reject") {
      if (!matchesAny(name, folded, lists.reject)) return { allow: false, reason: "no-reject-word" };
      return { allow: true, reason: "ok" };
    }
    if (role === "openSettings") {
      if (!matchesAny(name, folded, lists.settings)) return { allow: false, reason: "no-settings-word" };
      return { allow: true, reason: "ok" };
    }
    return { allow: false, reason: "unknown-role" };
  }
  // @sync:cmp-tier2-veto:end

  let _spRejectActed = false;
  let _spPmOpened = false;
  let _spRejectGateOpen = false;
  let _spRejectObserver = null;
  const SP_REJECT_GIVE_UP_AFTER_DOM_READY_MS = 10000;
  let _spRejectGiveUpArmed = false;
  let _spRejectGiveUpTimer = null;
  let _spRejectGiveUpFallbackTimer = null;

  // NOTE (real-site probe finding): the `sp_message_container` DOM anchor
  // (the pure detectSourcepoint signal's DOM anchor above) and the actual
  // `sp_choice_type_*` decision buttons do NOT necessarily share a frame —
  // on real deployments (e.g. pinknews.co.uk) the container div renders in
  // the TOP frame while the buttons render inside a separate cross-origin
  // `cdn.privacy-mgmt.com` iframe. A same-frame container pre-check would
  // silently block the dispatcher in the exact frame where the buttons
  // live. This dispatcher therefore does NOT gate on that DOM anchor at
  // all — it relies entirely on findSpRejectTarget's own specificity
  // (exactly one actionable "13" candidate) as the safety/precision
  // filter — no DOM pre-check of its own either (all_frames:true already
  // means every frame pays this same, cheap, per-frame query cost).
  //
  // MULTI-LAYER (#1123 follow-up): a wall exposing ONLY choice type "12"
  // ("Options"/"Manage"/settings) — where the real reject control sits one
  // layer deeper, behind that secondary panel — is handled below via
  // findSpOpenSettingsTarget: the dispatcher clicks the single actionable "12"
  // ONCE (guarded by _spPmOpened) to reveal the deeper panel, then the observer
  // re-enters and clicks the revealed single "13" through findSpRejectTarget.
  // Opening the panel is monotone-safe (never grants consent) and success is
  // still only marked after a real "13" click, so a panel that never surfaces
  // a reachable "13" stays a fail-closed NOOP.
  function runSpRejectClickDispatcher() {
    if (_spRejectActed || !_spRejectGateOpen) return;
    const candidates = collectAcceptCandidates();
    const result = findSpRejectTarget(candidates);
    if (result.status === "single") {
      _spRejectActed = true;
      try {
        result.target.ref.click();
      } catch {
        // A throwing/hostile page element must never break the page.
      }
      spRejectStopObserver();
      return;
    }
    // Multi-layer (#1123 follow-up): no directly-reachable "13". If the wall
    // exposes exactly one actionable "12" ("Options"/"Manage") and we have not
    // opened the privacy-manager panel yet, click it ONCE to reveal the deeper
    // "Reject all". Opening a settings panel never grants consent
    // (monotone-safe), so this is NOT marked as success and the observer stays
    // live: the panel's render re-enters this dispatcher, which then clicks the
    // revealed single "13" via the branch above. A panel that never surfaces a
    // "13" resolves to a fail-closed NOOP when the bounded give-up window tears
    // the observer down.
    if (_spPmOpened) return;
    const settings = findSpOpenSettingsTarget(candidates);
    if (settings.status !== "single") return;
    _spPmOpened = true;
    try {
      settings.target.ref.click();
    } catch {
      // A throwing/hostile page element must never break the page.
    }
  }

  // Bounded give-up window — same rationale and shape as the reject
  // dispatchers' own give-up windows above.
  function spRejectArmGiveUp() {
    if (_spRejectGiveUpArmed) return;
    _spRejectGiveUpArmed = true;
    const schedule = () => {
      _spRejectGiveUpTimer = setTimeout(() => {
        _spRejectGiveUpTimer = null;
        if (!_spRejectActed) spRejectStopObserver();
      }, SP_REJECT_GIVE_UP_AFTER_DOM_READY_MS);
    };
    if (document.readyState === "loading") {
      _spRejectGiveUpFallbackTimer = setTimeout(() => {
        _spRejectGiveUpFallbackTimer = null;
        if (!_spRejectActed) spRejectStopObserver();
      }, SP_REJECT_GIVE_UP_AFTER_DOM_READY_MS);
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  }

  function spRejectStartObserver() {
    if (_spRejectObserver || _spRejectActed) return;
    if (!document || !document.documentElement) return;
    try {
      _spRejectObserver = new MutationObserver(() => runSpRejectClickDispatcher());
      _spRejectObserver.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _spRejectObserver = null;
    }
    spRejectArmGiveUp();
  }

  function spRejectStopObserver() {
    if (_spRejectGiveUpTimer !== null) {
      clearTimeout(_spRejectGiveUpTimer);
      _spRejectGiveUpTimer = null;
    }
    if (_spRejectGiveUpFallbackTimer !== null) {
      clearTimeout(_spRejectGiveUpFallbackTimer);
      _spRejectGiveUpFallbackTimer = null;
    }
    _spRejectGiveUpArmed = false;
    if (!_spRejectObserver) return;
    try {
      _spRejectObserver.disconnect();
    } catch {
      // already disconnected
    }
    _spRejectObserver = null;
  }

  // ── Tier 2 declarative reject-click dispatch (#1027, Slice 1) ─────────────
  //
  // Isolated-world DOM query-and-click execution for the reject-only
  // click-rule registry hand-copied above (@sync:cmp-tier2-rules /
  // @sync:cmp-tier2) — see Decision 3 in
  // openspec/changes/cookie-consent-tier2/design.md. This is the DOM half
  // deferred from src/lib/cmp-adapters.js's makeTier2Adapter: that pure
  // adapter's canReject(signals) reads signals.tier2Confirmed[rule.id],
  // exercised only by decideAction's truth-table unit tests in
  // tests/unit/cmp-adapters.test.mjs — this content script never calls
  // decideAction itself, exactly like the Tier-1 ladder above
  // (canRejectOneTrust() etc. are called directly, not through decideAction
  // either — decideAction has no runtime call site anywhere in this
  // extension, only a lib-level pure decision surface exercised by tests).
  // This dispatcher IS the thing that would produce a true
  // tier2Confirmed[rule.id] signal: it queries the DOM for the rule's
  // curated `present`/`reject` selectors, resolves the fail-closed match via
  // the hand-copied resolveTier2Reject above, and clicks the confirmed
  // single target directly.
  //
  // Mirrors runSpRejectClickDispatcher's shape closely (reuses
  // collectAcceptCandidates() for actionable, classified DOM nodes; a
  // confirmed reject click is the ONLY thing that marks a rule acted; the
  // open-settings hop is monotone-safe and never marks acted). Unlike the
  // single-CMP SP dispatcher, TIER2_RULES holds MULTIPLE independent rules
  // (Complianz, Cookie Notice) — every piece of per-rule state below is
  // therefore keyed by rule.id, not a single flat boolean.
  //
  // Never-accept invariant: `rule.reject` / `rule.openSettings` are the ONLY
  // selector lists this dispatcher ever queries or clicks — there is no
  // field on a Tier2Rule capable of expressing a broad-consent path (see
  // src/lib/cmp-tier2-rules.js's file docblock), so this dispatcher cannot
  // click one even by a future editing mistake without first inventing a
  // new field name, which the structural guard in
  // tests/unit/cmp-adapters.test.mjs scans for. Fail-closed everywhere: no
  // confirmed reject candidate means this loop iteration does nothing and
  // leaves the banner exactly as-is.

  const _tier2Acted = {};
  const _tier2PmOpened = {};
  const _tier2Warned = {};
  let _tier2GateOpen = false;
  let _tier2Observer = null;
  const TIER2_GIVE_UP_AFTER_DOM_READY_MS = 10000;
  let _tier2GiveUpArmed = false;
  let _tier2GiveUpTimer = null;
  let _tier2GiveUpFallbackTimer = null;

  // Drift signal (Decision 7): console-only, warned at most ONCE per rule id
  // — no network call, no telemetry. Covers BOTH: (a) a confirmed reject was
  // clicked but the banner never cleared, and (b) the banner's `present`
  // anchor stayed matched but the resolver never reached a confirmed single
  // reject through the whole give-up window (selector drift on either the
  // reject or the present anchor).
  function tier2WarnDrift(ruleId) {
    if (_tier2Warned[ruleId]) return;
    _tier2Warned[ruleId] = true;
    try {
      console.warn(
        "[MUGA] cookie-consent: tier2:" + ruleId +
        " reject clicked but banner did not clear (possible selector drift)"
      );
    } catch {
      // console unavailable — nothing else to do.
    }
  }

  // Semantic click-veto drift signal (#1027, Slice 2 / PR A): console-only,
  // warned at most ONCE per rule id + role — no network call, no telemetry
  // (mirrors tier2WarnDrift's contract above). Fires when computeClickVeto
  // rejects a resolved single target (bundled OR remote-origin selector
  // resolved to an element whose accessible name did not clear the veto) so
  // a maintainer can investigate selector drift without MUGA ever clicking
  // the ambiguous/mislabeled control.
  const _tier2VetoWarned = {};
  function tier2WarnVeto(ruleId, role, reason) {
    const key = ruleId + ":" + role;
    if (_tier2VetoWarned[key]) return;
    _tier2VetoWarned[key] = true;
    try {
      console.warn(
        "[MUGA] cookie-consent: tier2:" + ruleId + " " + role +
        " click vetoed (" + reason + ") — target not clicked"
      );
    } catch {
      // console unavailable — nothing else to do.
    }
  }

  // Reuses the SAME bounded-poll mechanics as confirmRejectDismissal above
  // (REJECT_CONFIRM_WINDOW_MS / REJECT_CONFIRM_INTERVAL_MS, deadline +
  // interval, fail-safe-gone-on-error) — confirmRejectDismissal's own
  // message text is pinned to the Tier-1 vendor-API-drift wording, so this
  // small parallel version reuses its constants/timing but reports through
  // tier2WarnDrift's Tier-2-specific wording instead of parameterizing the
  // shared helper.
  function confirmTier2RejectDismissal(ruleId, isBannerGone) {
    const deadline = Date.now() + REJECT_CONFIRM_WINDOW_MS;
    const tick = () => {
      let gone = true;
      try {
        gone = !!isBannerGone();
      } catch {
        gone = true;
      }
      if (gone) return; // confirmed dismissal — stay silent
      if (Date.now() >= deadline) {
        tier2WarnDrift(ruleId);
        return;
      }
      setTimeout(tick, REJECT_CONFIRM_INTERVAL_MS);
    };
    tick();
  }

  function tier2BannerGoneBy(rule) {
    return bannerGoneBy(rule.present.join(","));
  }

  // Filters collectAcceptCandidates()'s full button/link scan down to the
  // ones matching one of `selectors` (a rule's `reject` or `openSettings`
  // list) AND currently actionable — the same conservative bar
  // findSpRejectTarget applies inline above; resolveTier2Reject itself stays
  // generic/caller-agnostic (see its docblock in src/lib/cmp-adapters.js),
  // so this filtering lives at the call site, not inside the shared
  // @sync:cmp-tier2 resolver. Never throws.
  function tier2FilterCandidates(candidates, selectors) {
    if (!Array.isArray(selectors) || selectors.length === 0) return [];
    const joined = selectors.join(",");
    const matches = [];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object" || candidate.actionable !== true) continue;
      try {
        if (candidate.ref && typeof candidate.ref.matches === "function" && candidate.ref.matches(joined)) {
          matches.push(candidate);
        }
      } catch {
        // A malformed/hostile selector or element must never break the page.
      }
    }
    return matches;
  }

  function runTier2RejectDispatcher() {
    if (!_tier2GateOpen) return;
    const candidates = collectAcceptCandidates();
    for (const rule of TIER2_RULES) {
      if (_tier2Acted[rule.id]) continue;
      let present = false;
      try {
        present = !!document.querySelector(rule.present.join(","));
      } catch {
        present = false;
      }
      if (!present) continue;
      const rejectCandidates = tier2FilterCandidates(candidates, rule.reject);
      const result = resolveTier2Reject(present, rejectCandidates);
      if (result.status === "single") {
        // Semantic click-veto (#1027, Slice 2 / PR A — LOAD-BEARING): a
        // confirmed single target is STILL not clicked unless its real
        // accessible name clears the veto. This is what makes a
        // wrongly-matched selector (bundled OR remote) safe — see
        // computeClickVeto's docblock above. Fail-closed: on veto, do NOT
        // set _tier2Acted (a later observer pass may find a correctly
        // labelled target once the DOM settles), warn once, and continue —
        // the existing bounded give-up window already stops churn.
        const veto = computeClickVeto(result.target.fullText, "reject", VETO_WORDS);
        if (!veto.allow) {
          tier2WarnVeto(rule.id, "reject", veto.reason);
          continue;
        }
        _tier2Acted[rule.id] = true;
        try {
          result.target.ref.click();
        } catch {
          // A throwing/hostile page element must never break the page.
        }
        confirmTier2RejectDismissal(rule.id, tier2BannerGoneBy(rule));
        continue;
      }
      // Single open-settings hop (Decision 3 / SP precedent): monotone-safe
      // (opening a settings panel grants nothing), NOT marked acted — the
      // revealed reject control is re-resolved on the observer's next pass.
      // Dormant for both Slice-1 seed rules (openSettings: []).
      if (_tier2PmOpened[rule.id]) continue;
      const openCandidates = tier2FilterCandidates(candidates, rule.openSettings);
      if (openCandidates.length !== 1) continue;
      // Same semantic click-veto, role "openSettings" — its OWN positive
      // settings-word set, stricter than Slice 1's "monotone-safe, click
      // freely" stance because Slice 2 adds untrusted remote selectors to
      // this same code path. Fail-closed: on veto, do NOT set
      // _tier2PmOpened, warn once, continue.
      const openVeto = computeClickVeto(openCandidates[0].fullText, "openSettings", VETO_WORDS);
      if (!openVeto.allow) {
        tier2WarnVeto(rule.id, "openSettings", openVeto.reason);
        continue;
      }
      _tier2PmOpened[rule.id] = true;
      try {
        openCandidates[0].ref.click();
      } catch {
        // A throwing/hostile page element must never break the page.
      }
    }
  }

  // Bounded give-up window — same rationale and shape as the other
  // dispatchers' give-up windows above. Also the drift-check point for
  // "resolver stuck at noop through the give-up window" (Decision 7): a rule
  // whose `present` anchor is still matched but never reached a confirmed
  // reject click gets exactly one console warning here before the observer
  // disconnects.
  function tier2ArmGiveUp() {
    if (_tier2GiveUpArmed) return;
    _tier2GiveUpArmed = true;
    const giveUp = () => {
      for (const rule of TIER2_RULES) {
        if (_tier2Acted[rule.id]) continue;
        let present = false;
        try {
          present = !!document.querySelector(rule.present.join(","));
        } catch {
          present = false;
        }
        if (present) tier2WarnDrift(rule.id);
      }
      tier2StopObserver();
    };
    const schedule = () => {
      _tier2GiveUpTimer = setTimeout(giveUp, TIER2_GIVE_UP_AFTER_DOM_READY_MS);
    };
    if (document.readyState === "loading") {
      _tier2GiveUpFallbackTimer = setTimeout(giveUp, TIER2_GIVE_UP_AFTER_DOM_READY_MS);
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  }

  function tier2StartObserver() {
    if (_tier2Observer) return;
    if (!document || !document.documentElement) return;
    try {
      _tier2Observer = new MutationObserver(() => runTier2RejectDispatcher());
      _tier2Observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _tier2Observer = null;
    }
    tier2ArmGiveUp();
  }

  function tier2StopObserver() {
    if (_tier2GiveUpTimer !== null) {
      clearTimeout(_tier2GiveUpTimer);
      _tier2GiveUpTimer = null;
    }
    if (_tier2GiveUpFallbackTimer !== null) {
      clearTimeout(_tier2GiveUpFallbackTimer);
      _tier2GiveUpFallbackTimer = null;
    }
    _tier2GiveUpArmed = false;
    if (!_tier2Observer) return;
    try {
      _tier2Observer.disconnect();
    } catch {
      // already disconnected
    }
    _tier2Observer = null;
  }

  function readPrefsAndGate() {
    try {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
        void chrome.runtime.lastError;
        const open = computeGate(prefs);
        // Always dispatch — harmless no-op on Firefox, where no MAIN-world
        // listener is ever loaded (no world:"MAIN" content script there).
        dispatchGate(open);
        if (_isFirefox) {
          _fxGateOpen = open;
          if (open) {
            fxRunDispatcher(); // initial sweep — the banner may already exist
            fxStartObserver();
          } else {
            fxStopObserver();
          }
        }
        // Sourcepoint reject-click DOM fallback — runs directly in THIS
        // world for BOTH browsers, gated by the SAME reject master gate
        // (`open`) as the Tier-1 API ladder above, independent of `_isFirefox`.
        _spRejectGateOpen = open;
        if (_spRejectGateOpen) {
          runSpRejectClickDispatcher(); // initial sweep — the wall may already exist
          spRejectStartObserver();
        } else {
          spRejectStopObserver();
        }
        // Tier 2 declarative reject-click dispatch — reuses the SAME reject
        // master gate (`open`) as the Tier-1 API ladder and the Sourcepoint
        // DOM fallback above; no separate Tier 2 toggle exists (Decision 4,
        // task 3.6). `open` already encodes cookieConsentMode === "reject-only"
        // (via deps.modeActive) AND not-allowlisted/exempted (via
        // isSiteFullyExempt) — see computeCookieGate above.
        _tier2GateOpen = open;
        if (_tier2GateOpen) {
          runTier2RejectDispatcher(); // initial sweep — the banner may already exist
          tier2StartObserver();
        } else {
          tier2StopObserver();
        }
      });
    } catch {
      // Extension context invalidated. Leave the gate closed.
    }
  }

  readPrefsAndGate();

  // Re-read on storage changes so toggling the feature in Settings closes
  // (or opens) the gate without a page reload.
  let _storageListenerInstalled = false;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    if (!_storageListenerInstalled) {
      _storageListenerInstalled = true;
      chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "sync") readPrefsAndGate();
      });
    }
  }
  } catch {
    // Frame-safety (all_frames:true): this guards only the SYNCHRONOUS
    // setup above — dispatchNonceOnce()'s call, readPrefsAndGate()'s
    // initial call, and the storage.onChanged listener REGISTRATION — in
    // ANY frame (top, same-origin iframe, cross-origin consent iframe,
    // ad/embed iframe, restricted/opaque frame), e.g. `document`/`chrome.*`
    // being unavailable in a sandboxed frame. It does NOT reach code that
    // runs from a LATER event-loop turn: the getPrefs sendMessage
    // callback, the MutationObserver callback, the give-up setTimeout
    // callback, and the storage.onChanged callback itself all fire after
    // this try block's dynamic extent has already ended — each of those is
    // individually wrapped fail-closed where it is defined above.
  }
})();
