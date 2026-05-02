/**
 * MUGA: DOM Link Rewriter (#443 / B8)
 *
 * Watches `<a href>` attribute mutations in a page and runs URL cleaning
 * on each. Pairs with a content-script bootstrap that installs a real
 * `MutationObserver` and feeds its callback into `onMutation`. This pure
 * module has NO DOM, NO chrome.*, NO globals — so unit tests can exercise
 * it with stub anchors and stub mutation records.
 *
 * Two correctness invariants drive the design:
 *
 *   1. IDEMPOTENCY. If the cleaner returns the SAME string the anchor
 *      already has, this module MUST NOT call `setAttribute`. Calling
 *      `setAttribute('href', existingValue)` is observable as an
 *      `attributes` mutation; the observer would re-fire, and we'd
 *      either burn CPU forever or need an exclude-set workaround. The
 *      "no write when cleaned === current" rule lets self-induced
 *      mutations converge naturally on the second pass.
 *   2. NEVER THROW. A bad URL or a cleaner that explodes must NOT bubble
 *      out into the page's mutation flow. The browser will keep firing
 *      mutations regardless; failing loud just spams the console and
 *      leaves links unmodified anyway. Swallow and skip.
 *
 * Scope guard: only http(s)-shaped hrefs are candidates. mailto:, tel:,
 * javascript:, data:, blob: — and anything `URL` parses but the cleaner
 * doesn't know how to handle — pass through with no DOM write. Decision
 * deferred to the injected `isCleanLink` predicate so the content-script
 * wiring can match the rest of MUGA's scope rules without this module
 * making its own policy.
 */

/**
 * @typedef {object} LinkRewriterDeps
 * @property {(rawUrl: string) => string|null|undefined} urlCleaner
 *   Synchronous cleaner. Receives the anchor's current href string.
 *   Should return the cleaned URL string, or null/undefined when it has
 *   no opinion. Throws are swallowed.
 * @property {(href: string) => boolean} isCleanLink
 *   Returns true when the href is in scope for cleaning. Implementations
 *   typically reject mailto:, tel:, javascript:, data:, blob:, and empty
 *   strings. Called BEFORE the cleaner to avoid wasted parsing work on
 *   non-http schemes the cleaner can't handle anyway.
 */

/**
 * @typedef {object} LinkRewriter
 * @property {(anchor: object) => void} rewriteLink
 *   Reads `anchor.getAttribute('href')`, runs the cleaner, and only
 *   calls `anchor.setAttribute('href', cleaned)` when `cleaned !==
 *   current`. No-op when the anchor's tagName isn't "A".
 * @property {(nodeIterable: Iterable|ArrayLike|null) => void} rewriteAll
 *   Iterates and calls `rewriteLink` on each. Accepts arrays, NodeLists
 *   (Symbol.iterator + length), and null/undefined (no-op).
 * @property {(records: MutationRecord[]|null) => void} onMutation
 *   Processes a `MutationObserver` callback's record list. For each
 *   record:
 *     - `attributes` with `attributeName === 'href'` → rewrite the
 *       record's `target`.
 *     - `childList` → rewrite each `addedNode` that's an anchor, plus
 *       descend via `querySelectorAll('a[href]')` on element children.
 *   Other records ignored.
 */

/**
 * Builds a link-rewriter bound to the given cleaner + scope predicate.
 *
 * @param {LinkRewriterDeps} deps
 * @returns {LinkRewriter}
 */
export function createLinkRewriter(deps) {
  const urlCleaner = deps && deps.urlCleaner;
  const isCleanLink = deps && deps.isCleanLink;

  if (typeof urlCleaner !== "function" || typeof isCleanLink !== "function") {
    throw new TypeError(
      "createLinkRewriter requires { urlCleaner, isCleanLink } functions"
    );
  }

  function isAnchor(node) {
    // nodeType 1 is ELEMENT_NODE. tagName comparison is uppercase in
    // HTML documents — XHTML is case-sensitive but the observer is
    // installed on HTML pages exclusively.
    return !!(node && node.nodeType === 1 && node.tagName === "A");
  }

  function rewriteLink(anchor) {
    if (!isAnchor(anchor)) return;
    let current;
    try {
      current = anchor.getAttribute("href");
    } catch {
      return;
    }
    if (typeof current !== "string" || current.length === 0) return;
    if (!isCleanLink(current)) return;

    let cleaned;
    try {
      cleaned = urlCleaner(current);
    } catch {
      // Cleaner blew up on a malformed URL or some unexpected input.
      // Leaving the link untouched is strictly better than a runtime
      // error on a SPA mutation hot path.
      return;
    }
    // Reject anything that isn't a non-empty string — if the cleaner
    // can't produce one, the DOM stays as-is.
    if (typeof cleaned !== "string" || cleaned.length === 0) return;
    // THE IDEMPOTENCY GUARD. Without this check, the observer's next
    // callback would see our own setAttribute as a mutation, re-enter,
    // and (worst case) loop forever.
    if (cleaned === current) return;
    try {
      anchor.setAttribute("href", cleaned);
    } catch {
      // Detached node or readonly anchor — neither rare nor fatal.
    }
  }

  function rewriteAll(nodeIterable) {
    if (!nodeIterable) return;
    // for-of handles arrays, NodeLists, generators, and any custom
    // iterable. Indexed-only collections without Symbol.iterator are
    // not in scope — every browser NodeList we care about is iterable.
    try {
      for (const node of nodeIterable) {
        rewriteLink(node);
      }
    } catch {
      // Iterator threw mid-traversal. Stop and move on; partial work
      // is fine — the observer will re-fire on subsequent mutations.
    }
  }

  function processAddedNode(node) {
    if (!node || node.nodeType !== 1) return; // text nodes, comments → skip
    if (isAnchor(node)) {
      rewriteLink(node);
    }
    // Descend into the inserted subtree. SPA frameworks commonly
    // append a fragment containing many anchors — walking via
    // querySelectorAll is O(matches) inside the inserted subtree, not
    // the whole document.
    if (typeof node.querySelectorAll === "function") {
      let descendants;
      try {
        descendants = node.querySelectorAll("a[href]");
      } catch {
        return;
      }
      if (descendants) rewriteAll(descendants);
    }
  }

  function onMutation(records) {
    if (!records) return;
    let len;
    try { len = records.length; } catch { return; }
    if (typeof len !== "number") return;
    for (let i = 0; i < len; i++) {
      const r = records[i];
      if (!r) continue;
      if (r.type === "attributes") {
        // Cheap fast-path even though MutationObserver was configured
        // with attributeFilter: ['href'] — defensive in case the
        // observer is shared or the filter ever changes.
        if (r.attributeName !== "href") continue;
        rewriteLink(r.target);
      } else if (r.type === "childList") {
        const added = r.addedNodes;
        if (!added) continue;
        const n = added.length || 0;
        for (let j = 0; j < n; j++) {
          processAddedNode(added[j]);
        }
      }
      // characterData and other types: ignored.
    }
  }

  return { rewriteLink, rewriteAll, onMutation };
}
