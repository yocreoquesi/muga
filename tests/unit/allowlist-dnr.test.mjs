/**
 * MUGA — Unit tests for syncAllowlistDNR() (#allowlist-full-inert, #1266 item 5, #1268)
 *
 * This file used to reach the service worker two ways: a hand-written mirror
 * of syncAllowlistDNR() exercised against a fake declarativeNetRequest
 * facade, plus a set of `swSource.indexOf`/`.slice`/`.includes` source-region
 * guards scraping production text for wiring that could not otherwise be
 * reached (`applyDnrState` calls `syncAllowlistDNR` after
 * `syncCustomParamsDNR`, the gate-closed branch clears it, and so on). Both
 * are the debt #1268 is about: a mirror can drift from production and stay
 * green, and a source scrape only proves a string is present, not that the
 * code behaves.
 *
 * `syncAllowlistDNR` and `applyDnrState` moved to src/background/dnr-sync.js
 * (#1266 item 5), which is importable in Node with a stubbed `chrome`. So
 * this file now imports the REAL functions: the algorithm tests below run
 * the shipped `syncAllowlistDNR` directly, and the wiring assertions that
 * used to scrape `applyDnrState`'s source now call the real `applyDnrState`
 * and record the ORDER its `updateDynamicRules` calls actually happen in.
 *
 * getFullyExemptDomains() itself is NOT reimplemented here — syncAllowlistDNR
 * imports it directly from src/lib/cleaner.js, so calling the real sync
 * function exercises the real domain-selection logic too.
 *
 * One assertion could not be migrated: "storage.onChanged re-syncs DNR when
 * whitelist or blacklist changes" concerns wiring in the message-listener /
 * lifecycle code that stays in service-worker.js as the composition root
 * (#1266 item 5's own scope note). It remains a source guard, kept in a
 * dedicated describe block below.
 */

import { test, describe, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  DNR_ALLOWLIST_RULE_ID_BASE,
  DNR_ALLOWLIST_MAX_RULES,
  DNR_CUSTOM_PARAMS_RULE_ID,
  DNR_REMOTE_PARAMS_RULE_ID,
  ALLOWLIST_RESOURCE_TYPES as IMPORTED_ALLOWLIST_RESOURCE_TYPES,
} from "../../src/lib/dnr-ids.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// storage.onChanged wiring stays in service-worker.js (the composition
// root — see #1266 item 5) and is not reachable through dnr-sync.js, so
// that one assertion still reads the service worker's source.
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8"
);

const ALLOWLIST_RULE_ID_RANGE = Array.from(
  { length: DNR_ALLOWLIST_MAX_RULES },
  (_, i) => DNR_ALLOWLIST_RULE_ID_BASE + i,
);

// ── Stub chrome BEFORE importing dnr-sync.js ─────────────────────────────────

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

let fakeDnr;
let syncAllowlistDNR;
let applyDnrState;
const warnCalls = [];
let realWarn;

before(async () => {
  globalThis.chrome = {
    declarativeNetRequest: {
      updateDynamicRules: (opts) => fakeDnr.updateDynamicRules(opts),
      updateEnabledRulesets: () => Promise.resolve(),
      getDynamicRules: () => Promise.resolve([]),
    },
    runtime: {
      getManifest: () => ({ manifest_version: 3, declarative_net_request: { rule_resources: [] } }),
      getURL: (p) => "file://" + p,
    },
  };
  ({ syncAllowlistDNR, applyDnrState } = await import("../../src/background/dnr-sync.js"));
  realWarn = console.warn;
  console.warn = (...args) => { warnCalls.push(args); realWarn(...args); };
});

beforeEach(() => {
  fakeDnr = makeFakeDnr();
  warnCalls.length = 0;
});

// ── Tests ────────────────────────────────────────────────────────────────────

describe("syncAllowlistDNR — one allow rule per exempt domain", () => {
  test("a domain-only whitelist entry produces exactly one allow rule", async () => {
    await syncAllowlistDNR({ whitelist: ["example.com"], blacklist: [] });

    assert.strictEqual(fakeDnr.calls.length, 1);
    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, 1);
    const rule = call.addRules[0];
    assert.strictEqual(rule.action.type, "allow");
    assert.deepEqual(rule.condition.requestDomains, ["example.com"]);
    assert.ok(rule.id >= DNR_ALLOWLIST_RULE_ID_BASE && rule.id < DNR_ALLOWLIST_RULE_ID_BASE + DNR_ALLOWLIST_MAX_RULES);
  });

  test("a `::disabled` blacklist entry (legacy syntax, removed) does NOT produce an allow rule", async () => {
    await syncAllowlistDNR({ whitelist: [], blacklist: ["paused.com::disabled"] });

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
  });

  test("allow rule priority (1000) is strictly higher than every strip/redirect rule (priority 1)", async () => {
    await syncAllowlistDNR({ whitelist: ["example.com"], blacklist: [] });

    const rule = fakeDnr.calls[0].addRules[0];
    assert.strictEqual(rule.priority, 1000);
    assert.ok(rule.priority > 1, "allow priority must exceed the priority-1 strip/redirect rules");
  });

  test("resourceTypes explicitly includes main_frame — the top-level-navigation case Chrome excludes by default", async () => {
    // Chrome's DNR API matches every resource type EXCEPT main_frame when
    // resourceTypes is omitted. Every strip/redirect rule MUGA registers
    // (tracking-params.json, syncCustomParamsDNR, amp-redirect.json, ...)
    // explicitly lists main_frame, so the allow rule must too, or a plain
    // top-level navigation to an allowlisted domain would still get its
    // tracking params stripped at the network layer. Asserted against the
    // real ALLOWLIST_RESOURCE_TYPES import (not a re-declared local copy).
    await syncAllowlistDNR({ whitelist: ["example.com"], blacklist: [] });

    const rule = fakeDnr.calls[0].addRules[0];
    assert.deepEqual(rule.condition.resourceTypes, IMPORTED_ALLOWLIST_RESOURCE_TYPES);
    assert.ok(Array.isArray(rule.condition.resourceTypes), "resourceTypes must be an explicit array, not omitted");
    assert.ok(rule.condition.resourceTypes.includes("main_frame"), "main_frame must be explicitly listed");
    assert.ok(rule.condition.resourceTypes.includes("sub_frame"), "sub_frame must be covered too (wrapper/AMP redirects run there)");
  });

  test("multiple exempt domains each get their own rule with distinct ids", async () => {
    await syncAllowlistDNR(
      // c.com::disabled is a stray legacy blacklist entry (removed syntax) and
      // must NOT produce a rule alongside the two real whitelist entries.
      { whitelist: ["a.com", "b.com"], blacklist: ["c.com::disabled"] },
    );

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, 2);
    const domains = call.addRules.map(r => r.condition.requestDomains[0]).sort();
    assert.deepEqual(domains, ["a.com", "b.com"]);
    const ids = call.addRules.map(r => r.id);
    assert.strictEqual(new Set(ids).size, ids.length, "rule ids must be unique");
  });

  test("a param-scoped whitelist entry does NOT produce an allow rule", async () => {
    await syncAllowlistDNR({ whitelist: ["example.com::tag::x"], blacklist: [] });

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
  });

  test("a plain blacklist entry without ::disabled does NOT produce an allow rule", async () => {
    await syncAllowlistDNR({ whitelist: [], blacklist: ["blocked.com"] });

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
  });
});

describe("syncAllowlistDNR — clears stale rules", () => {
  test("every sync removes the full allowlist id range before adding the current set", async () => {
    await syncAllowlistDNR({ whitelist: ["example.com"], blacklist: [] });

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.removeRuleIds.length, DNR_ALLOWLIST_MAX_RULES);
    assert.ok(call.removeRuleIds.includes(DNR_ALLOWLIST_RULE_ID_BASE));
    assert.ok(call.removeRuleIds.includes(DNR_ALLOWLIST_RULE_ID_BASE + DNR_ALLOWLIST_MAX_RULES - 1));
  });

  test("no exempt domains — removeRuleIds still clears the range, addRules is empty (no stale rules survive de-whitelisting)", async () => {
    await syncAllowlistDNR({ whitelist: [], blacklist: [] });

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, 0);
    assert.strictEqual(call.removeRuleIds.length, DNR_ALLOWLIST_MAX_RULES);
  });

  test("allowlist rule IDs never collide with DNR_CUSTOM_PARAMS_RULE_ID or DNR_REMOTE_PARAMS_RULE_ID", () => {
    assert.ok(!ALLOWLIST_RULE_ID_RANGE.includes(DNR_CUSTOM_PARAMS_RULE_ID));
    assert.ok(!ALLOWLIST_RULE_ID_RANGE.includes(DNR_REMOTE_PARAMS_RULE_ID));
  });
});

describe("syncAllowlistDNR — cap and warn, no silent truncation", () => {
  test("exempt-domain count over the cap: only the cap is added, excess is reported via console.warn", async () => {
    const many = Array.from({ length: DNR_ALLOWLIST_MAX_RULES + 5 }, (_, i) => `d${i}.com`);
    await syncAllowlistDNR({ whitelist: many, blacklist: [] });

    const call = fakeDnr.calls[0];
    assert.strictEqual(call.addRules.length, DNR_ALLOWLIST_MAX_RULES);
    assert.strictEqual(warnCalls.length, 1, "cap overflow must be reported, not silently dropped");
    const [, dropped] = warnCalls[0];
    assert.ok(Array.isArray(dropped));
    assert.strictEqual(dropped.length, 5);
  });

  test("exempt-domain count under the cap: console.warn is never invoked", async () => {
    await syncAllowlistDNR({ whitelist: ["example.com"], blacklist: [] });
    assert.strictEqual(warnCalls.length, 0);
  });
});

describe("syncAllowlistDNR — hasDNR guard and error isolation", () => {
  test("wraps updateDynamicRules in try/catch: a throwing DNR call does not reject syncAllowlistDNR", async () => {
    globalThis.chrome.declarativeNetRequest.updateDynamicRules = () => {
      throw new Error("simulated DNR failure");
    };
    try {
      await assert.doesNotReject(() => syncAllowlistDNR({ whitelist: ["example.com"], blacklist: [] }));
    } finally {
      globalThis.chrome.declarativeNetRequest.updateDynamicRules = (opts) => fakeDnr.updateDynamicRules(opts);
    }
  });
});

// ── applyDnrState wiring: real ordering, not a source scrape ────────────────
//
// #1268: this used to scan applyDnrState's SOURCE TEXT for the exact call
// strings "await syncCustomParamsDNR(prefs.customParams);" and
// "await syncAllowlistDNR(prefs);" and compare their string offsets. That
// proves the calls are textually present in that order; it does not prove
// applyDnrState actually invokes them in that order at runtime — a
// refactor that kept both lines but changed control flow around them could
// still pass. Calling the real, imported applyDnrState and recording which
// rule family each updateDynamicRules call touches (by inspecting
// removeRuleIds) asserts the real runtime order instead.

function ruleFamilyOf(call) {
  const ids = call.removeRuleIds ?? [];
  if (ids.includes(DNR_CUSTOM_PARAMS_RULE_ID)) return "customParams";
  if (ids.includes(DNR_ALLOWLIST_RULE_ID_BASE)) return "allowlist";
  return null;
}

describe("applyDnrState — real ordering and gate-closed clearing of the allowlist", () => {
  test("gate-open branch calls syncAllowlistDNR after syncCustomParamsDNR", async () => {
    await applyDnrState({
      enabled: true,
      dnrEnabled: true,
      onboardingDone: true,
      customParams: ["tracked"],
      whitelist: ["example.com"],
      blacklist: [],
      remoteRulesEnabled: false,
    });

    const families = fakeDnr.calls.map(ruleFamilyOf).filter(Boolean);
    const customIdx = families.indexOf("customParams");
    const allowIdx = families.indexOf("allowlist");
    assert.ok(customIdx !== -1 && allowIdx !== -1, "both gate-open calls must actually happen");
    assert.ok(allowIdx > customIdx, "syncAllowlistDNR must run after syncCustomParamsDNR in the gate-open branch");
  });

  test("gate-closed branch clears the allowlist range (addRules empty)", async () => {
    await applyDnrState({
      enabled: false,
      dnrEnabled: true,
      onboardingDone: true,
      whitelist: ["example.com"],
      blacklist: [],
      remoteRulesEnabled: false,
    });

    const allowlistCalls = fakeDnr.calls.filter((c) => ruleFamilyOf(c) === "allowlist");
    assert.strictEqual(allowlistCalls.length, 1, "gate-closed teardown must clear the allowlist range exactly once");
    assert.deepEqual(allowlistCalls[0].addRules, [], "gate-closed must register no allow rules");
    assert.strictEqual(
      allowlistCalls[0].removeRuleIds.length,
      DNR_ALLOWLIST_MAX_RULES,
      "gate-closed must clear the full allowlist id range"
    );
  });
});

// ── Source-level guard: wiring that stays in service-worker.js ──────────────
//
// storage.onChanged lives in the message-listener / lifecycle code that
// stays in service-worker.js as the composition root (#1266 item 5's own
// scope note), so it is not reachable through the extracted dnr-sync.js and
// remains a source guard.

describe("service-worker.js source guard — storage.onChanged wiring", () => {
  test("storage.onChanged re-syncs DNR when whitelist or blacklist changes", () => {
    const storageListenerStart = swSource.lastIndexOf("chrome.storage.onChanged.addListener");
    assert.ok(storageListenerStart !== -1, "storage onChanged listener must exist");
    const storageListenerBlock = swSource.slice(storageListenerStart, storageListenerStart + 2500);
    assert.ok(
      storageListenerBlock.includes("changes.whitelist"),
      "must re-sync DNR when the whitelist changes"
    );
    assert.ok(
      storageListenerBlock.includes("changes.blacklist"),
      "must re-sync DNR when the blacklist changes"
    );
  });
});
