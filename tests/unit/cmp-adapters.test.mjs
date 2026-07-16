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
  cookiebotAdapter,
  didomiAdapter,
  cookieYesAdapter,
  decideAction,
  computeCookieGate,
} from "../../src/lib/cmp-adapters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Registry shape ──────────────────────────────────────────────────────────

describe("cmp-adapters — registry shape", () => {
  test("TIER1 contains exactly the OneTrust, Cookiebot, Didomi and CookieYes adapters, in order", () => {
    assert.equal(TIER1.length, 4);
    assert.strictEqual(TIER1[0], oneTrustAdapter);
    assert.strictEqual(TIER1[1], cookiebotAdapter);
    assert.strictEqual(TIER1[2], didomiAdapter);
    assert.strictEqual(TIER1[3], cookieYesAdapter);
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

  test("cookiebotAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(cookiebotAdapter.id, "cookiebot");
    assert.equal(cookiebotAdapter.tier, 1);
    assert.equal(typeof cookiebotAdapter.detect, "function");
    assert.equal(typeof cookiebotAdapter.canReject, "function");
    assert.equal(typeof cookiebotAdapter.reject, "function");
  });

  test("didomiAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(didomiAdapter.id, "didomi");
    assert.equal(didomiAdapter.tier, 1);
    assert.equal(typeof didomiAdapter.detect, "function");
    assert.equal(typeof didomiAdapter.canReject, "function");
    assert.equal(typeof didomiAdapter.reject, "function");
  });

  test("cookieYesAdapter exposes id, tier, detect, canReject, reject", () => {
    assert.equal(cookieYesAdapter.id, "cookieyes");
    assert.equal(cookieYesAdapter.tier, 1);
    assert.equal(typeof cookieYesAdapter.detect, "function");
    assert.equal(typeof cookieYesAdapter.canReject, "function");
    assert.equal(typeof cookieYesAdapter.reject, "function");
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

  test("Cookiebot submitCustomConsent present + corroborated -> reject", () => {
    const r = decideAction({
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: true,
      hasResponseBooleanGlobal: true,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "cookiebot");
  });

  test("Cookiebot global present but submitCustomConsent absent (hard wall) -> NOOP", () => {
    const r = decideAction({
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: false,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: true,
      hasResponseBooleanGlobal: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
  });

  test("Cookiebot mandatory signal present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: false,
      hasConsentObjectGlobal: false,
      hasResponseBooleanGlobal: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("Didomi setUserDisagreeToAll present + corroborated -> reject", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: true,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "didomi");
  });

  test("Didomi global present but setUserDisagreeToAll absent (hard wall) -> NOOP", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: false,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
  });

  test("Didomi mandatory signal present but zero corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: false,
      hasGetCurrentUserStatusFn: false,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("CookieYes: both bare globals + corroborating DOM -> reject", () => {
    const r = decideAction({
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: false,
    });
    assert.equal(r.action, ACTIONS.REJECT_ALL);
    assert.equal(r.reason, "reject");
    assert.equal(r.adapterId, "cookieyes");
  });

  test("CookieYes: performBannerAction present but getCkyConsent missing (only one global) -> NOOP, uncertain", () => {
    const r = decideAction({
      hasGetCkyConsentFn: false,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "uncertain");
  });

  test("CookieYes: getCkyConsent present but performBannerAction missing (hard wall) -> NOOP, no-reject-path", () => {
    const r = decideAction({
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: false,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    });
    assert.equal(r.action, null);
    assert.equal(r.reason, "no-reject-path");
  });

  test("CookieYes: both globals present but zero DOM corroboration -> NOOP, uncertain (fail-closed)", () => {
    const r = decideAction({
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: false,
      hasCkyOverlayDom: false,
      hasCkyConsentBarDom: false,
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

describe("cookiebotAdapter.detect — confidence gate", () => {
  const FULL_COOKIEBOT_SIGNALS = Object.freeze({
    hasCookiebotGlobal: true,
    hasSubmitCustomConsentFn: true,
    hasCybotDialogDom: true,
    hasConsentObjectGlobal: true,
    hasResponseBooleanGlobal: true,
  });

  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = cookiebotAdapter.detect(FULL_COOKIEBOT_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(cookiebotAdapter.canReject(FULL_COOKIEBOT_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (Cybot dialog DOM only) -> canReject true", () => {
    const s = {
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: false,
      hasResponseBooleanGlobal: false,
    };
    assert.equal(cookiebotAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasCookiebotGlobal: true,
      hasSubmitCustomConsentFn: true,
      hasCybotDialogDom: false,
      hasConsentObjectGlobal: false,
      hasResponseBooleanGlobal: false,
    };
    assert.equal(cookiebotAdapter.canReject(s), false);
    assert.ok(cookiebotAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory submitCustomConsent fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasCookiebotGlobal: false,
      hasSubmitCustomConsentFn: false,
      hasCybotDialogDom: true,
      hasConsentObjectGlobal: true,
      hasResponseBooleanGlobal: true,
    };
    assert.equal(cookiebotAdapter.detect(s), 0);
    assert.equal(cookiebotAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => cookiebotAdapter.detect(null));
    assert.doesNotThrow(() => cookiebotAdapter.detect(undefined));
    assert.equal(cookiebotAdapter.detect(null), 0);
  });
});

describe("didomiAdapter.detect — confidence gate", () => {
  const FULL_DIDOMI_SIGNALS = Object.freeze({
    hasDidomiGlobal: true,
    hasSetUserDisagreeToAllFn: true,
    hasDidomiHostDom: true,
    hasGetCurrentUserStatusFn: true,
  });

  test("mandatory + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = didomiAdapter.detect(FULL_DIDOMI_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(didomiAdapter.canReject(FULL_DIDOMI_SIGNALS), true);
  });

  test("mandatory + exactly one secondary (#didomi-host DOM only) -> canReject true", () => {
    const s = {
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: false,
    };
    assert.equal(didomiAdapter.canReject(s), true);
  });

  test("global-only (mandatory present, zero secondary signals) -> uncertain, canReject false", () => {
    const s = {
      hasDidomiGlobal: true,
      hasSetUserDisagreeToAllFn: true,
      hasDidomiHostDom: false,
      hasGetCurrentUserStatusFn: false,
    };
    assert.equal(didomiAdapter.canReject(s), false);
    assert.ok(didomiAdapter.detect(s) < 1);
  });

  test("DOM-only (mandatory setUserDisagreeToAll fn missing) -> confidence 0, canReject false", () => {
    const s = {
      hasDidomiGlobal: false,
      hasSetUserDisagreeToAllFn: false,
      hasDidomiHostDom: true,
      hasGetCurrentUserStatusFn: true,
    };
    assert.equal(didomiAdapter.detect(s), 0);
    assert.equal(didomiAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => didomiAdapter.detect(null));
    assert.doesNotThrow(() => didomiAdapter.detect(undefined));
    assert.equal(didomiAdapter.detect(null), 0);
  });
});

describe("cookieYesAdapter.detect — dual-mandatory confidence gate", () => {
  const FULL_COOKIEYES_SIGNALS = Object.freeze({
    hasGetCkyConsentFn: true,
    hasPerformBannerActionFn: true,
    hasCkyConsentContainerDom: true,
    hasCkyOverlayDom: true,
    hasCkyConsentBarDom: true,
  });

  test("both mandatory globals + >=1 secondary -> confidence at ceiling, canReject true", () => {
    const c = cookieYesAdapter.detect(FULL_COOKIEYES_SIGNALS);
    assert.ok(c >= 1);
    assert.equal(cookieYesAdapter.canReject(FULL_COOKIEYES_SIGNALS), true);
  });

  test("both mandatory globals + exactly one secondary (.cky-consent-container only) -> canReject true", () => {
    const s = {
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: false,
      hasCkyConsentBarDom: false,
    };
    assert.equal(cookieYesAdapter.canReject(s), true);
  });

  test("both mandatory globals present, zero DOM corroboration -> uncertain, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: false,
      hasCkyOverlayDom: false,
      hasCkyConsentBarDom: false,
    };
    assert.equal(cookieYesAdapter.canReject(s), false);
    assert.ok(cookieYesAdapter.detect(s) < 1);
  });

  test("only getCkyConsent present (performBannerAction missing) -> confidence 0, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: true,
      hasPerformBannerActionFn: false,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    };
    assert.equal(cookieYesAdapter.detect(s), 0);
    assert.equal(cookieYesAdapter.canReject(s), false);
  });

  test("only performBannerAction present (getCkyConsent missing) -> confidence 0, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: false,
      hasPerformBannerActionFn: true,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    };
    assert.equal(cookieYesAdapter.detect(s), 0);
    assert.equal(cookieYesAdapter.canReject(s), false);
  });

  test("DOM-only (both mandatory globals missing) -> confidence 0, canReject false", () => {
    const s = {
      hasGetCkyConsentFn: false,
      hasPerformBannerActionFn: false,
      hasCkyConsentContainerDom: true,
      hasCkyOverlayDom: true,
      hasCkyConsentBarDom: true,
    };
    assert.equal(cookieYesAdapter.detect(s), 0);
    assert.equal(cookieYesAdapter.canReject(s), false);
  });

  test("malformed/missing signals object never throws", () => {
    assert.doesNotThrow(() => cookieYesAdapter.detect(null));
    assert.doesNotThrow(() => cookieYesAdapter.detect(undefined));
    assert.equal(cookieYesAdapter.detect(null), 0);
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

describe("cookiebotAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = cookiebotAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = cookiebotAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = cookiebotAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("didomiAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = didomiAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = didomiAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = didomiAdapter.reject(undefined);
    assert.equal(r.status, "noop");
  });
});

describe("cookieYesAdapter.reject — pure callback invocation", () => {
  test("calls the injected function and reports rejected", () => {
    let called = false;
    const r = cookieYesAdapter.reject(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "rejected");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = cookieYesAdapter.reject(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = cookieYesAdapter.reject(undefined);
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

  test("cookiebotAdapter is registered in TIER1 alongside oneTrustAdapter (#1118)", () => {
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must include cookiebotAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
  });

  test("didomiAdapter is registered in TIER1 alongside oneTrustAdapter and cookiebotAdapter (#1119)", () => {
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must include didomiAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
  });

  test("cookieYesAdapter is registered in TIER1 alongside the other three adapters (#1120)", () => {
    assert.ok(TIER1.includes(cookieYesAdapter), "TIER1 must include cookieYesAdapter");
    assert.ok(TIER1.includes(oneTrustAdapter), "TIER1 must still include oneTrustAdapter");
    assert.ok(TIER1.includes(cookiebotAdapter), "TIER1 must still include cookiebotAdapter");
    assert.ok(TIER1.includes(didomiAdapter), "TIER1 must still include didomiAdapter");
  });
});
