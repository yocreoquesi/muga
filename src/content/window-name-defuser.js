/**
 * MUGA: Window-Name Defuser — isolated-world gate + Firefox page-world wrap
 * (#451 / B11, CSP-immune port #509 / B12).
 *
 * The `window.name` property accessor that actually cleans reads is
 * installed in the PAGE world. There are two delivery paths:
 *
 *   - Chrome MV3: the sibling main-world content script
 *     (`window-name-defuser-mainworld.js`) is loaded natively via the
 *     `world: "MAIN"` directive in `src/manifest.json`. This file does
 *     NOTHING on Chrome beyond the once-guard — see the early return.
 *   - Firefox MV2: there is no `world: "MAIN"`. The previous approach
 *     injected the main-world script as a `<script src="moz-extension://…">`
 *     element, but a page's Content-Security-Policy (e.g. Amazon) silently
 *     blocks that injected script, so `window.name` was never defused on
 *     CSP-strict sites. This isolated-world script now installs the page-
 *     world accessor DIRECTLY via Firefox's `window.wrappedJSObject` +
 *     `exportFunction` — no `<script>` element is created, so no page CSP
 *     can block it. This mirrors the CSP-immune history wrap in
 *     `history-defuser.js` (#1022 / B12).
 *
 * Gate sharing with B10: this file does NOT read prefs itself. The
 * isolated-world gatekeeper for the History Defuser (`history-defuser.js`)
 * already reads prefs and dispatches the `muga:history-gate` event (with
 * the #811 nonce handshake); the Firefox page-world wrap below listens on
 * the same event. One isolated-world dispatcher governs both defusers
 * because both gate on the same "active-defense" pref domain
 * (`enabled && onboardingDone && activeDefenseEnabled && !exempt`).
 * Splitting the gate would mean two independent prefs round-trips per page
 * load — a cost without a feature win. `window-name-defuser.js` is ordered
 * BEFORE `history-defuser.js` in both manifests, so it captures the nonce
 * before the dispatcher fires (invariant pinned by gate-nonce.test.mjs).
 *
 * Read-time cleaning (not write-time): many legitimate scripts WRITE a
 * value and READ IT BACK expecting the exact value to round-trip (cross-
 * frame handshakes, OAuth transports). Cleaning on write would corrupt
 * those flows; cleaning on read mutates only what tracking-recovery
 * scripts see, and non-URL payloads pass through verbatim via the URL-
 * shape gate. See `src/lib/window-name-defuser.js` for the pure model.
 */

/* global exportFunction */
(function () {
  "use strict";

  // Skip iframes — same guard as cleaner.js. Wrapping `window.name` inside
  // cross-origin iframes risks corrupting cross-frame messaging patterns
  // that legitimately use the property as a transport.
  if (window.self !== window.top) return;
  if (window.__mugaWindowNameDefuserGate) return;
  window.__mugaWindowNameDefuserGate = true;

  // Chrome MV3 loads the page-world wrap via `world: "MAIN"`; this isolated
  // script has nothing to do there. Only Firefox MV2 (no world:MAIN, with
  // wrappedJSObject + exportFunction available) installs the wrap here.
  let mv;
  try {
    mv = chrome.runtime.getManifest && chrome.runtime.getManifest().manifest_version;
  } catch {
    mv = undefined;
  }
  if (mv !== 2 || typeof exportFunction !== "function" || !window.wrappedJSObject) {
    return;
  }

  // Subset of TRACKING_PARAMS from src/lib/affiliates.js. Kept BYTE-IDENTICAL
  // with the same table in dom-link-rewriter.js, dom-link-rewriter-click.js,
  // history-defuser-mainworld.js and window-name-defuser-mainworld.js —
  // pinned by tests/unit/strip-table-parity.test.mjs. Object lookup is
  // faster than a Set for this hot path; values are unused (truthiness only).
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
   * Heuristic: only http/https URLs are treated as cleanable. Anything else
   * (opaque tokens, JSON, javascript:/data: URIs, plain words) is returned
   * verbatim by the caller without consulting the cleaner.
   */
  function looksLikeHttpUrl(s) {
    if (typeof s !== "string" || s.length === 0) return false;
    if (!/^https?:\/\//i.test(s)) return false;
    try {
      const u = new URL(s);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  /**
   * Strips the static tracking-param subset from `rawUrl`. Returns the
   * original string when nothing changed or when parsing fails — never
   * throws (a property-getter throw would be catastrophic for the page).
   */
  function cleanUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
    if (rawUrl.indexOf("?") < 0) return rawUrl;
    let u;
    try {
      u = new URL(rawUrl);
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
    return u.toString();
  }

  // ── Disabled-state gate (reuse B10 nonce handshake) ──────────────────────
  //
  // Same pattern as window-name-defuser-mainworld.js: capture the one-shot
  // `muga:history-gate:nonce` broadcast (fired by history-defuser.js, which
  // runs AFTER this file), then require every `muga:history-gate` event to
  // carry the matching nonce so hostile page scripts cannot force the gate.
  // Fail-closed: until a valid gate event lands, `_gateOpen` stays false and
  // the wrap is pass-through.
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
    if (!e || !e.detail || e.detail.nonce !== _capturedNonce) {
      if (!_warnedOrder && e && e.detail && typeof e.detail.nonce === "string" && _capturedNonce === null) {
        _warnedOrder = true;
        console.warn("[MUGA] gate event before nonce capture — check manifest script order");
      }
      return;
    }
    _gateOpen = !!(e.detail.enabled);
  });

  // ── Firefox MV2 page-world window.name wrap (CSP-immune) ─────────────────
  //
  // `window.wrappedJSObject` is the page's real Window without Xray wrappers;
  // defining a property on it defines it on the object page scripts see. The
  // get/set callbacks must be `exportFunction`-ed so the page world can call
  // them. Fail-safe: if Firefox refuses to redefine the special `name` slot
  // (or wrappedJSObject/exportFunction is unavailable), the whole block is a
  // no-op and native `window.name` is left untouched — never corrupted.
  try {
    const pageWindow = window.wrappedJSObject;

    // Capture the value the page may already hold. We run at document_start
    // before any page script, but another extension could have beaten us.
    let stored;
    try {
      stored = pageWindow.name;
    } catch {
      stored = "";
    }
    if (typeof stored !== "string") stored = "";

    Object.defineProperty(pageWindow, "name", {
      configurable: true,
      enumerable: true,
      get: exportFunction(function () {
        const raw = stored;
        if (typeof raw !== "string" || raw.length === 0) return raw;
        if (!_gateOpen) return raw;
        if (!looksLikeHttpUrl(raw)) return raw;
        try {
          const cleaned = cleanUrl(raw);
          if (typeof cleaned !== "string" || cleaned.length === 0) return raw;
          return cleaned;
        } catch {
          // Property getters MUST NOT throw — return the raw value.
          return raw;
        }
      }, pageWindow),
      set: exportFunction(function (v) {
        // Mirror the browser's own coercion: `window.name` stores strings.
        // Storage stays RAW — cleaning is read-time only, so scripts that
        // round-trip a token through window.name see it unchanged.
        stored = typeof v === "string" ? v : String(v);
      }, pageWindow),
    });
  } catch {
    /* wrappedJSObject property redefine rejected — leave native window.name
       intact (fail-safe). Worst case: no defuse on this page, never a corrupt
       value. */
  }
})();
