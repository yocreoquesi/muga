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

  // Cookie Consent Minimizer — Didomi minimum-grant pilot (see the design
  // docs for the full mode name; this file's own structural guard forbids
  // spelling it outside the fenced regions below). The two pure functions
  // in the fenced block directly below are a hand-maintained COPY of the
  // sibling lib module's own same-named block (content scripts cannot use
  // ES module imports — AGENTS.md). Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. World-agnostic and pure — never
  // touches `window` itself; the dispatch regions further below supply
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

  // Pure double-gate for the minimum-grant path (mirrors
  // computeCookieGate's @sync:cookie-gate shape). Hand-maintained COPY of
  // the sibling lib module's own same-named block. Kept in sync by
  // tests/unit/cookie-noise-sync.test.mjs. The main-world caller does NOT
  // carry this block — it never reads prefs.
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

  function dispatchGate(enabled, didomiMinimumGateOpen) {
    try {
      document.dispatchEvent(new CustomEvent("muga:cookie-gate", {
        detail: { enabled: !!enabled, didomiMinimumGateOpen: !!didomiMinimumGateOpen, nonce: _nonce },
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
  // Firefox-local mirror of the minimum-grant double-gate — computed
  // directly from prefs in this same world (Firefox has no MAIN-world
  // relay to receive), via computeDidomiMinimumGate() further below.
  let _fxDidomiMinimumGateOpen = false;
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
    // Didomi minimum-grant pilot signals (Firefox wrappedJSObject path) —
    // same five signals as the Chrome MAIN-world caller, see
    // cookie-noise-mainworld.js for the full rationale.
    let hasSetCurrentUserStatusFn = false;
    let hasGetRequiredPurposeIdsFn = false;
    let hasGetRequiredVendorIdsFn = false;
    let hasGetPurposesFn = false;
    let hasGetVendorsFn = false;
    try {
      const wrapped = window.wrappedJSObject;
      const di = wrapped && wrapped.Didomi;
      hasSetCurrentUserStatusFn = hasDidomiGlobal && typeof di.setCurrentUserStatus === "function";
      hasGetRequiredPurposeIdsFn = hasDidomiGlobal && typeof di.getRequiredPurposeIds === "function";
      hasGetRequiredVendorIdsFn = hasDidomiGlobal && typeof di.getRequiredVendorIds === "function";
      hasGetPurposesFn = hasDidomiGlobal && typeof di.getPurposes === "function";
      hasGetVendorsFn = hasDidomiGlobal && typeof di.getVendors === "function";
    } catch {
      // Xray wrapper / permission failure — fail closed.
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
      fxStopObserver();
      return;
    }
    // Cookie Consent Minimizer — Didomi minimum-grant pilot, own fenced
    // region below (this file's structural guard forbids spelling the
    // mode name outside it). Same shape as the Chrome MAIN-world caller's
    // dispatch — see cookie-noise-mainworld.js — reached ONLY after every
    // Tier 1 reject adapter above returned false for this page (a genuine
    // hard wall), double-gated by a boolean computed directly from prefs
    // in this world, AND the region's own signal check.
    // @sync:cmp-accept-dispatch:start
    if (_fxDidomiMinimumGateOpen && canAttemptDidomiMinimumAccept(signals)) {
      _fxActed = true;
      try {
        const payload = resolveDidomiMinimumStatus({
          requiredPurposeIds: window.wrappedJSObject.Didomi.getRequiredPurposeIds(),
          requiredVendorIds: window.wrappedJSObject.Didomi.getRequiredVendorIds(),
          allPurposeIds: window.wrappedJSObject.Didomi.getPurposes(),
          allVendorIds: window.wrappedJSObject.Didomi.getVendors(),
        });
        if (payload) window.wrappedJSObject.Didomi.setCurrentUserStatus(payload);
      } catch {
        // A throwing page global must never break the page.
      }
      fxStopObserver();
      return;
    }
    // @sync:cmp-accept-dispatch:end
  }

  // Bounded give-up window (#1027) — Firefox mirror of the MAIN-world
  // caller's give-up (see content/cookie-noise-mainworld.js for the full
  // rationale). Most pages never show a OneTrust banner; without a give-up
  // the observer + dispatcher would run per-mutation for the whole page
  // lifetime. Fail-closed: giving up just disconnects, never acts.
  const FX_GIVE_UP_AFTER_DOM_READY_MS = 10000;
  let _fxGiveUpArmed = false;
  let _fxGiveUpTimer = null;

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

  // Computes the minimum-grant double-gate from the real prefs in this
  // world — this world is the only one with prefs access; the Chrome
  // MAIN-world caller receives the already-computed boolean via the
  // nonce-gated event (see dispatchGate above), and Firefox reads this
  // function's result directly (no cross-world relay needed, same world).
  // This thin wrapper is itself fenced (this file's structural guard
  // forbids spelling the wrapped function's name outside a fenced
  // region — see the fenced block directly below).
  // @sync:cmp-accept-gate-call:start
  function computeDidomiMinimumGate(prefs) {
    const cleaner = window.__mugaCleaner;
    return computeAcceptGate(prefs, {
      hostname: location.hostname,
      isSiteFullyExempt:
        cleaner && typeof cleaner.isSiteFullyExempt === "function" ? cleaner.isSiteFullyExempt : null,
    });
  }
  // @sync:cmp-accept-gate-call:end

  function readPrefsAndGate() {
    try {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
        void chrome.runtime.lastError;
        const open = computeGate(prefs);
        const minimumGateOpen = computeDidomiMinimumGate(prefs);
        // Always dispatch — harmless no-op on Firefox, where no MAIN-world
        // listener is ever loaded (no world:"MAIN" content script there).
        dispatchGate(open, minimumGateOpen);
        if (_isFirefox) {
          _fxGateOpen = open;
          _fxDidomiMinimumGateOpen = minimumGateOpen;
          if (open) {
            fxRunDispatcher(); // initial sweep — the banner may already exist
            fxStartObserver();
          } else {
            fxStopObserver();
          }
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
    // Frame-safety (all_frames:true): this module must never throw an
    // uncaught exception in ANY frame (top, same-origin iframe,
    // cross-origin consent iframe, ad/embed iframe, restricted/opaque
    // frame). Every individual signal read and dispatch call is already
    // wrapped fail-closed above; this is the outer backstop for anything
    // unexpected during setup (e.g. `document`/`chrome.*` being
    // unavailable in a sandboxed frame).
  }
})();
