/**
 * MUGA — Tests for service worker patterns and validation
 *
 * Verifies message handler patterns, input validation, and list entry format
 * by reading source code and replicating key functions.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { isValidListEntry } from "../../src/lib/validation.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(join(__dirname, "../../src/background/service-worker.js"), "utf8");

// ── Message handler structure verification ───────────────────────────────────

describe("PROCESS_URL payload limits", () => {
  test("defines a sensible max URL length", () => {
    const match = swSource.match(/const MAX_URL_LENGTH\s*=\s*(\d+)/);
    assert.ok(match, "MAX_URL_LENGTH constant should be defined");
    const value = parseInt(match[1], 10);
    assert.ok(value >= 2048, `MAX_URL_LENGTH (${value}) should be >= 2048`);
    assert.ok(value <= 65536, `MAX_URL_LENGTH (${value}) should be <= 65536`);
  });

  test("rejects URLs exceeding MAX_URL_LENGTH", () => {
    assert.ok(
      swSource.includes("message.url.length > MAX_URL_LENGTH"),
      "PROCESS_URL handler should check url length against MAX_URL_LENGTH"
    );
  });

  test("accepts URLs at exactly MAX_URL_LENGTH", () => {
    // Boundary: the guard is strictly greater-than, so length === MAX_URL_LENGTH is allowed
    assert.ok(
      swSource.includes("message.url.length > MAX_URL_LENGTH"),
      "guard must be strictly greater-than so boundary-length URLs are accepted"
    );
    assert.ok(
      !swSource.includes("message.url.length >= MAX_URL_LENGTH"),
      "guard must not be >= (that would reject exactly-MAX_URL_LENGTH URLs)"
    );
  });
});

describe("Service worker message handlers", () => {
  test("handles PROCESS_URL message type", () => {
    assert.ok(swSource.includes('message.type === "PROCESS_URL"'));
  });

  test("handles ADD_TO_WHITELIST message type", () => {
    assert.ok(swSource.includes('message.type === "ADD_TO_WHITELIST"'));
  });

  test("handles ADD_TO_BLACKLIST message type", () => {
    assert.ok(swSource.includes('message.type === "ADD_TO_BLACKLIST"'));
  });

  test("handles getPrefs message type", () => {
    assert.ok(swSource.includes('message.type === "getPrefs"'));
  });

  test("handles GET_DEBUG_LOG message type", () => {
    assert.ok(swSource.includes('message.type === "GET_DEBUG_LOG"'));
  });

  test("validates sender.id in main message listener", () => {
    assert.ok(swSource.includes("sender.id !== chrome.runtime.id"));
  });

  test("ADD_TO_WHITELIST validates entry with isValidListEntry", () => {
    assert.ok(swSource.includes('isValidListEntry(entry)'));
  });

  test("list mutations are serialized via _listMutationQueue", () => {
    assert.ok(swSource.includes("_listMutationQueue"));
  });

  test("list mutations read fresh prefs (not cache) to prevent race", () => {
    // After the queue fix, handlers should call getPrefs() directly, not getPrefsWithCache()
    // Use the dedicated handler block (skip combined tab guard at the top)
    const whitelistStart = swSource.indexOf('if (message.type === "ADD_TO_WHITELIST")');
    const blacklistStart = swSource.indexOf('if (message.type === "ADD_TO_BLACKLIST")');
    const whitelistHandler = swSource.slice(whitelistStart, blacklistStart);
    assert.ok(whitelistHandler.includes("getPrefs()"), "whitelist handler should read fresh prefs");
  });
});

// ── isValidListEntry validation ──────────────────────────────────────────────

describe("isValidListEntry — domain format", () => {
  test("accepts plain domain", () => {
    assert.ok(isValidListEntry("amazon.es"));
    assert.ok(isValidListEntry("booking.com"));
    assert.ok(isValidListEntry("sub.domain.co.uk"));
  });

  test("accepts domain::disabled", () => {
    assert.ok(isValidListEntry("amazon.es::disabled"));
  });

  test("accepts domain::param::value", () => {
    assert.ok(isValidListEntry("amazon.es::tag::youtuber-21"));
    assert.ok(isValidListEntry("booking.com::aid::12345"));
  });

  test("rejects empty string", () => {
    assert.ok(!isValidListEntry(""));
  });

  test("rejects non-string", () => {
    assert.ok(!isValidListEntry(null));
    assert.ok(!isValidListEntry(42));
    assert.ok(!isValidListEntry(undefined));
  });

  test("rejects over 500 chars", () => {
    assert.ok(!isValidListEntry("a".repeat(501)));
  });

  test("rejects domain with special characters", () => {
    assert.ok(!isValidListEntry("amazon.es<script>"));
    assert.ok(!isValidListEntry("amazon.es;drop"));
    assert.ok(!isValidListEntry("amazon es"));
  });

  test("rejects 2-part entry that isn't ::disabled", () => {
    assert.ok(!isValidListEntry("amazon.es::tag"));
    assert.ok(!isValidListEntry("amazon.es::something"));
  });

  test("rejects 3-part entry with empty param or value", () => {
    assert.ok(!isValidListEntry("amazon.es::::value"));
    assert.ok(!isValidListEntry("amazon.es::tag::"));
  });

  test("rejects more than 3 parts", () => {
    assert.ok(!isValidListEntry("a::b::c::d"));
  });
});

// ── Bug #229 regression: entries must use domain::param::value format ────────

describe("Bug #229 — whitelist/blacklist entry format", () => {
  test("domain::param::value format is valid", () => {
    assert.ok(isValidListEntry("amazon.es::tag::youtuber-21"));
  });

  test("old param=value format is rejected (no domain)", () => {
    // Before the fix, entries were stored as "tag=youtuber-21"
    // which parseListEntry treated as a domain name
    assert.ok(!isValidListEntry("tag=youtuber-21"), "param=value format must be rejected");
  });

  test("format with equals sign in domain is rejected", () => {
    assert.ok(!isValidListEntry("aff=other-99"));
  });
});

// ── INCREMENT_STAT handler returns true ──────────────────────────────────────

describe("INCREMENT_STAT handler — response channel", () => {
  test("INCREMENT_STAT handler returns true (keeps response channel open)", () => {
    // All other branches return true to keep the sendResponse channel open.
    // INCREMENT_STAT must also return true for consistency and future-safety.
    const handlerBlock = swSource.slice(
      swSource.indexOf('"INCREMENT_STAT"'),
      swSource.indexOf('"CLEAR_DEBUG_LOG"')
    );
    // The block must NOT end with a bare `return;` (undefined)
    assert.ok(
      !handlerBlock.includes("sendResponse({ ok: true });\n    return;\n"),
      "INCREMENT_STAT must not use bare return (returns undefined, closes channel early)"
    );
    assert.ok(
      handlerBlock.includes("return true;"),
      "INCREMENT_STAT handler must return true to keep the sendResponse channel open"
    );
  });
});

// ── Cache invalidation version counter ───────────────────────────────────────

describe("Cache invalidation — version counter", () => {
  test("defines _cacheVersion counter", () => {
    assert.ok(swSource.includes("let _cacheVersion = 0"), "_cacheVersion should be initialized to 0");
  });

  test("getPrefsWithCache captures version before fetch", () => {
    assert.ok(
      swSource.includes("const versionAtStart = _cacheVersion"),
      "should snapshot _cacheVersion before starting async fetch"
    );
  });

  test("getPrefsWithCache discards stale result when version changed", () => {
    assert.ok(
      swSource.includes("_cacheVersion !== versionAtStart"),
      "should compare version after fetch completes"
    );
  });

  test("storage change listener invalidates prefs cache via _invalidatePrefsCache()", () => {
    const storageListener = swSource.slice(
      swSource.indexOf("chrome.storage.onChanged.addListener"),
      swSource.indexOf("chrome.storage.onChanged.addListener") + 500
    );
    assert.ok(
      storageListener.includes("_invalidatePrefsCache()"),
      "storage listener should call _invalidatePrefsCache() to invalidate the prefs cache"
    );
  });

  test("whitelist handler invalidates prefs cache via _invalidatePrefsCache()", () => {
    // Use the dedicated handler block (skip combined tab guard at the top)
    const whitelistStart = swSource.indexOf('if (message.type === "ADD_TO_WHITELIST")');
    const blacklistStart = swSource.indexOf('if (message.type === "ADD_TO_BLACKLIST")');
    const whitelistHandler = swSource.slice(whitelistStart, blacklistStart);
    assert.ok(
      whitelistHandler.includes("_invalidatePrefsCache()"),
      "whitelist handler should call _invalidatePrefsCache()"
    );
  });

  test("blacklist handler invalidates prefs cache via _invalidatePrefsCache()", () => {
    // Use the dedicated handler block (skip combined guard at the top)
    const blacklistStart = swSource.indexOf('if (message.type === "ADD_TO_BLACKLIST")');
    const blacklistHandler = swSource.slice(blacklistStart, blacklistStart + 800);
    assert.ok(
      blacklistHandler.includes("_invalidatePrefsCache()"),
      "blacklist handler should call _invalidatePrefsCache()"
    );
  });

  test("_invalidatePrefsCache helper is defined and increments _cacheVersion", () => {
    assert.ok(
      swSource.includes("function _invalidatePrefsCache()"),
      "_invalidatePrefsCache helper must be defined"
    );
    const helperBlock = swSource.slice(
      swSource.indexOf("function _invalidatePrefsCache()"),
      swSource.indexOf("function _invalidatePrefsCache()") + 200
    );
    assert.ok(
      helperBlock.includes("_cacheVersion++"),
      "_invalidatePrefsCache must increment _cacheVersion"
    );
    assert.ok(
      helperBlock.includes("cachedPrefs = null"),
      "_invalidatePrefsCache must null cachedPrefs"
    );
    assert.ok(
      helperBlock.includes("prefsFetchPromise = null"),
      "_invalidatePrefsCache must null prefsFetchPromise"
    );
  });
});

// ── Security: debug log must not contain URLs/paths outside devMode ──────────

describe("Security: debug log payload privacy (finding 1)", () => {
  test("logAction('cleaned') does not include cleanUrl unconditionally", () => {
    // cleanUrl must only be logged when devMode is true.
    // The entry object is built before the logAction call; we anchor on cleanedEntry.
    const cleanedEntryStart = swSource.indexOf("const cleanedEntry =");
    assert.ok(cleanedEntryStart !== -1, "cleanedEntry object must exist");
    const cleanedBlock = swSource.slice(cleanedEntryStart, cleanedEntryStart + 600);
    const devModeGatePos = cleanedBlock.indexOf("if (prefs.devMode)");
    assert.ok(devModeGatePos !== -1, "cleanedEntry block must have a devMode gate");
    const cleanUrlBeforeGate = cleanedBlock.slice(0, devModeGatePos).includes("cleanUrl");
    assert.ok(!cleanUrlBeforeGate, "cleanUrl must not appear in the flat log entry before devMode gate");
  });

  test("logAction('cleaned') includes domain unconditionally", () => {
    const cleanedEntryStart = swSource.indexOf("const cleanedEntry =");
    assert.ok(cleanedEntryStart !== -1, "cleanedEntry object must exist");
    const cleanedBlock = swSource.slice(cleanedEntryStart, cleanedEntryStart + 200);
    assert.ok(cleanedBlock.includes("domain"), "domain must always be logged");
  });

  test("logAction('cleaned') includes junkRemoved unconditionally", () => {
    const cleanedEntryStart = swSource.indexOf("const cleanedEntry =");
    assert.ok(cleanedEntryStart !== -1, "cleanedEntry object must exist");
    const cleanedBlock = swSource.slice(cleanedEntryStart, cleanedEntryStart + 250);
    assert.ok(cleanedBlock.includes("junkRemoved"), "junkRemoved must always be logged");
  });

  test("logAction('passthrough') does not include path unconditionally", () => {
    // path must only be logged when devMode is true.
    // The devMode gate wraps path/params assignment BEFORE the logAction call.
    // We find the block that contains both the gate and the logAction call.
    const passthroughEntryStart = swSource.indexOf("const passthroughEntry =");
    assert.ok(passthroughEntryStart !== -1, "passthroughEntry object must exist");
    const passthroughBlock = swSource.slice(passthroughEntryStart, passthroughEntryStart + 400);
    // The flat literal (before devMode gate) must NOT contain path:
    const devModeGatePos = passthroughBlock.indexOf("if (prefs.devMode)");
    assert.ok(devModeGatePos !== -1, "passthrough block must have a devMode gate");
    const pathBeforeGate = passthroughBlock.slice(0, devModeGatePos).includes("path:");
    assert.ok(!pathBeforeGate, "path must not appear in passthrough entry before devMode gate");
  });

  test("sender.tab guard required for list-mutation messages (finding 5)", () => {
    // ADD_TO_WHITELIST and ADD_TO_BLACKLIST handlers must check sender.tab
    const whitelistPos = swSource.indexOf('"ADD_TO_WHITELIST"');
    const blacklistPos = swSource.indexOf('"ADD_TO_BLACKLIST"');
    const listSection = swSource.slice(whitelistPos, blacklistPos + 600);
    assert.ok(
      listSection.includes("sender.tab"),
      "list-mutation handlers must check sender.tab"
    );
  });
});

// ── Remote-rules refresh — on-wake time-gated (v1.10.1) ──────────────────────
// Replaces chrome.alarms. No new permission required — the SW wakes on natural
// events (onInstalled, onStartup, PROCESS_URL) and checks the stored fetchedAt
// timestamp. One check per SW lifetime via a module-level flag.

const REMOTE_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Pure extraction of maybeFetchRemoteRules for unit testing. Mirrors the
 * production logic in service-worker.js.
 */
function makeMaybeFetchHelper() {
  let _checked = false;
  return async function maybeFetchRemoteRules(deps) {
    if (_checked) return "skipped-dedup";
    _checked = true;
    const { remoteRulesEnabled } = await deps.getPrefs();
    if (!remoteRulesEnabled) return "disabled";
    const { remoteRulesMeta } = await deps.getRemoteParams();
    const last = remoteRulesMeta?.fetchedAt ? Date.parse(remoteRulesMeta.fetchedAt) : 0;
    if (Number.isFinite(last) && Date.now() - last < REMOTE_REFRESH_INTERVAL_MS) {
      return "fresh";
    }
    await deps.runFetch(deps.fetchDeps);
    return "ran";
  };
}

describe("Remote-rules on-wake time-gated fetch (replaces alarms)", () => {
  test("short-circuits when remoteRulesEnabled is false (SC-01)", async () => {
    let fetchCalled = false;
    const maybe = makeMaybeFetchHelper();
    const result = await maybe({
      getPrefs: async () => ({ remoteRulesEnabled: false }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "disabled");
    assert.strictEqual(fetchCalled, false, "fetch must not fire when disabled");
  });

  test("short-circuits when last fetch is fresh (< 7 days)", async () => {
    let fetchCalled = false;
    const maybe = makeMaybeFetchHelper();
    const recent = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // 1h ago
    const result = await maybe({
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: recent } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "fresh");
    assert.strictEqual(fetchCalled, false);
  });

  test("fires fetch when last fetch is stale (> 7 days)", async () => {
    let fetchCalled = false;
    const maybe = makeMaybeFetchHelper();
    const stale = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const result = await maybe({
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: stale } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "ran");
    assert.strictEqual(fetchCalled, true);
  });

  test("fires fetch when fetchedAt is absent (first-time enable)", async () => {
    let fetchCalled = false;
    const maybe = makeMaybeFetchHelper();
    const result = await maybe({
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "ran");
    assert.strictEqual(fetchCalled, true);
  });

  test("dedupes subsequent calls in the same SW lifetime", async () => {
    let fetchCount = 0;
    const maybe = makeMaybeFetchHelper();
    const deps = {
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async () => { fetchCount++; },
      fetchDeps: {},
    };
    const first = await maybe(deps);
    const second = await maybe(deps);
    const third = await maybe(deps);
    assert.strictEqual(first, "ran");
    assert.strictEqual(second, "skipped-dedup");
    assert.strictEqual(third, "skipped-dedup");
    assert.strictEqual(fetchCount, 1, "runFetch must only be invoked once per SW lifetime");
  });

  test("passes fetchDeps to runFetch", async () => {
    let received = null;
    const maybe = makeMaybeFetchHelper();
    const fakeDeps = { marker: "xyz" };
    await maybe({
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async (deps) => { received = deps; },
      fetchDeps: fakeDeps,
    });
    assert.strictEqual(received, fakeDeps);
  });

  test("service worker source defines maybeFetchRemoteRules", () => {
    assert.ok(
      /function\s+maybeFetchRemoteRules|async\s+function\s+maybeFetchRemoteRules/.test(swSource),
      "SW must define maybeFetchRemoteRules function"
    );
  });

  test("service worker defines REMOTE_REFRESH_INTERVAL_MS as 7 days", () => {
    const match = swSource.match(/REMOTE_REFRESH_INTERVAL_MS\s*=\s*([^;]+);/);
    assert.ok(match, "SW must define REMOTE_REFRESH_INTERVAL_MS");
    // eslint-disable-next-line no-eval
    const value = Function(`"use strict"; return (${match[1]});`)();
    assert.strictEqual(value, 7 * 24 * 60 * 60 * 1000, "must equal 7 days in ms");
  });

  test("service worker calls maybeFetchRemoteRules from onInstalled", () => {
    const onInstalledPos = swSource.indexOf("onInstalled.addListener");
    assert.ok(onInstalledPos !== -1, "onInstalled.addListener must be present");
    const block = swSource.slice(onInstalledPos, onInstalledPos + 600);
    assert.ok(
      block.includes("maybeFetchRemoteRules"),
      "onInstalled handler must call maybeFetchRemoteRules"
    );
  });

  test("service worker calls maybeFetchRemoteRules from onStartup", () => {
    const onStartupPos = swSource.indexOf("onStartup.addListener");
    assert.ok(onStartupPos !== -1, "onStartup.addListener must be present");
    const block = swSource.slice(onStartupPos, onStartupPos + 600);
    assert.ok(
      block.includes("maybeFetchRemoteRules"),
      "onStartup handler must call maybeFetchRemoteRules"
    );
  });

  test("service worker calls maybeFetchRemoteRules from PROCESS_URL handler", () => {
    const processUrlPos = swSource.indexOf('message.type === "PROCESS_URL"');
    assert.ok(processUrlPos !== -1, "PROCESS_URL handler must be present");
    const block = swSource.slice(processUrlPos, processUrlPos + 800);
    assert.ok(
      block.includes("maybeFetchRemoteRules"),
      "PROCESS_URL handler must call maybeFetchRemoteRules so users who never restart the browser still get refreshes"
    );
  });

  test("service worker does NOT import chrome.alarms (permission removed)", () => {
    // Regression guard: the alarms permission was removed in v1.10.1.
    // If someone reintroduces chrome.alarms.create / onAlarm, the next build
    // against the current manifest will fail at runtime.
    assert.ok(
      !swSource.includes("chrome.alarms.create"),
      "SW must not reintroduce chrome.alarms.create — v1.10.1 removed the permission"
    );
    assert.ok(
      !swSource.includes("chrome.alarms.onAlarm"),
      "SW must not reintroduce chrome.alarms.onAlarm — v1.10.1 removed the permission"
    );
  });
});

// ── T2.3: ENABLE/DISABLE/GET_STATUS message handlers ────────────────────────

describe("T2.3 — Message handler source patterns", () => {
  test("SW handles ENABLE_REMOTE_RULES message type", () => {
    assert.ok(
      swSource.includes('"ENABLE_REMOTE_RULES"'),
      "SW must handle ENABLE_REMOTE_RULES"
    );
  });

  test("SW handles DISABLE_REMOTE_RULES message type", () => {
    assert.ok(
      swSource.includes('"DISABLE_REMOTE_RULES"'),
      "SW must handle DISABLE_REMOTE_RULES"
    );
  });

  test("SW handles GET_REMOTE_RULES_STATUS message type", () => {
    assert.ok(
      swSource.includes('"GET_REMOTE_RULES_STATUS"'),
      "SW must handle GET_REMOTE_RULES_STATUS"
    );
  });

  test("ENABLE_REMOTE_RULES handler calls setPrefs with remoteRulesEnabled true", () => {
    const enablePos = swSource.indexOf('"ENABLE_REMOTE_RULES"');
    assert.ok(enablePos !== -1);
    const enableBlock = swSource.slice(enablePos, enablePos + 600);
    assert.ok(
      enableBlock.includes("remoteRulesEnabled: true"),
      "ENABLE handler must setPrefs({ remoteRulesEnabled: true })"
    );
  });

  test("DISABLE_REMOTE_RULES handler calls setPrefs with remoteRulesEnabled false", () => {
    const disablePos = swSource.indexOf('"DISABLE_REMOTE_RULES"');
    assert.ok(disablePos !== -1);
    const disableBlock = swSource.slice(disablePos, disablePos + 600);
    assert.ok(
      disableBlock.includes("remoteRulesEnabled: false"),
      "DISABLE handler must setPrefs({ remoteRulesEnabled: false })"
    );
  });

  test("DISABLE_REMOTE_RULES handler calls clearRemoteCache", () => {
    const disablePos = swSource.indexOf('"DISABLE_REMOTE_RULES"');
    const disableBlock = swSource.slice(disablePos, disablePos + 600);
    assert.ok(
      disableBlock.includes("clearRemoteCache"),
      "DISABLE handler must call clearRemoteCache (REQ-OPT-5, SC-03)"
    );
  });

  test("ENABLE_REMOTE_RULES handler triggers immediate runRemoteRulesFetch", () => {
    const enablePos = swSource.indexOf('"ENABLE_REMOTE_RULES"');
    const enableBlock = swSource.slice(enablePos, enablePos + 600);
    assert.ok(
      enableBlock.includes("runRemoteRulesFetch"),
      "ENABLE handler must call runRemoteRulesFetch for immediate first fetch (REQ-OPT-3)"
    );
  });

  test("GET_REMOTE_RULES_STATUS responds with enabled, meta, supportsAlarms, supportsDNR", () => {
    const statusPos = swSource.indexOf('"GET_REMOTE_RULES_STATUS"');
    const statusBlock = swSource.slice(statusPos, statusPos + 1500);
    assert.ok(statusBlock.includes("supportsAlarms"), "status must include supportsAlarms (REQ-UI-5)");
    assert.ok(statusBlock.includes("supportsDNR"), "status must include supportsDNR (REQ-UI-5)");
    assert.ok(statusBlock.includes("enabled"), "status must include enabled flag");
  });

  test("all remote-rules message handlers return true (keep channel open)", () => {
    // All three handlers must return true per the onMessage invariant.
    // Each handler uses an IIFE pattern; the status handler grew with v1.10.1
    // explanatory comments so give the window enough headroom.
    for (const msgType of ["ENABLE_REMOTE_RULES", "DISABLE_REMOTE_RULES", "GET_REMOTE_RULES_STATUS"]) {
      const pos = swSource.indexOf(`"${msgType}"`);
      assert.ok(pos !== -1, `${msgType} handler must exist`);
      const block = swSource.slice(pos, pos + 1800);
      assert.ok(block.includes("return true"), `${msgType} handler must return true`);
    }
  });

  test("sender.id validation present in message listener (REQ-SECURITY-2)", () => {
    // The main onMessage handler already validates sender.id; the new handlers
    // fall through the same gate — verify the gate is present and covers all messages
    assert.ok(
      swSource.includes("sender.id !== chrome.runtime.id"),
      "onMessage listener must validate sender.id (REQ-SECURITY-2)"
    );
  });
});

// ── T2.4: DNR integration — syncRemoteParamsDNR ──────────────────────────────

import { buildRemoteDnrRule, REMOTE_RULE_ID } from "../../src/lib/remote-rules.js";
import { DNR_CUSTOM_PARAMS_RULE_ID } from "../../src/lib/dnr-ids.js";

/**
 * Pure syncRemoteParamsDNR helper — mirrors the implementation in SW.
 * Extracted here for unit-testability with a fake DNR facade.
 *
 * @param {string[]} params - Remote params to sync (may be empty to remove rule).
 * @param {{ updateDynamicRules: Function } | null} chromeDnr - DNR API or null if unsupported.
 */
async function syncRemoteParamsDNR(params, chromeDnr) {
  if (!chromeDnr) return; // no-op when DNR unsupported
  if (!params || params.length === 0) {
    await chromeDnr.updateDynamicRules({
      removeRuleIds: [REMOTE_RULE_ID],
      addRules: [],
    });
    return;
  }
  await chromeDnr.updateDynamicRules({
    removeRuleIds: [REMOTE_RULE_ID],
    addRules: [buildRemoteDnrRule(params)],
  });
}

describe("T2.4 — syncRemoteParamsDNR", () => {
  test("adds rule 1001 on non-empty params", async () => {
    const calls = [];
    const fakeDnr = { updateDynamicRules(opts) { calls.push(opts); return Promise.resolve(); } };
    await syncRemoteParamsDNR(["utm_test", "fbclid_x"], fakeDnr);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].addRules.length, 1);
    assert.strictEqual(calls[0].addRules[0].id, REMOTE_RULE_ID);
    assert.strictEqual(calls[0].addRules[0].id, 1001);
  });

  test("rule 1001 removeParams contains the provided params", async () => {
    const calls = [];
    const fakeDnr = { updateDynamicRules(opts) { calls.push(opts); return Promise.resolve(); } };
    const params = ["tracker_a", "tracker_b"];
    await syncRemoteParamsDNR(params, fakeDnr);
    const rule = calls[0].addRules[0];
    assert.deepEqual(rule.action.redirect.transform.queryTransform.removeParams, params);
  });

  test("removes rule 1001 on empty params (purely removes)", async () => {
    const calls = [];
    const fakeDnr = { updateDynamicRules(opts) { calls.push(opts); return Promise.resolve(); } };
    await syncRemoteParamsDNR([], fakeDnr);
    assert.strictEqual(calls.length, 1);
    assert.ok(calls[0].removeRuleIds.includes(1001), "must remove rule 1001");
    assert.strictEqual(calls[0].addRules.length, 0, "must not add any rules on empty params");
  });

  test("rule 1000 (custom params) NEVER appears in removeRuleIds (REQ-MERGE-2, REQ-MERGE-4)", async () => {
    const calls = [];
    const fakeDnr = { updateDynamicRules(opts) { calls.push(opts); return Promise.resolve(); } };
    // Test both paths: with params and without
    await syncRemoteParamsDNR(["utm_x"], fakeDnr);
    await syncRemoteParamsDNR([], fakeDnr);
    for (const call of calls) {
      assert.ok(
        !(call.removeRuleIds ?? []).includes(DNR_CUSTOM_PARAMS_RULE_ID),
        `rule 1000 must never appear in removeRuleIds (found in call: ${JSON.stringify(call)})`
      );
      assert.ok(
        !(call.addRules ?? []).some(r => r.id === DNR_CUSTOM_PARAMS_RULE_ID),
        "rule 1000 must never appear in addRules"
      );
    }
  });

  test("no-op when DNR unsupported (chromeDnr is null/undefined)", async () => {
    // Must not throw; returns without calling updateDynamicRules
    await assert.doesNotReject(() => syncRemoteParamsDNR(["utm_x"], null));
    await assert.doesNotReject(() => syncRemoteParamsDNR(["utm_x"], undefined));
  });

  test("service worker source defines syncRemoteParamsDNR function", () => {
    assert.ok(
      swSource.includes("syncRemoteParamsDNR"),
      "SW must define syncRemoteParamsDNR function"
    );
  });

  test("service worker syncRemoteParamsDNR only references REMOTE_RULE_ID (not custom)", () => {
    // Find the syncRemoteParamsDNR function block in the SW source
    const fnStart = swSource.indexOf("function syncRemoteParamsDNR");
    assert.ok(fnStart !== -1, "syncRemoteParamsDNR must be defined in SW");
    const fnBlock = swSource.slice(fnStart, fnStart + 600);
    assert.ok(
      fnBlock.includes("REMOTE_RULE_ID"),
      "syncRemoteParamsDNR must use REMOTE_RULE_ID"
    );
    assert.ok(
      !fnBlock.includes("DNR_CUSTOM_PARAMS_RULE_ID"),
      "syncRemoteParamsDNR must NOT reference DNR_CUSTOM_PARAMS_RULE_ID"
    );
  });
});

// ── Onboarding consent verification ─────────────────────────────────────────

describe("Onboarding consent — source code patterns", () => {
  const onboardingSource = readFileSync(
    join(__dirname, "../../src/onboarding/onboarding.js"), "utf8"
  );

  test("saves consentVersion on acceptance", () => {
    assert.ok(onboardingSource.includes("consentVersion"));
  });

  test("saves consentDate on acceptance", () => {
    assert.ok(onboardingSource.includes("consentDate"));
  });

  test("saves injectOwnAffiliate preference", () => {
    assert.ok(onboardingSource.includes("injectOwnAffiliate"));
  });

  test("saves onboardingDone flag", () => {
    assert.ok(onboardingSource.includes("onboardingDone"));
  });

  test("requires ToS checkbox before proceeding", () => {
    assert.ok(onboardingSource.includes("tos-check"));
  });
});
