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
 *
 * #1491 item 2 (native review, accepted tradeoff): the behavioral coverage
 * above exercises computeSuppressRefererDecision/computeBlockBeaconDecision
 * — copies of the two listeners' gate logic — not the production
 * onBeforeSendHeadersSuppressReferer/onBeforeRequestBlockBeacons functions
 * themselves. Only the `indexOf` source guards further down (see the
 * "production service-worker.js wiring" describe block) link the copy back
 * to the real listeners, by checking they contain the same gate/predicate
 * calls in the same order — not by executing the real functions. This is
 * accepted for now: the service worker's module-scope chrome.* calls and
 * top-level listener registration make it un-importable in Node. Revisit if
 * the listeners are ever extracted into an importable module (see #1266
 * item 5's dnr-sync.js split for the established precedent on doing that).
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

  // #1475: a disabled or not-yet-onboarded extension must not touch Referer,
  // regardless of suppressReferer or any blocklist entry. Checked before
  // anything else, mirroring the production gate's position.
  if (!cachedPrefs.enabled || !cachedPrefs.onboardingDone) return "pass";

  // #1422: the default configuration can never act; answered first.
  const blacklist = cachedPrefs.blacklist;
  if (cachedPrefs.suppressReferer !== true && !(Array.isArray(blacklist) && blacklist.length > 0)) return "pass";

  let host;
  try {
    host = new URL(url).hostname;
  } catch {
    return "pass"; // malformed URL -> fail open
  }

  try {
    if (cachedPrefs.suppressReferer !== true && !isSiteFullyBlacklisted(host, cachedPrefs)) return "pass";
    if (isSiteFullyExempt(host, cachedPrefs)) return "pass"; // allowlist always wins
    return "remove";
  } catch {
    return "pass"; // exempt-check throw -> fail open
  }
}

function computeBlockBeaconDecision(url, cachedPrefs) {
  if (!cachedPrefs) return "pass";

  // #1475: same disabled/onboarding gate as computeSuppressRefererDecision
  // above — checked before anything else.
  if (!cachedPrefs.enabled || !cachedPrefs.onboardingDone) return "pass";

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
  // Every prefs object below carries enabled:true, onboardingDone:true — this
  // block tests the suppressReferer/allowlist/blocklist decision, which only
  // runs once the #1475 gate (tested separately below) has already passed.
  test("suppressReferer:true, plain (non-listed) host -> remove", () => {
    const decision = computeSuppressRefererDecision(
      "https://plain.example/path",
      { enabled: true, onboardingDone: true, suppressReferer: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "remove");
  });

  test("suppressReferer:false, plain host -> pass (baseline: Referer untouched)", () => {
    const decision = computeSuppressRefererDecision(
      "https://plain.example/path",
      { enabled: true, onboardingDone: true, suppressReferer: false, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("suppressReferer:false, bare-domain blocklisted host -> remove (D2 force-suppress, global OFF)", () => {
    const decision = computeSuppressRefererDecision(
      "https://blocked.example/x",
      { enabled: true, onboardingDone: true, suppressReferer: false, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "remove");
  });

  test("suppressReferer:true, allowlisted host -> pass (allowlist wins over the global toggle)", () => {
    const decision = computeSuppressRefererDecision(
      "https://safe.example/x",
      { enabled: true, onboardingDone: true, suppressReferer: true, whitelist: ["safe.example"], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("host on BOTH the allowlist and the blocklist -> pass (allowlist wins, mirrors Chrome DNR precedence)", () => {
    const decision = computeSuppressRefererDecision(
      "https://both.example/x",
      { enabled: true, onboardingDone: true, suppressReferer: true, whitelist: ["both.example"], blacklist: ["both.example"] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("param-scoped blacklist entry does NOT force-suppress a plain host with the global toggle OFF", () => {
    const decision = computeSuppressRefererDecision(
      "https://example.com/x",
      { enabled: true, onboardingDone: true, suppressReferer: false, whitelist: [], blacklist: ["example.com::aid::123456"] },
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
      { enabled: true, onboardingDone: true, suppressReferer: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("#1422: with the default settings the allowlist is never read", () => {
    let reads = 0;
    const prefs = {
      enabled: true,
      onboardingDone: true,
      suppressReferer: false,
      blacklist: [],
      get whitelist() { reads++; return ["a.example", "b.example", "c.example"]; },
    };
    assert.strictEqual(computeSuppressRefererDecision("https://plain.example/x", prefs), "pass");
    assert.strictEqual(reads, 0);
  });

  test("#1422: an allowlisted host still wins over a blocklist entry for the same host", () => {
    const decision = computeSuppressRefererDecision(
      "https://both.example/x",
      { enabled: true, onboardingDone: true, suppressReferer: false, whitelist: ["both.example"], blacklist: ["both.example"] },
    );
    assert.strictEqual(decision, "pass");
  });

  // #1475: audit repro — a disabled extension (or one before onboarding)
  // must not strip Referer even with suppressReferer ON and a blocklist
  // entry for the exact host. "Turn MUGA off" must actually stop this
  // feature, matching Chrome's gate-closed DNR teardown (dnr-sync.js).
  test("#1475: enabled:false -> pass, even with suppressReferer ON and the host blocklisted", () => {
    const decision = computeSuppressRefererDecision(
      "https://blocked.example/x",
      { enabled: false, onboardingDone: true, suppressReferer: true, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("#1475: onboardingDone:false -> pass, even with suppressReferer ON and the host blocklisted", () => {
    const decision = computeSuppressRefererDecision(
      "https://blocked.example/x",
      { enabled: true, onboardingDone: false, suppressReferer: true, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("#1475: enabled:true + onboardingDone:true -> the pre-existing remove verdict is unaffected", () => {
    const decision = computeSuppressRefererDecision(
      "https://blocked.example/x",
      { enabled: true, onboardingDone: true, suppressReferer: true, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "remove");
  });
});

// ── 3.2: onBeforeRequest (types:["ping"]) — beacon block decision ──────────

describe("computeBlockBeaconDecision — Firefox onBeforeRequest(types:[\"ping\"]) predicate", () => {
  // Every prefs object below carries enabled:true, onboardingDone:true — this
  // block tests the blockBeacons/allowlist/blocklist decision, which only
  // runs once the #1475 gate (tested separately below) has already passed.
  test("blockBeacons:true, plain host -> cancel", () => {
    const decision = computeBlockBeaconDecision(
      "https://plain.example/beacon",
      { enabled: true, onboardingDone: true, blockBeacons: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "cancel");
  });

  test("blockBeacons:false, plain host -> pass (baseline)", () => {
    const decision = computeBlockBeaconDecision(
      "https://plain.example/beacon",
      { enabled: true, onboardingDone: true, blockBeacons: false, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("blockBeacons:false, bare-domain blocklisted host -> cancel (D2 force-block, global OFF)", () => {
    const decision = computeBlockBeaconDecision(
      "https://blocked.example/beacon",
      { enabled: true, onboardingDone: true, blockBeacons: false, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "cancel");
  });

  test("blockBeacons:true, exempt (allowlisted) host -> pass (allowlist wins)", () => {
    const decision = computeBlockBeaconDecision(
      "https://safe.example/beacon",
      { enabled: true, onboardingDone: true, blockBeacons: true, whitelist: ["safe.example"], blacklist: [] },
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
      { enabled: true, onboardingDone: true, blockBeacons: true, whitelist: [], blacklist: [] },
    );
    assert.strictEqual(decision, "pass");
  });

  // #1475: audit repro — a disabled extension (or one before onboarding)
  // must not cancel beacon requests even with blockBeacons ON and a
  // blocklist entry for the exact host.
  test("#1475: enabled:false -> pass, even with blockBeacons ON and the host blocklisted", () => {
    const decision = computeBlockBeaconDecision(
      "https://blocked.example/beacon",
      { enabled: false, onboardingDone: true, blockBeacons: true, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("#1475: onboardingDone:false -> pass, even with blockBeacons ON and the host blocklisted", () => {
    const decision = computeBlockBeaconDecision(
      "https://blocked.example/beacon",
      { enabled: true, onboardingDone: false, blockBeacons: true, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "pass");
  });

  test("#1475: enabled:true + onboardingDone:true -> the pre-existing cancel verdict is unaffected", () => {
    const decision = computeBlockBeaconDecision(
      "https://blocked.example/beacon",
      { enabled: true, onboardingDone: true, blockBeacons: true, whitelist: [], blacklist: ["blocked.example"] },
    );
    assert.strictEqual(decision, "cancel");
  });
});

// ── Source-level guards: verify the production SW was updated ──────────────

// isFirefoxMV2 moved to src/background/dnr-sync.js (#1266 item 5, #1268): it
// is now a lazily-evaluated exported function, imported here at the top of
// the service worker rather than declared as a local const.
const isFxIdx = swSource.indexOf(
  'import { hasDNR, isFirefoxMV2, applyDnrState } from "./dnr-sync.js";',
);
const suppressFnStart = swSource.indexOf("function onBeforeSendHeadersSuppressReferer(");
// Widened 1400 -> 2200 after the #1475 disabled/onboarding gate + its WHY
// comment were added ahead of the #1422 cheap-check (the gate must run
// FIRST, before any pref/blocklist read).
const suppressFnBlock = swSource.slice(suppressFnStart, suppressFnStart + 2200);
const beaconFnStart = swSource.indexOf("function onBeforeRequestBlockBeacons(");
const beaconFnBlock = swSource.slice(beaconFnStart, beaconFnStart + 1400);
const fxGateStart = swSource.indexOf("if (isFirefoxMV2()) {");
const fxGateBlock = swSource.slice(fxGateStart, fxGateStart + 2000);

describe("service-worker.js source guards — the two new FF listeners exist and are wired", () => {
  test("both listener functions exist, after the isFirefoxMV2 gate declaration", () => {
    assert.ok(isFxIdx !== -1, "isFirefoxMV2 gate must exist");
    assert.ok(suppressFnStart !== -1, "onBeforeSendHeadersSuppressReferer must exist in the service worker");
    assert.ok(beaconFnStart !== -1, "onBeforeRequestBlockBeacons must exist in the service worker");
    assert.ok(suppressFnStart > isFxIdx);
    assert.ok(beaconFnStart > isFxIdx);
  });

  test("onBeforeSendHeadersSuppressReferer answers the cheap pref/blocklist check before the allowlist (#1422)", () => {
    // Order, not just presence: the listener runs on every Firefox request,
    // and walking the allowlist first cost a parse per entry per request
    // for a feature that is off by default. The mirror above pins the
    // resulting verdicts; this pins that production has the same order.
    const cheap = suppressFnBlock.indexOf("cachedPrefs.suppressReferer !== true");
    const blocklisted = suppressFnBlock.indexOf("isSiteFullyBlacklisted(");
    const exempt = suppressFnBlock.indexOf("isSiteFullyExempt(");
    assert.ok(cheap !== -1 && blocklisted !== -1 && exempt !== -1);
    assert.ok(cheap < exempt && blocklisted < exempt, "the allowlist must be consulted last");
  });

  test("onBeforeSendHeadersSuppressReferer fails open on cache-miss and returns a mutated requestHeaders array", () => {
    assert.ok(suppressFnBlock.includes("if (!cachedPrefs)"), "must fail open on cache-miss");
    assert.ok(suppressFnBlock.includes("requestHeaders"), "must return a requestHeaders array");
  });

  test("#1475: onBeforeSendHeadersSuppressReferer gates on prefs.enabled && prefs.onboardingDone, BEFORE the #1422 cheap check", () => {
    // Ratchet-conscious (#824): a single indexOf pair proves both existence
    // (!== -1) and ordering (before the #1422 cheap check) in one pass,
    // rather than a separate cache-miss anchor.
    const gate = suppressFnBlock.indexOf("!cachedPrefs.enabled || !cachedPrefs.onboardingDone");
    const cheap = suppressFnBlock.indexOf("cachedPrefs.suppressReferer !== true");
    assert.ok(gate !== -1 && gate < cheap, "the disabled/onboarding gate must exist (#1475) and run before every other decision");
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

  test("#1475: onBeforeRequestBlockBeacons gates on prefs.enabled && prefs.onboardingDone, BEFORE the URL parse", () => {
    const gate = beaconFnBlock.indexOf("!cachedPrefs.enabled || !cachedPrefs.onboardingDone");
    const urlParse = beaconFnBlock.indexOf("new URL(details.url)");
    assert.ok(gate !== -1 && gate < urlParse, "the disabled/onboarding gate must exist (#1475) and run before the URL parse");
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
