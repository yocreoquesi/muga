/**
 * MUGA — DNR sync, extracted so it can be imported in Node (#1266 item 5, #1268)
 *
 * `src/background/service-worker.js` makes `chrome.*` calls at module scope,
 * so Node cannot import it, and its DNR logic has never been tested directly.
 * The suite worked around that two different ways, both of which are debt
 * this file pays off:
 *
 *   - `tests/unit/custom-params-dnr.test.mjs` said, in its own header, that it
 *     "Mirrors the FIXED syncCustomParamsDNR() in service-worker.js exactly"
 *     — a hand-written reimplementation with no generator and no structural
 *     check tying it to the original. If the service worker drifted from it,
 *     the tests stayed green while shipped behaviour changed.
 *   - `tests/unit/allowlist-dnr.test.mjs` reached the code by string-scanning
 *     `swSource` (`swSource.indexOf("async function applyDnrState(")`, then
 *     `.includes("if (!hasDNR) return;")`, etc.) — a proxy for behaviour, not
 *     behaviour itself.
 *
 * This is the pure move #1266 item 5 sketches as the highest-value slice:
 * every `sync*DNR` function already takes `prefs` as its only meaningful
 * input, so the block below is importable in Node with a stubbed `chrome`,
 * and the tests that import it directly become real tests instead of a
 * mirror or a source scrape.
 *
 * `applyDnrState` stays the only entry point the service worker calls; the
 * lifecycle wiring and the message listener stay there too, as the
 * composition root.
 */

import { getFullyExemptDomains, getFullyBlacklistedDomains } from "../lib/cleaner.js";
import { TRACKING_PARAM_CATEGORIES } from "../lib/affiliates.js";
import { getRemoteParams } from "../lib/storage.js";
import {
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
  DNR_ALLOWLIST_RULE_ID_BASE,
  DNR_ALLOWLIST_MAX_RULES,
  DNR_BLOCKLIST_MAX_RULES,
  ALLOWLIST_RESOURCE_TYPES,
  DNR_CATEGORY_FILTER_RULE_ID_BASE,
  DNR_CATEGORY_FILTER_MAX_RULES,
} from "../lib/dnr-ids.js";
import * as DNR_IDS from "../lib/dnr-ids.js";
import { partitionRulesets } from "../lib/dnr-ruleset-state.js";
import { tearDownAndVerify, ownedDynamicRanges } from "./dnr-teardown.js";
import { buildCategoryFilteredRules } from "../lib/dnr-category-filter.js";
import {
  buildRemoteDnrRule,
  applyScopedDnrRules,
  SCOPED_RULE_ID_RANGE,
} from "../lib/remote-rules.js";
import {
  buildSuppressRefererRules,
  buildBlockBeaconsRules,
  buildBlocklistRefererRules,
  buildBlocklistBeaconsRules,
} from "./dnr-privacy-rules.js";

// Firefox's blocking-webRequest param stripper (referer-beacon-privacy PR 3) is
// the true equivalent of Chrome's DNR: it strips tracking params from the
// top-level navigation BEFORE the request goes out and, unlike DNR, can feed
// the cleaned-URL counter (DNR emits no onRuleMatched signal). Chrome is
// unaffected — it never registers this listener and keeps using DNR.
//
// Gate: MV2 manifest (only ever shipped to Firefox via with-firefox-manifest.sh)
// AND a blocking-capable webRequest. `hasDNR` cannot distinguish the targets
// (both expose declarativeNetRequest); the manifest version can.
//
// Lazily evaluated rather than a module-scope `const` so this file can be
// imported in Node, where `chrome` does not exist until a test stubs it.
export function isFirefoxMV2() {
  return (
    globalThis.chrome?.runtime?.getManifest?.().manifest_version === 2 &&
    typeof globalThis.chrome?.webRequest?.onBeforeRequest?.addListener === "function"
  );
}

// --- DNR sync helpers ---
// Guard all DNR calls with a feature-detect. Firefox MV2 (≥113) DOES support
// declarativeNetRequest for static rulesets and regexSubstitution redirects;
// the guard covers Firefox Android and any environment where the API is absent.
//
// Lazily evaluated rather than a module-scope `const` so this file can be
// imported in Node, where `chrome` does not exist until a test stubs it.
export function hasDNR() {
  return typeof globalThis.chrome !== "undefined" && typeof globalThis.chrome.declarativeNetRequest !== "undefined";
}

export async function syncCustomParamsDNR(customParams) {
  if (!hasDNR()) return;
  try {
    if (!customParams || customParams.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
        addRules: [],
      });
      return;
    }
    const normalized = customParams
      .filter(p => /^[a-zA-Z0-9_.-]+$/.test(p.trim()))
      .map(p => p.trim().toLowerCase());
    // #1104: every entry may fail the format filter above (e.g. all-symbol
    // junk input), leaving normalized empty. Registering a DNR rule with
    // removeParams: [] is a no-op that serves no purpose and pollutes the
    // dynamic rule table with a dead entry. Treat an empty post-filter list
    // the same as "no customParams at all" — mirrors the mergeIntoCache()
    // empty-accepted guard in remote-rules.js (#923).
    if (normalized.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
        addRules: [],
      });
      return;
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_CUSTOM_PARAMS_RULE_ID],
      addRules: [{
        id: DNR_CUSTOM_PARAMS_RULE_ID,
        priority: 1,
        action: {
          type: "redirect",
          redirect: { transform: { queryTransform: { removeParams: normalized } } },
        },
        condition: { urlFilter: "*", resourceTypes: ["main_frame"] },
      }],
    });
  } catch (err) {
    console.error("[MUGA] syncCustomParamsDNR failed:", err);
  }
}

// Full range of allowlist rule IDs ever handed out, so a resync always
// clears every previously-added rule before adding the current set - no
// stale rule can survive a domain being removed from the allowlist or the
// per-site pause being lifted.
const ALLOWLIST_RULE_ID_RANGE = Array.from(
  { length: DNR_ALLOWLIST_MAX_RULES },
  (_, i) => DNR_ALLOWLIST_RULE_ID_BASE + i,
);

// ALLOWLIST_RESOURCE_TYPES is imported from ../lib/dnr-ids.js (task 1.5,
// referer-beacon-privacy): promoted to a shared constant so the allow rule
// below and the global/blocklist Referer-suppression rules
// (syncSuppressRefererDNR / syncBlocklistRefererDNR, PR 2) reference the
// exact same list and cannot drift apart. See its JSDoc in dnr-ids.js for the
// main_frame gotcha this list exists to guard against.

/**
 * Syncs one dynamic DNR "allow" rule per fully-exempt domain
 * (#allowlist-full-inert): a domain-only whitelist entry. This is the
 * network-layer half of the "allowlist = MUGA fully inert" choke point -
 * src/lib/cleaner.js#processUrl is the JS-layer
 * half, both sourced from the same isSiteFullyExempt/getFullyExemptDomains
 * predicate so the two never drift.
 *
 * Each rule uses `action: { type: "allow" }` with an explicit
 * ALLOWLIST_RESOURCE_TYPES list (see its doc comment for why `main_frame`
 * must be listed explicitly) and `requestDomains: [domain]` (Chrome matches
 * this against the domain and its subdomains, same semantics as
 * domainMatches() in cleaner.js). Priority is set to 1000 - strictly higher
 * than every strip/redirect rule MUGA registers today (priority 1, the DNR
 * default, except the host-scoped remote rules at priority 2) - so Chrome's
 * documented precedence rule
 * (a higher-priority "allow" action wins over a lower-priority
 * "redirect"/"block" action for the same request, regardless of rule order
 * or ruleset) makes the allow win deterministically. Because the condition
 * is domain-wide rather than tied to a specific rule ID, this also covers
 * any STRIP RULE ADDED LATER at the default priority, with no per-mechanism
 * patch required - that is the future-proofing property this rule exists for.
 *
 * Modeled on syncCustomParamsDNR() above: same hasDNR guard, try/catch, and
 * updateDynamicRules() usage.
 *
 * @param {{ whitelist?: string[], blacklist?: string[] }} prefs
 */
export async function syncAllowlistDNR(prefs) {
  if (!hasDNR()) return;
  try {
    const domains = getFullyExemptDomains(prefs);

    if (domains.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: ALLOWLIST_RULE_ID_RANGE,
        addRules: [],
      });
      return;
    }

    let syncedDomains = domains;
    if (domains.length > DNR_ALLOWLIST_MAX_RULES) {
      const dropped = domains.slice(DNR_ALLOWLIST_MAX_RULES);
      syncedDomains = domains.slice(0, DNR_ALLOWLIST_MAX_RULES);
      console.warn(
        `[MUGA] syncAllowlistDNR: ${domains.length} exempt domains exceed the ` +
        `${DNR_ALLOWLIST_MAX_RULES}-rule cap; dropped from network-level allow rules ` +
        "(active-defense + JS cleaning stay inert for these via isSiteFullyExempt, " +
        "only the DNR allow rule is missing):",
        dropped,
      );
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: ALLOWLIST_RULE_ID_RANGE,
      addRules: syncedDomains.map((domain, i) => ({
        id: DNR_ALLOWLIST_RULE_ID_BASE + i,
        priority: 1000,
        action: { type: "allow" },
        condition: { requestDomains: [domain], resourceTypes: ALLOWLIST_RESOURCE_TYPES },
      })),
    });
  } catch (err) {
    console.error("[MUGA] syncAllowlistDNR failed:", err);
  }
}

// Full range of category-filter rule IDs ever handed out (#1256), cleared on
// every resync so no mirror survives the user re-enabling a category.
const CATEGORY_FILTER_RULE_ID_RANGE = Array.from(
  { length: DNR_CATEGORY_FILTER_MAX_RULES },
  (_, i) => DNR_CATEGORY_FILTER_RULE_ID_BASE + i,
);

/**
 * The parsed rules/tracking-params.json, cached for this service-worker
 * lifetime. It ships inside the package and never changes at runtime, so one
 * read per wake is enough; a null cache means "not read yet", not "empty".
 *
 * @type {Array<object>|null}
 */
let _staticTrackingRules = null;

/**
 * The disabled-category set this worker last wrote mirrors for, as a sorted
 * comma-joined key. `null` means "this lifetime has not synced yet", which is
 * NOT the same as "no categories": dynamic rules persist across service-worker
 * lifetimes, so a fresh worker must still reconcile once even when the user has
 * nothing disabled, in case a previous lifetime left mirrors behind.
 *
 * This exists because applyDnrState runs on every storage change and every wake
 * event. Writing the 300-id removeRuleIds range unconditionally on each of
 * those put an extra disk write in front of every other rule family's sync, and
 * the scoped-rule and toolbar-badge e2e specs timed out waiting for rules that
 * were queued behind it. An idempotent sync should not rewrite state that has
 * not changed.
 *
 * @type {string|null}
 */
let _categoryMirrorKey = null;

/**
 * Reads the static tracking-param ruleset out of the extension package.
 *
 * Read through chrome.runtime.getURL rather than bundled at build time so the
 * mirrors are provably the same rules the static ruleset would have applied.
 * Deliberately NOT added to web_accessible_resources: an extension's own
 * service worker can fetch its own files, and exposing another path to the open
 * web would widen the fingerprinting surface (#1258).
 *
 * @returns {Promise<Array<object>>} the rules, or [] if unreadable
 */
export async function loadStaticTrackingRules() {
  if (_staticTrackingRules !== null) return _staticTrackingRules;
  try {
    const res = await fetch(chrome.runtime.getURL("rules/tracking-params.json"));
    const parsed = await res.json();
    _staticTrackingRules = Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error("[MUGA] loadStaticTrackingRules failed:", err);
    _staticTrackingRules = [];
  }
  return _staticTrackingRules;
}

/**
 * Syncs the dynamic category-filtered mirrors of the static tracking-param
 * ruleset (#1256).
 *
 * `disabledCategories` reached the JS cleaner and stopped there. On Chrome the
 * network layer strips navigations before any JS runs, from rules generated at
 * build time out of the full param list, so a user who turned a category off
 * still had it stripped on every page they opened -- while Settings told them
 * "Disabling a category keeps those parameters in URLs".
 *
 * When at least one category is off, partitionRulesets() disables the static
 * ruleset and this registers the same rules as dynamic ones with those params
 * subtracted. Both halves are required and neither is safe alone: two matching
 * rule sets would leave Chrome to pick one, and it applies exactly one redirect
 * rule per request.
 *
 * When no category is off this clears the range and the static ruleset carries
 * navigations exactly as before, so the untouched-settings path costs nothing
 * beyond one updateDynamicRules call that removes nothing.
 *
 * @param {{ disabledCategories?: string[] }} prefs
 */
export async function syncCategoryFilteredDNR(prefs) {
  if (!hasDNR()) return;
  // Firefox MV2 never reaches this: its navigations go through the blocking
  // webRequest stripper, which calls processUrl and honours the pref already.
  if (isFirefoxMV2()) return;
  try {
    const disabled = prefs?.disabledCategories ?? [];

    // Nothing changed since this worker last synced: skip the write entirely.
    // See _categoryMirrorKey — the null case means a fresh worker, which always
    // reconciles once so a previous lifetime's mirrors cannot linger.
    const key = [...disabled].map(String).sort().join(",");
    if (_categoryMirrorKey === key) return;

    if (disabled.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: CATEGORY_FILTER_RULE_ID_RANGE,
        addRules: [],
      });
      _categoryMirrorKey = key;
      return;
    }

    const staticRules = await loadStaticTrackingRules();
    const mirrors = buildCategoryFilteredRules(
      staticRules,
      disabled,
      TRACKING_PARAM_CATEGORIES,
      {
        idBase: DNR_CATEGORY_FILTER_RULE_ID_BASE,
        maxRules: DNR_CATEGORY_FILTER_MAX_RULES,
      },
    );

    if (staticRules.length > 0 && mirrors.length === 0) {
      // Every rule filtered away. Reachable only when the user disabled every
      // category, in which case stripping nothing at the network layer is the
      // correct outcome and matches what the JS cleaner does. Said out loud
      // because the alternative reading -- the ruleset failed to load, so
      // MUGA silently stopped cleaning -- looks identical from the outside.
      console.warn(
        "[MUGA] syncCategoryFilteredDNR: every static rule filtered away; " +
        "no network-layer strip while these categories are off:", disabled,
      );
    }

    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: CATEGORY_FILTER_RULE_ID_RANGE,
      addRules: mirrors,
    });
    // Only after the write lands. A failed write must not record the state as
    // applied, or the next call would skip the retry.
    _categoryMirrorKey = key;
  } catch (err) {
    console.error("[MUGA] syncCategoryFilteredDNR failed:", err);
  }
}

/**
 * Syncs the dynamic GLOBAL Referer-suppression rule (referer-beacon-privacy,
 * PR 2). Removes the `referer` request header on every http(s) request when
 * `prefs.suppressReferer` is true; removes rule 2500 when false. Modeled on
 * syncCustomParamsDNR() above: same hasDNR guard, try/catch, and
 * updateDynamicRules() usage.
 *
 * Uses the shared ALLOWLIST_RESOURCE_TYPES list (same list syncAllowlistDNR's
 * allow rule uses) so that rule, registered at priority 1000, deterministically
 * shadows this one (priority 1) on allowlisted domains — see D3 in design.md.
 * On a domain that is also on the blacklist, syncBlocklistRefererDNR's
 * priority-2 rule fires the same action regardless of this rule/pref.
 *
 * @param {{ suppressReferer?: boolean }} prefs
 */
export async function syncSuppressRefererDNR(prefs) {
  if (!hasDNR()) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules(buildSuppressRefererRules(prefs));
  } catch (err) {
    console.error("[MUGA] syncSuppressRefererDNR failed:", err);
  }
}

/**
 * Syncs the dynamic GLOBAL beacon-block rule (referer-beacon-privacy, PR 2).
 * Blocks every "ping"-resourceType request (covers both `<a ping>` hyperlink
 * auditing and `sendBeacon()`, the network-layer gap the DOM-layer
 * `blockPings` pref cannot reach) when `prefs.blockBeacons` is true; removes
 * rule 2600 when false. Modeled on syncCustomParamsDNR() above.
 *
 * @param {{ blockBeacons?: boolean }} prefs
 */
export async function syncBlockBeaconsDNR(prefs) {
  if (!hasDNR()) return;
  try {
    await chrome.declarativeNetRequest.updateDynamicRules(buildBlockBeaconsRules(prefs));
  } catch (err) {
    console.error("[MUGA] syncBlockBeaconsDNR failed:", err);
  }
}

/**
 * Syncs one dynamic DNR Referer force-suppress rule per bare-domain
 * blacklist entry (referer-beacon-privacy, PR 2; D2 in design.md: the
 * blocklist ALSO governs this feature). ACTIVE REGARDLESS of
 * `prefs.suppressReferer` — a blacklisted domain forces Referer removal even
 * when the global toggle is off, matching the blocklist's existing "be
 * aggressive on this domain" meaning (Scenario D). Shadowed on a domain that
 * is ALSO allowlisted by syncAllowlistDNR's priority-1000 allow rule
 * (allowlist always wins).
 *
 * Structural clone of syncAllowlistDNR()'s clear-then-register pattern:
 * clears the full BLOCKLIST_REFERER_RULE_ID_RANGE on every resync, caps at
 * DNR_BLOCKLIST_MAX_RULES, and logs dropped domains rather than silently
 * truncating.
 *
 * @param {{ blacklist?: string[] }} prefs
 */
export async function syncBlocklistRefererDNR(prefs) {
  if (!hasDNR()) return;
  try {
    const domains = getFullyBlacklistedDomains(prefs);
    const { dropped, ...rules } = buildBlocklistRefererRules(domains);
    if (dropped.length > 0) {
      console.warn(
        `[MUGA] syncBlocklistRefererDNR: ${domains.length} blacklisted domains exceed the ` +
        `${DNR_BLOCKLIST_MAX_RULES}-rule cap; dropped from Referer force-suppress rules:`,
        dropped,
      );
    }
    await chrome.declarativeNetRequest.updateDynamicRules(rules);
  } catch (err) {
    console.error("[MUGA] syncBlocklistRefererDNR failed:", err);
  }
}

/**
 * Syncs one dynamic DNR beacon-block force rule per bare-domain blacklist
 * entry (referer-beacon-privacy, PR 2; same D2 rationale as
 * syncBlocklistRefererDNR above). ACTIVE REGARDLESS of `prefs.blockBeacons`.
 * Referer removal and beacon blocking are distinct DNR action types, so a
 * blacklisted domain needs a rule from both this function and
 * syncBlocklistRefererDNR — they cannot be merged into one rule.
 *
 * @param {{ blacklist?: string[] }} prefs
 */
export async function syncBlocklistBeaconsDNR(prefs) {
  if (!hasDNR()) return;
  try {
    const domains = getFullyBlacklistedDomains(prefs);
    const { dropped, ...rules } = buildBlocklistBeaconsRules(domains);
    if (dropped.length > 0) {
      console.warn(
        `[MUGA] syncBlocklistBeaconsDNR: ${domains.length} blacklisted domains exceed the ` +
        `${DNR_BLOCKLIST_MAX_RULES}-rule cap; dropped from beacon-block force rules:`,
        dropped,
      );
    }
    await chrome.declarativeNetRequest.updateDynamicRules(rules);
  } catch (err) {
    console.error("[MUGA] syncBlocklistBeaconsDNR failed:", err);
  }
}

export async function applyDnrState(prefs) {
  if (!hasDNR()) return;
  // Gate DNR on onboardingDone too (#consent-gate). Content scripts
  // already short-circuit on `!prefs.onboardingDone`, but the DNR
  // rulesets are declarative — they would still fire before the user
  // accepts unless we explicitly disable them here. This makes "the
  // extension is disabled until the user accepts the ToS" hold across
  // both the dynamic and declarative cleaning paths.
  //
  // Derive which rulesets are actually declared in the active manifest
  // at runtime so we never pass IDs that don't exist in the current
  // manifest (Firefox MV2 declares only "tracking_params"; passing
  // "amp_redirect" or "wrapper_unwrap" there would cause the API to
  // reject the entire call). (#810)
  const declaredIds = (
    chrome.runtime.getManifest()?.declarative_net_request?.rule_resources ?? []
  ).map(r => r.id);

  if (prefs.enabled && prefs.dnrEnabled && prefs.onboardingDone) {
    // Gate open: selectively enable/disable based on per-feature prefs (pure
    // decision in partitionRulesets). The manifest defaults every ruleset to
    // enabled:true, so rulesets whose feature pref is OFF — or which a different
    // mechanism now owns (tracking_params on Firefox, handled by the blocking
    // webRequest stripper) — must be explicitly disabled here.
    const { enableRulesetIds, disableRulesetIds, unmanaged } =
      partitionRulesets(declaredIds, prefs, { isFirefoxMV2: isFirefoxMV2() });
    for (const id of unmanaged) {
      console.warn("[MUGA] applyDnrState: unmanaged ruleset id:", id);
    }

    await chrome.declarativeNetRequest.updateEnabledRulesets({
      enableRulesetIds,
      disableRulesetIds,
    }).catch(err => console.warn("[MUGA] applyDnrState enable:", err));
    // Immediately after the ruleset toggle above, because the two are one
    // decision: partitionRulesets() just disabled tracking_params iff a
    // category is off, and this registers what stands in for it (#1256).
    await syncCategoryFilteredDNR(prefs);
    await syncCustomParamsDNR(prefs.customParams);
    // Allowlist "allow" rules (#allowlist-full-inert) - rebuilt from current
    // prefs on every gate-open sync so a whitelist/pause change takes effect
    // live (see the storage.onChanged handler below and the mugaConsent /
    // mugaPerDevicePrefs branches, all of which call applyDnrState).
    await syncAllowlistDNR(prefs);
    // Referer/beacon privacy layer (referer-beacon-privacy, PR 2): two
    // global rules gated on their own pref (suppressReferer/blockBeacons)
    // plus two per-domain blocklist-force rule families that are ACTIVE
    // REGARDLESS of those prefs (D2 in design.md). Order here matches the
    // priority scheme documented in dnr-ids.js and design.md: allowlist
    // allow (1000, synced above) > blocklist force (2) > global suppress (1).
    await syncSuppressRefererDNR(prefs);
    await syncBlockBeaconsDNR(prefs);
    await syncBlocklistRefererDNR(prefs);
    await syncBlocklistBeaconsDNR(prefs);
    // Re-arm the dynamic remote-params rule (id 1001). The gate-closed branch
    // removes it (#921), so a close→open cycle — or a wake where the weekly
    // signed fetch is time-gated and skips re-adding it — would otherwise leave
    // remote cleaning silently off. Rebuild it here from the cached payload.
    await reconcileRemoteDnrRule(prefs);
  } else {
    // Gate closed: disable ALL declared rulesets so that AMP redirects
    // and wrapper-unwrapping cannot fire before the user has accepted
    // the ToS or while the extension is toggled off. (#810)
    // Every step below used to be awaited bare, and each swallows its own
    // error and returns. Nothing looked at the results and nothing retried, so
    // one failing step left that ID range registered and still acting at the
    // network layer for a user who had just withdrawn consent (#1257 item 5).
    //
    // tearDownAndVerify runs them all — a thrown step does not stop the others,
    // because on a withdrawal the goal is to remove as much as possible — and
    // then READS BACK what is still registered. Verifying state rather than
    // collecting eight self-reports is the point: the dangerous failure is a
    // step that returns normally while its rules survive.
    await tearDownAndVerify({
      ranges: ownedDynamicRanges(DNR_IDS),
      readLiveRuleIds: async () => {
        const rules = await chrome.declarativeNetRequest.getDynamicRules();
        return (rules ?? []).map((r) => r.id);
      },
      steps: {
        staticRulesets: async () => {
          if (declaredIds.length === 0) return;
          await chrome.declarativeNetRequest.updateEnabledRulesets({
            disableRulesetIds: declaredIds,
          });
        },
        customParams: () => syncCustomParamsDNR([]),
        // The category mirrors are strip rules like any other, so the consent
        // gate has to reach them too: leaving them registered would keep
        // cleaning navigations for a disabled or non-consented extension,
        // which is the exact hole #921 closed for rule 1001 (#1256).
        categoryMirrors: () => syncCategoryFilteredDNR({ disabledCategories: [] }),
        // With every strip/redirect rule off there is nothing left for an
        // "allow" rule to out-prioritize; leaving them registered would just be
        // a stale MUGA network footprint while the extension is off.
        allowlist: () => syncAllowlistDNR({ whitelist: [], blacklist: [] }),
        // referer-beacon-privacy PR 2: the two global rules AND the per-domain
        // blocklist-force ranges. "Always aggressive on this domain" still
        // yields to "extension not accepted / disabled".
        suppressReferer: () => syncSuppressRefererDNR({ suppressReferer: false }),
        blockBeacons: () => syncBlockBeaconsDNR({ blockBeacons: false }),
        blocklistReferer: () => syncBlocklistRefererDNR({ blacklist: [] }),
        blocklistBeacons: () => syncBlocklistBeaconsDNR({ blacklist: [] }),
        // Disabling the static rulesets and clearing rule 1000 is NOT enough:
        // rule 1001 is a DNR redirect that keeps stripping params for a
        // disabled extension (#921). The host-scoped range (3100-5099, #1221
        // slice 2) comes from the same channel and goes in the same call.
        remoteParams: () => chrome.declarativeNetRequest.updateDynamicRules({
          removeRuleIds: [DNR_REMOTE_PARAMS_RULE_ID, ...SCOPED_RULE_ID_RANGE],
        }),
      },
    });
  }
}

// Reconciles the dynamic remote-params rule (id 1001) AND the host-scoped
// range (3100-5099, #1221 slice 2) with current prefs + cached payload. Used on gate-open so rule 1001 is restored after the
// gate-closed branch removed it, without waiting for the next weekly fetch.
// buildRemoteDnrRule rejects an empty removeParams transform, so an empty or
// missing cache resolves to "no rule" (removal only). (#921)
//
// Named distinctly from the SW-local syncRemoteParamsDNR retired in #706: that
// helper duplicated the write that runRemoteRulesFetch already performs, whereas
// this one restores rule 1001 from the CACHE on gate-open, which the time-gated
// weekly fetch does not do.
export async function reconcileRemoteDnrRule(prefs) {
  if (!hasDNR()) return;
  try {
    const cache = prefs.remoteRulesEnabled ? await getRemoteParams() : null;

    // The host-scoped range (#1221 slice 2) is restored from the SAME cache and
    // gated on the same pref, so the gate-closed branch above does not leave
    // scoped cleaning off until the next weekly fetch — the exact staleness
    // this function exists to fix for rule 1001. applyScopedDnrRules swallows
    // its own failure, so a scoped problem cannot skip the global reconcile
    // below; the reverse is not true, which is why it runs first.
    await applyScopedDnrRules(cache?.remoteRulesMeta?.scopedFacts, {
      updateDynamicRules: (opts) => chrome.declarativeNetRequest.updateDynamicRules(opts),
    });

    const params = cache ? cache.remoteParams : [];
    const list = Array.isArray(params) ? params : [];
    if (list.length === 0) {
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [DNR_REMOTE_PARAMS_RULE_ID],
      });
      return;
    }
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [DNR_REMOTE_PARAMS_RULE_ID],
      addRules: [buildRemoteDnrRule(list)],
    });
  } catch (err) {
    console.warn("[MUGA] reconcileRemoteDnrRule failed:", err);
  }
}
