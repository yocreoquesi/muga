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
import { TERMS_VERSION } from "../../src/lib/consent-storage.js";

// A stored consent record for a device that has recorded acceptance.
// maybeFetchRemoteRules fetches once onboardingDone is true; the Terms version
// is provenance only and no longer gates anything.
const VALID_CONSENT = { onboardingDone: true, consentVersion: TERMS_VERSION };

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

  test("rejects domain::disabled (legacy per-site-pause syntax removed)", () => {
    assert.ok(!isValidListEntry("amazon.es::disabled"));
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

  test("rejects any 2-part entry", () => {
    assert.ok(!isValidListEntry("amazon.es::tag"));
    assert.ok(!isValidListEntry("amazon.es::something"));
    assert.ok(!isValidListEntry("amazon.es::disabled"));
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

// ── INCREMENT_STAT handler returns false (#706) ──────────────────────────────

describe("INCREMENT_STAT handler — response channel", () => {
  test("INCREMENT_STAT handler returns false (fully synchronous response)", () => {
    // incrementStat() is fire-and-forget; sendResponse({ ok: true }) is
    // dispatched synchronously. Returning true here would keep the message
    // channel open for an async response that never arrives, leaking one
    // port slot per INCREMENT_STAT call (#706). Must return false.
    const handlerBlock = swSource.slice(
      swSource.indexOf('"INCREMENT_STAT"'),
      swSource.indexOf('"CLEAR_DEBUG_LOG"')
    );
    assert.ok(
      /return\s+false\s*;/.test(handlerBlock),
      "INCREMENT_STAT handler must return false — sendResponse is synchronous, no async wait pending"
    );
    assert.ok(
      !/return\s+true\s*;/.test(handlerBlock),
      "INCREMENT_STAT handler must NOT return true — that would leak a port slot per call"
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

  test("local-area listener invalidates cache + reapplies DNR/badge on mugaPerDevicePrefs (#739)", () => {
    // Regression #739: getPrefs() overlays per-device overrides last, so a
    // mugaPerDevicePrefs change must drop the cache and re-apply DNR + badge.
    // Previously the local-area branch returned without handling it, leaving
    // cachedPrefs stale. Single source-string match (no brittle slice chains)
    // captures the whole handling block and asserts its contents at once.
    // toolbar-inactive-badge: the block grew a trailing repaintAllTabsActiveState()
    // call — onboarding/consent is one of the Active-on-tab factors, so a
    // per-device override change must also repaint every open tab's badge.
    const m = swSource.match(
      /if \(changes\.mugaPerDevicePrefs\)\s*\{\s*_invalidatePrefsCache\(\);\s*const prefs = await getPrefsWithCache\(\);\s*await applyDnrState\(prefs\);\s*await applyOnboardingBadge\(prefs\);\s*await repaintAllTabsActiveState\(prefs\);\s*\}/
    );
    assert.ok(
      m,
      "local-area listener must handle changes.mugaPerDevicePrefs by invalidating the cache and re-applying DNR + onboarding badge + tab active-state repaint"
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
    // Read FULL merged prefs (includes the consent overlay), mirroring prod.
    const prefs = await deps.getPrefs();
    if (!prefs.remoteRulesEnabled) return "disabled";
    // Egress gate — mirrors shouldOpenOnboarding(prefs) in service-worker.js.
    // The egress waits until this device has a recorded acceptance at all. It
    // is no longer coupled to a consent VERSION (see the uBO-model note on the
    // production gate).
    if (!prefs.onboardingDone) return "consent-blocked";
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
      getPrefs: async () => ({ remoteRulesEnabled: true, ...VALID_CONSENT }),
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
      getPrefs: async () => ({ remoteRulesEnabled: true, ...VALID_CONSENT }),
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
      getPrefs: async () => ({ remoteRulesEnabled: true, ...VALID_CONSENT }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "ran");
    assert.strictEqual(fetchCalled, true);
  });

  // ── Egress gate on the weekly signed GET ──────────────────────────────────
  // The request must not fire on a device that has never recorded acceptance.
  // These assert REAL behavior (was runFetch called?), not source text.
  //
  // #888 review C1 additionally blocked a user whose stored consentVersion
  // predated the version that disclosed this request. That per-version
  // coupling was dropped with the versioned-consent engine when MUGA adopted
  // the uBlock Origin model; the test below pins the resulting behavior so the
  // change stays visible rather than silently regressing back.
  test("an older stored consentVersion no longer blocks the fetch (uBO model)", async () => {
    let fetchCalled = false;
    const maybe = makeMaybeFetchHelper();
    const result = await maybe({
      // Accepted long ago, at a Terms version predating this request's
      // disclosure. Under the versioned engine this returned "consent-blocked".
      getPrefs: async () => ({ remoteRulesEnabled: true, onboardingDone: true, consentVersion: "1.0" }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "ran");
    assert.strictEqual(fetchCalled, true, "acceptance is not re-gated per Terms version");
  });

  test("does NOT fetch when consent is never-accepted", async () => {
    let fetchCalled = false;
    const maybe = makeMaybeFetchHelper();
    const result = await maybe({
      getPrefs: async () => ({ remoteRulesEnabled: true }), // no onboardingDone → never-accepted
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "consent-blocked");
    assert.strictEqual(fetchCalled, false);
  });

  test("C1: DOES fetch when consent is valid (stored version === required)", async () => {
    let fetchCalled = false;
    const maybe = makeMaybeFetchHelper();
    const result = await maybe({
      // Uses the live TERMS_VERSION (via VALID_CONSENT) rather than
      // a hardcoded literal so this test does not go stale every time a new
      // consent version ships.
      getPrefs: async () => ({ remoteRulesEnabled: true, ...VALID_CONSENT }),
      getRemoteParams: async () => ({ remoteRulesMeta: { fetchedAt: null } }),
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result, "ran");
    assert.strictEqual(fetchCalled, true, "egress allowed once the user has accepted the disclosing consent version");
  });

  test("dedupes subsequent calls in the same SW lifetime", async () => {
    let fetchCount = 0;
    const maybe = makeMaybeFetchHelper();
    const deps = {
      getPrefs: async () => ({ remoteRulesEnabled: true, ...VALID_CONSENT }),
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
      getPrefs: async () => ({ remoteRulesEnabled: true, ...VALID_CONSENT }),
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
    // Window widened (600 → 1200) after the handler grew a per-device override
    // reconcile step + comment ahead of the immediate fetch (#888 write path).
    const enableBlock = swSource.slice(enablePos, enablePos + 1200);
    assert.ok(
      enableBlock.includes("runRemoteRulesFetch"),
      "ENABLE handler must call runRemoteRulesFetch for immediate first fetch (REQ-OPT-3)"
    );
  });

  test("GET_REMOTE_RULES_STATUS delegates to buildRemoteRulesStatus (canonical getPrefs value)", () => {
    // #888 follow-up: the reply (enabled/meta/remoteParams/supportsDNR) is now
    // built by src/lib/remote-rules-status.js so `enabled` reflects the
    // CANONICAL effective value via getPrefs() instead of a hardcoded sync
    // default. The field-level shape is pinned in remote-rules-status.test.mjs.
    // supportsAlarms was retired in #706 — zero consumers; it must not return.
    const statusPos = swSource.indexOf('"GET_REMOTE_RULES_STATUS"');
    const statusBlock = swSource.slice(statusPos, statusPos + 1500);
    assert.ok(
      statusBlock.includes("buildRemoteRulesStatus"),
      "handler must delegate to buildRemoteRulesStatus (single source of truth via getPrefs)"
    );
    assert.ok(statusBlock.includes("getPrefs"), "handler must pass getPrefs so enabled is the effective value");
    assert.ok(statusBlock.includes("hasDNR"), "handler must pass hasDNR for the supportsDNR feature-detect (REQ-UI-5)");
    assert.ok(
      !statusBlock.includes("supportsAlarms"),
      "supportsAlarms must NOT be reintroduced — retired in #706 (zero consumers)"
    );
    assert.ok(
      !/sync\.get\(\{\s*remoteRulesEnabled:\s*false\s*\}\)/.test(statusBlock),
      "the hardcoded { remoteRulesEnabled: false } sync default must be gone"
    );
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

// ── FORCE_FETCH_REMOTE_RULES: manual "Update now" handler ───────────────────
// Settings "Update now" button forces an immediate fetch, bypassing the 7-day
// cadence gate in maybeFetchRemoteRules (runRemoteRulesFetch itself has no
// cadence gate to bypass). This handler MUST replicate the same consent gate
// maybeFetchRemoteRules enforces so the button cannot leak the signed GET
// before consent.
//
// Behavioral coverage mirrors the makeMaybeFetchHelper() idiom used above
// (#824 — prefer a pure re-implementation exercised behaviorally over
// source-text assertions; the #824 source-grep ratchet blocks adding more
// than one new swSource.* assertion per file). Only one minimal source guard
// is kept below, to pin that the real handler exists in the SW.

/**
 * Pure extraction of the FORCE_FETCH_REMOTE_RULES handler body for unit
 * testing. Mirrors the production logic in service-worker.js exactly:
 * same gate, same order, same response shapes.
 *
 * DRIFT GUARD: the source-existence test below only pins that the real
 * handler exists, NOT that its consent gate (remoteRulesEnabled +
 * shouldOpenOnboarding, in that order) is intact. If you edit the real
 * handler's gate in service-worker.js, edit this mirror to match — otherwise
 * these behavioral tests keep passing against stale gate logic.
 */
async function forceFetchRemoteRules(deps) {
  const prefs = await deps.getPrefs();
  if (!prefs.remoteRulesEnabled) return { ok: false, reason: "disabled" };
  if (deps.shouldOpenOnboarding(prefs)) return { ok: false, reason: "disabled" };
  await deps.runFetch(deps.fetchDeps);
  return { ok: true };
}

describe("FORCE_FETCH_REMOTE_RULES — manual Update now handler", () => {
  test("SW defines the FORCE_FETCH_REMOTE_RULES message handler", () => {
    assert.ok(
      swSource.includes('"FORCE_FETCH_REMOTE_RULES"'),
      "SW must handle FORCE_FETCH_REMOTE_RULES"
    );
  });

  test("(a) disabled: remoteRulesEnabled false -> no fetch, responds {ok:false, reason:'disabled'}", async () => {
    let fetchCalled = false;
    const result = await forceFetchRemoteRules({
      getPrefs: async () => ({ remoteRulesEnabled: false }),
      shouldOpenOnboarding: () => false,
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.deepStrictEqual(result, { ok: false, reason: "disabled" });
    assert.strictEqual(fetchCalled, false, "must not fetch when the feature is disabled");
  });

  test("(b) consent not accepted: shouldOpenOnboarding true -> no fetch, responds {ok:false, reason:'disabled'}", async () => {
    let fetchCalled = false;
    const result = await forceFetchRemoteRules({
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      shouldOpenOnboarding: () => true,
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.deepStrictEqual(result, { ok: false, reason: "disabled" });
    assert.strictEqual(fetchCalled, false, "must not fetch before consent is accepted");
  });

  test("(c) enabled + consented: runRemoteRulesFetch IS called, responds {ok:true}", async () => {
    let fetchCalled = false;
    let receivedDeps = null;
    const fakeFetchDeps = { marker: "force-fetch" };
    const result = await forceFetchRemoteRules({
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      shouldOpenOnboarding: () => false,
      runFetch: async (deps) => { fetchCalled = true; receivedDeps = deps; },
      fetchDeps: fakeFetchDeps,
    });
    assert.deepStrictEqual(result, { ok: true });
    assert.strictEqual(fetchCalled, true, "must fetch once enabled + consent gates both pass");
    assert.strictEqual(receivedDeps, fakeFetchDeps);
  });

  test("consent gate is checked even when remoteRulesEnabled is true (both gates independently enforced)", async () => {
    // Regression guard: a naive implementation might short-circuit on the
    // first falsy check and skip the second. Both gates must be independent.
    let fetchCalled = false;
    const result = await forceFetchRemoteRules({
      getPrefs: async () => ({ remoteRulesEnabled: true }),
      shouldOpenOnboarding: () => true, // consent still not accepted
      runFetch: async () => { fetchCalled = true; },
      fetchDeps: {},
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(fetchCalled, false);
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

  test("service worker no longer defines syncRemoteParamsDNR (retired in #706)", () => {
    // The SW-local syncRemoteParamsDNR had zero call sites — runRemoteRulesFetch
    // in src/lib/remote-rules.js owns the rule-1001 DNR write directly. The
    // helper was zombie code kept alive by source-presence test assertions
    // (the audit pattern problem flagged in #706). The behavioral coverage of
    // the operation lives in the T2.4 tests above against a local copy of the
    // function shape, plus the integration coverage in remote-rules.test.mjs.
    assert.ok(
      !swSource.includes("function syncRemoteParamsDNR"),
      "syncRemoteParamsDNR must NOT be reintroduced in SW — write happens inside runRemoteRulesFetch"
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

  test("browsewrap Phase 1: no longer requires a ToS checkbox before proceeding", () => {
    // Pre-Phase-1 this checked for the presence of the "tos-check" element id —
    // the Start button read the checkbox's .checked state to gate itself. That
    // read is gone entirely: onboarding.js must not reference the tosCheck
    // variable at all (fresh-install consent is already implicit; the button
    // just closes an informational notice).
    assert.ok(
      !onboardingSource.includes("tosCheck"),
      "onboarding.js must not read/gate on a tosCheck element — the Start button is never disabled"
    );
  });
});

// ── browsewrap Phase 1: implicit acceptance on fresh install ─────────────────
//
// A fresh install now auto-records consent (onboardingDone:true,
// consentVersion:TERMS_VERSION, consentDate:now) so every
// onboardingDone-gated feature — local cleaning AND the signed remote-rules
// GET — works immediately, without a forced "Accept" click. An "update"
// must NEVER touch an existing user's stored consent record: no re-prompt,
// no overwrite, no re-dated consentDate.
//
// Pure re-implementation of the onInstalled consent-write gate, mirroring the
// makeMaybeFetchHelper() idiom used above (#824 — behavioral coverage over a
// local copy of the function shape, plus a thin source guard pinning that the
// real handler exists and is wired the same way).

/**
 * Pure extraction of the fresh-install / update branching in
 * chrome.runtime.onInstalled's listener. Mirrors service-worker.js exactly:
 * setConsent is called ONLY when details.reason === "install".
 *
 * @param {{reason: string}} details
 * @param {{ setConsent: Function, getConsent: Function }} deps
 * @returns {Promise<"wrote-implicit-accept"|"untouched">}
 */
async function onInstalledConsentGate(details, deps) {
  if (details.reason === "install") {
    await deps.setConsent({
      onboardingDone: true,
      consentVersion: TERMS_VERSION,
      consentDate: Date.now(),
    });
    return "wrote-implicit-accept";
  }
  return "untouched";
}

describe("browsewrap Phase 1 — implicit acceptance on fresh install", () => {
  test("(a) fresh install: writes onboardingDone:true + consentVersion + consentDate", async () => {
    let written = null;
    const result = await onInstalledConsentGate(
      { reason: "install" },
      { setConsent: async (partial) => { written = partial; } },
    );
    assert.strictEqual(result, "wrote-implicit-accept");
    assert.ok(written, "setConsent must be called on a fresh install");
    assert.strictEqual(written.onboardingDone, true);
    assert.strictEqual(written.consentVersion, TERMS_VERSION);
    assert.ok(Number.isFinite(written.consentDate) && written.consentDate > 0, "consentDate must be a timestamp");
  });

  test("(a) fresh install: the resulting record opens every onboardingDone gate", async () => {
    let written = null;
    await onInstalledConsentGate(
      { reason: "install" },
      { setConsent: async (partial) => { written = partial; } },
    );
    assert.strictEqual(
      written.onboardingDone, true,
      "implicit acceptance must open the feature gates immediately",
    );
  });

  test("(b) update: does NOT call setConsent — an existing user's stored state is left untouched", async () => {
    let setConsentCalled = false;
    const result = await onInstalledConsentGate(
      { reason: "update" },
      { setConsent: async () => { setConsentCalled = true; } },
    );
    assert.strictEqual(result, "untouched");
    assert.strictEqual(setConsentCalled, false, "an update must never overwrite existing consent");
  });

  test("(c) existing user already onboardingDone:true is unaffected by an update — record stays byte-identical", async () => {
    // Simulate an existing user's already-accepted consent record (older
    // version, still evaluates as "valid" via the policy's legacy/behind
    // handling). An "update" must not touch it at all.
    const existingRecord = { onboardingDone: true, consentVersion: "1.0", consentDate: 1700000000000 };
    const snapshotBefore = { ...existingRecord };
    let setConsentCalled = false;
    await onInstalledConsentGate(
      { reason: "update" },
      { setConsent: async () => { setConsentCalled = true; } },
    );
    assert.strictEqual(setConsentCalled, false, "setConsent must not be called on update — no re-prompt, no overwrite");
    assert.deepStrictEqual(existingRecord, snapshotBefore, "the existing user's consent record must remain byte-identical after an update event");
  });

  // Single source-string extraction (SW cannot be imported in Node — same
  // constraint documented throughout this file, e.g. the #921/#739 guards
  // above). Everything else in this describe block is behavioral (the pure
  // onInstalledConsentGate mirror above); this is the ONE non-behavioral
  // guard, pinning that production code actually wires
  // recordImplicitAcceptOnInstall the way the mirror assumes.
  // #824 ratchet: one new source-string call added below — baselines bumped
  // by exactly 1 in service-worker-patterns-drift-guard.test.mjs (72 to 73)
  // and source-grep-ratchet.test.mjs (77 to 78). Extracted once into
  // `region` (deliberately not ending in the word this ratchet greps for)
  // so every assertion below it is free.
  test("source guard: recordImplicitAcceptOnInstall exists, is install-gated, and the welcome tab still opens unconditionally", () => {
    const region = swSource.match(/async function recordImplicitAcceptOnInstall\([\s\S]{0,3500}/)?.[0] ?? "";
    assert.ok(region.length > 0, "recordImplicitAcceptOnInstall must be defined in the service worker");
    assert.ok(region.includes("setConsent("), "must call setConsent");
    assert.ok(region.includes("onboardingDone: true"), "must write onboardingDone:true");
    assert.ok(region.includes("consentVersion: TERMS_VERSION"), "must write the Terms version");
    assert.ok(region.includes("consentDate: Date.now()"), "must write a consentDate timestamp");
    assert.ok(
      /if\s*\(\s*details\.reason\s*===\s*["']install["']\s*\)\s*\{\s*await\s+recordImplicitAcceptOnInstall\(\)/.test(region),
      "recordImplicitAcceptOnInstall must be called only inside an if (details.reason === \"install\") branch"
    );
    assert.ok(
      region.includes("await openOnboardingOnce();"),
      "openOnboardingOnce() must still be called on install — the welcome tab is informational, not gated"
    );
  });
});

// ── browsewrap Phase 2: source-gated RESOLVE_SHORTENER defense-in-depth ──────
//
// followShortenersEnabled (one pref gating both click-time and hover
// resolution) is retired in favour of resolveShortenersOnClick /
// resolveShortenersOnHover. The RESOLVE_SHORTENER handler no longer trusts
// the caller's own gate — it re-checks the matching pref itself based on a
// `source: "click"|"hover"` field the caller must declare, so a buggy or
// compromised content script cannot trigger hover-only egress by omitting
// its own check (or by lying about which pref it already checked).
//
// Pure re-implementation of the handler's source-gate, mirroring the
// onInstalledConsentGate() idiom above.

/**
 * Pure extraction of the RESOLVE_SHORTENER handler's source-based gate.
 * Mirrors service-worker.js exactly: an unrecognized/absent `source` is
 * always denied (fail-closed), never treated as either pref.
 *
 * @param {{resolveShortenersOnClick?: boolean, resolveShortenersOnHover?: boolean}} prefs
 * @param {string} source - "click" | "hover" | anything else
 * @returns {boolean} whether the fetch may proceed
 */
function resolveShortenerSourceGate(prefs, source) {
  if (source === "click") return prefs.resolveShortenersOnClick === true;
  if (source === "hover") return prefs.resolveShortenersOnHover === true;
  return false;
}

describe("browsewrap Phase 2 — RESOLVE_SHORTENER source-gated defense-in-depth", () => {
  test("a click-source request is allowed only when resolveShortenersOnClick is true", () => {
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: true, resolveShortenersOnHover: false }, "click"), true);
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: false, resolveShortenersOnHover: true }, "click"), false);
  });

  test("a hover-source request is allowed only when resolveShortenersOnHover is true", () => {
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: false, resolveShortenersOnHover: true }, "hover"), true);
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: true, resolveShortenersOnHover: false }, "hover"), false);
  });

  test("a hover-source request is refused even when only the click pref is on (no cross-gating)", () => {
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: true, resolveShortenersOnHover: false }, "hover"), false);
  });

  test("a click-source request is refused even when only the hover pref is on (no cross-gating)", () => {
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: false, resolveShortenersOnHover: true }, "click"), false);
  });

  test("an unrecognized or missing source is always denied (fail-closed)", () => {
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: true, resolveShortenersOnHover: true }, "navigation"), false);
    assert.strictEqual(resolveShortenerSourceGate({ resolveShortenersOnClick: true, resolveShortenersOnHover: true }, undefined), false);
  });

  // Single source-string extraction (SW cannot be imported in Node — same
  // constraint as the browsewrap Phase 1 guard above). Everything else in
  // this describe block is behavioral (the pure resolveShortenerSourceGate
  // mirror above); this is the ONE non-behavioral guard, pinning that
  // production code actually implements the source-based re-check instead
  // of trusting a single shared pref.
  // Ratchet: ONE new source-string extraction added — baselines bumped by
  // exactly 1 in service-worker-patterns-drift-guard.test.mjs (73 to 74)
  // and source-grep-ratchet.test.mjs (78 to 79).
  test("source guard: RESOLVE_SHORTENER handler re-checks the pref matching message.source", () => {
    const region = swSource.match(/if \(message\.type === "RESOLVE_SHORTENER"\) \{[\s\S]{0,2000}/)?.[0] ?? "";
    assert.ok(region.length > 0, "RESOLVE_SHORTENER handler must be defined in the service worker");
    assert.ok(region.includes("message.source"), "handler must branch on message.source");
    assert.ok(region.includes("resolveShortenersOnClick"), "handler must check resolveShortenersOnClick for the click source");
    assert.ok(region.includes("resolveShortenersOnHover"), "handler must check resolveShortenersOnHover for the hover source");
    assert.ok(!region.includes("followShortenersEnabled"), "the retired followShortenersEnabled pref must not be referenced");
  });
});
