/**
 * MUGA: History Defuser — main-world content script (#444 / B10)
 *
 * Runs IN THE PAGE WORLD (`world: "MAIN"`) at `document_start` so it
 * can wrap `history.pushState` / `history.replaceState` directly on
 * the page's `window.history`. The isolated-world content script
 * cannot wrap these methods — the same MV3 isolated-world constraint
 * that forced the removal of the `navigator.sendBeacon` override
 * (see content/cleaner.js comment near line 665).
 *
 * This file runs ONLY on Chrome MV3, loaded via the `world: "MAIN"`
 * content_scripts entry in src/manifest.json. Firefox MV2 does not
 * support `world: "MAIN"` and does NOT load this file at all. On
 * Firefox the page-world history wrap is done directly by the
 * isolated-world companion `content/history-defuser.js`, which reaches
 * the page's real `history` object via `window.wrappedJSObject` and
 * installs the wrap with `exportFunction` (see that file for details).
 *
 * Important constraints for this file:
 *
 *   - No chrome.* APIs. Main-world scripts have NO access to
 *     extension messaging — they share the page's privileges only.
 *   - No ES module imports. Runs as a classic script in the page
 *     world.
 *   - Tracking-param list is a HARD-CODED SUBSET. Round-tripping to
 *     the SW per pushState would be async; the page may read
 *     `window.location.search` synchronously after the call. The
 *     subset covers the highest-volume params (UTM, click IDs,
 *     social). Full coverage continues to live in the navigation
 *     pipeline (DNR + cleaner-bundle.js).
 *   - Disabled-state guard: cannot read prefs from main world. A
 *     companion isolated-world content script writes a flag onto
 *     `window.__mugaHistoryDefuserEnabled` that this wrapper polls
 *     before doing any cleaning. Until that flag is true, the
 *     wrappers fall through to the originals untouched.
 */

(function () {
  "use strict";

  // Skip iframes — same guard as cleaner.js. Wrapping inside an iframe
  // risks corrupting cross-origin parent navigation handling.
  if (window.self !== window.top) return;
  if (window.__mugaHistoryDefused) return;
  window.__mugaHistoryDefused = true;

  // Subset of TRACKING_PARAMS from src/lib/affiliates.js. Keep in sync
  // with the structural list in tests/unit/history-defuser.test.mjs.
  // Object lookup is faster than a Set for this hot path; values are
  // unused (truthiness only).
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
   * Strips the static tracking-param subset from `rawUrl`. Re-emits in
   * the same shape (relative vs absolute) the caller passed in so SPA
   * routers that string-compare locations don't see a sudden absolute
   * swap. Returns the original string when nothing changed or when
   * parsing fails — never throws.
   */
  function cleanUrl(rawUrl) {
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
    const isAbsolute = /^[a-z]+:\/\//i.test(rawUrl);
    if (isAbsolute) return u.toString();
    return u.pathname + u.search + u.hash;
  }

  // Disabled-state gate. Cross-world signaling happens via CustomEvents
  // dispatched on `document`: events DO cross the isolated/main world
  // boundary even though `window` properties don't. The companion
  // isolated-world script (content/history-defuser.js) reads prefs and
  // dispatches `muga:history-gate` with `detail: { enabled: bool, nonce }`.
  // Until the first event arrives the gate stays CLOSED (fail-closed):
  // the wrap is installed but pass-through, matching the
  // disabled-state guard contract in AGENTS.md.
  //
  // Nonce handshake (#811): the dispatcher fires a one-shot
  // `muga:history-gate:nonce` event at document_start before any page
  // script executes. We capture the nonce here, then remove the listener
  // so no persistent listener can be observed. All subsequent gate events
  // must carry the matching nonce or they are silently ignored — this
  // prevents hostile page scripts from spoofing the gate event.
  let _capturedNonce = null;
  function _onNonce(e) {
    if (e && e.detail && typeof e.detail.nonce === "string") {
      _capturedNonce = e.detail.nonce;
    }
    document.removeEventListener("muga:history-gate:nonce", _onNonce);
  }
  document.addEventListener("muga:history-gate:nonce", _onNonce);

  let _gateOpen = false;
  let _warnedOrder = false;
  document.addEventListener("muga:history-gate", (e) => {
    // Reject events that do not carry the handshake nonce. A missing or
    // mismatched nonce indicates a spoofed dispatch from page-script code.
    if (!e || !e.detail || e.detail.nonce !== _capturedNonce) {
      if (!_warnedOrder && e && e.detail && typeof e.detail.nonce === "string" && _capturedNonce === null) {
        _warnedOrder = true;
        console.warn("[MUGA] gate event before nonce capture — check manifest script order");
      }
      return;
    }
    _gateOpen = !!(e.detail.enabled);
  });

  function gateOpen() {
    return _gateOpen;
  }

  // ── Post-commit signal (#951 Layer B) ────────────────────────────────────
  //
  // The subset strip above is a synchronous, defense-in-depth measure only
  // (see file docblock). It does NOT cover path segments (e.g. Amazon's
  // trailing `/ref=...`) or the full tracking-param list, because doing the
  // full clean here would require an async round-trip the page might
  // observe. Instead, once the native call has committed (so
  // `window.location` already reflects the new URL), we tell the
  // isolated-world side to run the FULL pipeline (path + query rules) via
  // `muga:history-committed`. The isolated-world listener lives in
  // history-defuser.js; the actual reclean logic lives in cleaner.js
  // (`window.__mugaReclean`), which is only reachable from the isolated
  // world.
  //
  // SECURITY (#811): this event is dispatched from the MAIN (page) world, so
  // its CustomEvent detail is fully readable by hostile page scripts. It must
  // NOT carry the gate nonce — leaking it would hand the page the secret that
  // guards the `muga:history-gate` handshake, letting it forge a gate event
  // and force the gate closed to disable cleaning. No nonce is needed here:
  // the isolated reclean this triggers only ever calls history.replaceState()
  // on the resulting URL, something page scripts can already do directly, so a
  // forged committed event grants no capability the page lacks.
  function dispatchCommitted(finalUrl) {
    try {
      document.dispatchEvent(new CustomEvent("muga:history-committed", {
        detail: { url: finalUrl },
      }));
    } catch { /* document detached or CustomEvent unavailable — silent */ }
  }

  const origPush = history.pushState;
  const origReplace = history.replaceState;

  history.pushState = function pushState(state, title, url) {
    let finalUrl = url;
    if (arguments.length >= 3 && gateOpen()) {
      try { finalUrl = cleanUrl(url); } catch { finalUrl = url; }
    }
    const ret = arguments.length >= 3
      ? origPush.call(this, state, title, finalUrl)
      : origPush.call(this, state, title);
    if (arguments.length >= 3 && gateOpen()) dispatchCommitted(finalUrl);
    return ret;
  };

  history.replaceState = function replaceState(state, title, url) {
    let finalUrl = url;
    if (arguments.length >= 3 && gateOpen()) {
      try { finalUrl = cleanUrl(url); } catch { finalUrl = url; }
    }
    const ret = arguments.length >= 3
      ? origReplace.call(this, state, title, finalUrl)
      : origReplace.call(this, state, title);
    if (arguments.length >= 3 && gateOpen()) dispatchCommitted(finalUrl);
    return ret;
  };
})();
