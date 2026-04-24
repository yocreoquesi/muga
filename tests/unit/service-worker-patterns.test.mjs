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
