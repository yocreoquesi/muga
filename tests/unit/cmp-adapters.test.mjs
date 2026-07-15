/**
 * MUGA — Cookie Consent Minimizer: cmp-adapters.js (#1027)
 *
 * Pure-logic tests for the OneTrust Tier 1 adapter and the two-tier
 * decision function. No DOM, no chrome.*, no globals — signals are
 * injected as plain objects, matching the pure-module contract described
 * in src/lib/cmp-adapters.js.
 *
 * Three groups:
 *   1. decideAction truth table — reject / hard-wall-noop / uncertain-noop.
 *   2. Multi-signal detect() confidence gate — mandatory + corroboration.
 *   3. STRUCTURAL never-auto-reject-the-other-way guard (own section,
 *      load-bearing — do NOT fold into the groups above). Statically
 *      scans the source for any trace of a consent-granting action.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  ACTIONS,
  TIER1,
  TIER2,
  oneTrustAdapter,
  decideAction,
  computeCookieGate,
} from "../../src/lib/cmp-adapters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Registry shape ──────────────────────────────────────────────────────────

describe("cmp-adapters — registry shape", () => {
  test("TIER1 contains exactly the OneTrust adapter", () => {
    assert.equal(TIER1.length, 1);
    assert.strictEqual(TIER1[0], oneTrustAdapter);
  });

  test("TIER2 ships empty in this slice", () => {
    assert.ok(Array.isArray(TIER2));
    assert.equal(TIER2.length, 0);
  });

  test("TIER1 and TIER2 are frozen", () => {
    assert.ok(Object.isFrozen(TIER1));
    assert.ok(Object.isFrozen(TIER2));
  });

  test("oneTrustAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(oneTrustAdapter.id, "onetrust");
    assert.equal(oneTrustAdapter.tier, 1);
    assert.equal(typeof oneTrustAdapter.detect, "function");
    assert.equal(typeof oneTrustAdapter.canReject, "function");
    assert.equal(typeof oneTrustAdapter.reject, "function");
  });

  test("ACTIONS is a closed set containing only the reject-family action", () => {
    assert.deepEqual(Object.keys(ACTIONS), ["REJECT_ALL"]);
    assert.equal(ACTIONS.REJECT_ALL, "reject-all");
  });
});

// ── decideAction — exhaustive truth table ───────────────────────────────────

const FULL_SIGNALS = Object.freeze({
  hasOneTrustGlobal: true,
  hasRejectAllFn: true,
  hasBannerDom: true,
  hasActiveGroupsGlobal: true,
  hasRejectHandlerDom: true,
});

describe("decideAction — truth table", () => {
  test("RejectAll present + corroborated -> reject", () => {
    const r = decideAction(FULL_SIGNALS);
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "onetrust");
  });

  test("OneTrust global present but RejectAll absent (hard wall) -> NOOP", () => {
    const r = decideAction({
      hasOneTrustGlobal: true,
      hasRejectAllFn: false,
      hasBannerDom: true,
      hasActiveGroupsGlobal: true,
      hasRejectHandlerDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
  });

  test("no signals at all (non-OneTrust page) -> NOOP, uncertain", () => {
    const r = decideAction({});
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("null/undefined signals -> NOOP, uncertain, never throws", () => {
    assert.doesNotThrow(() => decideAction(null));
    assert.doesNotThrow(() => decideAction(undefined));
    assert.equal(decideAction(null).action, null);
    assert.equal(decideAction(undefined).reason, "uncertain");
  });

  test("mandatory signal present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasOneTrustGlobal: true,
      hasRejectAllFn: true,
      hasBannerDom: false,
      hasActiveGroupsGlobal: false,
      hasRejectHandlerDom: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });
});

// ── detect() / canReject() — multi-signal confidence gate ──────────────────

describe("oneTrustAdapter.detect — confidence gate", () => {
  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = oneTrustAdapter.detect(FULL_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(oneTrustAdapter.canReject(FULL_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (DOM banner only) -> canReject true", () => {
    const s = {
      hasOneTrustGlobal: true,
      hasRejectAllFn: true,
      hasBannerDom: true,
      hasActiveGroupsGlobal: false,
      hasRejectHandlerDom: false,
    };
    assert.equal(oneTrustAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasOneTrustGlobal: true,
      hasRejectAllFn: true,
      hasBannerDom: false,
      hasActiveGroupsGlobal: false,
      hasRejectHandlerDom: false,
    };
    assert.equal(oneTrustAdapter.canReject(s), false);
    assert.ok(oneTrustAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory RejectAll fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasOneTrustGlobal: false,
      hasRejectAllFn: false,
      hasBannerDom: true,
      hasActiveGroupsGlobal: true,
      hasRejectHandlerDom: true,
    };
    assert.equal(oneTrustAdapter.detect(s), 0);
    assert.equal(oneTrustAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => oneTrustAdapter.detect(null));
    assert.doesNotThrow(() => oneTrustAdapter.detect(undefined));
    assert.equal(oneTrustAdapter.detect(null), 0);
  });
});

// ── reject() — pure, callback-injected global call ──────────────────────────

describe("oneTrustAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = oneTrustAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = oneTrustAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = oneTrustAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

// ── computeCookieGate — disabled-state gate truth table ────────────────────
//
// W2/S2 (#1027): the gate decision used to live in a non-exported IIFE
// closure in content/cookie-noise.js, so these branches had no executed
// coverage (only a structural regex). Extracting it as a pure helper lets
// every branch run here.

const GATE_ON_PREFS = Object.freeze({
  enabled: true,
  onboardingDone: true,
  cookieConsentMinimizerEnabled: true,
});

describe("computeCookieGate — disabled-state gate", () => {
  test("all gate conditions pass -> gate opens (true)", () => {
    assert.equal(computeCookieGate(GATE_ON_PREFS), true);
  });

  test("feature pref OFF -> gate stays closed", () => {
    assert.equal(
      computeCookieGate({ ...GATE_ON_PREFS, cookieConsentMinimizerEnabled: false }),
      false,
    );
  });

  test("onboardingDone false -> gate stays closed", () => {
    assert.equal(computeCookieGate({ ...GATE_ON_PREFS, onboardingDone: false }), false);
  });

  test("master enabled false -> gate stays closed", () => {
    assert.equal(computeCookieGate({ ...GATE_ON_PREFS, enabled: false }), false);
  });

  test("null / undefined prefs -> gate stays closed, never throws", () => {
    assert.doesNotThrow(() => computeCookieGate(null));
    assert.equal(computeCookieGate(null), false);
    assert.equal(computeCookieGate(undefined), false);
  });

  test("isSiteFullyExempt true -> gate stays closed even when every pref passes", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => true };
    assert.equal(computeCookieGate(GATE_ON_PREFS, deps), false);
  });

  test("isSiteFullyExempt false -> gate opens (site not exempt)", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => false };
    assert.equal(computeCookieGate(GATE_ON_PREFS, deps), true);
  });

  test("isSiteFullyExempt receives the injected hostname and prefs", () => {
    let seen = null;
    const deps = {
      hostname: "shop.example.com",
      isSiteFullyExempt: (hostname, prefs) => { seen = { hostname, prefs }; return false; },
    };
    computeCookieGate(GATE_ON_PREFS, deps);
    assert.equal(seen.hostname, "shop.example.com");
    assert.strictEqual(seen.prefs, GATE_ON_PREFS);
  });

  test("a throwing isSiteFullyExempt is swallowed and treated as not exempt (fail-safe -> open)", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => { throw new Error("boom"); } };
    assert.doesNotThrow(() => computeCookieGate(GATE_ON_PREFS, deps));
    assert.equal(computeCookieGate(GATE_ON_PREFS, deps), true);
  });
});

// ── STRUCTURAL guard — no consent-granting action path can exist ───────────
//
// LOAD-BEARING. This is the ethical spine of the feature (#1027): MUGA must
// never programmatically grant broad tracking consent on the user's behalf.
// The guard is a static source scan, deliberately kept in its own describe
// block so a future PR that reintroduces a consent-granting action fails
// here first, independent of any behavioral test above.
//
// cmp-adapters.js's own source (including every comment) is written WITHOUT
// the word this guard forbids, so a plain case-insensitive scan is safe —
// see the file's docblock for the naming convention this enables.

describe("cmp-adapters — STRUCTURAL guard: closed reject-only action set", () => {
  const source = readFileSync(join(__dirname, "../../src/lib/cmp-adapters.js"), "utf8");
  const FORBIDDEN = /allowall|accept/i;

  test("cmp-adapters.js source contains no AllowAll / accept-family identifier", () => {
    assert.doesNotMatch(
      source,
      FORBIDDEN,
      "cmp-adapters.js must never reference AllowAll/accept — the action registry is reject-only",
    );
  });

  test("ACTIONS enum has exactly one member and it is REJECT_ALL", () => {
    assert.equal(Object.keys(ACTIONS).length, 1);
    assert.ok("REJECT_ALL" in ACTIONS);
  });

  test("no TIER1 or TIER2 adapter exposes any method whose name suggests a grant/allow action", () => {
    for (const adapter of [...TIER1, ...TIER2]) {
      for (const key of Object.keys(adapter)) {
        assert.doesNotMatch(key, FORBIDDEN, `adapter "${adapter.id}" exposes a forbidden method: ${key}`);
      }
    }
  });
});
