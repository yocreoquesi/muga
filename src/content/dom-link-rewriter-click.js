/**
 * MUGA: DOM Link Rewriter — Click Interceptor content script (#450 / B9)
 *
 * Sister script to `content/dom-link-rewriter.js` (B8). B8's
 * MutationObserver rewrites `<a href>` values as the DOM mutates —
 * great for SPA re-renders and static anchors, but blind to the
 * last-millisecond reinjection trick used by Twitter, Facebook, and
 * LinkedIn: a `mousedown` listener that re-decorates `event.target.href`
 * AFTER MUGA has already cleaned it via the observer. The user clicks
 * and the navigation heads to the dirty URL.
 *
 * B9 closes that gap by attaching capture-phase listeners on `mousedown`
 * and `click` at the document level. Capture phase runs BEFORE the
 * page's own bubble-phase listeners and BEFORE the browser starts
 * navigation — exactly the window we need to re-run the cleaner.
 *
 * Why isolated world (matches B8):
 *   - DOM is shared. Reading and writing `a.getAttribute('href')` /
 *     `a.setAttribute('href', ...)` works fine here.
 *   - We can listen for the SAME `muga:history-gate` event the History
 *     Defuser publishes — no extra prefs round-trip, no second gate.
 *
 * Why we re-implement the cleaner inline (matches B8):
 *   - Content scripts can't use ES module imports cross-browser
 *     (Firefox MV2). The pure factories live under `src/lib/` and are
 *     unit-tested directly; this file is a thin shell that mirrors
 *     them. The pure-factory test files cover the algorithmic
 *     invariants — this content script is structurally tested via
 *     the IIFE/manifest assertions in the unit suite.
 *
 * NEVER calls preventDefault / stopPropagation / stopImmediatePropagation.
 * The whole point is to be a passive observer of the click — we tweak
 * the href the navigation will follow, the navigation itself proceeds
 * untouched.
 */

(function () {
  "use strict";

  // Skip iframes — same guard as the rest of the content scripts.
  if (window.self !== window.top) return;
  if (window.__mugaDomLinkRewriterClick) return;
  window.__mugaDomLinkRewriterClick = true;

  // ── Inline tracking-param subset ──────────────────────────────────────
  // Mirrors content/dom-link-rewriter.js (B8). The `__mugaCleaner`
  // bundle is preferred when available; this is the safety net for
  // very-early clicks that race the bundle attach.
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

  function inlineCleanUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
    const qIndex = rawUrl.indexOf("?");
    if (qIndex < 0) return rawUrl;
    // audit-2026-07 S3: splice the raw query bytes instead of rebuilding via
    // URLSearchParams.toString(), which re-encodes every surviving param and
    // could corrupt a signature/token computed over exact bytes. A raw splice
    // also preserves the caller's shape (relative stays relative) for free.
    // Mirrors src/lib/hot-path-strip.js stripHotPathQuery — keep the two in sync.
    const hashIndex = rawUrl.indexOf("#", qIndex);
    const prefix = rawUrl.slice(0, qIndex);
    const query = hashIndex < 0 ? rawUrl.slice(qIndex + 1) : rawUrl.slice(qIndex + 1, hashIndex);
    const hash = hashIndex < 0 ? "" : rawUrl.slice(hashIndex);
    let changed = false;
    const kept = [];
    const pairs = query.split("&");
    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      const eq = pair.indexOf("=");
      const rawKey = eq < 0 ? pair : pair.slice(0, eq);
      let key = rawKey;
      try { key = decodeURIComponent(rawKey); } catch { /* malformed %-escape: match raw */ }
      if (Object.prototype.hasOwnProperty.call(STRIP, key)) { changed = true; continue; }
      kept.push(pair);
    }
    if (!changed) return rawUrl;
    const newQuery = kept.join("&");
    return newQuery ? prefix + "?" + newQuery + hash : prefix + hash;
  }

  /**
   * Operates on an ABSOLUTE url string. Relative hrefs are resolved to
   * absolute before reaching this function — see `urlCleaner` below.
   */
  function cleanAbsolute(raw) {
    const bundled = window.__mugaCleaner;
    if (bundled && typeof bundled.processUrl === "function") {
      try {
        const out = bundled.processUrl(raw);
        if (typeof out === "string") return out;
        if (out && typeof out.cleanUrl === "string") return out.cleanUrl;
      } catch {
        // fall through to inline subset
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

  function isCleanLink(href) {
    if (typeof href !== "string" || href.length === 0) return false;
    if (/^(mailto|tel|javascript|data|blob|about|chrome|chrome-extension):/i.test(href)) {
      return false;
    }
    return true;
  }

  // ── Inline rewriter (mirrors src/lib/dom-link-rewriter.js) ────────────
  function rewriteLink(anchor) {
    if (!anchor || anchor.nodeType !== 1 || anchor.tagName !== "A") return;
    let current;
    try { current = anchor.getAttribute("href"); } catch { return; }
    if (typeof current !== "string" || current.length === 0) return;
    if (!isCleanLink(current)) return;
    let cleaned;
    try { cleaned = urlCleaner(current); } catch { return; }
    if (typeof cleaned !== "string" || cleaned.length === 0) return;
    if (cleaned === current) return; // idempotency — see B8 docblock
    try { anchor.setAttribute("href", cleaned); } catch { /* detached */ }
  }

  // ── Capture-phase click handler (mirrors src/lib/dom-link-rewriter-click.js) ─
  function getAnchorFromEvent(event) {
    if (!event) return null;
    const target = event.target;
    if (!target || typeof target.closest !== "function") return null;
    try {
      return target.closest("a[href]") || null;
    } catch {
      return null;
    }
  }

  function handle(event) {
    let anchor;
    try { anchor = getAnchorFromEvent(event); } catch { return; }
    if (!anchor) return;
    try { rewriteLink(anchor); } catch { /* never throw out of capture phase */ }
    // NEVER preventDefault / stopPropagation / stopImmediatePropagation.
  }

  function onMousedown(event) { handle(event); }
  function onClick(event) { handle(event); }

  // ── Disabled-state gate ───────────────────────────────────────────────
  // Reuse the same `muga:history-gate` event the History Defuser
  // publishes — no extra prefs round-trip, no second gate.
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

  let _installed = false;
  const CAPTURE_OPTS = { capture: true };

  function install() {
    if (_installed) return;
    if (!document) return;
    try {
      document.addEventListener("mousedown", onMousedown, CAPTURE_OPTS);
      document.addEventListener("click", onClick, CAPTURE_OPTS);
      _installed = true;
    } catch {
      _installed = false;
    }
  }

  function uninstall() {
    if (!_installed) return;
    try {
      document.removeEventListener("mousedown", onMousedown, CAPTURE_OPTS);
      document.removeEventListener("click", onClick, CAPTURE_OPTS);
    } catch { /* document detached */ }
    _installed = false;
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
    if (enabled) install();
    else uninstall();
  });
})();
