/**
 * MUGA: History Defuser — isolated-world gatekeeper (#444 / B10)
 *
 * The actual `history.pushState` / `history.replaceState` wrap lives in
 * a sibling main-world content script (`history-defuser-mainworld.js`)
 * — see that file for the WHY of dual-world wiring. This isolated-world
 * script is responsible for one job: reading the user's prefs and
 * notifying the main-world wrap whether the disabled-state gate is
 * open.
 *
 * Cross-world signaling: a `CustomEvent` dispatched on `document`
 * crosses the isolated/main-world boundary in MV3 (and on Firefox MV2
 * via the same DOM event bus). `window` property writes don't cross —
 * that's why we don't just set `window.__mugaEnabled` from here.
 *
 * The gate fails CLOSED by default: until prefs land and we dispatch a
 * `muga:history-gate { detail: { enabled: true } }` event, the
 * main-world wrap forwards calls untouched. Cleaner safe than
 * surprising a not-yet-onboarded user with a mutated URL.
 */

(function () {
  "use strict";

  // Skip iframes — same guard as cleaner.js.
  if (window.self !== window.top) return;
  if (window.__mugaHistoryDefuserGate) return;
  window.__mugaHistoryDefuserGate = true;

  // ── Nonce handshake (#811) ────────────────────────────────────────────
  //
  // The `muga:history-gate` CustomEvent crosses the isolated/main-world
  // boundary and is therefore also dispatchable by hostile page scripts.
  // A page can call `document.dispatchEvent(new CustomEvent("muga:history-gate",
  // { detail: { enabled: false } }))` to silently disable the active-defense
  // layer or force-open it pre-consent.
  //
  // Fix: generate a random nonce here (isolated world, first script in the
  // injection order), share it via a one-shot `muga:history-gate:nonce` event
  // that fires at document_start BEFORE any page script can run, and require
  // every subsequent gate event to carry the correct nonce in its detail.
  //
  // Injection-order contract (PINNED — do not reorder without updating both
  // manifests AND tests/unit/gate-nonce.test.mjs):
  //
  //   The handshake fires ONCE, synchronously, at document_start. Every
  //   listener script MUST be ordered BEFORE this file in BOTH manifests
  //   (src/manifest.json and src/manifest.v2.json). A listener that
  //   registers AFTER this dispatch never captures the nonce and stays
  //   fail-closed — it will reject every subsequent gate event silently.
  //   Ordering is pinned by tests/unit/gate-nonce.test.mjs.
  //
  //   MV3 Chrome — MAIN-world scripts (history-defuser-mainworld.js,
  //     window-name-defuser-mainworld.js) run in a separate group that
  //     executes before the ISOLATED group; they register their nonce
  //     listeners before this file fires. Within the ISOLATED group, all
  //     gate-aware siblings (window-name-defuser.js, dom-link-rewriter.js,
  //     dom-link-rewriter-click.js, bounce-state-cleaner.js) are listed
  //     before this file in the manifest so they register first.
  //   Firefox MV2 — no world:MAIN group; the window-name-defuser-mainworld
  //     page copy is injected as a synchronous <script> by
  //     window-name-defuser.js (which runs before this file). All isolated-
  //     world siblings are likewise listed before this file in the manifest.
  //
  // No global property stores the nonce after handshake — it lives only
  // inside each listener's closure to prevent page scripts from reading it
  // back via window inspection.
  const _nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(_nonceBytes);
  const _nonce = Array.from(_nonceBytes, (b) => b.toString(16).padStart(2, "0")).join("");

  // ── Firefox MV2 page-world bootstrap (#509 / B12) ────────────────────
  //
  // Chrome MV3 registers `history-defuser-mainworld.js` as a `world: "MAIN"`
  // content script (see src/manifest.json) — the browser handles loading
  // it into the page world automatically. Firefox MV2 has no `world: "MAIN"`
  // support, so the same script must be injected from this isolated-world
  // script as a `<script src=...>` element pointing at the extension's
  // web-accessible resource. The injected `<script>` runs in the page world
  // because that's where `<script>` tags execute by default; the extension
  // origin and `web_accessible_resources` declaration in manifest.v2.json
  // make the resource URL loadable cross-origin from the page.
  //
  // MV3 detection is `manifest_version === 3`. We skip the inject in MV3 so
  // we don't double-bootstrap.
  try {
    const mv = chrome.runtime.getManifest && chrome.runtime.getManifest().manifest_version;
    if (mv === 2) {
      const s = document.createElement("script");
      s.src = chrome.runtime.getURL("content/history-defuser-mainworld.js");
      // Synchronous so the wrap installs before the page's first script runs.
      // Modern browsers honour async=false for in-document insertion.
      s.async = false;
      const target = document.head || document.documentElement;
      if (target) {
        target.appendChild(s);
        // Detach from the DOM as soon as it's executed; the wrap lives on
        // window.history regardless of whether the <script> node is present.
        s.remove();
      }
    }
  } catch { /* manifest unavailable / DOM not ready — leave the page-world wrap absent */ }

  // Broadcast the nonce once at document_start so all listeners (both worlds)
  // can capture it before any page script executes. This event is fired once
  // and never again; listeners remove themselves after capturing the nonce.
  try {
    document.dispatchEvent(new CustomEvent("muga:history-gate:nonce", {
      detail: { nonce: _nonce },
    }));
  } catch { /* document detached — silent */ }

  function dispatchGate(enabled) {
    try {
      document.dispatchEvent(new CustomEvent("muga:history-gate", {
        detail: { enabled: !!enabled, nonce: _nonce },
      }));
    } catch { /* document detached or CustomEvent unavailable — silent */ }
  }

  // ── SPA reclean on committed history navigation (#951 Layer B) ─────────
  //
  // The main-world wrap (history-defuser-mainworld.js) only applies a
  // synchronous, hard-coded query-param SUBSET before committing a
  // pushState/replaceState — it has no chrome.* access and can't reach
  // path rules or the full tracking-param list. After it commits the call,
  // it dispatches `muga:history-committed` on `document` so this
  // isolated-world script can trigger the FULL cleaning pipeline
  // (path-strip + path-affiliate + full query rules) via
  // `window.__mugaReclean`, which is set by content/cleaner.js — a sibling
  // isolated-world script sharing the same `window` object.
  //
  // No nonce guard here (unlike the gate handshake): `muga:history-committed`
  // originates in the MAIN world, so its detail is page-readable and cannot
  // carry a secret without leaking it (see the SECURITY note in
  // history-defuser-mainworld.js). A forged event is harmless — __mugaReclean
  // only calls history.replaceState() on the URL, which the page can already
  // do itself — and is further bounded by the prefs gate + loop guard inside
  // __mugaReclean.
  document.addEventListener("muga:history-committed", (e) => {
    if (!e || !e.detail) return;
    try {
      if (typeof window.__mugaReclean === "function") {
        window.__mugaReclean(e.detail.url);
      }
    } catch { /* never let a reclean failure break the page's navigation */ }
  });

  // ── popstate / hashchange coverage (#951 Layer B, additive) ─────────────
  //
  // Back/forward navigation (popstate) and hash-only routing (hashchange)
  // are ALSO same-document navigations that never hit the network layer,
  // so DNR never sees them — same gap as pushState/replaceState. These are
  // genuine browser-dispatched events (not page-triggerable the way a
  // CustomEvent is), so no nonce handshake is needed here. Gating
  // (enabled/onboardingDone) happens inside window.__mugaReclean itself.
  window.addEventListener("popstate", () => {
    try {
      if (typeof window.__mugaReclean === "function") {
        window.__mugaReclean(window.location.href);
      }
    } catch { /* never let a reclean failure break the page's navigation */ }
  });

  window.addEventListener("hashchange", () => {
    try {
      if (typeof window.__mugaReclean === "function") {
        window.__mugaReclean(window.location.href);
      }
    } catch { /* never let a reclean failure break the page's navigation */ }
  });

  function readPrefsAndGate() {
    try {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
        void chrome.runtime.lastError;
        const prefsOk = !!(prefs && prefs.enabled && prefs.onboardingDone);
        // #1006: a whitelisted domain or a per-site paused domain (#995) must
        // turn OFF the active-defense scripts entirely - window.name defuser,
        // this history defuser, the DOM link rewriter, and the click
        // rewriter all gate on this single muga:history-gate event, so
        // factoring the exemption in here fixes all four at once instead of
        // requiring the user to fully disable MUGA to unbreak a site.
        //
        // Fail-safe: if the bundle helper is unavailable, throws, or prefs
        // is malformed, `exempt` stays false and active-defense stays ON.
        // A missing/failed helper must never silently disable protection.
        let exempt = false;
        try {
          const cleaner = window.__mugaCleaner;
          if (cleaner && typeof cleaner.isSiteExemptFromActiveDefense === "function") {
            exempt = cleaner.isSiteExemptFromActiveDefense(location.hostname, prefs);
          }
        } catch {
          // Fail-safe: treat as not exempt, active-defense stays ON.
        }
        // #1006: users can disable active-defense content scripts (history pushState/replaceState
        // cleaning, window.name defusing, DOM link/click rewriting) if they break a site.
        // Default to ON when the pref key is absent (older installs / not yet synced).
        const activeDefenseOn = !(prefs && prefs.activeDefenseEnabled === false);
        dispatchGate(prefsOk && activeDefenseOn && !exempt);
      });
    } catch {
      // Extension context invalidated. Leave the gate closed.
    }
  }

  // Eagerly populate the gate. The main-world wrap may have already
  // intercepted the very first pushState before this resolves; that's
  // an inherent race we accept (fail-closed).
  readPrefsAndGate();

  // Re-read on storage changes so toggling MUGA off in the popup closes
  // the gate without a page reload.
  //
  // Once-guard (#832): the IIFE's window.__mugaHistoryDefuserGate check
  // (above) already prevents this block from running more than once per
  // window lifetime, making duplicate listener registration impossible in
  // practice. The _storageListenerInstalled boolean is defense-in-depth:
  // it makes the once-only intent explicit and guards against any future
  // refactor that might extract this block into a callable function or
  // remove the top-level gate.
  let _storageListenerInstalled = false;
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.onChanged) {
    if (!_storageListenerInstalled) {
      _storageListenerInstalled = true;
      chrome.storage.onChanged.addListener((_changes, area) => {
        if (area === "sync" || area === "local") readPrefsAndGate();
      });
    }
  }
})();
