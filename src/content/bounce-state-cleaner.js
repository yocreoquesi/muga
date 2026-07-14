/**
 * MUGA: Bounce State Cleaner — isolated-world content script (#447 / B17)
 *
 * Pairs with the pure factory in `src/lib/bounce-state-cleaner.js`. This
 * IIFE is the production wiring: it runs on every page at document_start
 * (isolated world), checks whether the page's host is a recognized
 * intermediary (affiliate-network bounce, social-link wrapper, privacy
 * proxy), and if so wipes that origin's localStorage + sessionStorage.
 *
 * Why isolated world: Web Storage is shared between isolated and main
 * worlds (the storage surface is keyed by ORIGIN, not by world). Running
 * here lets us reuse the same `muga:history-gate` event the rest of the
 * isolated-world scripts already publish — no extra prefs round-trip.
 *
 * Wipe gate — CURATED ALLOWLIST, not the full engine: the storage wipe is
 *   decided by the inline `WRAPPERS` table below (dedicated redirector hosts
 *   only), via resolveEngine(). It does NOT consult the bundled engine
 *   (`window.__mugaCleaner`). This is deliberate — the bundled engine also
 *   recognizes SHARED-ORIGIN content wrappers (youtube.com/redirect,
 *   duckduckgo.com/l/, steamcommunity.com/linkfilter/, curseforge.com/linkout)
 *   whose origin holds the user's own session/settings; because Web Storage is
 *   keyed by origin (not path), wiping there would destroy legitimate
 *   first-party state. Those hosts are still unwrapped by the main cleaner
 *   pipeline via the full engine — they are simply never storage-wiped here.
 *   The inline table is the explicit "safe to wipe" allowlist; a host is
 *   opted in by adding it here. A pure redirector missing from the table just
 *   misses cleanup (fail-safe) — it never risks user data. Do NOT restore a
 *   `window.__mugaCleaner` branch in resolveEngine(): that reintroduces the
 *   C1 storage-loss regression (guarded by
 *   tests/unit/bounce-state-wrappers-parity.test.mjs).
 *
 * ── Cookies (intentionally not requested) ────────────────────────────────
 * This module does NOT clear cookies. Doing so would require the
 * `cookies` permission, which triggers an install-time prompt
 * disproportionate to the benefit. See src/lib/bounce-state-cleaner.js
 * docblock for the full rationale.
 *
 * ── Iframes skipped ─────────────────────────────────────────────────────
 * Storage clears MUST NOT run inside iframes. A legitimate parent page
 * may embed a privacy-proxy host as an `<iframe>` for some
 * non-bounce purpose (e.g. an admin dashboard's tooling iframe), and
 * wiping its storage from inside the iframe would corrupt that.
 * `window.self !== window.top` is the standard guard the rest of the
 * MUGA content scripts use.
 *
 * ── Disabled-state guard ────────────────────────────────────────────────
 * The cleanup waits for a `muga:history-gate { enabled: true }` event
 * (B10's dispatcher). This honors the user's onboarding/disable choice
 * the same way every other isolated-world script does. We DO buffer the
 * "should clean now?" decision so that a gate-open event arriving after
 * document_start still triggers the wipe (the page may have already
 * settled by then; storage state survives until we clear it).
 */

(function () {
  "use strict";

  // ── Iframe guard ─────────────────────────────────────────────────────
  // See module docblock. NOT optional — privacy frames may share the host
  // with legitimate iframes.
  if (window.self !== window.top) return;
  if (window.__mugaBounceStateCleaner) return;
  window.__mugaBounceStateCleaner = true;

  // ── Replicated WRAPPERS table ────────────────────────────────────────
  // Mirrors the schema in src/lib/wrapper-engine.js. We only need the
  // host/path matchers — extraction is irrelevant to storage cleanup.
  // Keep this list in sync with the lib copy; the lib unit tests pin the
  // shape of each entry, and any new wrapper added there should be
  // mirrored here for storage cleanup to apply.
  const WRAPPERS = [
    { hostPatterns: ["t.co"], pathPatterns: null },
    { hostPatterns: ["l.facebook.com"], pathPatterns: ["/l.php"] },
    { hostPatterns: ["lm.facebook.com"], pathPatterns: ["/l.php"] },
    { hostPatterns: ["l.instagram.com"], pathPatterns: null },
    { hostPatterns: ["out.reddit.com"], pathPatterns: null },
    { hostPatterns: ["link.medium.com"], pathPatterns: null },
    { hostPatterns: ["away.vk.com"], pathPatterns: ["/away.php"] },
    { hostPatterns: ["exit.sc"], pathPatterns: null },
    { hostPatterns: ["href.li"], pathPatterns: null },
    { hostPatterns: ["anonym.to"], pathPatterns: null },
    // Harvested from ClearURLs redirections (see tools/rule-ingestion/
    // harvest-unwrap.mjs). Kept in parity with wrapper-engine.js by
    // tests/unit/bounce-state-wrappers-parity.test.mjs. Only DEDICATED
    // redirector hosts are auto-harvested — never a content apex that shares
    // its origin (and its Web Storage) with a logged-in user session, so this
    // storage wipe can never destroy legitimate first-party state.
    { hostPatterns: ["cc.loginfra.com"], pathPatterns: null },
    { hostPatterns: ["click.redditmail.com"], pathPatterns: null },
    { hostPatterns: ["gate.sc", "www.gate.sc"], pathPatterns: null },
    { hostPatterns: ["l.messenger.com"], pathPatterns: ["/l.php"] },
    { hostPatterns: ["t.umblr.com"], pathPatterns: ["/redirect"] },
    // Awin (awin1.com), Impact Radius (*.pxf.io), Rakuten
    // (click.linksynergy.com), TradeTracker (tc.tradetracker.net), Skimlinks
    // (go.redirectingat.com, go.skimresources.com), and ShareASale
    // (shareasale.com) previously lived in this list. Retired per ADR-0003 /
    // #684 / #692 / #907: those hosts now live in AFFILIATE_REDIRECT_NETWORKS
    // (pass-through), and bounce-state cleanup must NOT wipe their
    // localStorage during the redirect step — the network needs that state
    // to attribute the click on landing. The inlineDetectWrapper() guard
    // below (INLINE_AFFILIATE_REDIRECT_NETWORKS) enforces the same invariant
    // at runtime as defense-in-depth.
  ];

  // ── Inline AFFILIATE_REDIRECT_NETWORKS guard (#703) ──────────────────
  // Mirrors src/lib/opaque-networks.js AFFILIATE_REDIRECT_NETWORKS so the
  // inline detector can hard-NULL any host that is in the 2.1 pass-through
  // bucket — even if a future change accidentally re-adds one to WRAPPERS.
  // Kept in sync by tests/unit/bounce-state-affiliate-redirect.test.mjs.
  // Wildcard entries use the `*.suffix` shape (matches `endsWith(".suffix")`).
  const INLINE_AFFILIATE_REDIRECT_NETWORKS = [
    "s.click.aliexpress.com",
    "awin1.com",
    "www.awin1.com",
    "anrdoezrs.net",
    "dpbolvw.net",
    "jdoqocy.com",
    "kqzyfj.com",
    "tkqlhce.com",
    "emjcd.com",
    "qksrv.net",
    "cj.dotomi.com",
    "ad.admitad.com",
    "prf.hn",
    "px.a8.net",
    "*.pxf.io",
    "click.linksynergy.com",
    "tc.tradetracker.net",
    "clk.tradedoubler.com",
    "alitems.com",
    "redirect.viglink.com",
    "go.redirectingat.com",
    "go.skimresources.com",
    "shareasale.com",
    "www.shareasale.com",
  ];

  function isInlineAffiliateRedirectNetwork(host) {
    // #1101: strip a leading "www." before comparing, mirroring
    // src/lib/opaque-networks.js's matches(). Most entries above have an
    // explicit "www.foo" duplicate (awin1.com / www.awin1.com,
    // shareasale.com / www.shareasale.com) that accidentally masked this
    // gap, but hosts without one (e.g. anrdoezrs.net) let a www.-prefixed
    // affiliate-redirect URL slip past the guard and get unwrapped,
    // defeating the network's 30x attribution.
    const normalizedHost = host.replace(/^www\./, "");
    for (const entry of INLINE_AFFILIATE_REDIRECT_NETWORKS) {
      if (entry.startsWith("*.")) {
        if (normalizedHost.endsWith(entry.slice(1))) return true;
      } else if (normalizedHost === entry) {
        return true;
      }
    }
    return false;
  }

  function inlineDetectWrapper(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return null; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
    // 2.1 pass-through invariant: never report an affiliate-redirect host
    // as a wrapper. The merchant's first-party cookie depends on landing
    // state surviving the bounce; wiping it would silently break attribution.
    if (isInlineAffiliateRedirectNetwork(host)) return null;
    for (const wrapper of WRAPPERS) {
      const hostMatch = wrapper.hostPatterns.some((p) =>
        typeof p === "string" ? host === p.toLowerCase() : p.test(host)
      );
      if (!hostMatch) continue;
      if (wrapper.pathPatterns) {
        const pathMatch = wrapper.pathPatterns.some((pp) =>
          url.pathname.startsWith(pp)
        );
        if (!pathMatch) continue;
      }
      return wrapper;
    }
    return null;
  }

  /**
   * The bounce-state storage wipe is gated on the CURATED inline WRAPPERS
   * table above (dedicated redirector hosts only), NOT on the full bundled
   * wrapper engine. This is deliberate: the bundled engine also recognizes
   * SHARED-ORIGIN content wrappers (e.g. youtube.com/redirect,
   * duckduckgo.com/l/, steamcommunity.com/linkfilter/) whose origin holds the
   * user's own session and settings. Web Storage is keyed by origin, not path,
   * so wiping localStorage/sessionStorage on such a page would destroy
   * legitimate first-party state (DuckDuckGo, for instance, keeps every
   * preference in localStorage with no account). Those hosts are still
   * unwrapped by the main cleaner pipeline via the full engine; they are just
   * never storage-wiped here. The inline table is the explicit "safe to wipe"
   * allowlist — a maintainer opts a host in by adding it there. A pure
   * redirector missing from the table merely misses cleanup (fail-safe), it
   * never risks user data.
   */
  function resolveEngine() {
    return { detectWrapper: inlineDetectWrapper };
  }

  // ── Pure factory inlined ─────────────────────────────────────────────
  // Same logic as src/lib/bounce-state-cleaner.js — content scripts can't
  // use ES module imports cross-browser (Firefox MV2). The unit tests
  // cover the factory directly; this copy is a thin shell.
  function createBounceStateCleaner(deps) {
    const wrapperEngine = deps && deps.wrapperEngine;
    const storageLike = deps && deps.storageLike;
    const sessionStorageLike = deps && deps.sessionStorageLike;

    function safeLength(s) {
      if (!s) return 0;
      try {
        const n = s.length;
        return typeof n === "number" && n >= 0 ? n : 0;
      } catch { return 0; }
    }
    function safeClear(s) {
      if (!s || typeof s.clear !== "function") return false;
      try { s.clear(); return true; } catch { return false; }
    }
    function isIntermediary(href) {
      if (typeof href !== "string" || href.length === 0) return false;
      if (!wrapperEngine || typeof wrapperEngine.detectWrapper !== "function") return false;
      try { return wrapperEngine.detectWrapper(href) !== null; } catch { return false; }
    }
    function cleanCurrent() {
      const lb = safeLength(storageLike);
      const sb = safeLength(sessionStorageLike);
      const lok = safeClear(storageLike);
      const sok = safeClear(sessionStorageLike);
      return { localCleared: lok ? lb : 0, sessionCleared: sok ? sb : 0 };
    }
    function cleanIfIntermediary(href) {
      if (!isIntermediary(href)) return { cleaned: false, localCleared: 0, sessionCleared: 0 };
      const c = cleanCurrent();
      return { cleaned: true, localCleared: c.localCleared, sessionCleared: c.sessionCleared };
    }
    return { isIntermediary, cleanCurrent, cleanIfIntermediary };
  }

  // ── Storage references — defensive reads ─────────────────────────────
  // Reading window.localStorage in some contexts (sandboxed iframes,
  // certain incognito setups) throws SecurityError. Catch at the
  // top-level so the IIFE never crashes the page just by loading.
  let localRef = null;
  let sessionRef = null;
  try { localRef = window.localStorage; } catch { localRef = null; }
  try { sessionRef = window.sessionStorage; } catch { sessionRef = null; }

  const cleaner = createBounceStateCleaner({
    wrapperEngine: resolveEngine(),
    storageLike: localRef,
    sessionStorageLike: sessionRef,
  });

  // ── Disabled-state gate ──────────────────────────────────────────────
  // We mirror the dom-link-rewriter pattern: cache the "should run?"
  // decision and only act once the gate confirms enabled. Because the
  // storage state is persistent, a late-arriving gate event (after the
  // page has already loaded) still has work to do — we re-attempt on
  // each gate-open event until the first time the cleaner acts on an
  // intermediary URL (result.cleaned === true), which performs the clear
  // regardless of how many keys were present. After that we latch off.
  //
  // Nonce handshake (#811): capture the shared secret from the one-shot
  // `muga:history-gate:nonce` event fired at document_start by the
  // dispatcher. Gate events without the matching nonce are rejected.
  let _capturedNonce = null;
  (function () {
    function _onNonce(e) {
      if (e && e.detail && typeof e.detail.nonce === "string") {
        _capturedNonce = e.detail.nonce;
      }
      document.removeEventListener("muga:history-gate:nonce", _onNonce);
    }
    document.addEventListener("muga:history-gate:nonce", _onNonce);
  })();

  let _haveCleaned = false;

  function attemptCleanup() {
    if (_haveCleaned) return;
    let href;
    try { href = location.href; } catch { return; }
    const result = cleaner.cleanIfIntermediary(href);
    if (result.cleaned) {
      _haveCleaned = true;
    }
  }

  // Latch re-arm (#832): track the previous gate state so a disable→re-enable
  // cycle on the same intermediary page re-cleans storage that was written
  // in between. When the gate transitions from true→false we reset _haveCleaned
  // so the next gate-open event triggers a fresh cleanup pass.
  let _prevGateEnabled = false;

  let _warnedOrder = false;
  document.addEventListener("muga:history-gate", (e) => {
    if (!e || !e.detail || e.detail.nonce !== _capturedNonce) {
      if (!_warnedOrder && e && e.detail && typeof e.detail.nonce === "string" && _capturedNonce === null) {
        _warnedOrder = true;
        console.warn("[MUGA] gate event before nonce capture — check manifest script order");
      }
      return;
    }
    const enabled = !!(e.detail.enabled);
    // Re-arm the latch when the gate closes so a subsequent re-enable cleans
    // any storage written while MUGA was disabled.
    if (_prevGateEnabled && !enabled) {
      _haveCleaned = false;
    }
    _prevGateEnabled = enabled;
    if (enabled) attemptCleanup();
  });
})();
