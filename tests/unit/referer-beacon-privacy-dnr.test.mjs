/**
 * MUGA — referer-beacon-privacy, PR 2 (Chrome DNR Enforcement): unit tests
 * for the four new dynamic-rule sync functions and their applyDnrState()
 * wiring (tasks 2.6-2.9).
 *
 * The service worker has no behavioral unit harness (Chrome API bindings at
 * module scope), so this file used to reimplement each sync algorithm and test
 * the copy, plus source guards confirming production wired in the real ones
 * with the same shapes.
 *
 * #1268: the four referer/beacon rule builders now live in
 * src/background/dnr-privacy-rules.js and are imported here, so the assertions
 * below exercise the SHIPPED logic. What remains local is a thin adapter that
 * hands the built rules to a fake declarativeNetRequest facade, mirroring only
 * the plumbing the service worker also has around them.
 *
 * syncAllowlistDNRLogic is still a genuine mirror: syncAllowlistDNR was not
 * part of that extraction. It is labelled as such at its definition rather
 * than left to look like the others.
 *
 * getFullyBlacklistedDomains() itself is NOT reimplemented here — it is
 * imported directly from src/lib/cleaner.js, so these tests exercise the
 * real domain-selection logic and only stub the chrome.* boundary.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { getFullyExemptDomains, getFullyBlacklistedDomains } from "../../src/lib/cleaner.js";
import {
  buildSuppressRefererRules,
  buildBlockBeaconsRules,
  buildBlocklistRefererRules,
  buildBlocklistBeaconsRules,
} from "../../src/background/dnr-privacy-rules.js";
import {
  DNR_SUPPRESS_REFERER_RULE_ID,
  DNR_BLOCK_BEACONS_RULE_ID,
  DNR_BLOCKLIST_REFERER_RULE_ID_BASE,
  DNR_BLOCKLIST_BEACON_RULE_ID_BASE,
  DNR_BLOCKLIST_MAX_RULES,
  DNR_ALLOWLIST_RULE_ID_BASE,
  DNR_ALLOWLIST_MAX_RULES,
  ALLOWLIST_RESOURCE_TYPES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8",
);

// ── Thin adapters over the REAL builders ─────────────────────────────────────
//
// #1268: these four functions used to be full reimplementations of their
// service-worker.js counterparts, opening with "Each mirrors its
// service-worker.js counterpart exactly". That is the pattern #1268 is about:
// the assertions below were checking a copy, and a copy stays green while the
// shipped behaviour changes. It is also only ever tested for what its author
// already thought of.
//
// The rule building now lives in src/background/dnr-privacy-rules.js, so what
// is left here is the thin part the service worker also has: hand the built
// rules to the DNR facade, and report dropped domains. These adapters exist
// only so the ~350 lines of assertions below keep their call shape; the logic
// they exercise is the shipped logic.
//
// syncAllowlistDNRLogic further down is still a genuine mirror. syncAllowlistDNR
// was not part of this extraction, so that one is honestly labelled rather than
// quietly grouped with these.

async function syncSuppressRefererDNRLogic(prefs, dnrApi) {
  await dnrApi.updateDynamicRules(buildSuppressRefererRules(prefs));
}

async function syncBlockBeaconsDNRLogic(prefs, dnrApi) {
  await dnrApi.updateDynamicRules(buildBlockBeaconsRules(prefs));
}

async function syncBlocklistRefererDNRLogic(prefs, dnrApi, warn) {
  const { dropped, ...rules } = buildBlocklistRefererRules(getFullyBlacklistedDomains(prefs));
  if (dropped.length > 0) warn?.(dropped);
  await dnrApi.updateDynamicRules(rules);
}

async function syncBlocklistBeaconsDNRLogic(prefs, dnrApi, warn) {
  const { dropped, ...rules } = buildBlocklistBeaconsRules(getFullyBlacklistedDomains(prefs));
  if (dropped.length > 0) warn?.(dropped);
  await dnrApi.updateDynamicRules(rules);
}

// STILL A MIRROR (#1268). Reimplements syncAllowlistDNR() (see
// tests/unit/allowlist-dnr.test.mjs), needed here only for the precedence
// tests (2.8), which must prove the allow rule still registers even when a
// domain is ALSO blacklisted.
//
// syncAllowlistDNR was not part of the dnr-privacy-rules.js extraction, so
// this copy can still drift from production while these tests stay green.
// It is the next candidate: extracting a buildAllowlistRules() would let this
// import the real thing and delete the last mirror in the file.
const ALLOWLIST_RULE_ID_RANGE = Array.from(
  { length: DNR_ALLOWLIST_MAX_RULES },
  (_, i) => DNR_ALLOWLIST_RULE_ID_BASE + i,
);
async function syncAllowlistDNRLogic(prefs, dnrApi) {
  const domains = getFullyExemptDomains(prefs);
  if (domains.length === 0) {
    await dnrApi.updateDynamicRules({ removeRuleIds: ALLOWLIST_RULE_ID_RANGE, addRules: [] });
    return;
  }
  await dnrApi.updateDynamicRules({
    removeRuleIds: ALLOWLIST_RULE_ID_RANGE,
    addRules: domains.map((domain, i) => ({
      id: DNR_ALLOWLIST_RULE_ID_BASE + i,
      priority: 1000,
      action: { type: "allow" },
      condition: { requestDomains: [domain], resourceTypes: ALLOWLIST_RESOURCE_TYPES },
    })),
  });
}

// Mirrors the applyDnrState() gate-open/gate-closed wiring for JUST the four
// new sync fns (task 2.5), so the consent-gate behavior (task 2.9) can be
// asserted without a browser.
async function applyReferBeaconGateLogic(prefs, gateOpen, dnrApi, warn) {
  if (gateOpen) {
    await syncSuppressRefererDNRLogic(prefs, dnrApi);
    await syncBlockBeaconsDNRLogic(prefs, dnrApi);
    await syncBlocklistRefererDNRLogic(prefs, dnrApi, warn);
    await syncBlocklistBeaconsDNRLogic(prefs, dnrApi, warn);
  } else {
    await syncSuppressRefererDNRLogic({ suppressReferer: false }, dnrApi);
    await syncBlockBeaconsDNRLogic({ blockBeacons: false }, dnrApi);
    await syncBlocklistRefererDNRLogic({ blacklist: [] }, dnrApi);
    await syncBlocklistBeaconsDNRLogic({ blacklist: [] }, dnrApi);
  }
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

// ── 2.6: global rule shapes ──────────────────────────────────────────────────

describe("syncSuppressRefererDNR — global Referer-suppress rule (2500)", () => {
  test("suppressReferer:true registers id 2500, priority 1, modifyHeaders remove referer, shared resourceTypes", async () => {
    const dnr = makeFakeDnr();
    await syncSuppressRefererDNRLogic({ suppressReferer: true }, dnr);

    assert.strictEqual(dnr.calls.length, 1);
    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    const rule = call.addRules[0];
    assert.strictEqual(rule.id, DNR_SUPPRESS_REFERER_RULE_ID);
    assert.strictEqual(rule.priority, 1);
    assert.strictEqual(rule.action.type, "modifyHeaders");
    assert.deepEqual(rule.action.requestHeaders, [{ header: "referer", operation: "remove" }]);
    assert.strictEqual(rule.condition.urlFilter, "*");
    assert.deepEqual(rule.condition.resourceTypes, ALLOWLIST_RESOURCE_TYPES);
  });

  test("suppressReferer:false removes rule 2500, adds nothing", async () => {
    const dnr = makeFakeDnr();
    await syncSuppressRefererDNRLogic({ suppressReferer: false }, dnr);

    const call = dnr.calls[0];
    assert.deepEqual(call.removeRuleIds, [DNR_SUPPRESS_REFERER_RULE_ID]);
    assert.strictEqual(call.addRules.length, 0);
  });
});

describe("syncBlockBeaconsDNR — global beacon-block rule (2600)", () => {
  test("blockBeacons:true registers id 2600, priority 1, block, resourceTypes [\"ping\"]", async () => {
    const dnr = makeFakeDnr();
    await syncBlockBeaconsDNRLogic({ blockBeacons: true }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    const rule = call.addRules[0];
    assert.strictEqual(rule.id, DNR_BLOCK_BEACONS_RULE_ID);
    assert.strictEqual(rule.priority, 1);
    assert.strictEqual(rule.action.type, "block");
    assert.deepEqual(rule.condition.resourceTypes, ["ping"]);
  });

  test("blockBeacons:false removes rule 2600, adds nothing", async () => {
    const dnr = makeFakeDnr();
    await syncBlockBeaconsDNRLogic({ blockBeacons: false }, dnr);

    const call = dnr.calls[0];
    assert.deepEqual(call.removeRuleIds, [DNR_BLOCK_BEACONS_RULE_ID]);
    assert.strictEqual(call.addRules.length, 0);
  });
});

// ── 2.7: per-domain blocklist rules ──────────────────────────────────────────

describe("syncBlocklistRefererDNR / syncBlocklistBeaconsDNR — per-domain force rules", () => {
  test("one bare-domain blacklist entry yields a Referer force rule (2700+, priority 2, requestDomains-scoped)", async () => {
    const dnr = makeFakeDnr();
    await syncBlocklistRefererDNRLogic({ blacklist: ["blocked.com"] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    const rule = call.addRules[0];
    assert.ok(rule.id >= DNR_BLOCKLIST_REFERER_RULE_ID_BASE && rule.id < DNR_BLOCKLIST_REFERER_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES);
    assert.strictEqual(rule.priority, 2);
    assert.strictEqual(rule.action.type, "modifyHeaders");
    assert.deepEqual(rule.action.requestHeaders, [{ header: "referer", operation: "remove" }]);
    assert.deepEqual(rule.condition.requestDomains, ["blocked.com"]);
    assert.deepEqual(rule.condition.resourceTypes, ALLOWLIST_RESOURCE_TYPES);
  });

  test("the SAME bare-domain blacklist entry ALSO yields a beacon force rule (2900+, priority 2, block, [\"ping\"])", async () => {
    const dnr = makeFakeDnr();
    await syncBlocklistBeaconsDNRLogic({ blacklist: ["blocked.com"] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    const rule = call.addRules[0];
    assert.ok(rule.id >= DNR_BLOCKLIST_BEACON_RULE_ID_BASE && rule.id < DNR_BLOCKLIST_BEACON_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES);
    assert.strictEqual(rule.priority, 2);
    assert.strictEqual(rule.action.type, "block");
    assert.deepEqual(rule.condition.requestDomains, ["blocked.com"]);
    assert.deepEqual(rule.condition.resourceTypes, ["ping"]);
  });

  test("a param-scoped blacklist entry produces NEITHER a Referer nor a beacon force rule", async () => {
    const refererDnr = makeFakeDnr();
    const beaconDnr = makeFakeDnr();
    await syncBlocklistRefererDNRLogic({ blacklist: ["booking.com::aid::123456"] }, refererDnr);
    await syncBlocklistBeaconsDNRLogic({ blacklist: ["booking.com::aid::123456"] }, beaconDnr);

    assert.strictEqual(refererDnr.calls[0].addRules.length, 0);
    assert.strictEqual(beaconDnr.calls[0].addRules.length, 0);
  });

  test("every resync clears the FULL id range for both families before adding the current set", async () => {
    const refererDnr = makeFakeDnr();
    const beaconDnr = makeFakeDnr();
    await syncBlocklistRefererDNRLogic({ blacklist: ["a.com"] }, refererDnr);
    await syncBlocklistBeaconsDNRLogic({ blacklist: ["a.com"] }, beaconDnr);

    assert.strictEqual(refererDnr.calls[0].removeRuleIds.length, DNR_BLOCKLIST_MAX_RULES);
    assert.ok(refererDnr.calls[0].removeRuleIds.includes(DNR_BLOCKLIST_REFERER_RULE_ID_BASE));
    assert.ok(refererDnr.calls[0].removeRuleIds.includes(DNR_BLOCKLIST_REFERER_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES - 1));

    assert.strictEqual(beaconDnr.calls[0].removeRuleIds.length, DNR_BLOCKLIST_MAX_RULES);
    assert.ok(beaconDnr.calls[0].removeRuleIds.includes(DNR_BLOCKLIST_BEACON_RULE_ID_BASE));
    assert.ok(beaconDnr.calls[0].removeRuleIds.includes(DNR_BLOCKLIST_BEACON_RULE_ID_BASE + DNR_BLOCKLIST_MAX_RULES - 1));
  });

  test("a domain removed from the blacklist drops its force rules on the next resync (empty blacklist -> addRules empty, range still cleared)", async () => {
    const dnr = makeFakeDnr();
    await syncBlocklistRefererDNRLogic({ blacklist: [] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
    assert.strictEqual(call.removeRuleIds.length, DNR_BLOCKLIST_MAX_RULES);
  });

  test("blacklisted-domain count over DNR_BLOCKLIST_MAX_RULES: only the cap is added, excess reported via warn (not silently dropped)", async () => {
    const dnr = makeFakeDnr();
    const many = Array.from({ length: DNR_BLOCKLIST_MAX_RULES + 5 }, (_, i) => `d${i}.com`);
    let warnedDropped = null;
    await syncBlocklistRefererDNRLogic({ blacklist: many }, dnr, (dropped) => { warnedDropped = dropped; });

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, DNR_BLOCKLIST_MAX_RULES);
    assert.ok(Array.isArray(warnedDropped), "cap overflow must be reported, not silently dropped");
    assert.strictEqual(warnedDropped.length, 5);
  });

  test("blacklisted-domain count under the cap: warn callback is never invoked", async () => {
    const dnr = makeFakeDnr();
    let warnCalled = false;
    await syncBlocklistBeaconsDNRLogic({ blacklist: ["only-one.com"] }, dnr, () => { warnCalled = true; });
    assert.strictEqual(warnCalled, false);
  });

  test("multiple blacklisted domains each get their own rule with distinct ids", async () => {
    const dnr = makeFakeDnr();
    await syncBlocklistBeaconsDNRLogic({ blacklist: ["a.com", "b.com"] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 2);
    const ids = call.addRules.map((r) => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, "rule ids must be unique");
  });
});

// ── 2.8: precedence — allowlist wins ────────────────────────────────────────

describe("Precedence — allowlist allow (1000) shadows blocklist-force (2) and global-suppress (1)", () => {
  test("a domain-only whitelist entry produces the priority-1000 allow rule covering the SAME resourceTypes as the global Referer rule", async () => {
    const allowDnr = makeFakeDnr();
    const globalDnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["example.com"], blacklist: [] }, allowDnr);
    await syncSuppressRefererDNRLogic({ suppressReferer: true }, globalDnr);

    const allowRule = allowDnr.calls[0].addRules[0];
    const globalRule = globalDnr.calls[0].addRules[0];
    assert.strictEqual(allowRule.priority, 1000);
    assert.strictEqual(globalRule.priority, 1);
    assert.ok(allowRule.priority > globalRule.priority);
    assert.deepEqual(allowRule.condition.resourceTypes, globalRule.condition.resourceTypes,
      "allow rule and global suppress rule must share the exact same resourceTypes list so the allow shadows it on every type");
  });

  test("a domain-only whitelist entry produces the priority-1000 allow rule covering the SAME resourceTypes as the blocklist Referer-force rule", async () => {
    const allowDnr = makeFakeDnr();
    const forceDnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["example.com"], blacklist: [] }, allowDnr);
    await syncBlocklistRefererDNRLogic({ blacklist: ["example.com"] }, forceDnr);

    const allowRule = allowDnr.calls[0].addRules[0];
    const forceRule = forceDnr.calls[0].addRules[0];
    assert.strictEqual(allowRule.priority, 1000);
    assert.strictEqual(forceRule.priority, 2);
    assert.ok(allowRule.priority > forceRule.priority);
    assert.deepEqual(allowRule.condition.resourceTypes, forceRule.condition.resourceTypes);
  });

  test("a domain on BOTH the whitelist and the blacklist still registers the allow rule (allowlist wins)", async () => {
    const dnr = makeFakeDnr();
    await syncAllowlistDNRLogic({ whitelist: ["both.com"], blacklist: ["both.com"] }, dnr);

    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1, "the allow rule must still register even though the domain is also blacklisted");
    assert.strictEqual(call.addRules[0].condition.requestDomains[0], "both.com");
    assert.strictEqual(call.addRules[0].action.type, "allow");
  });

  test("a domain on BOTH lists still yields a blocklist force rule too (force rule is pref-independent; the ALLOW rule is what shadows it, not the force sync itself omitting it)", async () => {
    const dnr = makeFakeDnr();
    await syncBlocklistRefererDNRLogic({ blacklist: ["both.com"] }, dnr);

    // getFullyBlacklistedDomains only reads prefs.blacklist — it has no
    // knowledge of the whitelist, so the force rule is generated regardless.
    // Chrome's real engine is what makes the priority-1000 allow rule win;
    // that precedence is asserted via priority comparison above.
    const call = dnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    assert.strictEqual(call.addRules[0].condition.requestDomains[0], "both.com");
  });
});

// ── 2.9: consent gate ────────────────────────────────────────────────────────

describe("Consent gate — gate-closed removes all four rule families; global pref-OFF keeps blocklist force rules", () => {
  test("gate-closed removes rule 2500, rule 2600, and clears the full 2700-2899/2900-3099 ranges", async () => {
    const dnr = makeFakeDnr();
    await applyReferBeaconGateLogic(
      { suppressReferer: true, blockBeacons: true, blacklist: ["forced.com"] },
      false,
      dnr,
    );

    // 4 calls: suppress-referer clear, block-beacons clear, blocklist-referer clear, blocklist-beacon clear.
    assert.strictEqual(dnr.calls.length, 4);
    const [suppressCall, beaconCall, blocklistRefererCall, blocklistBeaconCall] = dnr.calls;

    assert.deepEqual(suppressCall.removeRuleIds, [DNR_SUPPRESS_REFERER_RULE_ID]);
    assert.strictEqual(suppressCall.addRules.length, 0);

    assert.deepEqual(beaconCall.removeRuleIds, [DNR_BLOCK_BEACONS_RULE_ID]);
    assert.strictEqual(beaconCall.addRules.length, 0);

    assert.strictEqual(blocklistRefererCall.removeRuleIds.length, DNR_BLOCKLIST_MAX_RULES);
    assert.strictEqual(blocklistRefererCall.addRules.length, 0,
      "gate-closed must clear blocklist-force rules too, even though a domain IS blacklisted — consent gate wins over 'always aggressive here'");

    assert.strictEqual(blocklistBeaconCall.removeRuleIds.length, DNR_BLOCKLIST_MAX_RULES);
    assert.strictEqual(blocklistBeaconCall.addRules.length, 0);
  });

  test("gate-open + global pref OFF: removes only the global rule but KEEPS blocklist force rules active", async () => {
    const dnr = makeFakeDnr();
    await applyReferBeaconGateLogic(
      { suppressReferer: false, blockBeacons: false, blacklist: ["forced.com"] },
      true,
      dnr,
    );

    assert.strictEqual(dnr.calls.length, 4);
    const [suppressCall, beaconCall, blocklistRefererCall, blocklistBeaconCall] = dnr.calls;

    assert.strictEqual(suppressCall.addRules.length, 0, "global Referer rule must be removed when suppressReferer is false");
    assert.strictEqual(beaconCall.addRules.length, 0, "global beacon rule must be removed when blockBeacons is false");

    assert.strictEqual(blocklistRefererCall.addRules.length, 1,
      "blocklist Referer force rule must STILL be registered even though the global pref is OFF (D2 override)");
    assert.strictEqual(blocklistRefererCall.addRules[0].condition.requestDomains[0], "forced.com");

    assert.strictEqual(blocklistBeaconCall.addRules.length, 1,
      "blocklist beacon force rule must STILL be registered even though the global pref is OFF (D2 override)");
    assert.strictEqual(blocklistBeaconCall.addRules[0].condition.requestDomains[0], "forced.com");
  });

  test("gate-open + global prefs ON + no blacklisted domains: both global rules register, blocklist ranges are cleared with no rules added", async () => {
    const dnr = makeFakeDnr();
    await applyReferBeaconGateLogic(
      { suppressReferer: true, blockBeacons: true, blacklist: [] },
      true,
      dnr,
    );

    const [suppressCall, beaconCall, blocklistRefererCall, blocklistBeaconCall] = dnr.calls;
    assert.strictEqual(suppressCall.addRules.length, 1);
    assert.strictEqual(beaconCall.addRules.length, 1);
    assert.strictEqual(blocklistRefererCall.addRules.length, 0);
    assert.strictEqual(blocklistBeaconCall.addRules.length, 0);
  });
});

// ── Source-level guards: verify the production SW was updated ───────────────

const swFnStart = swSource.indexOf("async function syncSuppressRefererDNR(");
const swFnBlock = swSource.slice(swFnStart, swFnStart + 6500); // covers all four fns
const applyFnStart = swSource.indexOf("async function applyDnrState(");
// Bumped 6000 -> 9000 for #1257 item 5: the gate-closed branch grew a
// tearDownAndVerify() wrapper, which pushed the calls asserted below past the
// old window. A fixed-size slice that must be re-tuned whenever the function
// grows is a guard that eventually gets deleted, so the first assertion in the
// gate-closed test now checks the window still reaches its target and says so.
const applyFnBlock = swSource.slice(applyFnStart, applyFnStart + 9000);
const gateClosedBlock = applyFnBlock.slice(applyFnBlock.indexOf("Gate closed:"));

describe("service-worker.js source guards — the four new sync fns exist and are wired", () => {
  test("all four sync functions exist, guard on hasDNR, and use try/catch", () => {
    assert.ok(swFnStart !== -1, "syncSuppressRefererDNR must exist in the service worker");
    for (const name of [
      "async function syncSuppressRefererDNR(",
      "async function syncBlockBeaconsDNR(",
      "async function syncBlocklistRefererDNR(",
      "async function syncBlocklistBeaconsDNR(",
    ]) {
      assert.ok(swSource.includes(name), `${name} must exist`);
    }
    assert.ok(swFnBlock.includes("if (!hasDNR) return;"));
    assert.ok(swFnBlock.includes("try {") && swFnBlock.includes("catch (err)"));
  });

  test("syncBlocklistRefererDNR / syncBlocklistBeaconsDNR derive domains via getFullyBlacklistedDomains, not a reimplementation", () => {
    assert.ok(swFnBlock.includes("getFullyBlacklistedDomains"),
      "must derive blacklisted domains via getFullyBlacklistedDomains, not reimplement domain matching");
  });

  // #1268: the test that used to sit here scanned this function's SOURCE TEXT
  // for "DNR_SUPPRESS_REFERER_RULE_ID" and "resourceTypes:
  // ALLOWLIST_RESOURCE_TYPES". Both moved into
  // src/background/dnr-privacy-rules.js when the rule building was extracted,
  // so the scan started failing on a change that altered no behaviour at all —
  // the exact zombie-code failure mode the drift guard
  // (service-worker-patterns-drift-guard.test.mjs) exists to discourage.
  //
  // Deleted rather than re-pointed at the new file, because both properties
  // are now asserted on the BUILT RULE instead of on the text that builds it,
  // in tests/unit/dnr-privacy-rules.test.mjs:
  //   - "pref on registers one modifyHeaders rule that strips referer everywhere"
  //     pins id 2500 and asserts resourceTypes is ALLOWLIST_RESOURCE_TYPES itself,
  //     not a string that mentions it;
  //   - "neither global rule id falls inside a blocklist range" pins the id
  //     against collision, which no source scan could have checked.

  test("ALLOWLIST_RESOURCE_TYPES is imported from ../lib/dnr-ids.js, not re-declared locally", () => {
    assert.ok(
      swSource.includes('ALLOWLIST_RESOURCE_TYPES,') && swSource.includes('from "../lib/dnr-ids.js"'),
      "ALLOWLIST_RESOURCE_TYPES must be imported from dnr-ids.js (task 1.5)",
    );
    assert.ok(
      !swSource.includes("const ALLOWLIST_RESOURCE_TYPES = ["),
      "service-worker.js must not re-declare ALLOWLIST_RESOURCE_TYPES locally after promoting it to dnr-ids.js",
    );
  });

  test("applyDnrState gate-open branch calls all four sync fns after syncAllowlistDNR", () => {
    const allowIdx = applyFnBlock.indexOf("await syncAllowlistDNR(prefs);");
    const suppressIdx = applyFnBlock.indexOf("await syncSuppressRefererDNR(prefs);");
    const beaconIdx = applyFnBlock.indexOf("await syncBlockBeaconsDNR(prefs);");
    const blocklistRefererIdx = applyFnBlock.indexOf("await syncBlocklistRefererDNR(prefs);");
    const blocklistBeaconIdx = applyFnBlock.indexOf("await syncBlocklistBeaconsDNR(prefs);");
    assert.ok(allowIdx !== -1 && suppressIdx !== -1 && beaconIdx !== -1 && blocklistRefererIdx !== -1 && blocklistBeaconIdx !== -1,
      "all gate-open calls must be present");
    assert.ok(suppressIdx > allowIdx, "syncSuppressRefererDNR must be called after syncAllowlistDNR");
    assert.ok(beaconIdx > suppressIdx);
    assert.ok(blocklistRefererIdx > beaconIdx);
    assert.ok(blocklistBeaconIdx > blocklistRefererIdx);
  });

  test("applyDnrState gate-closed branch explicitly clears 2500, 2600, and both blocklist ranges", () => {
    assert.ok(
      gateClosedBlock.includes("syncBlocklistBeaconsDNR"),
      "the extraction window no longer spans the gate-closed branch — raise the slice " +
        "bound above. The assertions below are reading a truncated region, and their " +
        "failures would read as a real regression when they are not."
    );
    assert.ok(gateClosedBlock.includes("syncSuppressRefererDNR({ suppressReferer: false })"));
    assert.ok(gateClosedBlock.includes("syncBlockBeaconsDNR({ blockBeacons: false })"));
    assert.ok(gateClosedBlock.includes("syncBlocklistRefererDNR({ blacklist: [] })"));
    assert.ok(gateClosedBlock.includes("syncBlocklistBeaconsDNR({ blacklist: [] })"));
  });

  test("storage.onChanged re-syncs DNR when suppressReferer or blockBeacons change", () => {
    const storageListenerStart = swSource.lastIndexOf("chrome.storage.onChanged.addListener");
    const storageListenerBlock = swSource.slice(storageListenerStart, storageListenerStart + 2700);
    assert.ok(storageListenerBlock.includes("changes.suppressReferer"));
    assert.ok(storageListenerBlock.includes("changes.blockBeacons"));
  });
});
