/**
 * MUGA — Cookie Consent Minimizer: cmp-accept-adapters.js (cookie-consent-
 * accept Slice 2a — Didomi-only pilot)
 *
 * ALL accept logic lives in this file (design's L1 — file-scoped lexical
 * purity: src/lib/cmp-adapters.js and the reject regions of the two
 * content scripts stay forever accept-free; this is the ONE place accept
 * decisions and payload construction exist as an ES module).
 *
 * This is the highest-stakes test file in the project: it must prove, not
 * just assert, that accept is structurally unreachable except when the
 * user explicitly asked for it. Four groups:
 *
 *   1. decideMinimumAccept — pure decision truth table.
 *   2. computeAcceptGate — the double-gate (+ enabled/onboarded/exemption).
 *   3. didomiAcceptAdapter — minimum-payload construction + the callback-
 *      injected accept() wrapper.
 *   4. STRUCTURAL guards — DENYLIST scan for broad-accept identifiers, and
 *      the adversarial "this must be impossible" scenarios.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import {
  ACTIONS_ACCEPT,
  decideMinimumAccept,
  computeAcceptGate,
  canAttemptDidomiMinimumAccept,
  didomiAcceptAdapter,
  resolveDidomiMinimumStatus,
  extractRequiredIds,
} from "../../src/lib/cmp-accept-adapters.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── ACTIONS_ACCEPT — closed set ─────────────────────────────────────────────

describe("ACTIONS_ACCEPT", () => {
  test("is a closed set containing exactly ACCEPT_MINIMUM", () => {
    assert.deepEqual(Object.keys(ACTIONS_ACCEPT), ["ACCEPT_MINIMUM"]);
    assert.equal(ACTIONS_ACCEPT.ACCEPT_MINIMUM, "accept-minimum");
  });

  test("is frozen", () => {
    assert.ok(Object.isFrozen(ACTIONS_ACCEPT));
  });
});

// ── decideMinimumAccept — pure decision truth table ─────────────────────────

const HARD_WALL_DIDOMI = Object.freeze({ action: null, reason: "no-reject-path", adapterId: "didomi" });

describe("decideMinimumAccept — truth table", () => {
  test("mode accept-when-necessary + consented + Didomi hard wall -> ACCEPT_MINIMUM", () => {
    const r = decideMinimumAccept(HARD_WALL_DIDOMI, "accept-when-necessary", true);
    assert.equal(r.action, ACTIONS_ACCEPT.ACCEPT_MINIMUM);
    assert.equal(r.adapterId, "didomi");
  });

  test("mode reject-only (even with consented true and a real hard wall) -> NOOP", () => {
    const r = decideMinimumAccept(HARD_WALL_DIDOMI, "reject-only", true);
    assert.equal(r.action, null);
  });

  test("mode off -> NOOP", () => {
    const r = decideMinimumAccept(HARD_WALL_DIDOMI, "off", true);
    assert.equal(r.action, null);
  });

  test("consented false (even in accept-when-necessary mode with a real hard wall) -> NOOP", () => {
    const r = decideMinimumAccept(HARD_WALL_DIDOMI, "accept-when-necessary", false);
    assert.equal(r.action, null);
  });

  test("consented missing/undefined -> NOOP (must be exactly true)", () => {
    const r = decideMinimumAccept(HARD_WALL_DIDOMI, "accept-when-necessary", undefined);
    assert.equal(r.action, null);
  });

  test("decision.reason is 'reject' (a real reject fired) -> NOOP, never double-acts", () => {
    const r = decideMinimumAccept(
      { action: "reject-all", reason: "reject", adapterId: "didomi" },
      "accept-when-necessary",
      true,
    );
    assert.equal(r.action, null);
  });

  test("decision.reason is 'uncertain' (no CMP confidently detected) -> NOOP", () => {
    const r = decideMinimumAccept(
      { action: null, reason: "uncertain", adapterId: null },
      "accept-when-necessary",
      true,
    );
    assert.equal(r.action, null);
  });

  test("adapterId not in the accept-capable set (e.g. a OneTrust hard wall) -> NOOP — Slice 2a is Didomi-only", () => {
    const r = decideMinimumAccept(
      { action: null, reason: "no-reject-path", adapterId: "onetrust" },
      "accept-when-necessary",
      true,
    );
    assert.equal(r.action, null);
  });

  test("adapterId null (e.g. an 'uncertain' hard wall with no vendor identified) -> NOOP", () => {
    const r = decideMinimumAccept(
      { action: null, reason: "no-reject-path", adapterId: null },
      "accept-when-necessary",
      true,
    );
    assert.equal(r.action, null);
  });

  test("malformed/missing decision object never throws, resolves to NOOP", () => {
    assert.doesNotThrow(() => decideMinimumAccept(null, "accept-when-necessary", true));
    assert.doesNotThrow(() => decideMinimumAccept(undefined, "accept-when-necessary", true));
    assert.equal(decideMinimumAccept(null, "accept-when-necessary", true).action, null);
  });
});

// ── computeAcceptGate — the double-gate (L2) ────────────────────────────────

const ACCEPT_GATE_ON_PREFS = Object.freeze({
  enabled: true,
  onboardingDone: true,
  cookieConsentMode: "accept-when-necessary",
  cookieConsentAcceptConsented: true,
});

describe("computeAcceptGate — double-gate as a DATA invariant", () => {
  test("every invariant satisfied -> gate opens (true)", () => {
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS), true);
  });

  test("mode is reject-only (consented true) -> gate stays closed", () => {
    assert.equal(
      computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentMode: "reject-only" }),
      false,
    );
  });

  test("mode is off (consented true) -> gate stays closed", () => {
    assert.equal(
      computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentMode: "off" }),
      false,
    );
  });

  test("cookieConsentAcceptConsented false (mode correct) -> gate stays closed", () => {
    assert.equal(
      computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: false }),
      false,
    );
  });

  test("cookieConsentAcceptConsented missing/undefined -> gate stays closed (must be exactly true)", () => {
    const { cookieConsentAcceptConsented: _omit, ...rest } = ACCEPT_GATE_ON_PREFS;
    assert.equal(computeAcceptGate(rest), false);
  });

  test("cookieConsentAcceptConsented as a truthy non-boolean (e.g. 1 or 'true') does NOT open the gate", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: 1 }), false);
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: "true" }), false);
  });

  test("master enabled false -> gate stays closed", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, enabled: false }), false);
  });

  test("onboardingDone false -> gate stays closed", () => {
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, onboardingDone: false }), false);
  });

  test("null / undefined prefs -> gate stays closed, never throws", () => {
    assert.doesNotThrow(() => computeAcceptGate(null));
    assert.equal(computeAcceptGate(null), false);
    assert.equal(computeAcceptGate(undefined), false);
  });

  test("isSiteFullyExempt true -> gate stays closed even when every pref passes", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => true };
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps), false);
  });

  test("isSiteFullyExempt false -> gate opens (site not exempt)", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => false };
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps), true);
  });

  test("isSiteFullyExempt receives the injected hostname and prefs", () => {
    let seen = null;
    const deps = {
      hostname: "shop.example.com",
      isSiteFullyExempt: (hostname, prefs) => { seen = { hostname, prefs }; return false; },
    };
    computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps);
    assert.equal(seen.hostname, "shop.example.com");
    assert.strictEqual(seen.prefs, ACCEPT_GATE_ON_PREFS);
  });

  test("a throwing isSiteFullyExempt is swallowed and treated as not exempt (fail-safe -> open)", () => {
    const deps = { hostname: "example.com", isSiteFullyExempt: () => { throw new Error("boom"); } };
    assert.doesNotThrow(() => computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps));
    assert.equal(computeAcceptGate(ACCEPT_GATE_ON_PREFS, deps), true);
  });
});

// ── canAttemptDidomiMinimumAccept — content-script hard-wall detection ─────
//
// This is the pure predicate hand-copied into the @sync:cmp-accept region
// of both content scripts (they cannot import this module — no ES imports
// in content scripts, AGENTS.md), mirroring the @sync:cmp-adapters /
// @sync:cookie-gate precedent. It is deliberately narrower than the reject
// ladder's signal shape: it re-confirms the Didomi hard wall (global
// present, reject fn absent) AND the accept-specific signals this Slice
// needs (setCurrentUserStatus + both getters), so a page that has Didomi
// but not the accept-capable API surface never reaches a call attempt.

describe("canAttemptDidomiMinimumAccept — hard-wall + accept-capability detection", () => {
  const FULL_ACCEPT_SIGNALS = Object.freeze({
    hasDidomiGlobal: true,
    hasSetUserDisagreeToAllFn: false,
    hasSetCurrentUserStatusFn: true,
    hasGetRequiredPurposeIdsFn: true,
    hasGetRequiredVendorIdsFn: true,
    hasGetPurposesFn: true,
    hasGetVendorsFn: true,
  });

  test("Didomi hard wall (global present, reject fn absent) + full accept signal set -> true", () => {
    assert.equal(canAttemptDidomiMinimumAccept(FULL_ACCEPT_SIGNALS), true);
  });

  test("Didomi global absent -> false", () => {
    assert.equal(canAttemptDidomiMinimumAccept({ ...FULL_ACCEPT_SIGNALS, hasDidomiGlobal: false }), false);
  });

  test("reject fn present (a real reject path exists — not a hard wall) -> false, even with every accept signal present", () => {
    assert.equal(canAttemptDidomiMinimumAccept({ ...FULL_ACCEPT_SIGNALS, hasSetUserDisagreeToAllFn: true }), false);
  });

  test("setCurrentUserStatus fn missing -> false (no accept call surface at all)", () => {
    assert.equal(canAttemptDidomiMinimumAccept({ ...FULL_ACCEPT_SIGNALS, hasSetCurrentUserStatusFn: false }), false);
  });

  test("getRequiredPurposeIds fn missing -> false (cannot build a minimum payload)", () => {
    assert.equal(canAttemptDidomiMinimumAccept({ ...FULL_ACCEPT_SIGNALS, hasGetRequiredPurposeIdsFn: false }), false);
  });

  test("getRequiredVendorIds fn missing -> false", () => {
    assert.equal(canAttemptDidomiMinimumAccept({ ...FULL_ACCEPT_SIGNALS, hasGetRequiredVendorIdsFn: false }), false);
  });

  test("getPurposes fn missing -> false (cannot build the disabled list)", () => {
    assert.equal(canAttemptDidomiMinimumAccept({ ...FULL_ACCEPT_SIGNALS, hasGetPurposesFn: false }), false);
  });

  test("getVendors fn missing -> false", () => {
    assert.equal(canAttemptDidomiMinimumAccept({ ...FULL_ACCEPT_SIGNALS, hasGetVendorsFn: false }), false);
  });

  test("malformed/missing signals object never throws, resolves to false", () => {
    assert.doesNotThrow(() => canAttemptDidomiMinimumAccept(null));
    assert.doesNotThrow(() => canAttemptDidomiMinimumAccept(undefined));
    assert.equal(canAttemptDidomiMinimumAccept(null), false);
  });
});

// ── didomiAcceptAdapter — minimum-payload construction ──────────────────────

describe("didomiAcceptAdapter — minimum payload construction (L4)", () => {
  test("exposes id, buildMinimumPayload, accept", () => {
    assert.equal(didomiAcceptAdapter.id, "didomi");
    assert.equal(typeof didomiAcceptAdapter.buildMinimumPayload, "function");
    assert.equal(typeof didomiAcceptAdapter.accept, "function");
  });

  test("enables exactly the required purpose/vendor ids, disables everything else", () => {
    const payload = didomiAcceptAdapter.buildMinimumPayload({
      requiredPurposeIds: ["cookies_functional"],
      requiredVendorIds: ["vendor-required-1"],
      allPurposeIds: ["cookies_functional", "advertising", "analytics"],
      allVendorIds: ["vendor-required-1", "vendor-ads-2", "vendor-analytics-3"],
    });
    assert.deepEqual(payload.purposes.enabled, ["cookies_functional"]);
    assert.deepEqual(payload.purposes.disabled, ["advertising", "analytics"]);
    assert.deepEqual(payload.vendors.enabled, ["vendor-required-1"]);
    assert.deepEqual(payload.vendors.disabled, ["vendor-ads-2", "vendor-analytics-3"]);
  });

  test("enabled + disabled partition the full id list exactly — no id lost, none duplicated", () => {
    const payload = didomiAcceptAdapter.buildMinimumPayload({
      requiredPurposeIds: ["p1", "p2"],
      requiredVendorIds: ["v1"],
      allPurposeIds: ["p1", "p2", "p3", "p4"],
      allVendorIds: ["v1", "v2", "v3"],
    });
    assert.equal(payload.purposes.enabled.length + payload.purposes.disabled.length, 4);
    assert.equal(payload.vendors.enabled.length + payload.vendors.disabled.length, 3);
    assert.equal(new Set([...payload.purposes.enabled, ...payload.purposes.disabled]).size, 4);
    assert.equal(new Set([...payload.vendors.enabled, ...payload.vendors.disabled]).size, 3);
  });

  test("ADVERSARIAL: a required id NOT present in the full id list is never enabled (corrupted/hostile page data stays fail-closed)", () => {
    const payload = didomiAcceptAdapter.buildMinimumPayload({
      requiredPurposeIds: ["p1", "phantom-purpose-not-in-registry"],
      requiredVendorIds: ["v1", "phantom-vendor-not-in-registry"],
      allPurposeIds: ["p1", "p2"],
      allVendorIds: ["v1", "v2"],
    });
    assert.deepEqual(payload.purposes.enabled, ["p1"]);
    assert.ok(!payload.purposes.enabled.includes("phantom-purpose-not-in-registry"));
    assert.deepEqual(payload.vendors.enabled, ["v1"]);
    assert.ok(!payload.vendors.enabled.includes("phantom-vendor-not-in-registry"));
  });

  test("empty required lists -> everything disabled, nothing enabled (still a valid minimum, not a NOOP payload)", () => {
    const payload = didomiAcceptAdapter.buildMinimumPayload({
      requiredPurposeIds: [],
      requiredVendorIds: [],
      allPurposeIds: ["p1", "p2"],
      allVendorIds: ["v1"],
    });
    assert.deepEqual(payload.purposes.enabled, []);
    assert.deepEqual(payload.purposes.disabled, ["p1", "p2"]);
    assert.deepEqual(payload.vendors.enabled, []);
    assert.deepEqual(payload.vendors.disabled, ["v1"]);
  });

  test("malformed/missing input (non-array fields) never throws, resolves to empty everything", () => {
    assert.doesNotThrow(() => didomiAcceptAdapter.buildMinimumPayload({}));
    assert.doesNotThrow(() => didomiAcceptAdapter.buildMinimumPayload(null));
    assert.doesNotThrow(() => didomiAcceptAdapter.buildMinimumPayload(undefined));
    const payload = didomiAcceptAdapter.buildMinimumPayload(null);
    assert.deepEqual(payload.purposes.enabled, []);
    assert.deepEqual(payload.purposes.disabled, []);
    assert.deepEqual(payload.vendors.enabled, []);
    assert.deepEqual(payload.vendors.disabled, []);
  });
});

describe("didomiAcceptAdapter.accept — pure callback invocation", () => {
  test("calls the injected function and reports accepted", () => {
    let called = false;
    const r = didomiAcceptAdapter.accept(() => { called = true; });
    assert.equal(called, true);
    assert.equal(r.status, "accepted");
  });

  test("a throwing callback is swallowed -> status noop, never throws", () => {
    const r = didomiAcceptAdapter.accept(() => { throw new Error("boom"); });
    assert.equal(r.status, "noop");
  });

  test("non-function argument -> status noop, no call", () => {
    const r = didomiAcceptAdapter.accept(undefined);
    assert.equal(r.status, "noop");
  });
});

// ── resolveDidomiMinimumStatus — fail-closed required-id parsing (L5) ───────
//
// This is the runtime-facing seam the two content-script dispatch regions
// call with the RAW return values of Didomi's four getters. It owns the
// fail-closed contract that buildMinimumPayload alone could not enforce:
// the REQUIRED lists must be a clean array of non-empty strings; ANY other
// shape (a flag-map object, an array of registry objects, null, a member
// that is not a non-empty string) makes the required set UNRESOLVABLE and
// the WHOLE accept is abandoned (returns null → the caller never calls
// setCurrentUserStatus, the banner is left as the safe fail-closed outcome).

describe("resolveDidomiMinimumStatus — fail-closed required-id parsing", () => {
  test("clean array-of-strings required getters (Didomi's real shape) -> builds the minimum payload", () => {
    const payload = resolveDidomiMinimumStatus({
      requiredPurposeIds: ["cookies_functional"],
      requiredVendorIds: ["vendor-required-1"],
      allPurposeIds: ["cookies_functional", "advertising", "analytics"],
      allVendorIds: ["vendor-required-1", "vendor-ads-2", "vendor-analytics-3"],
    });
    assert.notEqual(payload, null, "the clean happy path must build a payload, not NOOP");
    assert.deepEqual(payload.purposes.enabled, ["cookies_functional"]);
    assert.deepEqual(payload.purposes.disabled, ["advertising", "analytics"]);
    assert.deepEqual(payload.vendors.enabled, ["vendor-required-1"]);
    assert.deepEqual(payload.vendors.disabled, ["vendor-ads-2", "vendor-analytics-3"]);
  });

  test("ADVERSARIAL: a REQUIRED getter returning a flag-map object -> NOOP (never widens to the false/non-essential ids)", () => {
    // The exact vulnerability: a getRequiredPurposeIds() shaped as a
    // consent flag-map. The broad normalizer would have returned every KEY
    // (ignoring the booleans), enabling advertising + analytics = accept-all.
    // The strict parser rejects the shape entirely -> the whole accept NOOPs.
    const payload = resolveDidomiMinimumStatus({
      requiredPurposeIds: { cookies_functional: true, advertising: false, analytics: false },
      requiredVendorIds: ["vendor-required-1"],
      allPurposeIds: ["cookies_functional", "advertising", "analytics"],
      allVendorIds: ["vendor-required-1", "vendor-ads-2", "vendor-analytics-3"],
    });
    assert.equal(payload, null, "a flag-map required list must NOOP the entire accept, never build a payload");
  });

  test("ADVERSARIAL: a REQUIRED getter returning an array of registry objects enumerating the whole registry -> NOOP", () => {
    const payload = resolveDidomiMinimumStatus({
      requiredPurposeIds: [
        { id: "cookies_functional" },
        { id: "advertising" },
        { id: "analytics" },
      ],
      requiredVendorIds: ["vendor-required-1"],
      allPurposeIds: ["cookies_functional", "advertising", "analytics"],
      allVendorIds: ["vendor-required-1", "vendor-ads-2", "vendor-analytics-3"],
    });
    assert.equal(payload, null, "an array-of-objects required list must NOOP the entire accept");
  });

  test("ADVERSARIAL: a REQUIRED getter containing a non-string / empty-string member -> NOOP", () => {
    assert.equal(
      resolveDidomiMinimumStatus({
        requiredPurposeIds: ["cookies_functional", 42],
        requiredVendorIds: [],
        allPurposeIds: ["cookies_functional"],
        allVendorIds: [],
      }),
      null,
    );
    assert.equal(
      resolveDidomiMinimumStatus({
        requiredPurposeIds: ["cookies_functional", ""],
        requiredVendorIds: [],
        allPurposeIds: ["cookies_functional"],
        allVendorIds: [],
      }),
      null,
    );
  });

  test("either required getter returning null/undefined -> NOOP", () => {
    assert.equal(
      resolveDidomiMinimumStatus({
        requiredPurposeIds: null,
        requiredVendorIds: ["vendor-required-1"],
        allPurposeIds: ["p1"],
        allVendorIds: ["vendor-required-1"],
      }),
      null,
    );
    assert.equal(
      resolveDidomiMinimumStatus({
        requiredPurposeIds: ["cookies_functional"],
        requiredVendorIds: undefined,
        allPurposeIds: ["cookies_functional"],
        allVendorIds: ["v1"],
      }),
      null,
    );
  });

  test("empty required arrays are a LEGITIMATE all-essential-disabled minimum (not a NOOP), as long as the registry is readable", () => {
    const payload = resolveDidomiMinimumStatus({
      requiredPurposeIds: [],
      requiredVendorIds: [],
      allPurposeIds: ["p1", "p2"],
      allVendorIds: ["v1"],
    });
    assert.notEqual(payload, null);
    assert.deepEqual(payload.purposes.enabled, []);
    assert.deepEqual(payload.purposes.disabled, ["p1", "p2"]);
    assert.deepEqual(payload.vendors.enabled, []);
    assert.deepEqual(payload.vendors.disabled, ["v1"]);
  });

  test("malformed/missing input never throws, resolves to NOOP", () => {
    assert.doesNotThrow(() => resolveDidomiMinimumStatus(null));
    assert.doesNotThrow(() => resolveDidomiMinimumStatus(undefined));
    assert.equal(resolveDidomiMinimumStatus(null), null);
  });
});

describe("extractRequiredIds — strict array-of-non-empty-strings-or-null", () => {
  test("a clean array of non-empty strings passes through unchanged", () => {
    assert.deepEqual(extractRequiredIds(["a", "b"]), ["a", "b"]);
  });

  test("an empty array is valid (returns [])", () => {
    assert.deepEqual(extractRequiredIds([]), []);
  });

  test("a flag-map object -> null", () => {
    assert.equal(extractRequiredIds({ a: true, b: false }), null);
  });

  test("an array of objects -> null", () => {
    assert.equal(extractRequiredIds([{ id: "a" }]), null);
  });

  test("an array with a non-string or empty-string member -> null", () => {
    assert.equal(extractRequiredIds(["a", 1]), null);
    assert.equal(extractRequiredIds(["a", ""]), null);
    assert.equal(extractRequiredIds(["a", null]), null);
  });

  test("null / undefined / non-array -> null, never throws", () => {
    assert.doesNotThrow(() => extractRequiredIds(null));
    assert.equal(extractRequiredIds(null), null);
    assert.equal(extractRequiredIds(undefined), null);
    assert.equal(extractRequiredIds("nope"), null);
  });
});

// ── STRUCTURAL guard — broad-accept DENYLIST (L4) ───────────────────────────
//
// LOAD-BEARING. Even though this file is where accept logic legitimately
// lives, it must never construct or reference a BROAD accept-all call —
// only the Didomi minimum-payload shape above. This scans the raw source
// for every broad-accept method/literal identified across all 10 vendors
// in the design's per-vendor verification (Part A), so a future edit that
// widens this module toward any of them fails here immediately.

describe("cmp-accept-adapters — STRUCTURAL guard: broad-accept DENYLIST", () => {
  const source = readFileSync(join(__dirname, "../../src/lib/cmp-accept-adapters.js"), "utf8");

  const DENYLIST = [
    "AllowAll",
    "acceptAllConsents",
    "acceptAllServices",
    "acceptAllAction",
    "postAcceptAll",
    "submitCustomConsent(true",
    "respondAll(true)",
    '__cmp("setConsent", 1',
    'performBannerAction("accept_all"',
  ];

  for (const forbidden of DENYLIST) {
    test(`source never contains "${forbidden}"`, () => {
      assert.equal(
        source.includes(forbidden),
        false,
        `cmp-accept-adapters.js must never contain the broad-accept identifier "${forbidden}"`,
      );
    });
  }

  test("ACTIONS_ACCEPT has exactly one member and it is ACCEPT_MINIMUM (no broad-accept action can exist)", () => {
    assert.equal(Object.keys(ACTIONS_ACCEPT).length, 1);
    assert.ok("ACCEPT_MINIMUM" in ACTIONS_ACCEPT);
  });

  test("the only vendor id this module recognizes as accept-capable is didomi (Slice 2a scope)", () => {
    // Adversarial: every other real vendor id from cmp-adapters.js's
    // TIER1 registry must resolve to NOOP even with every other invariant
    // satisfied — proven behaviorally, not just by reading this list.
    const OTHER_VENDOR_IDS = [
      "onetrust", "cookiebot", "cookieyes", "sourcepoint", "usercentrics",
      "cookieinformation", "cookiescript", "tarteaucitron", "consentmanager",
    ];
    for (const adapterId of OTHER_VENDOR_IDS) {
      const r = decideMinimumAccept(
        { action: null, reason: "no-reject-path", adapterId },
        "accept-when-necessary",
        true,
      );
      assert.equal(r.action, null, `adapterId "${adapterId}" must never resolve to ACCEPT_MINIMUM in Slice 2a`);
    }
  });
});

// ── ADVERSARIAL — "this must be impossible" scenarios (own section) ────────

describe("cmp-accept-adapters — ADVERSARIAL: impossible-by-construction scenarios", () => {
  test("accept can NEVER fire in reject-only mode, no matter what else is true", () => {
    // Sweep every other axis (consented, reason, adapterId) — reason must
    // stay NOOP purely because mode !== accept-when-necessary.
    for (const consented of [true, false]) {
      for (const reason of ["no-reject-path", "reject", "uncertain"]) {
        const r = decideMinimumAccept({ action: null, reason, adapterId: "didomi" }, "reject-only", consented);
        assert.equal(r.action, null, `reject-only + consented=${consented} + reason=${reason} must stay NOOP`);
      }
    }
  });

  test("accept can NEVER fire without the explicit consent gesture, no matter what else is true", () => {
    for (const mode of ["accept-when-necessary", "reject-only", "off"]) {
      const r = decideMinimumAccept(HARD_WALL_DIDOMI, mode, false);
      assert.equal(r.action, null, `mode=${mode} without the gesture must stay NOOP`);
    }
    // The gate itself, independently of decideMinimumAccept, must also stay
    // closed without the gesture even when every other pref is perfect.
    assert.equal(computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, cookieConsentAcceptConsented: false }), false);
  });

  test("accept can NEVER grant more than the minimum — enabled ids are always a subset of the required ids that actually exist in the registry", () => {
    const requiredPurposeIds = ["p1"];
    const allPurposeIds = ["p1", "p2", "p3"];
    const payload = didomiAcceptAdapter.buildMinimumPayload({
      requiredPurposeIds,
      requiredVendorIds: [],
      allPurposeIds,
      allVendorIds: [],
    });
    // Every enabled id must be in the intersection of required and all —
    // never wider than what was explicitly required by the page itself.
    for (const id of payload.purposes.enabled) {
      assert.ok(requiredPurposeIds.includes(id) && allPurposeIds.includes(id));
    }
    // And the disabled set must contain every id that is NOT required —
    // proving nothing outside the minimum sneaks into "enabled".
    assert.deepEqual(payload.purposes.disabled, ["p2", "p3"]);
  });

  test("the double-gate and the decision function are independent layers — closing one does not require the other to also be checked (defense in depth)", () => {
    // Gate closed (no consent), decision would have said ACCEPT_MINIMUM in
    // isolation — the CONTENT SCRIPT is expected to check the gate FIRST;
    // this test documents that decideMinimumAccept alone is not a complete
    // gate (by design — it only checks mode+consented+reason+adapterId,
    // not enabled/onboardingDone/exemption), so callers must always AND it
    // with computeAcceptGate's result, never call it standalone as if it
    // were the whole safety story.
    const gateOpen = computeAcceptGate({ ...ACCEPT_GATE_ON_PREFS, enabled: false });
    const decision = decideMinimumAccept(HARD_WALL_DIDOMI, "accept-when-necessary", true);
    assert.equal(gateOpen, false);
    assert.equal(decision.action, ACTIONS_ACCEPT.ACCEPT_MINIMUM);
    // The combined effective decision a real call site must use:
    const effectiveAccept = gateOpen && decision.action === ACTIONS_ACCEPT.ACCEPT_MINIMUM;
    assert.equal(effectiveAccept, false);
  });
});
