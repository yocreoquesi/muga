/**
 * MUGA: DOM Link Rewriter — Click Interceptor (#450 / B9)
 *
 * Sister module to `src/lib/dom-link-rewriter.js` (B8). B8's
 * MutationObserver covers SPA re-renders and static anchors but does
 * NOT cover the last-millisecond reinjection trick used by Twitter,
 * Facebook, LinkedIn and similar sites: a `mousedown` listener in the
 * page that re-decorates `event.target.href` AFTER MUGA has already
 * cleaned it via the observer. By the time the click fires, navigation
 * is already heading to the dirty URL.
 *
 * B9 closes that gap with capture-phase listeners on `mousedown` and
 * `click` at the document level. Capture phase runs BEFORE the page's
 * own bubble-phase listeners and BEFORE the browser starts navigation
 * — exactly the window we need to re-run the cleaner in place.
 *
 * Two non-negotiable contracts drive this module:
 *
 *   1. PASSIVE — never call preventDefault, stopPropagation, or
 *      stopImmediatePropagation. The user's click and the resulting
 *      navigation MUST proceed; we only tweak the href the navigation
 *      will follow.
 *   2. NEVER THROW — a thrown error in a capture-phase listener won't
 *      block navigation in modern browsers, but it WILL spam the
 *      console on every click and may trip page-level error reporters.
 *      Swallow and skip; the rewriter is best-effort defense, not a
 *      correctness gate.
 *
 * Reuses the B8 rewriter wholesale via dependency injection. The B8
 * `rewriteLink(anchor)` is exactly the operation needed at click time
 * — it reads the current href, runs the cleaner, and writes back only
 * when something changed (idempotency invariant carries over).
 *
 * Idempotency: capture-phase mousedown AND capture-phase click on the
 * same anchor will BOTH fire and BOTH call rewriteLink. Each rewrite
 * is a no-op on already-clean URLs (B8 guarantee), so no debouncing
 * is needed and we keep the implementation trivially simple.
 */

/**
 * @typedef {object} ClickRewriterDeps
 * @property {{ rewriteLink: (anchor: object) => void }} rewriter
 *   The B8 rewriter (or any object exposing `rewriteLink`). Receives
 *   the resolved anchor element on each mousedown/click in capture
 *   phase. Throws inside `rewriteLink` are swallowed.
 * @property {(event: object) => (object|null)} [getAnchorFromEvent]
 *   Optional override resolver. Default closes over
 *   `event.target.closest('a[href]')` — handles clicks on text, spans,
 *   or images nested inside an anchor. Override when stub-testing or
 *   when shadow-DOM event retargeting needs custom logic.
 */

/**
 * @typedef {object} ClickRewriter
 * @property {(event: object) => void} onMousedown
 *   Capture-phase mousedown handler. Resolves the anchor, calls
 *   `rewriter.rewriteLink`. Never preventsDefault/stopsPropagation.
 * @property {(event: object) => void} onClick
 *   Capture-phase click handler. Same shape as `onMousedown`.
 * @property {(target: EventTarget) => void} install
 *   Attaches `onMousedown` + `onClick` to the given target with
 *   `{capture: true}`. Idempotent — calling twice with the same
 *   target does NOT double-attach.
 * @property {(target: EventTarget) => void} uninstall
 *   Detaches the listeners installed by `install`. No-op if `install`
 *   was never called.
 */

/**
 * Default anchor resolver — `event.target.closest('a[href]')`.
 *
 * Encapsulated so tests can replace it via `getAnchorFromEvent`. The
 * real DOM Element prototype provides `closest`; defensive checks
 * accommodate synthetic events / shadow-DOM hosts that don't.
 *
 * @param {object} event
 * @returns {object|null}
 */
function defaultGetAnchorFromEvent(event) {
  if (!event) return null;
  const target = event.target;
  if (!target || typeof target.closest !== "function") return null;
  try {
    return target.closest("a[href]") || null;
  } catch {
    // closest can throw on detached nodes or unsupported selectors in
    // exotic environments. Skip silently — the click still navigates.
    return null;
  }
}

/**
 * Builds a click-rewriter bound to the given B8 rewriter.
 *
 * @param {ClickRewriterDeps} [deps]
 * @returns {ClickRewriter}
 */
export function createClickRewriter(deps) {
  const rewriter = deps && deps.rewriter;
  if (!rewriter || typeof rewriter.rewriteLink !== "function") {
    throw new TypeError(
      "createClickRewriter requires { rewriter: { rewriteLink } }"
    );
  }
  const getAnchor = (deps && deps.getAnchorFromEvent) || defaultGetAnchorFromEvent;

  // Tracks whether listeners are currently attached to a target. Stored
  // by reference so install() called twice with the same target is a
  // no-op AND so a different target can still be installed/uninstalled
  // independently. Most callers only ever pass `document` — the Map
  // shape just keeps the module composable for tests.
  const installed = new WeakSet();

  function handle(event) {
    let anchor;
    try {
      anchor = getAnchor(event);
    } catch {
      return;
    }
    if (!anchor) return;
    try {
      rewriter.rewriteLink(anchor);
    } catch {
      // Cleaner / rewriter blew up. We deliberately do NOT propagate —
      // see the NEVER THROW contract in the docblock. Navigation
      // proceeds to whatever href is on the anchor right now, which is
      // strictly no worse than not having the rewriter at all.
    }
    // CRITICAL: control flow ends here. We do NOT call preventDefault,
    // stopPropagation, or stopImmediatePropagation under any circumstance.
  }

  function onMousedown(event) { handle(event); }
  function onClick(event) { handle(event); }

  // Capture-phase options object. Spec form `{capture: true}` is supported
  // in every modern browser and (importantly) in Firefox MV2 — using the
  // boolean `true` shorthand also works but the object form documents
  // intent at the call site.
  const CAPTURE_OPTS = { capture: true };

  function install(target) {
    if (!target || typeof target.addEventListener !== "function") return;
    if (installed.has(target)) return; // idempotent — see docblock
    target.addEventListener("mousedown", onMousedown, CAPTURE_OPTS);
    target.addEventListener("click", onClick, CAPTURE_OPTS);
    installed.add(target);
  }

  function uninstall(target) {
    if (!target || typeof target.removeEventListener !== "function") return;
    if (!installed.has(target)) return;
    target.removeEventListener("mousedown", onMousedown, CAPTURE_OPTS);
    target.removeEventListener("click", onClick, CAPTURE_OPTS);
    installed.delete(target);
  }

  return { onMousedown, onClick, install, uninstall };
}
