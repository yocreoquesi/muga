/**
 * MUGA: Declarative Net Request rule ID registry
 *
 * All DNR rule IDs used by MUGA are declared here so the namespace is visible
 * in one place and future additions cannot silently collide with existing rules.
 * A collision would cause one rule to silently overwrite another with no error.
 *
 * ID allocation:
 *   1        — static ruleset: global tracking-param strip (tracking-params.json)
 *   2        — static ruleset: Amazon-scoped internal-nav param strip — params the
 *              cleaner strips on Amazon that the global rule can't (unsafe to strip
 *              site-wide), scoped via requestDomains to Amazon marketplaces
 *   100-102  — static ruleset: AMP unwrap redirects (amp-redirect.json)
 *   1-5      — static ruleset: wrapper-link unwrap redirects (wrapper-dnr-rules.json,
 *              its own file-scoped namespace, distinct from tracking-params.json's 1/2)
 *   200      — static ruleset: Amazon /dp/ SEO-slug strip, Chrome-only DNR
 *              regexSubstitution redirect (amazon-path-canonical.json) — #903
 *   1000     — dynamic custom params rule (user-defined params, DNR redirect)
 *   1001     — dynamic remote params rule (signed remote payload, DNR redirect)
 *   2000-2499 — dynamic allowlist "allow" rules (#allowlist-full-inert), one
 *              per fully-exempt domain (domain-only whitelist entry or a
 *              `::disabled` per-site pause). Managed by syncAllowlistDNR() in
 *              service-worker.js. A dedicated 500-ID range so it can never
 *              collide with 1000/1001 or any future single-purpose dynamic
 *              rule below 2000.
 *
 * When adding a new dynamic rule, pick an ID > 1001 (and outside 2000-2499
 * unless it belongs to the allowlist range), document it here, and verify it
 * does not overlap with any existing entry in this file.
 */

/** ID of the static tracking-params ruleset (tracking-params.json). */
export const DNR_STATIC_RULE_ID = 1;

/**
 * ID of the static Amazon-scoped internal-nav param strip rule, emitted into
 * tracking-params.json alongside the global rule. Scoped via `requestDomains`
 * to Amazon marketplaces so params that are unsafe to strip site-wide (e.g.
 * `ref`, `sr`) are still removed on Chrome's DNR-only current-page path —
 * closing the gap where the in-page cleaner strips them but DNR did not.
 */
export const DNR_AMAZON_PARAMS_RULE_ID = 2;

/**
 * ID of the dynamic rule that removes user-defined custom params.
 * Managed by syncCustomParamsDNR() in service-worker.js.
 */
export const DNR_CUSTOM_PARAMS_RULE_ID = 1000;

/**
 * ID of the dynamic rule that removes remotely-fetched tracking params.
 * Managed by lib/remote-rules.js. Must not equal DNR_CUSTOM_PARAMS_RULE_ID.
 */
export const DNR_REMOTE_PARAMS_RULE_ID = 1001;

/**
 * Base ID for the dynamic allowlist "allow" rules (#allowlist-full-inert).
 * One rule is emitted per fully-exempt domain (see
 * cleaner.js#getFullyExemptDomains), at id = DNR_ALLOWLIST_RULE_ID_BASE + i.
 * Managed by syncAllowlistDNR() in service-worker.js. Does not collide with
 * DNR_CUSTOM_PARAMS_RULE_ID (1000) or DNR_REMOTE_PARAMS_RULE_ID (1001).
 */
export const DNR_ALLOWLIST_RULE_ID_BASE = 2000;

/**
 * Maximum number of dynamic allowlist "allow" rules syncAllowlistDNR() will
 * register (ids DNR_ALLOWLIST_RULE_ID_BASE .. + DNR_ALLOWLIST_MAX_RULES - 1).
 * A conservative cap well under Chrome's dynamic-rule ceiling, leaving
 * headroom for the custom/remote-param rules and any future dynamic rule.
 * If the user's exempt-domain count exceeds this, syncAllowlistDNR() caps
 * the list and logs which domains were dropped rather than truncating
 * silently.
 */
export const DNR_ALLOWLIST_MAX_RULES = 500;
