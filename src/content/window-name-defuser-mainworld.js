/**
 * MUGA: Window-Name Defuser — main-world content script (#451 / B11)
 *
 * Runs IN THE PAGE WORLD (`world: "MAIN"`) at `document_start` so it
 * can install a property accessor on the page's `window.name` BEFORE
 * any page script reads it. The isolated-world content script cannot
 * shadow `window.name` for the page — same MV3 isolated-world boundary
 * documented in `history-defuser-mainworld.js` (B10).
 *
 * Why on-read instead of on-write: many legitimate scripts WRITE a
 * value and then READ IT BACK expecting their exact value to round-
 * trip (cross-frame handshakes, popup result transports, OAuth flows).
 * Cleaning on write would corrupt those flows. Cleaning on read
 * mutates only what the tracking-recovery scripts see when they fish
 * the URL back out post-navigation; non-URL payloads pass through
 * verbatim because the URL-shape gate skips them.
 *
 * This file runs ONLY on Chrome MV3, loaded via the `world: "MAIN"`
 * content_scripts entry in src/manifest.json. Firefox MV2 does not
 * support `world: "MAIN"` and does NOT load this file at all. On
 * Firefox the page-world `window.name` wrap is installed directly by
 * the isolated-world companion `content/window-name-defuser.js`, which
 * reaches the page's real `window` via `window.wrappedJSObject` and
 * redefines the property with `exportFunction` (see that file for
 * details).
 *
 * Important constraints for this file:
 *
 *   - No chrome.* APIs. Main-world scripts have NO access to
 *     extension messaging — they share the page's privileges only.
 *   - No ES module imports. Runs as a classic script in the page
 *     world.
 *   - Tracking-param list is a HARD-CODED SUBSET. Same subset as
 *     `history-defuser-mainworld.js` — see comment on the STRIP table.
 *     Round-tripping to the SW per read would be async; the page may
 *     read `window.name` synchronously and feed it straight into a
 *     beacon. The subset covers the highest-volume params (UTM, click
 *     IDs, social).
 *   - Disabled-state guard: cannot read prefs from main world. Reuses
 *     the existing B10 `muga:history-gate` event so a single isolated-
 *     world dispatcher (`history-defuser.js`) governs both defusers.
 *     Same active-defense pref domain → same gate.
 */

(function () {
  "use strict";

  // Skip iframes — same guard as cleaner.js. Wrapping `window.name`
  // inside cross-origin iframes risks corrupting cross-frame messaging
  // patterns that legitimately use the property as a transport.
  if (window.self !== window.top) return;
  if (window.__mugaWindowNameDefused) return;
  window.__mugaWindowNameDefused = true;

  // Subset of TRACKING_PARAMS from src/lib/affiliates.js. Kept in sync
  // with the same table in `history-defuser-mainworld.js` (B10) — the
  // two defusers share the same active-defense param coverage.
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
   * Heuristic: only http/https URLs are treated as cleanable. Anything
   * else (opaque tokens, JSON, javascript:/data: URIs, plain words) is
   * returned verbatim by the caller without consulting the cleaner.
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
   * throws (a property-getter throw would be catastrophic for the
   * page).
   */
  function cleanUrl(rawUrl) {
    if (typeof rawUrl !== "string" || rawUrl.length === 0) return rawUrl;
    const qIndex = rawUrl.indexOf("?");
    if (qIndex < 0) return rawUrl;
    // audit-2026-07 S3: splice the raw query bytes instead of rebuilding via
    // URLSearchParams.toString(), which re-encodes every surviving param and
    // could corrupt a signature/token computed over exact bytes. Mirrors
    // src/lib/hot-path-strip.js stripHotPathQuery — keep the two in sync.
    const hashIndex = rawUrl.indexOf("#");
    if (hashIndex >= 0 && hashIndex < qIndex) return rawUrl;
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

  // Disabled-state gate. We REUSE the B10 event (`muga:history-gate`)
  // because both defusers fall under the same general "active-defense"
  // pref (gated on `enabled && onboardingDone`). One isolated-world
  // dispatcher → both main-world wraps. Until the first event arrives
  // the gate stays CLOSED (fail-closed): the wrap is installed but
  // pass-through, matching the disabled-state guard contract.
  //
  // Nonce handshake (#811): same pattern as history-defuser-mainworld.js.
  // The one-shot `muga:history-gate:nonce` event broadcasts the shared
  // secret before page scripts run; we capture it here and validate it
  // on every subsequent gate event to reject hostile page-script spoofing.
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
    // Reject events that do not carry the handshake nonce.
    if (!e || !e.detail || e.detail.nonce !== _capturedNonce) {
      if (!_warnedOrder && e && e.detail && typeof e.detail.nonce === "string" && _capturedNonce === null) {
        _warnedOrder = true;
        console.warn("[MUGA] gate event before nonce capture — check manifest script order");
      }
      return;
    }
    _gateOpen = !!(e.detail.enabled);
  });

  // Capture whatever value `window.name` held before we replaced the
  // property. The page may have set it before our document_start wrap
  // landed (rare in MV3 — we run before any page script — but possible
  // when another extension beat us to the property).
  let stored;
  try {
    stored = window.name;
  } catch {
    stored = "";
  }
  if (typeof stored !== "string") stored = "";

  Object.defineProperty(window, "name", {
    configurable: true,
    enumerable: true,
    get() {
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
    },
    set(v) {
      // Mirror the browser's own coercion: `window.name` stores strings.
      stored = typeof v === "string" ? v : String(v);
    },
  });
})();
