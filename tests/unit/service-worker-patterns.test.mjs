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

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(join(__dirname, "../../src/background/service-worker.js"), "utf8");

// Replicate isValidListEntry from service-worker.js
function isValidListEntry(entry) {
  if (typeof entry !== "string" || entry.length === 0 || entry.length > 500) return false;
  const parts = entry.split("::");
  if (parts.length > 3) return false;
  if (!parts[0] || !/^[a-zA-Z0-9.-]+$/.test(parts[0])) return false;
  if (parts.length === 2 && parts[1] !== "disabled") return false;
  if (parts.length === 3 && (!parts[1] || !parts[2])) return false;
  return true;
}

// ── Message handler structure verification ───────────────────────────────────

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
    const whitelistHandler = swSource.slice(
      swSource.indexOf('"ADD_TO_WHITELIST"'),
      swSource.indexOf('"ADD_TO_BLACKLIST"')
    );
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
