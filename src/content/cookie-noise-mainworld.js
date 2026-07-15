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
    return { hasOneTrustGlobal, hasRejectAllFn, hasBannerDom, hasActiveGroupsGlobal, hasRejectHandlerDom };
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
  document.addEventListener("muga:cookie-gate", (e) => {
    if (!e || !e.detail || e.detail.nonce !== _capturedNonce) return;
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

  let _observer = null;

  function startObserver() {
    if (_observer || _acted) return;
    if (!document || !document.documentElement) return;
    try {
      _observer = new MutationObserver(() => runDispatcher());
      _observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      _observer = null;
    }
  }

  function stopObserver() {
    if (!_observer) return;
    try {
      _observer.disconnect();
    } catch {
      // already disconnected
    }
    _observer = null;
  }
})();
