/**
 * MUGA — Unit tests for syncAllowlistDNR() (#allowlist-full-inert)
 *
 * The service worker has no behavioral unit harness (Chrome API bindings at
 * module scope - see the same note in tests/unit/dnr-consent-gate.test.mjs),
 * so this file follows that file's established pattern: a pure extraction of
 * the sync algorithm exercised against a fake declarativeNetRequest facade,
 * plus source guards confirming the production service-worker.js actually
 * wires the real function in.
 *
 * getFullyExemptDomains() itself is NOT reimplemented here - it is imported
 * directly from src/lib/cleaner.js, so these tests exercise the real
 * domain-selection logic and only stub the chrome.* boundary.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { getFullyExemptDomains } from "../../src/lib/cleaner.js";
import { DNR_ALLOWLIST_RULE_ID_BASE, DNR_ALLOWLIST_MAX_RULES, DNR_CUSTOM_PARAMS_RULE_ID, DNR_REMOTE_PARAMS_RULE_ID } from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8"
);

// ── Pure implementation under test ───────────────────────────────────────────
//
// Mirrors syncAllowlistDNR() in service-worker.js exactly (same removeRuleIds
// range, same rule shape, same cap-and-warn behavior) but wired to a fake DNR
// facade so the exact calls can be asserted without a browser.

const ALLOWLIST_RULE_ID_RANGE = Array.from(
  { length: DNR_ALLOWLIST_MAX_RULES },
  (_, i) => DNR_ALLOWLIST_RULE_ID_BASE + i,
);

// Mirrors ALLOWLIST_RESOURCE_TYPES in service-worker.js. Chrome's DNR API
// matches every resource type EXCEPT main_frame when resourceTypes is
// omitted, so main_frame - the single most common case, a top-level
// navigation to an allowlisted domain - must be listed explicitly or the
// allow rule silently never applies to it.
const ALLOWLIST_RESOURCE_TYPES = [
  "main_frame", "sub_frame", "stylesheet", "script", "image", "font",
  "object", "xmlhttprequest", "ping", "csp_report", "media", "websocket",
  "other",
];

async function syncAllowlistDNRLogic(prefs, dnrApi, warn) {
  const domains = getFullyExemptDomains(prefs);

  if (domains.length === 0) {
    await dnrApi.updateDynamicRules({ removeRuleIds: ALLOWLIST_RULE_ID_RANGE, addRules: [] });
    return;
  }

  let syncedDomains = domains;
  if (domains.length > DNR_ALLOWLIST_MAX_RULES) {
    const dropped = domains.slice(DNR_ALLOWLIST_MAX_RULES);
    syncedDomains = domains.slice(0, DNR_ALLOWLIST_MAX_RULES);
    warn?.(dropped);
  }

  await dnrApi.updateDynamicRules({
    removeRuleIds: ALLOWLIST_RULE_ID_RANGE,
    addRules: syncedDomains.map((domain, i) => ({
      id: DNR_ALLOWLIST_RULE_ID_BASE + i,
      priority: 1000,
      action: { type: "allow" },
      condition: { requestDomains: [domain], resourceTypes: ALLOWLIST_RESOURCE_TYPES },
    })),
  });
}

function makeFakeDnr() {
  const calls = [];
  return {
    calls,
    updateDynamicRules(opts) {
      calls.push(structuredClone(opts));
      return Promise.resolve();
    },
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("syncAllowlistDNR — one allow rule per exempt domain", () => {
  test("a domain-only whitelist entry produces exactly one allow rule", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["example.com"], blacklist: [] }, dnr);

    assert.strictEqual(dnr.calls.length, 1);
    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    const rule = call.addRules[0];
    assert.strictEqual(rule.action.type, "allow");
    assert.deepEqual(rule.condition.requestDomains, ["example.com"]);
    assert.ok(rule.id >= DNR_ALLOWLIST_RULE_ID_BASE && rule.id < DNR_ALLOWLIST_RULE_ID_BASE + DNR_ALLOWLIST_MAX_RULES);
  });

  test("a `::disabled` blacklist entry (legacy syntax, removed) does NOT produce an allow rule", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: [], blacklist: ["paused.com::disabled"] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
  });

  test("allow rule priority (1000) is strictly higher than every strip/redirect rule (priority 1)", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["example.com"], blacklist: [] }, dnr);

    const rule = dnr.calls[0].addRules[0];
    assert.strictEqual(rule.priority, 1000);
    assert.ok(rule.priority > 1, "allow priority must exceed the priority-1 strip/redirect rules");
  });

  test("resourceTypes explicitly includes main_frame — the top-level-navigation case Chrome excludes by default", async () => {
    // Chrome's DNR API matches every resource type EXCEPT main_frame when
    // resourceTypes is omitted. Every strip/redirect rule MUGA registers
    // (tracking-params.json, syncCustomParamsDNR, amp-redirect.json, ...)
    // explicitly lists main_frame, so the allow rule must too, or a plain
    // top-level navigation to an allowlisted domain would still get its
    // tracking params stripped at the network layer.
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["example.com"], blacklist: [] }, dnr);

    const rule = dnr.calls[0].addRules[0];
    assert.ok(Array.isArray(rule.condition.resourceTypes), "resourceTypes must be an explicit array, not omitted");
    assert.ok(rule.condition.resourceTypes.includes("main_frame"), "main_frame must be explicitly listed");
    assert.ok(rule.condition.resourceTypes.includes("sub_frame"), "sub_frame must be covered too (wrapper/AMP redirects run there)");
  });

  test("multiple exempt domains each get their own rule with distinct ids", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic(
      // c.com::disabled is a stray legacy blacklist entry (removed syntax) and
      // must NOT produce a rule alongside the two real whitelist entries.
      { whitelist: ["a.com", "b.com"], blacklist: ["c.com::disabled"] },
      dnr,
    );

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 2);
    const domains = call.addRules.map(r => r.condition.requestDomains[0]).sort();
    assert.deepEqual(domains, ["a.com", "b.com"]);
    const ids = call.addRules.map(r => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, "rule ids must be unique");
  });

  test("a param-scoped whitelist entry does NOT produce an allow rule", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["example.com::tag::x"], blacklist: [] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
  });

  test("a plain blacklist entry without ::disabled does NOT produce an allow rule", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: [], blacklist: ["blocked.com"] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
  });
});

describe("syncAllowlistDNR — clears stale rules", () => {
  test("every sync removes the full allowlist id range before adding the current set", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["example.com"], blacklist: [] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.removeRuleIds.length, DNR_ALLOWLIST_MAX_RULES);
    assert.ok(call.removeRuleIds.includes(DNR_ALLOWLIST_RULE_ID_BASE));
    assert.ok(call.removeRuleIds.includes(DNR_ALLOWLIST_RULE_ID_BASE + DNR_ALLOWLIST_MAX_RULES - 1));
  });

  test("no exempt domains — removeRuleIds still clears the range, addRules is empty (no stale rules survive de-whitelisting)", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: [], blacklist: [] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
    assert.strictEqual(call.removeRuleIds.length, DNR_ALLOWLIST_MAX_RULES);
  });

  test("allowlist rule IDs never collide with DNR_CUSTOM_PARAMS_RULE_ID or DNR_REMOTE_PARAMS_RULE_ID", () => {
    assert.ok(!ALLOWLIST_RULE_ID_RANGE.includes(DNR_CUSTOM_PARAMS_RULE_ID));
    assert.ok(!ALLOWLIST_RULE_ID_RANGE.includes(DNR_REMOTE_PARAMS_RULE_ID));
  });
});

describe("syncAllowlistDNR — cap and warn, no silent truncation", () => {
  test("exempt-domain count over the cap: only the cap is added, excess is reported via the warn callback", async () => {
    const dnr = makeFakeDnr();
    const many = Array.from({ length: DNR_ALLOWLIST_MAX_RULES + 5 }, (_, i) => `d${i}.com`);
    let warnedDropped = null;
    await syncAllowlistDNRLogic({ whitelist: many, blacklist: [] }, dnr, (dropped) => { warnedDropped = dropped; });

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, DNR_ALLOWLIST_MAX_RULES);
    assert.ok(Array.isArray(warnedDropped), "cap overflow must be reported, not silently dropped");
    assert.strictEqual(warnedDropped.length, 5);
  });

  test("exempt-domain count under the cap: warn callback is never invoked", async () => {
    const dnr = makeFakeDnr();
    let warnCalled = false;
    await syncAllowlistDNRLogic({ whitelist: ["example.com"], blacklist: [] }, dnr, () => { warnCalled = true; });
    assert.strictEqual(warnCalled, false);
  });
});

// ── Source-level guards: verify the production SW was updated ────────────────
//
// The service worker cannot be imported in Node (chrome.* at module scope),
// so — same as tests/unit/dnr-consent-gate.test.mjs — a handful of source
// regions are extracted ONCE each and every subsequent check runs against
// the extracted (non-"...Source"-named) local, keeping this file's
// source-grep footprint minimal per the #824 ratchet.

const resourceTypesStart = swSource.indexOf("const ALLOWLIST_RESOURCE_TYPES = [");
const resourceTypesBlock = swSource.slice(resourceTypesStart, resourceTypesStart + 300);

const syncFnStart = swSource.indexOf("async function syncAllowlistDNR(");
const syncFnBlock = swSource.slice(syncFnStart, syncFnStart + 1800);

const applyFnStart = swSource.indexOf("async function applyDnrState(");
const applyFnBlock = swSource.slice(applyFnStart, applyFnStart + 6000);
const gateClosedBlock = applyFnBlock.slice(applyFnBlock.indexOf("Gate closed:"));

const storageListenerStart = swSource.lastIndexOf("chrome.storage.onChanged.addListener");
const storageListenerBlock = swSource.slice(storageListenerStart, storageListenerStart + 2500);

describe("service-worker.js source guards — syncAllowlistDNR present and wired", () => {
  test("syncAllowlistDNR exists, guards on hasDNR, wraps in try/catch, and derives domains via getFullyExemptDomains", () => {
    assert.ok(syncFnStart !== -1, "syncAllowlistDNR must exist in the service worker");
    assert.ok(syncFnBlock.includes("if (!hasDNR) return;"), "must guard on hasDNR like syncCustomParamsDNR");
    assert.ok(syncFnBlock.includes("try {") && syncFnBlock.includes("catch (err)"), "must be wrapped in try/catch like syncCustomParamsDNR");
    assert.ok(syncFnBlock.includes("updateDynamicRules"), "must call updateDynamicRules");
    assert.ok(syncFnBlock.includes("getFullyExemptDomains"), "must derive exempt domains via getFullyExemptDomains, not reimplement domain matching");
  });

  test("allow rule uses type \"allow\", priority 1000, requestDomains, and an explicit resourceTypes list including main_frame", () => {
    assert.ok(syncFnBlock.includes('action: { type: "allow" }'));
    assert.ok(syncFnBlock.includes("priority: 1000"));
    assert.ok(syncFnBlock.includes("requestDomains: [domain]"));
    assert.ok(syncFnBlock.includes("resourceTypes: ALLOWLIST_RESOURCE_TYPES"), "the allow rule must use the explicit resourceTypes list (Chrome excludes main_frame by default otherwise)");
    assert.ok(resourceTypesBlock.includes('"main_frame"'), "ALLOWLIST_RESOURCE_TYPES must explicitly include main_frame");
  });

  test("applyDnrState calls syncAllowlistDNR after syncCustomParamsDNR in the gate-open branch, and clears it in the gate-closed branch", () => {
    assert.ok(applyFnStart !== -1, "applyDnrState must exist");
    const customIdx = applyFnBlock.indexOf("await syncCustomParamsDNR(prefs.customParams);");
    const allowIdx = applyFnBlock.indexOf("await syncAllowlistDNR(prefs);");
    assert.ok(customIdx !== -1 && allowIdx !== -1, "both gate-open calls must be present");
    assert.ok(allowIdx > customIdx, "syncAllowlistDNR must be called after syncCustomParamsDNR in the gate-open branch");
    assert.ok(
      gateClosedBlock.includes("syncAllowlistDNR({ whitelist: [], blacklist: [] })"),
      "gate-closed branch must clear the allowlist rules so no MUGA network footprint remains while disabled"
    );
  });

  test("storage.onChanged re-syncs DNR when whitelist or blacklist changes", () => {
    assert.ok(storageListenerStart !== -1);
    assert.ok(storageListenerBlock.includes("changes.whitelist"), "must re-sync DNR when the whitelist changes");
    assert.ok(storageListenerBlock.includes("changes.blacklist"), "must re-sync DNR when the blacklist changes");
  });
});
