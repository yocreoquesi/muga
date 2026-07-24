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
 *   2500      — dynamic GLOBAL Referer-suppression rule (referer-beacon-
 *              privacy). Removes the Referer header on every non-allowlisted
 *              request when prefs.suppressReferer is true. Managed by
 *              syncSuppressRefererDNR() in service-worker.js.
 *   2600      — dynamic GLOBAL beacon-block rule (referer-beacon-privacy).
 *              Blocks "ping"-resourceType requests (sendBeacon/<a ping>) on
 *              every non-allowlisted request when prefs.blockBeacons is
 *              true. Managed by syncBlockBeaconsDNR() in service-worker.js.
 *   2700-2899 — dynamic per-domain BLOCKLIST Referer force-suppress rules
 *              (referer-beacon-privacy), one per bare-domain blacklist entry
 *              (see cleaner.js#getFullyBlacklistedDomains). ACTIVE
 *              REGARDLESS of prefs.suppressReferer (D2: the blocklist
 *              governs independently of the global toggle). Managed by
 *              syncBlocklistRefererDNR(). Capped at DNR_BLOCKLIST_MAX_RULES.
 *   2900-3099 — dynamic per-domain BLOCKLIST beacon-block rules (referer-
 *              beacon-privacy), one per bare-domain blacklist entry. ACTIVE
 *              REGARDLESS of prefs.blockBeacons (same D2 rationale as
 *              2700-2899). Managed by syncBlocklistBeaconsDNR(). Capped at
 *              DNR_BLOCKLIST_MAX_RULES.
 *
 * When adding a new dynamic rule, pick an ID > 1001 (and outside 2000-2499,
 * 2500, 2600, 2700-2899, 2900-3099 unless it belongs to one of those existing
 * ranges), document it here, and verify it does not overlap with any
 * existing entry in this file.
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

/**
 * ID of the dynamic GLOBAL Referer-suppression rule (referer-beacon-privacy,
 * PR 1: foundation only — wired to DNR in a later PR). Managed by
 * syncSuppressRefererDNR() in service-worker.js: registered (modifyHeaders,
 * remove referer) when prefs.suppressReferer is true, removed when false.
 * Does not collide with DNR_ALLOWLIST_RULE_ID_BASE's range (2000-2499).
 */
export const DNR_SUPPRESS_REFERER_RULE_ID = 2500;

/**
 * ID of the dynamic GLOBAL beacon-block rule (referer-beacon-privacy, PR 1:
 * foundation only). Managed by syncBlockBeaconsDNR() in service-worker.js:
 * registered (action: "block", resourceTypes: ["ping"]) when
 * prefs.blockBeacons is true, removed when false.
 */
export const DNR_BLOCK_BEACONS_RULE_ID = 2600;

/**
 * Base ID for the dynamic per-domain BLOCKLIST Referer force-suppress rules
 * (referer-beacon-privacy). One rule per bare-domain blacklist entry (see
 * cleaner.js#getFullyBlacklistedDomains), at id =
 * DNR_BLOCKLIST_REFERER_RULE_ID_BASE + i. Managed by
 * syncBlocklistRefererDNR() in service-worker.js (a later PR). ACTIVE
 * REGARDLESS of prefs.suppressReferer — a blacklisted domain forces Referer
 * suppression even with the global toggle off (D2 override). Range:
 * 2700-2899 (see DNR_BLOCKLIST_MAX_RULES).
 */
export const DNR_BLOCKLIST_REFERER_RULE_ID_BASE = 2700;

/**
 * Base ID for the dynamic per-domain BLOCKLIST beacon-block rules
 * (referer-beacon-privacy). One rule per bare-domain blacklist entry, at id =
 * DNR_BLOCKLIST_BEACON_RULE_ID_BASE + i. Managed by
 * syncBlocklistBeaconsDNR() in service-worker.js (a later PR). ACTIVE
 * REGARDLESS of prefs.blockBeacons (same D2 rationale as the Referer force
 * range above). Range: 2900-3099 (see DNR_BLOCKLIST_MAX_RULES). Deliberately
 * starts immediately after the 2700-2899 referer-force range so the two
 * blocklist ranges never overlap.
 */
export const DNR_BLOCKLIST_BEACON_RULE_ID_BASE = 2900;

/**
 * Maximum number of dynamic per-domain blocklist rules
 * syncBlocklistRefererDNR()/syncBlocklistBeaconsDNR() will each register
 * (ids BASE .. + DNR_BLOCKLIST_MAX_RULES - 1). Mirrors the
 * DNR_ALLOWLIST_MAX_RULES precedent: if the user's blacklisted-domain count
 * exceeds this, the sync functions cap the list and log which domains were
 * dropped rather than truncating silently.
 */
export const DNR_BLOCKLIST_MAX_RULES = 200;

/**
 * Shared `resourceTypes` list for every dynamic DNR rule that must cover the
 * same surface as the allowlist "allow" rule (#allowlist-full-inert) — the
 * global/blocklist Referer-suppression rules (referer-beacon-privacy, PR 2)
 * AND `syncAllowlistDNR()`'s allow rule itself. Promoted here (task 1.5) as
 * the single source of truth so the two can never drift: if they did, a
 * domain could be allowlisted for one resource type but still have its
 * Referer stripped for another, silently breaking the "allowlist always
 * wins" guarantee (D2/D3 in design.md).
 *
 * IMPORTANT Chrome DNR gotcha: a rule condition that omits `resourceTypes`
 * (and `excludedResourceTypes`) matches every resource type EXCEPT
 * `main_frame` - main_frame is excluded from the "match everything" default.
 * Every real strip/redirect rule MUGA registers explicitly lists
 * `main_frame` (tracking-params.json, amp-redirect.json,
 * amazon-path-canonical.json, DNR_CUSTOM_PARAMS_RULE_ID in
 * syncCustomParamsDNR(), wrapper-dnr-rules.json, remote-rules.js), so an
 * allow/suppress rule WITHOUT an explicit main_frame entry would never even
 * be considered for the single most common case - a top-level navigation to
 * an allowlisted or Referer-suppressed domain - leaving the exact
 * network-layer bug this feature exists to fix.
 *
 * This list is therefore explicit rather than omitted, at the cost of some
 * future-proofing: a resource type Chrome adds after this list is written
 * would not automatically be covered by rules that reference it (it would
 * need to be appended here). That tradeoff is accepted because the
 * alternative - omitting resourceTypes - silently fails on main_frame today,
 * not just in some hypothetical future. Limited to the resource types stable
 * since MV3's initial DNR API to avoid rejecting the whole
 * updateDynamicRules() call on a browser/version that does not recognize a
 * newer enum value (e.g. Firefox MV2's DNR support).
 */
export const ALLOWLIST_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket",
  "other",
];
