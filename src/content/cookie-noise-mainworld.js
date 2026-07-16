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
 * feature's pref (`cookieConsentMinimizerEnabled`) defaults OFF while
 * `activeDefenseEnabled` defaults ON; sharing a gate would conflate two
 * independent opt-ins.
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
  // @sync:cmp-adapters:end

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
