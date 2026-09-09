/**
 * MUGA — the cleaning context for extension pages (#1255)
 *
 * `processUrl` takes eight positional arguments with defaults, so an
 * incomplete call is silently valid, and every caller assembled the list by
 * hand. The callers that got it wrong were the preview surfaces: the popup
 * omitted the path rules, and the Settings URL tester omitted the path rules
 * AND the referrer. Both exist to show the user what MUGA is about to do, so a
 * preview computed from a different context than the navigation is the one
 * place the divergence costs the most.
 *
 * The content-script world got its own answer in the same issue:
 * content/cleaner.js publishes `window.__mugaCleanWithContext`, bound to the
 * caches it already maintains. Extension pages cannot reach that -- different
 * world, no shared globals -- but they CAN import ES modules, so this is the
 * same idea in the shape this side supports.
 *
 * ── On the comments this replaces ───────────────────────────────────────────
 *
 * Both call sites carried "Path-strip and path-affiliate args intentionally
 * omitted ... (accepted regression per declarative-path-rules design §7)".
 * That document is not in the repository, and `git log -S` over the markdown
 * history does not find it ever having been: the only carriers of the phrase
 * were those two comments. So the trade-off could not be checked by anyone
 * reading the code, which is a large part of why it survived.
 *
 * On the merits it does not hold either. Path rules are what turn an Amazon
 * URL carrying an SEO slug into /dp/<ASIN>; a preview without them shows a URL
 * the extension will not produce. The cost of including them is one fetch of
 * two small JSON files on a surface that already fetches a third.
 */

import { processUrl } from "./cleaner.js";

/**
 * Rule files the cleaner needs beyond the prefs. Fetched from the extension
 * package, never the network.
 */
const RULE_FILES = Object.freeze({
  domainRules: "rules/domain-rules.json",
  pathStripRules: "rules/path-strip-rules.json",
  pathAffiliateRules: "rules/path-affiliate-rules.json",
});

/** Resolved once per page; the files ship in the package and never change. */
let _cached = null;
let _pending = null;

/**
 * Reads one rule file, returning [] when it cannot be read.
 *
 * Best-effort per FILE rather than per context: a preview that loses the path
 * rules is worse than one that loses only the affiliate path rules, and
 * failing the whole context because one fetch failed would give the caller
 * nothing at all. Every consumer already renders a preview without rules when
 * it must; this keeps that degradation as narrow as it can be.
 *
 * @param {string} path
 * @param {(p: string) => string} resolveUrl
 * @returns {Promise<Array>}
 */
async function readRules(path, resolveUrl) {
  try {
    const resp = await fetch(resolveUrl(path));
    if (!resp.ok) return [];
    const parsed = await resp.json();
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * Loads the full cleaning context, cached for the life of the page.
 *
 * @param {{ resolveUrl?: (p: string) => string }} [opts] injection seam for tests
 * @returns {Promise<{domainRules: Array, pathStripRules: Array, pathAffiliateRules: Array}>}
 */
export async function loadCleaningContext(opts = {}) {
  const resolveUrl = opts.resolveUrl ?? ((p) => chrome.runtime.getURL(p));
  if (_cached) return _cached;
  if (_pending) return _pending;

  _pending = (async () => {
    const [domainRules, pathStripRules, pathAffiliateRules] = await Promise.all([
      readRules(RULE_FILES.domainRules, resolveUrl),
      readRules(RULE_FILES.pathStripRules, resolveUrl),
      readRules(RULE_FILES.pathAffiliateRules, resolveUrl),
    ]);
    _cached = { domainRules, pathStripRules, pathAffiliateRules };
    _pending = null;
    return _cached;
  })();

  return _pending;
}

/** Test seam: drops the page-lifetime cache. */
export function resetCleaningContextCache() {
  _cached = null;
  _pending = null;
}

/**
 * Cleans a URL with a complete context.
 *
 * The point of this function is that there is no argument list to get wrong.
 * A caller supplies what only it knows -- the URL, the prefs, and the referrer
 * if its surface has one -- and everything else comes from the context.
 *
 * `notifyForeignAffiliate` is forced off: every caller here is a PREVIEW, and
 * a preview must never fire the toast that belongs to a real navigation. Both
 * call sites were already spreading that override in by hand, which is one
 * more thing that only worked while everyone remembered it.
 *
 * @param {string} rawUrl
 * @param {object} prefs
 * @param {{domainRules: Array, pathStripRules: Array, pathAffiliateRules: Array}} context
 * @param {{referrer?: string}} [opts] referrer drives honor-creator; "" disables it
 * @returns {object} the processUrl result
 */
export function cleanForPreview(rawUrl, prefs, context, opts = {}) {
  const { domainRules = [], pathStripRules = [], pathAffiliateRules = [] } = context ?? {};
  return processUrl(
    rawUrl,
    { ...prefs, notifyForeignAffiliate: false },
    domainRules,
    undefined,
    undefined,
    opts.referrer ?? "",
    pathStripRules,
    pathAffiliateRules,
  );
}
