/**
 * MUGA: DOM Link Rewriter — isolated-world content script (#443 / B8)
 *
 * Watches `<a href>` mutations on the page and rewrites tracking-decorated
 * URLs in place. SPA pages frequently re-render link lists with the same
 * dirty URLs the navigation pipeline already strips at request time. A
 * user who copies a link, hovers to read the bottom-of-window URL preview,
 * or middle-clicks to open a new tab would otherwise see/use the dirty
 * URL — this rewriter closes that visible-DOM leak.
 *
 * Why isolated world (not main world):
 *   - The DOM is shared between isolated and main worlds. Reading
 *     `a.href` and writing `a.setAttribute('href', ...)` works fine
 *     here. Only JS object identity is split — and we don't share
 *     objects with the page.
 *   - Running here means we can listen for the SAME `muga:history-gate`
 *     CustomEvent that the History Defuser (#444 / B10) already
 *     publishes from the isolated-world gate script. No extra prefs
 *     round-trip, no second gate event, no separate disable plumbing.
 *
 * Why a hard-coded tracking-param subset (vs. the full bundled cleaner):
 *   The cleaner bundle (`window.__mugaCleaner.processUrl`) is content-
 *   script visible, but a MutationObserver that fires on a SPA's link
 *   list rebuild can spike to hundreds of calls in a microtask. The
 *   inline subset matches the History Defuser main-world script and
 *   covers the highest-volume params (UTM, click IDs, social) without
 *   the full cleaner's per-call overhead. Full coverage continues to
 *   live in the navigation pipeline (DNR + cleaner-bundle.js).
 *
 *   If `window.__mugaCleaner.processUrl` is available we PREFER it over
 *   the inline subset — same isolated world, same sync surface. The
 *   inline subset is the safety net for paint-time mutations that fire
 *   before the cleaner bundle has attached.
 *
 * Idempotency: the pure factory in `src/lib/dom-link-rewriter.js`
 * guarantees that an already-clean href produces ZERO setAttribute calls
 * — the `attributes` mutation that would re-trigger the observer never
 * happens. See that file's docblock for the invariant.
 */

(function () {
  "use strict";

  // Skip iframes — same guard as the rest of the content scripts.
  // Wrapping inside an iframe risks corrupting cross-origin parent
  // navigation handling for embedded routers (Stripe, OAuth).
  if (window.self !== window.top) return;
  if (window.__mugaDomLinkRewriter) return;
  window.__mugaDomLinkRewriter = true;

  // ── Inline tracking-param subset ──────────────────────────────────────
  // Mirrors the subset in content/history-defuser-mainworld.js. Object
  // lookup is faster than a Set on this hot path. Values are unused.
  // @generated hot-path STRIP subset - edit src/lib/hot-path-strip.js then run `npm run build:strip`
  const STRIP = Object.freeze({
    utm_source: 1, utm_medium: 1, utm_campaign: 1, utm_content: 1, utm_term: 1, utm_id: 1,
    utm_source_platform: 1, utm_creative_format: 1, utm_marketing_tactic: 1,
    fbclid: 1, gclid: 1, gclsrc: 1, dclid: 1, gbraid: 1, wbraid: 1, msclkid: 1, tclid: 1, twclid: 1,
    mc_cid: 1, mc_eid: 1, igshid: 1, igsh: 1,
    _hsenc: 1, _hsmi: 1, mkt_tok: 1,
    yclid: 1, ysclid: 1, _openstat: 1,
    irclickid: 1, cjevent: 1, awc: 1,
    ttclid: 1, sccid: 1, rdt_cid: 1,
    _branch_match_id: 1, _branch_referrer: 1,
    pk_campaign: 1, pk_kwd: 1, pk_source: 1, pk_medium: 1,
    mtm_campaign: 1, mtm_source: 1, mtm_medium: 1, mtm_content: 1,
    hsctatracking: 1,
    __s: 1, _ga: 1, _gl: 1, _gac: 1,
    ved: 1, ei: 1, sca_esv: 1, sxsrf: 1,
    mibextid: 1, share_id: 1,
    _pos: 1, _ss: 1, _psq: 1, _sid: 1, _fid: 1,
    pr_prod_strat: 1, pr_rec_id: 1, pr_ref_pid: 1, pr_rec_pid: 1, pr_seq: 1,
  });

  /**
   * Absolute-URL detector — a bare scheme + "://" prefix. Anything else
   * (path-relative, query-relative, or hash-only hrefs) is relative.
   */
  function isAbsoluteUrl(raw) {
    return /^[a-z]+:\/\//i.test(raw);
  }

  /**
   * Synchronous URL cleaner. Strips the static tracking-param subset
   * and re-emits in the same shape (relative vs absolute) the caller
   * passed in so attribute string-comparisons match. Returns the
   * original string when nothing changed or parsing fails — never
   * throws. The pure factory is built to swallow throws anyway, but
   * keeping this defensive matches the History Defuser pattern.
   */
  function inlineCleanUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
    if (rawUrl.indexOf("?") < 0) return rawUrl;
    let u;
    try {
      u = new URL(rawUrl, window.location.href);
    } catch {
      return rawUrl;
    }
    let changed = false;
    const keys = [];
    u.searchParams.forEach((_v, k) => keys.push(k));
    for (let i = 0; i < keys.length; i++) {
      if (Object.prototype.hasOwnProperty.call(STRIP, keys[i])) {
        u.searchParams.delete(keys[i]);
        changed = true;
      }
    }
    if (!changed) return rawUrl;
    if (isAbsoluteUrl(rawUrl)) return u.toString();
    return u.pathname + u.search + u.hash;
  }

  /**
   * Prefer the bundled `processUrl` if it's already attached. Both
   * scripts run in the isolated world and the cleaner bundle loads
   * earlier in the manifest content_scripts array, so by the time the
   * gate opens the bundle is typically up. The inline subset is the
   * fallback when an extremely-early mutation (rare — observer doesn't
   * start until the gate event) outraces the bundle attach.
   *
   * Operates on an ABSOLUTE url string. Relative hrefs are resolved to
   * absolute before reaching this function — see `urlCleaner` below.
   */
  function cleanAbsolute(raw) {
    const bundled = window.__mugaCleaner;
    if (bundled && typeof bundled.processUrl === "function") {
      try {
        const out = bundled.processUrl(raw);
        // processUrl returns { cleanUrl, ... } on hit; the rewriter wants
        // a string. Be defensive — if the bundled API ever changes shape,
        // we silently fall through to the inline subset.
        if (typeof out === "string") return out;
        if (out && typeof out.cleanUrl === "string") return out.cleanUrl;
      } catch {
        // fall through to the inline subset
      }
    }
    return inlineCleanUrl(raw);
  }

  /**
   * Public cleaner entry point.
   *
   * #1012: the bundled `processUrl` parses with `new URL(rawUrl)` — NO
   * base — so a relative href (e.g. "/product?utm_source=x") throws
   * inside it, is caught, and processUrl returns an "untouched" payload
   * whose `cleanUrl` is the ORIGINAL dirty relative string. A naive
   * "prefer the bundle" cleaner then returns that dirty string straight
   * through and never falls back to `inlineCleanUrl` (which IS base-aware
   * and would have handled it) — relative hrefs pass through uncleaned.
   *
   * Fix: resolve relative hrefs against `window.location.href` BEFORE
   * handing them to the bundle/inline cleaner (same fallback order as
   * before), then re-emit the result in the SAME shape the caller passed
   * in. SPA routers string-compare hrefs, so a shape change (relative in,
   * absolute out) would look like a different link even when the URL is
   * equivalent. When nothing changed we return the ORIGINAL string (not
   * the resolved-then-reshaped one) so `rewriteLink`'s
   * `cleaned === current` check still skips the setAttribute.
   *
   * Two guards keep this from over-reaching:
   *   1. `?`-guard: a relative href with no query of its OWN (e.g.
   *      "#section", "/about") has nothing to clean. Resolving it against
   *      the page URL would inherit the PAGE's query — if the page was
   *      opened via a tracking link, cleanAbsolute would strip those
   *      inherited params and we'd rewrite an in-page anchor that carried
   *      no tracking itself, changing its shape and firing a spurious
   *      setAttribute. Mirror inlineCleanUrl's existing `?`-guard contract.
   *   2. same-origin guard: cleanAbsolute -> processUrl can UNWRAP a
   *      redirect wrapper and return a DIFFERENT-origin absolute URL.
   *      Re-emitting pathname+search+hash would graft that other-origin
   *      path onto the current origin. Only re-relativize when the cleaned
   *      result is still same-origin as the resolved input; otherwise
   *      leave the href untouched.
   */
  function urlCleaner(raw) {
    if (isAbsoluteUrl(raw)) return cleanAbsolute(raw);
    // Protocol-relative hrefs (`//host/path`) are scheme-relative but
    // ORIGIN-bearing. isAbsoluteUrl requires a scheme, so it misses them and
    // they would fall into the relative branch below, which re-emits path-only
    // against the CURRENT origin — silently repointing a cross-host link at
    // this page (audit #1037). Clean here and re-emit in the SAME
    // protocol-relative shape so the `//host` is preserved (and an unwrapped
    // cross-origin destination stays expressible, unlike the path-only branch).
    if (raw.startsWith("//")) {
      if (raw.indexOf("?") < 0) return raw;
      let resolvedPR;
      try {
        resolvedPR = new URL(raw, window.location.href).toString();
      } catch {
        return raw;
      }
      const cleanedPR = cleanAbsolute(resolvedPR);
      if (cleanedPR === resolvedPR) return raw;
      try {
        const u = new URL(cleanedPR);
        return "//" + u.host + u.pathname + u.search + u.hash;
      } catch {
        return raw;
      }
    }
    if (raw.indexOf("?") < 0) return raw;

    let resolved;
    try {
      resolved = new URL(raw, window.location.href).toString();
    } catch {
      return inlineCleanUrl(raw);
    }
    const cleanedAbsolute = cleanAbsolute(resolved);
    if (cleanedAbsolute === resolved) return raw;
    try {
      const cleanedUrl = new URL(cleanedAbsolute);
      if (cleanedUrl.origin !== new URL(resolved).origin) return raw;
      return cleanedUrl.pathname + cleanedUrl.search + cleanedUrl.hash;
    } catch {
      return raw;
    }
  }

  /**
   * Scope guard — mirrors AGENTS.md's URL scope rules. Keeps the cleaner
   * (and `new URL()`) off non-http schemes that would either parse to
   * something nonsensical or throw.
   */
  function isCleanLink(href) {
    if (typeof href !== "string" || href.length === 0) return false;
    // Skip schemes the cleaner has no business touching. Hash-only
    // links and same-page anchors are kept out via the "must contain ?"
    // shortcut in inlineCleanUrl, but rejecting non-http schemes here
    // saves a `new URL()` per non-candidate.
    if (/^(mailto|tel|javascript|data|blob|about|chrome|chrome-extension):/i.test(href)) {
      return false;
    }
    return true;
  }

  // ── Pure factory inlined ──────────────────────────────────────────────
  // Same logic as src/lib/dom-link-rewriter.js. Inlined because content
  // scripts can't use ES module imports cross-browser (Firefox MV2). The
  // unit tests cover the factory directly; this copy is a thin shell.
  function createLinkRewriter() {
    function isAnchor(node) {
      return !!(node && node.nodeType === 1 && node.tagName === "A");
    }

    function rewriteLink(anchor) {
      if (!isAnchor(anchor)) return;
      let current;
      try { current = anchor.getAttribute("href"); } catch { return; }
      if (typeof current !== "string" || current.length === 0) return;
      if (!isCleanLink(current)) return;
      let cleaned;
      try { cleaned = urlCleaner(current); } catch { return; }
      if (typeof cleaned !== "string" || cleaned.length === 0) return;
      // IDEMPOTENCY: a write of the same string would still observable
      // as an `attributes` mutation and re-fire the observer. Skip.
      if (cleaned === current) return;
      try { anchor.setAttribute("href", cleaned); } catch { /* detached */ }
    }

    function rewriteAll(nodeIterable) {
      if (!nodeIterable) return;
      try {
        for (const node of nodeIterable) rewriteLink(node);
      } catch { /* iterator threw mid-walk */ }
    }

    function processAddedNode(node) {
      if (!node || node.nodeType !== 1) return;
      if (isAnchor(node)) rewriteLink(node);
      if (typeof node.querySelectorAll === "function") {
        let descendants;
        try { descendants = node.querySelectorAll("a[href]"); } catch { return; }
        if (descendants) rewriteAll(descendants);
      }
    }

    function onMutation(records) {
      if (!records) return;
      const len = records.length;
      if (typeof len !== "number") return;
      for (let i = 0; i < len; i++) {
        const r = records[i];
        if (!r) continue;
        if (r.type === "attributes") {
          if (r.attributeName !== "href") continue;
          rewriteLink(r.target);
        } else if (r.type === "childList") {
          const added = r.addedNodes;
          if (!added) continue;
          const n = added.length || 0;
          for (let j = 0; j < n; j++) processAddedNode(added[j]);
        }
      }
    }

    return { rewriteLink, rewriteAll, onMutation };
  }

  const rewriter = createLinkRewriter();

  // ── Disabled-state gate ───────────────────────────────────────────────
  // Reuse the same `muga:history-gate` event the History Defuser already
  // publishes from `content/history-defuser.js`. A separate gate event
  // would mean two prefs round-trips on every page; sharing keeps
  // disabled-state behavior coherent and cheap.
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

  let _observer = null;

  function observerCallback(records) {
    // The MutationObserver callback IS already a microtask boundary —
    // the browser batches DOM writes from a turn of the event loop and
    // delivers them in one callback. Process synchronously: queueing
    // another microtask just adds latency without adding batching.
    rewriter.onMutation(records);
  }

  function startObserver() {
    if (_observer) return;
    if (!document || !document.documentElement) return;
    try {
      _observer = new MutationObserver(observerCallback);
      _observer.observe(document.documentElement, {
        subtree: true,
        childList: true,
        attributes: true,
        // attributeFilter is the load-bearing perf optimization — without
        // it every attribute change on every element pages through this
        // callback. With it the browser short-circuits in C++.
        attributeFilter: ["href"],
      });
    } catch {
      _observer = null;
      return;
    }
    // Initial pass — anchors that already exist when the gate opens.
    try {
      rewriter.rewriteAll(document.querySelectorAll("a[href]"));
    } catch { /* document detached or selector unsupported */ }
  }

  function stopObserver() {
    if (!_observer) return;
    try { _observer.disconnect(); } catch { /* already disconnected */ }
    _observer = null;
  }

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
    if (enabled) startObserver();
    else stopObserver();
  });
})();
