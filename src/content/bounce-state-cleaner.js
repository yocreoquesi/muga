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
 * Wrapper detection: prefers the cleaner bundle, falls back to the
 *   re-replicated WRAPPERS table below. As of PR #511, the bundle DOES
 *   expose `detectWrapper` (and a full WRAPPERS table — was awin-only
 *   before #511). The resolveEngine() shim picks the bundled engine at
 *   call time, so the inline copy is now defense-in-depth: if a future
 *   change accidentally drops the export, or if the bundle script
 *   somehow hasn't attached by the time the gate event fires, we still
 *   have working detection. Keep both copies in sync when adding new
 *   wrappers.
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
    { hostPatterns: ["awin1.com", "www.awin1.com"], pathPatterns: ["/cread.php", "/awclick.php"] },
    { hostPatterns: ["go.redirectingat.com", "go.skimresources.com"], pathPatterns: null },
    { hostPatterns: ["shareasale.com", "www.shareasale.com"], pathPatterns: ["/r.cfm"] },
    { hostPatterns: ["click.linksynergy.com"], pathPatterns: ["/deeplink"] },
    { hostPatterns: ["tc.tradetracker.net"], pathPatterns: null },
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
    // Impact Radius — regex matches subdomain.pxf.io. The literal regex
    // here is a copy of the one in src/lib/wrapper-engine.js.
    { hostPatterns: [/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.pxf\.io$/], pathPatterns: null },
  ];

  function inlineDetectWrapper(rawUrl) {
    let url;
    try { url = new URL(rawUrl); } catch { return null; }
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    const host = url.hostname.toLowerCase();
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
   * Prefer the bundled engine when it's available; fall back to the
   * inline replica. Both are pure, both run synchronously — choose at
   * call time so a late-arriving bundle doesn't get bypassed.
   */
  function resolveEngine() {
    const bundled = window.__mugaCleaner;
    if (bundled && typeof bundled.detectWrapper === "function") {
      return { detectWrapper: (href) => bundled.detectWrapper(href) };
    }
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
  // each gate-open event until we successfully observe a non-zero
  // cleanup OR the URL stops being an intermediary.
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

  document.addEventListener("muga:history-gate", (e) => {
    const enabled = !!(e && e.detail && e.detail.enabled);
    if (enabled) attemptCleanup();
  });
})();
