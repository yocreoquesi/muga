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
 * Runs in the isolated world (Chrome + Firefox), listed after
 * content/cleaner-bundle.js in the manifest so `window.__mugaCleaner` is
 * already attached when the gate first opens (needed for the
 * `isSiteFullyExempt` per-site exemption check).
 */

(function () {
  "use strict";

  // Skip iframes — same guard as the rest of MUGA's content scripts.
  if (window.self !== window.top) return;
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
  // supplies this world's real location + cleaner exemption predicate.
  // @sync:cookie-gate:start
  function computeCookieGate(prefs, deps) {
    if (!prefs) return false;
    if (prefs.enabled === false) return false;
    if (prefs.onboardingDone !== true) return false;
    if (prefs.cookieConsentMode !== "reject-only") return false;
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

  function computeGate(prefs) {
    // isSiteFullyExempt is a standalone function on __mugaCleaner (no `this`
    // dependency — see src/lib/cleaner.js), so passing the reference detached
    // is safe.
    const cleaner = window.__mugaCleaner;
    return computeCookieGate(prefs, {
      hostname: location.hostname,
      isSiteFullyExempt:
        cleaner && typeof cleaner.isSiteFullyExempt === "function" ? cleaner.isSiteFullyExempt : null,
    });
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
})();
