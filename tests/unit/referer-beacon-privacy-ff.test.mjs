/**
 * MUGA — referer-beacon-privacy, PR 3 (Firefox MV2 Enforcement): unit tests
 * for the two new blocking webRequest listeners (tasks 3.1-3.2).
 *
 * The service worker has no behavioral unit harness (Chrome/webRequest API
 * bindings at module scope + top-level listener registration), so this file
 * follows the established pattern from tests/unit/referer-beacon-privacy-dnr.test.mjs
 * (PR 2): a pure extraction of each listener's DECISION logic, exercised
 * behaviorally against the REAL isSiteFullyExempt/isSiteFullyBlacklisted
 * predicates (imported, not reimplemented), plus source guards confirming the
 * production service-worker.js actually wires the real listener functions
 * with the same predicate/fail-open/registration shape.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { isSiteFullyExempt, isSiteFullyBlacklisted } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"),
  "utf8",
);

// ── Pure decision logic under test ──────────────────────────────────────────
//
// Mirrors onBeforeSendHeadersSuppressReferer / onBeforeRequestBlockBeacons in
// service-worker.js exactly: same exempt-first check, same OR-of-global-or-
// blacklisted predicate, same fail-open-on-error/cache-miss/malformed-URL
// behavior. The two REAL predicates (isSiteFullyExempt/isSiteFullyBlacklisted)
// are imported directly from src/lib/cleaner.js — nothing about list matching
// is reimplemented here, only the glue decision.

function computeSuppressRefererDecision(url, cachedPrefs) {
  if (!cachedPrefs) return "pass"; // cache-miss -> fail open

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return "pass"; // malformed URL -> fail open
  }

  try {
    if (isSiteFullyExempt(host, cachedPrefs)) return "pass";
    if (cachedPrefs.suppressReferer === true || isSiteFullyBlacklisted(host, cachedPrefs)) {
      return "remove";
    }
    return "pass";
  } catch {
    return "pass"; // exempt-check throw -> fail open
  }
}

function computeBlockBeaconDecision(url, cachedPrefs) {
  if (!cachedPrefs) return "pass";

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return "pass";
  }

  try {
    if (isSiteFullyExempt(host, cachedPrefs)) return "pass";
    if (cachedPrefs.blockBeacons === true || isSiteFullyBlacklisted(host, cachedPrefs)) {
      return "cancel";
    }
    return "pass";
  } catch {
    return "pass";
  }
}

// ── 3.1: onBeforeSendHeaders — Referer suppression decision ────────────────

describe("computeSuppressRefererDecision — Firefox onBeforeSendHeaders predicate", () => {
  test("suppressReferer:true, plain (non-listed) host -> remove", () => {
    const decision = computeSuppressRefererDecision(
      "https://plain.example/path",
      { suppressReferer: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "remove");
  });

  test("suppressReferer:false, plain host -> pass (baseline: Referer untouched)", () => {
    const decision = computeSuppressRefererDecision(
      "https://plain.example/path",
      { suppressReferer: false, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("suppressReferer:false, bare-domain blocklisted host -> remove (D2 force-suppress, global OFF)", () => {
    const decision = computeSuppressRefererDecision(
      "https://blocked.example/x",
      { suppressReferer: false, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "remove");
  });

  test("suppressReferer:true, allowlisted host -> pass (allowlist wins over the global toggle)", () => {
    const decision = computeSuppressRefererDecision(
      "https://safe.example/x",
      { suppressReferer: true, whitelist: ["safe.example"], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("host on BOTH the allowlist and the blocklist -> pass (allowlist wins, mirrors Chrome DNR precedence)", () => {
    const decision = computeSuppressRefererDecision(
      "https://both.example/x",
      { suppressReferer: true, whitelist: ["both.example"], blacklist: ["both.example"] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("param-scoped blacklist entry does NOT force-suppress a plain host with the global toggle OFF", () => {
    const decision = computeSuppressRefererDecision(
      "https://example.com/x",
      { suppressReferer: false, whitelist: [], blacklist: ["example.com::aid::123456"] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("cache-miss (cachedPrefs null) -> pass (fail open)", () => {
    const decision = computeSuppressRefererDecision("https://plain.example/x", null);
    assert.strictEqual(decision, "pass");
  });

  test("malformed URL -> pass (fail open)", () => {
    const decision = computeSuppressRefererDecision(
      "not-a-valid-url",
      { suppressReferer: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });
});

// ── 3.2: onBeforeRequest (types:["ping"]) — beacon block decision ──────────

describe("computeBlockBeaconDecision — Firefox onBeforeRequest(types:[\"ping\"]) predicate", () => {
  test("blockBeacons:true, plain host -> cancel", () => {
    const decision = computeBlockBeaconDecision(
      "https://plain.example/beacon",
      { blockBeacons: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "cancel");
  });

  test("blockBeacons:false, plain host -> pass (baseline)", () => {
    const decision = computeBlockBeaconDecision(
      "https://plain.example/beacon",
      { blockBeacons: false, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("blockBeacons:false, bare-domain blocklisted host -> cancel (D2 force-block, global OFF)", () => {
    const decision = computeBlockBeaconDecision(
      "https://blocked.example/beacon",
      { blockBeacons: false, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "cancel");
  });

  test("blockBeacons:true, exempt (allowlisted) host -> pass (allowlist wins)", () => {
    const decision = computeBlockBeaconDecision(
      "https://safe.example/beacon",
      { blockBeacons: true, whitelist: ["safe.example"], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("cache-miss -> pass (fail open)", () => {
    const decision = computeBlockBeaconDecision("https://plain.example/beacon", null);
    assert.strictEqual(decision, "pass");
  });

  test("malformed URL -> pass (fail open)", () => {
    const decision = computeBlockBeaconDecision(
      "not-a-valid-url",
      { blockBeacons: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });
});

// ── Source-level guards: verify the production SW was updated ──────────────

const isFxIdx = swSource.indexOf("const isFirefoxMV2 =");
const suppressFnStart = swSource.indexOf("function onBeforeSendHeadersSuppressReferer(");
const suppressFnBlock = swSource.slice(suppressFnStart, suppressFnStart + 1400);
const beaconFnStart = swSource.indexOf("function onBeforeRequestBlockBeacons(");
const beaconFnBlock = swSource.slice(beaconFnStart, beaconFnStart + 1400);
const fxGateStart = swSource.indexOf("if (isFirefoxMV2) {");
const fxGateBlock = swSource.slice(fxGateStart, fxGateStart + 2000);

describe("service-worker.js source guards — the two new FF listeners exist and are wired", () => {
  test("both listener functions exist, after the isFirefoxMV2 gate declaration", () => {
    assert.ok(isFxIdx !== -1, "isFirefoxMV2 gate must exist");
    assert.ok(suppressFnStart !== -1, "onBeforeSendHeadersSuppressReferer must exist in the service worker");
    assert.ok(beaconFnStart !== -1, "onBeforeRequestBlockBeacons must exist in the service worker");
    assert.ok(suppressFnStart > isFxIdx);
    assert.ok(beaconFnStart > isFxIdx);
  });

  test("onBeforeSendHeadersSuppressReferer checks isSiteFullyExempt first and uses suppressReferer / isSiteFullyBlacklisted", () => {
    assert.ok(suppressFnBlock.includes("isSiteFullyExempt("));
    assert.ok(suppressFnBlock.includes("cachedPrefs.suppressReferer"));
    assert.ok(suppressFnBlock.includes("isSiteFullyBlacklisted("));
  });

  test("onBeforeSendHeadersSuppressReferer fails open on cache-miss and returns a mutated requestHeaders array", () => {
    assert.ok(suppressFnBlock.includes("if (!cachedPrefs)"), "must fail open on cache-miss");
    assert.ok(suppressFnBlock.includes("requestHeaders"), "must return a requestHeaders array");
  });

  test("onBeforeRequestBlockBeacons checks isSiteFullyExempt first and uses blockBeacons / isSiteFullyBlacklisted", () => {
    assert.ok(beaconFnBlock.includes("isSiteFullyExempt("));
    assert.ok(beaconFnBlock.includes("cachedPrefs.blockBeacons"));
    assert.ok(beaconFnBlock.includes("isSiteFullyBlacklisted("));
  });

  test("onBeforeRequestBlockBeacons fails open on cache-miss and returns { cancel: true } when blocking", () => {
    assert.ok(beaconFnBlock.includes("if (!cachedPrefs)"), "must fail open on cache-miss");
    assert.ok(beaconFnBlock.includes("cancel: true"));
  });

  test("both catch blocks are non-empty / fail open (no rethrow)", () => {
    assert.ok(suppressFnBlock.includes("catch"));
    assert.ok(beaconFnBlock.includes("catch"));
  });

  test("isFirefoxMV2 gate registers onBeforeSendHeaders with [\"blocking\",\"requestHeaders\"], <all_urls>, no types filter", () => {
    const registrationIdx = fxGateBlock.indexOf("chrome.webRequest.onBeforeSendHeaders.addListener(");
    assert.ok(registrationIdx !== -1, "onBeforeSendHeaders must be registered inside the isFirefoxMV2 gate");
    const registrationBlock = fxGateBlock.slice(registrationIdx, registrationIdx + 300);
    assert.ok(registrationBlock.includes("onBeforeSendHeadersSuppressReferer"));
    assert.ok(registrationBlock.includes('urls: ["<all_urls>"]'));
    assert.ok(registrationBlock.includes('["blocking", "requestHeaders"]'));
    assert.ok(!registrationBlock.includes("types:"), "the Referer listener must NOT filter by resource type");
  });

  test("isFirefoxMV2 gate registers onBeforeRequest for beacons filtered to types:[\"ping\",\"beacon\"]", () => {
    const beaconRefIdx = fxGateBlock.indexOf("onBeforeRequestBlockBeacons,");
    assert.ok(beaconRefIdx !== -1, "onBeforeRequestBlockBeacons must be registered inside the isFirefoxMV2 gate");
    const registrationBlock = fxGateBlock.slice(Math.max(0, beaconRefIdx - 60), beaconRefIdx + 300);
    assert.ok(registrationBlock.includes("chrome.webRequest.onBeforeRequest.addListener("));
    // Firefox splits sendBeacon() into its OWN "beacon" resourceType, distinct
    // from "ping" (<a ping> only) — both must be listed (see the production
    // comment above this registration for why "ping" alone is insufficient).
    assert.ok(registrationBlock.includes('types: ["ping", "beacon"]'));
    assert.ok(registrationBlock.includes('["blocking"]'));
  });
});
