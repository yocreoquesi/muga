/**
 * MUGA — category-filtered mirrors of the static tracking-param DNR rules (#1256)
 *
 * `disabledCategories` lets a user keep a whole category of tracking params.
 * The JS cleaner honours it (`stripTrackingParams`, cleaner.js), and on Firefox
 * that is the whole story: the blocking webRequest stripper routes navigations
 * through `processUrl`, so the setting reaches every path.
 *
 * On Chrome it did not. Navigations are stripped by DNR, at the network layer,
 * before any JS runs, and the rules are generated at build time from the full
 * param list — `tools/generate-rules.mjs` has never seen `disabledCategories`.
 * The Settings hint says "Disabling a category keeps those parameters in URLs",
 * and for the pages a user actually visits, that was false.
 *
 * ── Why a runtime mirror rather than a build-time ruleset per category ───────
 *
 * Chrome applies AT MOST ONE redirect rule per request, so every strip rule
 * MUGA ships is complete for the hosts it matches: the global rule carries all
 * 447 params, and each per-host profile rule carries 447 minus that host's
 * preserveParams. A per-category ruleset would break that invariant — a request
 * would match six rules and Chrome would honour one.
 *
 * So the filter has to apply to whole rules, which is what this does: when any
 * category is off, the static ruleset is disabled and every one of its rules is
 * re-registered as a dynamic rule with the disabled params removed.
 *
 * ── What is preserved, deliberately ─────────────────────────────────────────
 *
 * Each mirror keeps its source rule's `priority` and `condition` verbatim. That
 * is what makes this safe: the precedence between MUGA's rule families
 * (allowlist allow at 1000, host-scoped remote strips at 2, global strip at 1)
 * is IDENTICAL to the unfiltered state. Nothing is reordered; params are only
 * subtracted.
 *
 * That includes the signed-URL allow guard (#1200). It carries no
 * `removeParams`, so it is mirrored verbatim at its own priority 1000.
 * Forgetting it would re-open #1200 — MUGA would strip an Azure SAS `sig` and
 * the download would 403 — for every user who turned off a category.
 */

/**
 * Lowercased union of every param in the disabled categories.
 *
 * @param {Iterable<string>} disabledCategories - category keys the user turned off
 * @param {Record<string, {params: string[]}>} categories - TRACKING_PARAM_CATEGORIES
 * @returns {Set<string>}
 */
export function disabledParamSet(disabledCategories, categories) {
  const disabled = new Set(
    [...(disabledCategories ?? [])].map((c) => String(c))
  );
  const params = new Set();
  if (disabled.size === 0) return params;

  for (const [key, cat] of Object.entries(categories ?? {})) {
    if (!disabled.has(key)) continue;
    for (const p of cat?.params ?? []) params.add(String(p).toLowerCase());
  }
  return params;
}

/**
 * Reads a rule's `removeParams` array, or null when it has none.
 *
 * @param {object} rule
 * @returns {string[]|null}
 */
function removeParamsOf(rule) {
  const rp = rule?.action?.redirect?.transform?.queryTransform?.removeParams;
  return Array.isArray(rp) ? rp : null;
}

/**
 * Builds the dynamic mirror of `staticRules` with the disabled categories'
 * params subtracted.
 *
 * Returns an EMPTY array when no category is disabled: the caller keeps the
 * static ruleset enabled in that case, so there is nothing to mirror and no
 * reason to pay for a dynamic-rule round trip on every wake.
 *
 * @param {Array<object>} staticRules - the parsed rules/tracking-params.json array
 * @param {Iterable<string>} disabledCategories
 * @param {Record<string, {params: string[]}>} categories - TRACKING_PARAM_CATEGORIES
 * @param {{idBase: number, maxRules: number}} opts
 * @returns {Array<object>} dynamic rules, ids assigned from idBase in input order
 */
export function buildCategoryFilteredRules(staticRules, disabledCategories, categories, { idBase, maxRules }) {
  const disabled = disabledParamSet(disabledCategories, categories);
  if (disabled.size === 0) return [];
  if (!Array.isArray(staticRules)) return [];

  const out = [];
  for (const rule of staticRules) {
    if (out.length >= maxRules) break;
    if (!rule || typeof rule !== "object") continue;

    const removeParams = removeParamsOf(rule);

    // No removeParams: not a strip rule. The signed-URL allow guard (#1200)
    // lives here, and it must survive the switch to dynamic rules or a user
    // who disabled a category loses the presigned-URL exemption entirely.
    if (removeParams === null) {
      out.push({ ...structuredCloneish(rule), id: idBase + out.length });
      continue;
    }

    const kept = removeParams.filter((p) => !disabled.has(String(p).toLowerCase()));

    // Every param this rule strips is in a disabled category. A redirect rule
    // with an empty removeParams rewrites the URL to itself, which Chrome
    // treats as a redirect loop rather than a no-op, so the rule is dropped:
    // "strip nothing here" and "no rule here" are the same behaviour, and only
    // one of them is safe to register.
    if (kept.length === 0) continue;

    const mirrored = structuredCloneish(rule);
    mirrored.id = idBase + out.length;
    mirrored.action.redirect.transform.queryTransform.removeParams = kept;
    out.push(mirrored);
  }

  return out;
}

/**
 * Deep-copies a plain DNR rule. `structuredClone` is available in both MV3
 * service workers and Node, but the rules are plain JSON by construction and
 * this keeps the module free of any host assumption.
 *
 * @param {object} rule
 * @returns {object}
 */
function structuredCloneish(rule) {
  return JSON.parse(JSON.stringify(rule));
}
