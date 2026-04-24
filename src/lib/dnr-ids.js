/**
 * MUGA: Declarative Net Request rule ID registry
 *
 * All DNR rule IDs used by MUGA are declared here so the namespace is visible
 * in one place and future additions cannot silently collide with existing rules.
 * A collision would cause one rule to silently overwrite another with no error.
 *
 * ID allocation:
 *   1        — static ruleset (tracking-params.json, managed by the browser)
 *   1000     — dynamic custom params rule (user-defined params, DNR redirect)
 *   1001     — dynamic remote params rule (signed remote payload, DNR redirect)
 *
 * When adding a new dynamic rule, pick an ID > 1001, document it here, and
 * verify it does not overlap with any existing entry in this file.
 */

/** ID of the static tracking-params ruleset (tracking-params.json). */
export const DNR_STATIC_RULE_ID = 1;

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
