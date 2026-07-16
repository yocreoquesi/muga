/**
 * MUGA: Cookie Consent Minimizer — isolated-world gatekeeper (#1027)
 *
 * Reads the user's prefs, computes the disabled-state gate, and controls
 * the MAIN-world caller (content/cookie-noise-mainworld.js, Chrome MV3
 * only) via a nonce-gated CustomEvent handshake on a channel SEPARATE
 * from `muga:history-gate` — this feature's pref
 * (`cookieConsentMinimizerEnabled`) defaults OFF while `activeDefenseEnabled`
 * defaults ON, so sharing a gate would conflate two independent opt-ins.
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
    return { hasOneTrustGlobal, hasRejectAllFn, hasBannerDom, hasActiveGroupsGlobal, hasRejectHandlerDom };
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
