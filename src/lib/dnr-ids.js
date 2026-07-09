/**
 * MUGA: Declarative Net Request rule ID registry
 *
 * All DNR rule IDs used by MUGA are declared here so the namespace is visible
 * in one place and future additions cannot silently collide with existing rules.
 * A collision would cause one rule to silently overwrite another with no error.
 *
 * ID allocation:
 *   1        — static ruleset: global tracking-param strip (tracking-params.json).
 *              Removes ALL TRACKING_PARAMS on every host EXCEPT the tailored
 *              domains, which it lists in excludedRequestDomains (see 300-799).
 *   100-102  — static ruleset: AMP unwrap redirects (amp-redirect.json)
 *   1-5      — static ruleset: wrapper-link unwrap redirects (wrapper-dnr-rules.json,
 *              its own file-scoped namespace, distinct from tracking-params.json's 1)
 *   200      — static ruleset: Amazon /dp/ SEO-slug strip, Chrome-only DNR
 *              regexSubstitution redirect (amazon-path-canonical.json) — #903
 *   300-799  — static ruleset: per-domain-profile tracking-param strip
 *              (tracking-params.json). Chrome applies at most ONE redirect rule
 *              per request, so each tailored host matches exactly one COMPLETE
 *              rule: requestDomains-scoped, removeParams = TRACKING_PARAMS minus
 *              that domain's preserveParams, plus any domain-specific extra strips
 *              (e.g. Amazon internal-nav params — folded in here, no longer a
 *              separate rule). Domains sharing a profile share one rule.
 *   1000     — dynamic custom params rule (user-defined params, DNR redirect)
 *   1001     — dynamic remote params rule (signed remote payload, DNR redirect)
 *   2000-2499 — dynamic allowlist "allow" rules (#allowlist-full-inert), one
 *              per fully-exempt domain (domain-only whitelist entry).
 *              Managed by syncAllowlistDNR() in service-worker.js. A
 *              dedicated 500-ID range so it can never
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
 * Base ID for the static per-domain-profile tracking-param strip rules emitted
 * into tracking-params.json. Chrome applies at most ONE redirect rule per
 * request (no cascade), so each tailored host must match exactly one COMPLETE
 * rule. Each profile rule is requestDomains-scoped and removes TRACKING_PARAMS
 * minus that domain's preserveParams, plus any domain-specific extra strips
 * (e.g. Amazon internal-nav params). The domains are simultaneously excluded
 * from the global rule (DNR_STATIC_RULE_ID) so they never double-match. Domains
 * sharing an identical removeParams profile share one rule;
 * id = DNR_DOMAIN_PRESERVE_RULE_ID_BASE + group index.
 */
export const DNR_DOMAIN_PRESERVE_RULE_ID_BASE = 300;

/**
 * Cap on the number of per-domain-profile strip rule groups. Well under
 * Chrome's static-rule ceiling; the generator fails loudly if exceeded so the
 * 300-799 range can never overrun into DNR_CUSTOM_PARAMS_RULE_ID (1000).
 */
export const DNR_DOMAIN_PRESERVE_MAX_RULES = 500;

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
