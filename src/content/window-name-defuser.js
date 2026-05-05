/**
 * MUGA: Window-Name Defuser — isolated-world gatekeeper (#451 / B11)
 *
 * The actual `window.name` property accessor lives in a sibling main-
 * world content script (`window-name-defuser-mainworld.js`) — see that
 * file for the WHY of dual-world wiring.
 *
 * Gate sharing with B10: this file deliberately does NOT dispatch its
 * own gate event. The isolated-world gatekeeper for the History
 * Defuser (`history-defuser.js`) already reads prefs and dispatches
 * `muga:history-gate`; the window-name main-world wrap listens on the
 * same event. One isolated-world dispatcher governs both main-world
 * defusers because both are gated on the same "active-defense"
 * domain (`enabled && onboardingDone`). Splitting the gate would mean
 * two independent prefs round-trips on every page load and two
 * separate `chrome.storage.onChanged` re-evaluations — a cost without
 * a corresponding feature win.
 *
 * The companion isolated-world gate (`history-defuser.js`) is
 * registered alongside this file in both manifests; this script's
 * existence is therefore primarily structural — it keeps the B11
 * file set parallel to B10 (so future divergence, e.g. a dedicated
 * `windowNameDefuserEnabled` pref, has a place to land) and gives the
 * manifest wiring tests a script to assert.
 */

(function () {
  "use strict";

  // Skip iframes — same guard as cleaner.js.
  if (window.self !== window.top) return;
  if (window.__mugaWindowNameDefuserGate) return;
  window.__mugaWindowNameDefuserGate = true;

  // ── Firefox MV2 page-world bootstrap (#509 / B12) ────────────────────
  //
  // Same rationale as `history-defuser.js`: Chrome MV3 loads the page-
  // world wrap automatically via `world: "MAIN"`; Firefox MV2 has no
  // such directive, so this isolated-world script injects the
  // `window-name-defuser-mainworld.js` resource as a page-world
  // `<script>` element. The wrap installs the property accessor on
  // `window.name` BEFORE the document parser starts running page
  // scripts (synchronous insert at document_start).
  //
  // The `web_accessible_resources` entry in manifest.v2.json is what
  // makes `chrome.runtime.getURL("content/window-name-defuser-mainworld.js")`
  // loadable as a `<script src>` from the page origin.
  try {
    const mv = chrome.runtime.getManifest && chrome.runtime.getManifest().manifest_version;
    if (mv === 2) {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("content/window-name-defuser-mainworld.js");
      s.async = false;
      const target = document.head || document.documentElement;
      if (target) {
        target.appendChild(s);
        s.remove();
      }
    }
  } catch { /* manifest unavailable / DOM not ready — leave the page-world wrap absent */ }

  // Intentionally empty body. Gate dispatch is handled by
  // `history-defuser.js` via the `muga:history-gate` event, which the
  // window-name main-world wrap also listens to. See the docblock for
  // the rationale.
})();
