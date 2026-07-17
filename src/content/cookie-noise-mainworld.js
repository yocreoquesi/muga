/**
 * MUGA: Cookie Consent Minimizer — main-world caller (#1027)
 *
 * Runs IN THE PAGE WORLD (`world: "MAIN"`) at `document_start`, Chrome
 * MV3 only, so it can reach a page-authored global directly
 * (`window.OneTrust.RejectAll()`). Mirrors the History Defuser dual-world
 * precedent (content/history-defuser-mainworld.js): a MAIN-world caller
 * paired with an isolated-world gatekeeper (content/cookie-noise.js) that
 * reads prefs and controls the gate via a nonce-gated CustomEvent
 * handshake — on a channel SEPARATE from `muga:history-gate`. This
 * feature's pref (`cookieConsentMode`, default "reject-only" for new
 * installs) is independent from `activeDefenseEnabled` (default ON);
 * sharing a gate would conflate two independent opt-ins.
 *
 * Firefox MV2 does NOT load this file at all (no `world: "MAIN"`
 * support). On Firefox the isolated-world companion performs the reject
 * call directly via `window.wrappedJSObject.OneTrust.RejectAll()` — see
 * content/cookie-noise.js.
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
 * Constraints for this file (main-world scripts):
 *   - No chrome.* APIs — no extension messaging in the page world.
 *   - No ES module imports. Runs as a classic script in the page world.
 */

(function () {
  "use strict";

  // Skip iframes — the OneTrust reject global lives in the top frame for
  // this feature's scope (MVP; see design doc "Deferred" section).
  if (window.self !== window.top) return;
  if (window.__mugaCookieNoise) return;
  window.__mugaCookieNoise = true;

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

  // Cookie Consent Minimizer — Didomi minimum-grant pilot (see the design
  // docs for the full mode name; this file's own structural guard forbids
  // spelling it outside the fenced region directly below). The two pure
  // functions in that fenced block are a hand-maintained COPY of the
  // sibling lib module's own same-named block (content scripts cannot use
  // ES module imports — AGENTS.md). Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. World-agnostic and pure — never
  // touches `window` itself; the dispatch region further below supplies
  // the real page-global reads.
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
  // Returns a validly-constructed minimum payload otherwise. Pure; never
  // throws (the getter calls themselves stay in the world-specific dispatch
  // region, wrapped there).
  function resolveDidomiMinimumStatus(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const requiredPurposeIds = extractRequiredIds(r.requiredPurposeIds);
    const requiredVendorIds = extractRequiredIds(r.requiredVendorIds);
    if (requiredPurposeIds === null || requiredVendorIds === null) return null;
    const allPurposeIds = extractDidomiIds(r.allPurposeIds);
    const allVendorIds = extractDidomiIds(r.allVendorIds);
    return buildMinimumPayload({ requiredPurposeIds, requiredVendorIds, allPurposeIds, allVendorIds });
  }
  // @sync:cmp-accept:end

  /**
   * Collects world-specific signals from the page's real globals/DOM.
   * Wrapped defensively: a hostile or broken page-authored getter on
   * `window.OneTrust` must never break the page or this script.
   */
  function collectSignals() {
    let hasOneTrustGlobal = false;
    let hasRejectAllFn = false;
    try {
      hasOneTrustGlobal = typeof window.OneTrust === "object" && window.OneTrust !== null;
      hasRejectAllFn = hasOneTrustGlobal && typeof window.OneTrust.RejectAll === "function";
    } catch {
      // Leave both false — fail-closed.
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
      // document not ready / detached — leave both false.
    }
    let hasActiveGroupsGlobal = false;
    try {
      hasActiveGroupsGlobal = typeof window.OnetrustActiveGroups === "string";
    } catch {
      // ignore
    }
    let hasCookiebotGlobal = false;
    let hasSubmitCustomConsentFn = false;
    try {
      hasCookiebotGlobal = typeof window.Cookiebot === "object" && window.Cookiebot !== null;
      hasSubmitCustomConsentFn =
        hasCookiebotGlobal && typeof window.Cookiebot.submitCustomConsent === "function";
    } catch {
      // Leave both false — fail-closed.
    }
    let hasCybotDialogDom = false;
    try {
      hasCybotDialogDom = !!document.getElementById("CybotCookiebotDialog");
    } catch {
      // document not ready / detached — leave false.
    }
    let hasConsentObjectGlobal = false;
    let hasResponseBooleanGlobal = false;
    try {
      hasConsentObjectGlobal = hasCookiebotGlobal && typeof window.Cookiebot.consent === "object";
      hasResponseBooleanGlobal = hasCookiebotGlobal && typeof window.Cookiebot.hasResponse === "boolean";
    } catch {
      // ignore
    }
    let hasDidomiGlobal = false;
    let hasSetUserDisagreeToAllFn = false;
    try {
      hasDidomiGlobal = typeof window.Didomi === "object" && window.Didomi !== null;
      hasSetUserDisagreeToAllFn =
        hasDidomiGlobal && typeof window.Didomi.setUserDisagreeToAll === "function";
    } catch {
      // Leave both false — fail-closed.
    }
    let hasDidomiHostDom = false;
    try {
      hasDidomiHostDom = !!document.getElementById("didomi-host");
    } catch {
      // document not ready / detached — leave false.
    }
    let hasGetCurrentUserStatusFn = false;
    try {
      hasGetCurrentUserStatusFn =
        hasDidomiGlobal && typeof window.Didomi.getCurrentUserStatus === "function";
    } catch {
      // ignore
    }
    // Didomi minimum-grant pilot signals: setCurrentUserStatus is the
    // granular grant-call surface; getRequiredPurposeIds/
    // getRequiredVendorIds report the vendor's OWN minimum-required ids;
    // getPurposes/getVendors report the vendor's OWN full registry (used
    // to build the "disable everything else" half of the minimum
    // payload). All five are typeof-checked only here — never invoked as
    // part of signal collection.
    let hasSetCurrentUserStatusFn = false;
    let hasGetRequiredPurposeIdsFn = false;
    let hasGetRequiredVendorIdsFn = false;
    let hasGetPurposesFn = false;
    let hasGetVendorsFn = false;
    try {
      hasSetCurrentUserStatusFn = hasDidomiGlobal && typeof window.Didomi.setCurrentUserStatus === "function";
      hasGetRequiredPurposeIdsFn = hasDidomiGlobal && typeof window.Didomi.getRequiredPurposeIds === "function";
      hasGetRequiredVendorIdsFn = hasDidomiGlobal && typeof window.Didomi.getRequiredVendorIds === "function";
      hasGetPurposesFn = hasDidomiGlobal && typeof window.Didomi.getPurposes === "function";
      hasGetVendorsFn = hasDidomiGlobal && typeof window.Didomi.getVendors === "function";
    } catch {
      // Leave all false — fail-closed.
    }
    // CookieYes (#1120): unlike the three adapters above, the reject call
    // is a BARE global (`window.performBannerAction`), not a method on a
    // vendor-namespaced object. Both bare globals are checked directly —
    // see the dual-mandatory-signal rationale on detectCookieYes above.
    let hasGetCkyConsentFn = false;
    let hasPerformBannerActionFn = false;
    try {
      hasGetCkyConsentFn = typeof window.getCkyConsent === "function";
      hasPerformBannerActionFn = typeof window.performBannerAction === "function";
    } catch {
      // Leave both false — fail-closed.
    }
    let hasCkyConsentContainerDom = false;
    let hasCkyOverlayDom = false;
    let hasCkyConsentBarDom = false;
    try {
      hasCkyConsentContainerDom = !!document.querySelector(".cky-consent-container");
      hasCkyOverlayDom = !!document.querySelector(".cky-overlay");
      hasCkyConsentBarDom = !!document.querySelector(".cky-consent-bar");
    } catch {
      // document not ready / detached — leave all false.
    }
    // Sourcepoint (#1123): __tcfapi is the generic IAB TCF surface every
    // TCF-compliant CMP exposes (including Didomi above), so it can never
    // be the sole mandatory anchor on its own — see the dual-mandatory
    // rationale on detectSourcepoint above.
    let hasTcfApiFn = false;
    try {
      hasTcfApiFn = typeof window.__tcfapi === "function";
    } catch {
      // Leave false — fail-closed.
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
      // document not ready / detached — leave all false.
    }
    // Usercentrics (#1121): window.UC_UI is the drop-in banner's
    // vendor-namespaced global. Do NOT key off __tcfapi or an __ucCmp
    // global — those are the generic-TCF / headless-SDK surfaces (a
    // separate, rarer Usercentrics integration mode), not this signal.
    let hasUcUiGlobal = false;
    let hasDenyAllConsentsFn = false;
    try {
      hasUcUiGlobal = typeof window.UC_UI === "object" && window.UC_UI !== null;
      hasDenyAllConsentsFn = hasUcUiGlobal && typeof window.UC_UI.denyAllConsents === "function";
    } catch {
      // Leave both false — fail-closed.
    }
    let hasUsercentricsRootDom = false;
    try {
      hasUsercentricsRootDom = !!document.getElementById("usercentrics-root");
    } catch {
      // document not ready / detached — leave false.
    }
    let hasIsInitializedFn = false;
    try {
      hasIsInitializedFn = hasUcUiGlobal && typeof window.UC_UI.isInitialized === "function";
    } catch {
      // ignore
    }
    // Cookie Information: window.CookieInformation is a vendor-namespaced
    // global. Do NOT key off the generic __tcfapi surface (hasTcfApiFn,
    // already collected above) — this vendor's TCF surface is opt-in per
    // site and is Sourcepoint's dual-mandatory anchor, not this adapter's.
    let hasCookieInformationGlobal = false;
    let hasDeclineAllCategoriesFn = false;
    try {
      hasCookieInformationGlobal =
        typeof window.CookieInformation === "object" && window.CookieInformation !== null;
      hasDeclineAllCategoriesFn =
        hasCookieInformationGlobal && typeof window.CookieInformation.declineAllCategories === "function";
    } catch {
      // Leave both false — fail-closed.
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
      // document not ready / detached — leave all false.
    }
    // CookieScript: the reject call lives on window.CookieScript.instance,
    // not directly on the vendor global — hasCookieScriptInstance must be
    // confirmed an object BEFORE probing .rejectAllAction, otherwise reading
    // a property off `undefined` would throw inside this try block (still
    // caught, but the intent is explicit here).
    let hasCookieScriptGlobal = false;
    let hasCookieScriptInstance = false;
    let hasRejectAllActionFn = false;
    try {
      hasCookieScriptGlobal = typeof window.CookieScript === "object" && window.CookieScript !== null;
      const instance = hasCookieScriptGlobal && window.CookieScript.instance;
      hasCookieScriptInstance = typeof instance === "object" && instance !== null;
      hasRejectAllActionFn = hasCookieScriptInstance && typeof instance.rejectAllAction === "function";
    } catch {
      // Leave all false — fail-closed.
    }
    let hasCookiescriptInjectedDom = false;
    let hasCookiescriptDescriptionDom = false;
    try {
      hasCookiescriptInjectedDom = !!document.getElementById("cookiescript_injected");
      hasCookiescriptDescriptionDom = !!document.getElementById("cookiescript_description");
    } catch {
      // document not ready / detached — leave both false.
    }
    // tarteaucitron: the reject call lives on window.tarteaucitron.userInterface,
    // not directly on the vendor global — hasTarteaucitronUserInterface must
    // be confirmed an object BEFORE probing .respondAll, otherwise reading a
    // property off `undefined` would throw inside this try block (still
    // caught, but the intent is explicit here). Null-safe staged checks, not
    // a naive chained typeof.
    let hasTarteaucitronGlobal = false;
    let hasTarteaucitronUserInterface = false;
    let hasRespondAllFn = false;
    try {
      hasTarteaucitronGlobal = typeof window.tarteaucitron === "object" && window.tarteaucitron !== null;
      const ui = hasTarteaucitronGlobal && window.tarteaucitron.userInterface;
      hasTarteaucitronUserInterface = typeof ui === "object" && ui !== null;
      hasRespondAllFn = hasTarteaucitronUserInterface && typeof ui.respondAll === "function";
    } catch {
      // Leave all false — fail-closed.
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
      // document not ready / detached — leave all false.
    }
    // consentmanager.net: window.cmpmngr is the vendor-specific global,
    // window.__cmp is the legacy IAB TCF v1.1 generic reject surface — do
    // NOT key detection off __cmp alone, see the dual-anchor discrimination
    // rationale above detectConsentmanager.
    let hasCmpMngrGlobal = false;
    let hasCmpFn = false;
    try {
      hasCmpMngrGlobal = typeof window.cmpmngr === "object" && window.cmpmngr !== null;
      hasCmpFn = typeof window.__cmp === "function";
    } catch {
      // Leave both false — fail-closed.
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
      // document not ready / detached — leave all false.
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
      hasSetCurrentUserStatusFn,
      hasGetRequiredPurposeIdsFn,
      hasGetRequiredVendorIdsFn,
      hasGetPurposesFn,
      hasGetVendorsFn,
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

  // Idempotency guard (#1027): once a decisive reject has fired, never
  // act again on this page load — repeated DOM mutations (e.g. the
  // banner's own removal animation) must not re-invoke RejectAll.
  let _acted = false;

  /**
   * Two-tier dispatcher. Tier 1 (API adapters) tried first; Tier 2
   * (declarative click-rule adapters) is an empty slot in this slice —
   * the loop shape exists so a later slice can populate it with no
   * dispatcher rewrite.
   */
  function runDispatcher() {
    if (_acted || !gateOpen()) return;
    const signals = collectSignals();
    // Tier 1: OneTrust API adapter.
    if (canRejectOneTrust(signals)) {
      _acted = true;
      try {
        window.OneTrust.RejectAll();
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: Cookiebot API adapter (#1118). Necessary cookies are
    // implicit/always-on in Cookiebot's model — the three positional
    // booleans (preferences, statistics, marketing) are always literal
    // `false`, never a variable, so this call structurally cannot grant
    // broad consent.
    if (canRejectCookiebot(signals)) {
      _acted = true;
      try {
        window.Cookiebot.submitCustomConsent(false, false, false);
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: Didomi API adapter (#1119). Same zero-argument, synchronous
    // reject-call shape as OneTrust.RejectAll() — setUserDisagreeToAll()
    // takes no consent-granting parameter at all.
    if (canRejectDidomi(signals)) {
      _acted = true;
      try {
        window.Didomi.setUserDisagreeToAll();
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: CookieYes API adapter (#1120). performBannerAction is a bare
    // global function, not a vendor-namespaced method — the dual-mandatory
    // detection gate (both getCkyConsent and performBannerAction present)
    // is what makes this a confident CookieYes match. The literal string
    // "reject" is the only argument this call site ever passes.
    if (canRejectCookieYes(signals)) {
      _acted = true;
      try {
        window.performBannerAction("reject");
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: Sourcepoint API adapter (#1123). postRejectAll is async
    // (callback-based), but this call site is fire-and-forget: the arrow
    // function below returns SYNCHRONOUSLY right after queuing the call —
    // _acted and stopObserver() fire synchronously right here, never gated
    // on the async callback's later result. The callback is optional-log-
    // only and must never re-trigger dispatch or flip _acted back.
    if (canRejectSourcepoint(signals)) {
      _acted = true;
      try {
        window.__tcfapi("postRejectAll", 2, (success) => {
          void success; // fire-and-forget — log only, never gates control flow
        });
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: Usercentrics API adapter (#1121). denyAllConsents() returns a
    // Promise (unlike every prior adapter here) — this call site is
    // fire-and-forget: .catch(() => {}) swallows any floating rejection,
    // and _acted + stopObserver() fire SYNCHRONOUSLY right after, never
    // awaited, never gating control flow on the promise settling.
    if (canRejectUsercentrics(signals)) {
      _acted = true;
      try {
        window.UC_UI.denyAllConsents().catch(() => {});
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: Cookie Information API adapter. Same zero-argument,
    // synchronous reject-call shape as OneTrust.RejectAll() /
    // Didomi.setUserDisagreeToAll() — declineAllCategories() takes no
    // consent-granting parameter at all.
    if (canRejectCookieInformation(signals)) {
      _acted = true;
      try {
        window.CookieInformation.declineAllCategories();
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: CookieScript API adapter. Same zero-argument, synchronous
    // reject-call shape as the adapters above — rejectAllAction() "rejects
    // all cookies except strictly necessary" per the vendor's own docs.
    if (canRejectCookieScript(signals)) {
      _acted = true;
      try {
        window.CookieScript.instance.rejectAllAction();
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: tarteaucitron API adapter. Same zero-argument-shape family as
    // the adapters above, except respondAll takes one literal argument:
    // `false` denies every registered service (the vendor's own "tout
    // refuser" button calls this exact function with the exact same
    // literal). Synchronous — a plain for-loop over tarteaucitron.job, no
    // Promise/callback.
    if (canRejectTarteaucitron(signals)) {
      _acted = true;
      try {
        window.tarteaucitron.userInterface.respondAll(false);
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Tier 1: consentmanager.net API adapter. setConsent's second argument
    // is the literal `0` (reject-all) — `1` would grant broad consent, so
    // this call site must never pass a variable there. Same fire-and-forget
    // family as the Sourcepoint adapter above: the callback fires in
    // practice but is optional-log-only and never gates control flow —
    // _acted and stopObserver() fire synchronously right after the call
    // returns.
    if (canRejectConsentmanager(signals)) {
      _acted = true;
      try {
        window.__cmp("setConsent", 0, () => {}, true);
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // Cookie Consent Minimizer — Didomi minimum-grant pilot, own fenced
    // region below (this file's structural guard forbids spelling the
    // mode name outside it). Reached ONLY after every Tier 1 reject
    // adapter above returned false for this page — i.e. a genuine hard
    // wall, mirroring cmp-adapters.js's decideAction "no-reject-path"
    // reason exactly. Double-gated by a boolean computed in the isolated
    // world from the user's real prefs (this world never reads prefs) and
    // relayed here over the same nonce-gated event channel as the reject
    // gate, AND the region's own signal check.
    // @sync:cmp-accept-dispatch:start
    if (_didomiMinimumGateOpen && canAttemptDidomiMinimumAccept(signals)) {
      _acted = true;
      try {
        const payload = resolveDidomiMinimumStatus({
          requiredPurposeIds: window.Didomi.getRequiredPurposeIds(),
          requiredVendorIds: window.Didomi.getRequiredVendorIds(),
          allPurposeIds: window.Didomi.getPurposes(),
          allVendorIds: window.Didomi.getVendors(),
        });
        if (payload) window.Didomi.setCurrentUserStatus(payload);
      } catch {
        // A throwing page global must never break the page's own script.
      }
      stopObserver();
      return;
    }
    // @sync:cmp-accept-dispatch:end
    // Tier 2: declarative click-rule adapters. Empty in this slice.
  }

  // ── Nonce handshake (separate channel: muga:cookie-gate) ────────────────
  // Mirrors the #811 pattern from history-defuser-mainworld.js on its own
  // channel. The isolated-world companion (content/cookie-noise.js)
  // generates the nonce and fires the one-shot muga:cookie-gate:nonce
  // event before dispatching any muga:cookie-gate control event.
  let _capturedNonce = null;
  function _onNonce(e) {
    if (e && e.detail && typeof e.detail.nonce === "string") {
      _capturedNonce = e.detail.nonce;
    }
    document.removeEventListener("muga:cookie-gate:nonce", _onNonce);
  }
  document.addEventListener("muga:cookie-gate:nonce", _onNonce);

  let _gateOpen = false;
  // Relayed from the isolated world (content/cookie-noise.js), which is
  // the only world with prefs access — this world never reads prefs
  // itself. See computeDidomiMinimumGate() there.
  let _didomiMinimumGateOpen = false;
  let _warnedOrder = false;
  document.addEventListener("muga:cookie-gate", (e) => {
    // Reject events that do not carry the handshake nonce. A missing or
    // mismatched nonce is either a spoofed dispatch from page-script code
    // OR — the case this once-guarded diagnostic surfaces — a gate event
    // that arrived BEFORE we captured the nonce, which only happens if the
    // manifest loads the dispatcher (content/cookie-noise.js) ahead of this
    // listener. Silent failure there means the feature just never engages,
    // so leave a breadcrumb. Mirrors content/history-defuser-mainworld.js.
    if (!e || !e.detail || e.detail.nonce !== _capturedNonce) {
      if (!_warnedOrder && e && e.detail && typeof e.detail.nonce === "string" && _capturedNonce === null) {
        _warnedOrder = true;
        console.warn("[MUGA] cookie-gate event before nonce capture — check manifest script order");
      }
      return;
    }
    _gateOpen = !!e.detail.enabled;
    _didomiMinimumGateOpen = !!e.detail.didomiMinimumGateOpen;
    if (_gateOpen) {
      runDispatcher(); // initial sweep — the banner may already exist
      startObserver();
    } else {
      stopObserver();
    }
  });

  function gateOpen() {
    return _gateOpen;
  }

  // Bounded give-up window (#1027). The MAJORITY of pages an opted-in user
  // visits never show a OneTrust banner, yet without a give-up the
  // MutationObserver + dispatcher would run on EVERY DOM mutation for the
  // whole page lifetime. A OneTrust banner that is going to appear does so
  // within a few seconds of a ready DOM (its SDK + geo lookup are
  // front-loaded); once that window passes, keeping the observer alive only
  // burns CPU with no chance of acting. Fail-closed: giving up just
  // disconnects the observer — it never rejects or grants anything.
  const GIVE_UP_AFTER_DOM_READY_MS = 10000;

  let _observer = null;
  let _giveUpArmed = false;
  let _giveUpTimer = null;

  function armGiveUp() {
    if (_giveUpArmed) return;
    _giveUpArmed = true;
    const schedule = () => {
      _giveUpTimer = setTimeout(() => {
        _giveUpTimer = null;
        if (!_acted) stopObserver();
      }, GIVE_UP_AFTER_DOM_READY_MS);
    };
    // Anchor the window to a settled DOM. A document_start MAIN-world script
    // sees readyState "loading" at first, but the gate may also open only
    // after the DOM is already parsed — handle both.
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", schedule, { once: true });
    } else {
      schedule();
    }
  }

  function startObserver() {
    if (_observer || _acted) return;
    if (!document || !document.documentElement) return;
    try {
      _observer = new MutationObserver(() => runDispatcher());
      _observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _observer = null;
    }
    armGiveUp();
  }

  function stopObserver() {
    if (_giveUpTimer !== null) {
      clearTimeout(_giveUpTimer);
      _giveUpTimer = null;
    }
    // Reset so a later gate reopen (Settings toggle) arms a fresh window.
    _giveUpArmed = false;
    if (!_observer) return;
    try {
      _observer.disconnect();
    } catch {
      // already disconnected
    }
    _observer = null;
  }
})();
