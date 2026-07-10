/**
 * MUGA: Hover destination preview (#1028, Proof of Concept)
 *
 * Desktop-only, fully local content script. When the user hovers AND holds
 * the mouse still over a link for ~hoverPreviewDelayMs (default 2.5s), shows a
 * small text-only tooltip with the link's REAL, cleaned destination — never
 * page content, never a screenshot.
 *
 * Shown ONLY when MUGA's local unwrap/clean pipeline changes the link's
 * HOST — i.e. the link is a redirect wrapper (l.facebook.com/l.php?u=…,
 * google.com/url?q=…, generic redirect networks). A plain link whose
 * destination host is unchanged (e.g. a UTM-only tracking link) shows
 * NOTHING — that case has no hidden destination worth surfacing.
 *
 * Fully local: no network access, no new permissions, no mutation of the
 * anchor's href, no interference with the click. Native-shortener
 * resolution (fetch-based) is explicitly out of scope for this PoC —
 * shorteners never show a preview here since resolving them requires a
 * network round trip.
 *
 * Note: ES module imports are not supported in MV3/MV2 content scripts, so
 * (like content/cleaner.js) the tooltip label translations are inlined
 * below. Keep LABELS in sync with the "hover_preview_label" key in
 * src/lib/i18n.js (en/es/pt/de/fr/it/ja).
 */

(function () {
  "use strict";

  // Skip iframes — same guard as the rest of the content scripts.
  if (window.self !== window.top) return;
  if (window.__mugaHoverPreview) return;
  window.__mugaHoverPreview = true;

  // ── Guard 1 (PC-only) ───────────────────────────────────────────────────
  // Desktop = coarse-vs-fine pointer AND hover capability. On touch-only
  // devices (Firefox Android) this never matches, so the entire script is a
  // no-op there — no listeners are ever registered.
  let _mq;
  try {
    _mq = window.matchMedia("(hover: hover) and (pointer: fine)");
  } catch {
    return;
  }
  if (!_mq || !_mq.matches) return;

  // ── Inline i18n (mirrors content/cleaner.js's STRINGS pattern) ──────────
  // Mirrors i18n key "hover_preview_label" (src/lib/locales/*.mjs) — content
  // scripts can't import ES modules, so the values are duplicated here.
  const LABELS = {
    en: "Goes to:",
    es: "Va a:",
    pt: "Vai para:",
    de: "Führt zu:",
    fr: "Mène à :",
    it: "Porta a:",
    ja: "遷移先:",
  };
  const SUPPORTED_LANGS = { en: 1, es: 1, pt: 1, de: 1, fr: 1, it: 1, ja: 1 };
  const _navLang = (navigator.language || "en").slice(0, 2);
  let _label = LABELS[_navLang in SUPPORTED_LANGS ? _navLang : "en"];

  // ── Prefs cache — fetched once via getPrefs, refreshed on storage change ─
  let _prefs = null;

  function loadPrefs() {
    try {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (prefs) => {
        void chrome.runtime.lastError;
        _prefs = prefs || null;
        if (_prefs && _prefs.language && SUPPORTED_LANGS[_prefs.language]) {
          _label = LABELS[_prefs.language];
        }
      });
    } catch {
      // Extension context invalidated (e.g. mid-reload) — _prefs stays null
      // and the gate below fails closed (no preview shown).
    }
  }
  loadPrefs();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === "sync") loadPrefs();
    });
  } catch {
    // storage API unavailable — prefs simply won't refresh live.
  }

  // ── Tooltip (single reused element, styled via one injected <style>) ────
  const TOOLTIP_CLASS = "muga-hover-preview-tooltip";
  const LABEL_CLASS = "muga-hover-preview-label";
  let _styleInjected = false;
  let _tooltip = null;

  function ensureStyle() {
    if (_styleInjected) return;
    _styleInjected = true;
    try {
      const style = document.createElement("style");
      // Solid, non-theme-dependent colors (not page CSS vars) so the tooltip
      // reads correctly regardless of the host page's light/dark styling.
      style.textContent =
        "." + TOOLTIP_CLASS + "{" +
          "position:fixed;" +
          "display:none;" +
          "background:#1c1c1e;" +
          "color:#f5f5f5;" +
          "border:1px solid rgba(255,255,255,0.25);" +
          "border-radius:6px;" +
          "padding:6px 10px;" +
          "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;" +
          "font-size:12px;" +
          "line-height:1.4;" +
          "max-width:380px;" +
          "white-space:nowrap;" +
          "overflow:hidden;" +
          "text-overflow:ellipsis;" +
          "box-shadow:0 2px 14px rgba(0,0,0,0.35);" +
          "z-index:2147483647;" +
          "pointer-events:none;" +
        "}" +
        "." + LABEL_CLASS + "{font-weight:600;margin-right:5px;color:#a8a8ad;}";
      (document.head || document.documentElement).appendChild(style);
    } catch {
      // Style injection failed (e.g. a strict page CSP blocking inline
      // <style>). The inline styles set directly on the tooltip element in
      // ensureTooltip() below still make it legible.
    }
  }

  function ensureTooltip() {
    if (_tooltip && _tooltip.isConnected) return _tooltip;
    ensureStyle();
    const el = document.createElement("div");
    el.className = TOOLTIP_CLASS;
    el.setAttribute("role", "tooltip");
    el.setAttribute("aria-hidden", "true");
    // Inline fallback in case the injected <style> above never landed.
    el.style.position = "fixed";
    el.style.pointerEvents = "none";
    el.style.zIndex = "2147483647";
    el.style.display = "none";
    (document.body || document.documentElement).appendChild(el);
    _tooltip = el;
    return el;
  }

  function truncate(str, max) {
    if (typeof str !== "string" || str.length <= max) return str;
    return str.slice(0, max - 1) + "…";
  }

  function hideTooltip() {
    if (!_tooltip) return;
    _tooltip.style.display = "none";
    _tooltip.setAttribute("aria-hidden", "true");
  }

  function positionTooltip(el, anchor) {
    const rect = anchor.getBoundingClientRect();
    const vw = document.documentElement.clientWidth;
    const vh = document.documentElement.clientHeight;
    const elW = el.offsetWidth || 200;
    const elH = el.offsetHeight || 24;
    // position:fixed is already viewport-relative, so getBoundingClientRect()
    // needs no added scroll offset here — adding one would double-offset.
    let left = rect.left;
    let top = rect.bottom + 6;
    if (left + elW > vw - 8) left = Math.max(8, vw - elW - 8);
    if (left < 8) left = 8;
    if (top + elH > vh - 8) top = rect.top - elH - 6;
    if (top < 8) top = 8;
    el.style.left = left + "px";
    el.style.top = top + "px";
  }

  function showTooltip(anchor, destinationUrl) {
    const el = ensureTooltip();
    el.textContent = "";
    const labelEl = document.createElement("span");
    labelEl.className = LABEL_CLASS;
    labelEl.textContent = _label;
    el.appendChild(labelEl);
    el.appendChild(document.createTextNode(truncate(destinationUrl, 120)));
    el.title = destinationUrl; // full URL always available on hover of the tooltip itself
    el.style.display = "block";
    el.setAttribute("aria-hidden", "false");
    positionTooltip(el, anchor);
  }

  // ── Gate — re-checked immediately before showing, not just at hover-start ─
  function gatePasses() {
    if (!_prefs) return false;
    if (_prefs.enabled === false) return false;
    if (_prefs.hoverPreviewEnabled === false) return false;
    try {
      if (window.__mugaCleaner && typeof window.__mugaCleaner.isSiteFullyExempt === "function") {
        if (window.__mugaCleaner.isSiteFullyExempt(location.hostname, _prefs)) return false;
      }
    } catch {
      // Fail-safe: treat as not exempt on any unexpected throw.
    }
    return true;
  }

  // ── Hover-and-hold interaction ────────────────────────────────────────────
  let _currentAnchor = null;
  let _timer = null;

  function clearHoverState() {
    if (_timer) {
      clearTimeout(_timer);
      _timer = null;
    }
    _currentAnchor = null;
    hideTooltip();
  }

  function resolveHttpAnchor(el) {
    if (!el || typeof el.closest !== "function") return null;
    const anchor = el.closest("a[href]");
    if (!anchor) return null;
    let href;
    try {
      href = anchor.href;
    } catch {
      return null;
    }
    if (typeof href !== "string" || !/^https?:\/\//i.test(href)) return null;
    return anchor;
  }

  function fireHover(anchor, href) {
    // The still-hovered anchor could have changed between scheduling the
    // timer and it firing (defensive; clearHoverState should already have
    // cancelled the timeout in that case).
    if (_currentAnchor !== anchor) return;
    if (!window.__mugaCleaner || typeof window.__mugaCleaner.processUrl !== "function") return;
    if (!gatePasses()) return;

    let result;
    try {
      result = window.__mugaCleaner.processUrl(href, _prefs, [], undefined, undefined, "", [], []);
    } catch {
      return;
    }
    if (!result || typeof result.cleanUrl !== "string" || !result.cleanUrl) return;

    let changed = false;
    try {
      changed = new URL(result.cleanUrl).host !== new URL(href).host;
    } catch {
      return;
    }
    if (!changed) return; // plain link, destination host unchanged — show nothing

    showTooltip(anchor, result.cleanUrl);
  }

  document.addEventListener("mouseover", (e) => {
    const anchor = resolveHttpAnchor(e.target);
    if (!anchor || anchor === _currentAnchor) return;
    clearHoverState();
    _currentAnchor = anchor;
    let href;
    try {
      href = anchor.href;
    } catch {
      _currentAnchor = null;
      return;
    }
    const delay = (_prefs && _prefs.hoverPreviewDelayMs) || 2500;
    _timer = setTimeout(() => {
      _timer = null;
      fireHover(anchor, href);
    }, delay);
  }, true);

  document.addEventListener("mouseout", (e) => {
    if (!_currentAnchor) return;
    // relatedTarget is where the pointer is headed. Moving between two
    // descendants of the SAME anchor (e.g. an inner <span>) is not a real
    // "leave" and must not reset the hold timer.
    const to = e.relatedTarget;
    if (to && _currentAnchor.contains(to)) return;
    clearHoverState();
  }, true);

  document.addEventListener("mousemove", (e) => {
    if (!_currentAnchor) return;
    // "Still-ish" hold: only reset if the pointer has moved onto a different
    // element than the one currently tracked (i.e. left the anchor
    // entirely, including onto a different anchor). Movement within the
    // same anchor's subtree does not reset the timer.
    const anchor = resolveHttpAnchor(e.target);
    if (anchor !== _currentAnchor) clearHoverState();
  }, true);

  document.addEventListener("scroll", () => {
    if (_currentAnchor) clearHoverState();
  }, true);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && _currentAnchor) clearHoverState();
  }, true);

  document.addEventListener("click", () => {
    if (_currentAnchor) clearHoverState();
  }, true);
})();
