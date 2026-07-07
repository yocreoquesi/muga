/**
 * MUGA: DNR static-ruleset enable/disable decision (pure).
 *
 * Extracted from service-worker.js applyDnrState so the gate-open ruleset
 * partition is unit-testable without the whole service worker. Given the
 * manifest-declared ruleset ids and the current prefs, returns which rulesets to
 * enable and which to disable when the consent gate is OPEN.
 *
 * The manifest defaults every ruleset to enabled:true, so any ruleset whose
 * feature pref is OFF (or which a different mechanism now owns) MUST be listed in
 * disableRulesetIds explicitly, or it stays active from the manifest default.
 */

/**
 * @param {string[]} declaredIds  ruleset ids declared in the active manifest
 * @param {object} prefs          materialized prefs (ampRedirect, unwrapRedirects, ...)
 * @param {{isFirefoxMV2?: boolean}} [opts]
 * @returns {{enableRulesetIds:string[], disableRulesetIds:string[], unmanaged:string[]}}
 */
export function partitionRulesets(declaredIds, prefs, { isFirefoxMV2 = false } = {}) {
  const enableRulesetIds = [];
  const disableRulesetIds = [];
  const unmanaged = [];

  for (const id of declaredIds) {
    if (id === "tracking_params") {
      // On Firefox MV2 the blocking webRequest stripper (onBeforeNavigateStrip in
      // service-worker.js) is the SOLE network-layer tracking-param strip path: it
      // increments the cleaned-URL counter (DNR emits no onRuleMatched signal) and
      // avoids a redundant DNR+webRequest double-strip that would also hinge on an
      // unverified webRequest-vs-DNR evaluation order. So disable this ruleset on
      // Firefox. Chrome (no blocking webRequest) keeps DNR as its strip path.
      (isFirefoxMV2 ? disableRulesetIds : enableRulesetIds).push(id);
    } else if (id === "amazon_path_canonical") {
      // Amazon /dp/ SEO-slug strip (#903): always-on when the gate is open. No
      // dedicated feature pref; Chrome-only (not declared in the Firefox manifest).
      enableRulesetIds.push(id);
    } else if (id === "amp_redirect") {
      (prefs.ampRedirect ? enableRulesetIds : disableRulesetIds).push(id);
    } else if (id === "wrapper_unwrap") {
      (prefs.unwrapRedirects ? enableRulesetIds : disableRulesetIds).push(id);
    } else {
      // A manifest-declared ruleset this partition doesn't know about would keep
      // its manifest default and silently bypass any feature pref. Enable it
      // (matching the default) and surface it so the gap is visible the moment a
      // new ruleset is added. (#810)
      unmanaged.push(id);
      enableRulesetIds.push(id);
    }
  }

  return { enableRulesetIds, disableRulesetIds, unmanaged };
}
