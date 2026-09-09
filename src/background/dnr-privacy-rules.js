/**
 * MUGA — dynamic DNR rule builders for referer/beacon privacy (#1268)
 *
 * The four `sync*DNR` functions in this family did two things at once: they
 * decided WHICH rules to register, and they talked to
 * `chrome.declarativeNetRequest`. Only the second half needs a browser, but
 * both halves lived in `service-worker.js`, which Node cannot import because
 * that file makes `chrome.*` calls at module scope. So the interesting half —
 * the rule shapes, the id assignment, the blocklist cap and what it drops —
 * had no direct test. `sw-robustness-833.test.mjs` documents where that leads:
 * tests assert against a hand-written mirror, and a mirror is only ever tested
 * for what its author already thought of.
 *
 * This module is the deciding half, extracted and pure: prefs (or a domain
 * list) in, an `updateDynamicRules` argument object out. It imports nothing
 * from the service worker, so it is importable in Node with no `chrome` stub
 * at all, and the service worker becomes a thin caller that applies what these
 * return.
 *
 * Following single-flight-loader.js (#1283), run-migrations.js (#1284),
 * dnr-teardown.js (#1286) and clean-resolved-destination.js (#1264).
 *
 * ── Why the two blocklist families cannot be merged ────────────────────────
 *
 * Referer removal and beacon blocking are distinct DNR action types
 * (`modifyHeaders` vs `block`), so a blacklisted domain needs one rule from
 * each family. They are built separately here for the same reason, over two
 * deliberately non-adjacent id ranges.
 */

import {
  DNR_SUPPRESS_REFERER_RULE_ID,
  DNR_BLOCK_BEACONS_RULE_ID,
  DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
  DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
  DNR_BLOCKLIST_MAX_RULES,
  ALLOWLIST_RESOURCE_TYPES,
} from "../lib/dnr-ids.js";

/**
 * Full range of blocklist Referer force-suppress rule ids ever handed out
 * (referer-beacon-privacy, PR 2), mirroring the allowlist range: a resync
 * always clears every previously-added rule, so no stale force rule survives
 * a domain being removed from the blacklist.
 */
export const BLOCKLIST_REFERER_RULE_ID_RANGE = Object.freeze(Array.from(
  { length: DNR_BLOCKLIST_MAX_RULES },
  (_, i) => DNR_BLOCKLIST_REFERER_RULE_ID_BASE + i,
));

/** Same as above, for the beacon-block force rule range. */
export const BLOCKLIST_BEACON_RULE_ID_RANGE = Object.freeze(Array.from(
  { length: DNR_BLOCKLIST_MAX_RULES },
  (_, i) => DNR_BLOCKLIST_BEACON_RULE_ID_BASE + i,
));

/**
 * The GLOBAL Referer-suppression rule (referer-beacon-privacy, PR 2).
 *
 * Removes the `referer` request header on every http(s) request when
 * `prefs.suppressReferer` is true; clears rule 2500 when false.
 *
 * Uses the shared ALLOWLIST_RESOURCE_TYPES list (the same list
 * syncAllowlistDNR's allow rule uses) so that rule, registered at priority
 * 1000, deterministically shadows this one (priority 1) on allowlisted
 * domains — see D3 in design.md. On a domain that is also blacklisted,
 * the priority-2 blocklist rule fires the same action regardless of this
 * rule or this pref.
 *
 * @param {{ suppressReferer?: boolean }} prefs
 * @returns {{removeRuleIds: number[], addRules: object[]}}
 */
export function buildSuppressRefererRules(prefs) {
  const removeRuleIds = [DNR_SUPPRESS_REFERER_RULE_ID];
  if (!prefs?.suppressReferer) return { removeRuleIds, addRules: [] };
  return {
    removeRuleIds,
    addRules: [{
      id: DNR_SUPPRESS_REFERER_RULE_ID,
      priority: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "referer", operation: "remove" }],
      },
      condition: { urlFilter: "*", resourceTypes: ALLOWLIST_RESOURCE_TYPES },
    }],
  };
}

/**
 * The GLOBAL beacon-block rule (referer-beacon-privacy, PR 2).
 *
 * Blocks every "ping"-resourceType request — which covers both `<a ping>`
 * hyperlink auditing and `sendBeacon()`, the network-layer gap the DOM-layer
 * `blockPings` pref cannot reach — when `prefs.blockBeacons` is true; clears
 * rule 2600 when false.
 *
 * @param {{ blockBeacons?: boolean }} prefs
 * @returns {{removeRuleIds: number[], addRules: object[]}}
 */
export function buildBlockBeaconsRules(prefs) {
  const removeRuleIds = [DNR_BLOCK_BEACONS_RULE_ID];
  if (!prefs?.blockBeacons) return { removeRuleIds, addRules: [] };
  return {
    removeRuleIds,
    addRules: [{
      id: DNR_BLOCK_BEACONS_RULE_ID,
      priority: 1,
      action: { type: "block" },
      condition: { resourceTypes: ["ping"] },
    }],
  };
}

/**
 * Applies the shared blocklist cap.
 *
 * Domains beyond DNR_BLOCKLIST_MAX_RULES are reported in `dropped` rather
 * than silently truncated, so the caller can log exactly which domains lost
 * their rule. Silent truncation here would mean a domain the user explicitly
 * blacklisted quietly stops being enforced.
 *
 * @param {string[]} domains
 * @returns {{synced: string[], dropped: string[]}}
 */
function applyCap(domains) {
  if (domains.length <= DNR_BLOCKLIST_MAX_RULES) return { synced: domains, dropped: [] };
  return {
    synced: domains.slice(0, DNR_BLOCKLIST_MAX_RULES),
    dropped: domains.slice(DNR_BLOCKLIST_MAX_RULES),
  };
}

/**
 * One Referer force-suppress rule per bare-domain blacklist entry
 * (referer-beacon-privacy, PR 2; D2 in design.md: the blocklist ALSO governs
 * this feature).
 *
 * ACTIVE REGARDLESS of `prefs.suppressReferer` — a blacklisted domain forces
 * Referer removal even when the global toggle is off, matching the
 * blocklist's existing "be aggressive on this domain" meaning (Scenario D).
 * Shadowed on a domain that is ALSO allowlisted by syncAllowlistDNR's
 * priority-1000 allow rule (allowlist always wins).
 *
 * @param {string[]} domains Fully-blacklisted bare domains.
 * @returns {{removeRuleIds: number[], addRules: object[], dropped: string[]}}
 */
export function buildBlocklistRefererRules(domains = []) {
  const removeRuleIds = [...BLOCKLIST_REFERER_RULE_ID_RANGE];
  if (domains.length === 0) return { removeRuleIds, addRules: [], dropped: [] };

  const { synced, dropped } = applyCap(domains);
  return {
    removeRuleIds,
    dropped,
    addRules: synced.map((domain, i) => ({
      id: DNR_BLOCKLIST_REFERER_RULE_ID_BASE + i,
      priority: 2,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "referer", operation: "remove" }],
      },
      condition: { requestDomains: [domain], resourceTypes: ALLOWLIST_RESOURCE_TYPES },
    })),
  };
}

/**
 * One beacon-block force rule per bare-domain blacklist entry
 * (referer-beacon-privacy, PR 2; same D2 rationale as the Referer family).
 * ACTIVE REGARDLESS of `prefs.blockBeacons`.
 *
 * @param {string[]} domains Fully-blacklisted bare domains.
 * @returns {{removeRuleIds: number[], addRules: object[], dropped: string[]}}
 */
export function buildBlocklistBeaconsRules(domains = []) {
  const removeRuleIds = [...BLOCKLIST_BEACON_RULE_ID_RANGE];
  if (domains.length === 0) return { removeRuleIds, addRules: [], dropped: [] };

  const { synced, dropped } = applyCap(domains);
  return {
    removeRuleIds,
    dropped,
    addRules: synced.map((domain, i) => ({
      id: DNR_BLOCKLIST_BEACON_RULE_ID_BASE + i,
      priority: 2,
      action: { type: "block" },
      condition: { requestDomains: [domain], resourceTypes: ["ping"] },
    })),
  };
}
