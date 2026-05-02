/**
 * MUGA: Wrapper DNR Rule Builder
 *
 * Pure module that converts the regex-pure subset of the WRAPPERS table
 * (src/lib/wrapper-engine.js) into Manifest V3 declarativeNetRequest rules.
 *
 * The build script (scripts/generate-dnr-rules.mjs) calls buildDnrRules() at
 * build time, writes the output to src/rules/wrapper-dnr-rules.json, and the
 * extension manifest references that file via declarative_net_request.
 * rule_resources.  Once registered, the browser rewrites matching requests
 * via regexSubstitution BEFORE the wrapper server is contacted — the user
 * never sends a request to awin1.com / l.facebook.com / etc.
 *
 * SCOPE (slice B6, issue #449):
 *   The seven entries listed in REGEX_PURE_WRAPPER_IDS — the wrappers whose
 *   destination lives in a single, well-known query parameter on a literal
 *   hostname.  All other wrappers (Impact's regex hostPatterns, t.co's
 *   path-only shape, link.medium.com's redirect, the naked-query proxies
 *   href.li / anonym.to, the social outbounds with no extractor) fall back
 *   to the runtime engine — that path is unchanged.
 *
 * URL-decode caveat:
 *   Chromium's regexSubstitution copies the captured group verbatim into the
 *   redirect target.  When the wrapper carries the destination as a single
 *   percent-encoded value (e.g. ?p=https%3A%2F%2Fmerchant.com%2Fpath), the
 *   browser then issues a request to the percent-encoded URL.  Most servers
 *   accept that and the percent-encoding survives parsing into a plain
 *   destination URL.  This assumption is the gate for shipping these rules
 *   to production — the Playwright network test (deferred for this slice)
 *   is the validation gate.  See issue #449 for the open verification.
 *
 * Pure module — no fs, no fetch, no clock.  Deterministic over its inputs.
 */

/**
 * The seven wrapper identifiers in scope for DNR rule generation.
 * Order is load-bearing for the test suite (it uses index lookup) and for
 * deterministic numeric ID assignment.  Do not reorder without updating the
 * generated wrapper-dnr-rules.json.
 *
 * @type {ReadonlyArray<string>}
 */
export const REGEX_PURE_WRAPPER_IDS = Object.freeze([
  "awin",
  "facebook-l",
  "facebook-lm",
  "skimlinks-redirectingat",
  "skimlinks-skimresources",
  "shareasale",
  "rakuten",
]);

/**
 * Per-id rule recipe.  Each entry encodes:
 *   - sourceId:    the wrapper-engine entry id this rule descends from.
 *                  buildDnrRules cross-checks the wrapper exists in the input
 *                  table and rejects entries whose hostPatterns include a
 *                  RegExp (defensive — no regex-pure rule should ever come
 *                  from a regex-host wrapper).
 *   - hostRegex:   the host portion of the regexFilter (without protocol or
 *                  path anchor).  Includes literal subdomains as needed.
 *   - pathPrefix:  optional pathname prefix (escaped) the rule must include
 *                  before the query lookahead.  When null, ".*" is used.
 *   - paramName:   the query-string key whose value is the destination.  The
 *                  generated regex captures `[^&]+` after `?` or `&` <key>=.
 *
 * @type {ReadonlyArray<{
 *   id: string,
 *   sourceId: string,
 *   hostRegex: string,
 *   pathPrefix: string|null,
 *   paramName: string,
 * }>}
 */
const RECIPES = Object.freeze([
  {
    id: "awin",
    sourceId: "awin",
    hostRegex: "(?:www\\.)?awin1\\.com",
    pathPrefix: null,
    paramName: "p",
  },
  {
    id: "facebook-l",
    sourceId: "facebook-l",
    hostRegex: "l\\.facebook\\.com",
    pathPrefix: "/l\\.php",
    paramName: "u",
  },
  {
    id: "facebook-lm",
    sourceId: "facebook-lm",
    hostRegex: "lm\\.facebook\\.com",
    pathPrefix: "/l\\.php",
    paramName: "u",
  },
  {
    id: "skimlinks-redirectingat",
    sourceId: "skimlinks",
    hostRegex: "go\\.redirectingat\\.com",
    pathPrefix: null,
    paramName: "url",
  },
  {
    id: "skimlinks-skimresources",
    sourceId: "skimlinks",
    hostRegex: "go\\.skimresources\\.com",
    pathPrefix: null,
    paramName: "url",
  },
  {
    id: "shareasale",
    sourceId: "shareasale",
    hostRegex: "(?:www\\.)?shareasale\\.com",
    pathPrefix: "/r\\.cfm",
    paramName: "urllink",
  },
  {
    id: "rakuten",
    sourceId: "rakuten",
    hostRegex: "click\\.linksynergy\\.com",
    pathPrefix: "/deeplink",
    paramName: "murl",
  },
]);

/**
 * Returns true when the given wrapper-engine entry is safe to translate into a
 * DNR rule — its hostPatterns must all be string literals.  RegExp host
 * patterns (Impact's `*.pxf.io` shape) cannot be safely substituted into a
 * regexFilter without re-anchoring, so we refuse them at the source.
 * @param {{ hostPatterns: ReadonlyArray<string|RegExp> }} wrapper
 * @returns {boolean}
 */
function isStringOnlyHostPatterns(wrapper) {
  if (!wrapper || !Array.isArray(wrapper.hostPatterns)) return false;
  return wrapper.hostPatterns.every((p) => typeof p === "string");
}

/**
 * Builds the regexFilter string for a given recipe.  Shape:
 *   ^https?://<hostRegex><pathPrefixOrAny>[?&]<paramName>=([^&]+)
 *
 * The capture group is the URL-encoded destination value.  regexSubstitution
 * "\\1" copies it verbatim into the redirect target.
 *
 * @param {{ hostRegex: string, pathPrefix: string|null, paramName: string }} recipe
 * @returns {string}
 */
function buildRegexFilter({ hostRegex, pathPrefix, paramName }) {
  const path = pathPrefix ?? "";
  return `^https?://${hostRegex}${path}.*[?&]${paramName}=([^&]+)`;
}

/**
 * Translates the regex-pure subset of the WRAPPERS table into DNR rule objects.
 *
 * - Iterates RECIPES in order, assigning sequential numeric IDs starting at 1.
 * - For each recipe, looks up the source wrapper in the input table.  If the
 *   source is missing, or its hostPatterns include a RegExp, the recipe is
 *   skipped (no rule emitted).  This keeps the build defensive against
 *   accidental allowlist/source drift.
 * - Output is deterministic: same input → identical output (key order, ids,
 *   regex strings).
 *
 * @param {ReadonlyArray<{
 *   id: string,
 *   hostPatterns: ReadonlyArray<string|RegExp>,
 *   pathPatterns: ReadonlyArray<string>|null,
 *   extract: Function,
 * }>} wrapperEntries
 * @returns {Array<object>} DNR rule objects ready for JSON serialization.
 */
export function buildDnrRules(wrapperEntries) {
  /** @type {Map<string, object>} */
  const bySourceId = new Map();
  for (const entry of wrapperEntries ?? []) {
    if (entry && typeof entry.id === "string") {
      bySourceId.set(entry.id, entry);
    }
  }

  const rules = [];
  let nextId = 1;
  for (const recipe of RECIPES) {
    const source = bySourceId.get(recipe.sourceId);
    if (!source) continue;
    if (!isStringOnlyHostPatterns(source)) continue;

    rules.push({
      id: nextId++,
      priority: 1,
      action: {
        type: "redirect",
        redirect: {
          regexSubstitution: "\\1",
        },
      },
      condition: {
        regexFilter: buildRegexFilter(recipe),
        resourceTypes: ["main_frame", "sub_frame"],
      },
    });
  }
  return rules;
}

/**
 * Sanity-checks an array of DNR rule objects.  Returns { ok, warnings }.
 *
 * Validations:
 *   - Total rule count does not exceed maxRuleCount (default 5000 — Chrome's
 *     hard limit per static ruleset is 30000, but a sane warning catches
 *     accidental fan-out earlier).
 *   - All rule.id values are unique (collisions would silently overwrite).
 *   - Every rule.condition.regexFilter compiles as a JavaScript RegExp
 *     (Chromium's RE2 engine has stricter rules, so this is a necessary
 *     but not sufficient check; the Playwright validation gate is the
 *     definitive runtime check).
 *
 * @param {ReadonlyArray<object>} rules
 * @param {{ maxRuleCount?: number }} [opts]
 * @returns {{ ok: boolean, warnings: string[] }}
 */
export function validateDnrRules(rules, opts = {}) {
  const maxRuleCount = Number.isFinite(opts.maxRuleCount) ? opts.maxRuleCount : 5000;
  const warnings = [];
  const list = Array.isArray(rules) ? rules : [];

  if (list.length > maxRuleCount) {
    warnings.push(
      `rule count ${list.length} exceeds maxRuleCount ${maxRuleCount} — Chrome limits static rulesets`,
    );
  }

  const idCounts = new Map();
  for (const rule of list) {
    const id = rule?.id;
    idCounts.set(id, (idCounts.get(id) ?? 0) + 1);
  }
  for (const [id, count] of idCounts) {
    if (count > 1) {
      warnings.push(`duplicate rule id ${id} appears ${count} times`);
    }
  }

  for (const rule of list) {
    const filter = rule?.condition?.regexFilter;
    if (typeof filter !== "string") {
      warnings.push(`rule ${rule?.id}: condition.regexFilter is not a string`);
      continue;
    }
    try {
      new RegExp(filter);
    } catch (err) {
      warnings.push(`rule ${rule?.id}: regexFilter does not compile (${err.message})`);
    }
  }

  return { ok: warnings.length === 0, warnings };
}
