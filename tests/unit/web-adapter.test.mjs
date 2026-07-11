/**
 * MUGA: Web-cleaner-tool adapter — unit tests against a FAKE engine (#1029,
 * Phase 3, design ADR-5 / ADR-8 item 1).
 *
 * Exercises `cleanUrl()`/`resolveEngine()`'s input validation, pure-cleaner
 * prefs construction, result mapping, and degradation paths WITHOUT loading
 * the real bundle — fast, deterministic, and independent of MUGA engine
 * drift (that coverage lives in web-adapter-contract.test.mjs, which runs
 * the dirty-to-expected grid against the real bundle).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { cleanUrl, resolveEngine } from "../../web/engine/adapter.js";
import { PATH_STRIP_RULES } from "../../web/engine/path-strip-rules.gen.mjs";

const FAKE_PREF_DEFAULTS = {
  enabled: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: true,
  stripAllAffiliates: false,
  honorCreatorMode: true,
  onboardingDone: false,
  blacklist: ["preexisting.example"],
  whitelist: ["preexisting.example"],
  customParams: ["preexisting"],
  userCustomRules: ["preexisting"],
};

function makeFakeEngine({ result, throwError, capture } = {}) {
  return {
    PREF_DEFAULTS: FAKE_PREF_DEFAULTS,
    processUrl(rawUrl, prefs, rules, ...rest) {
      if (capture) capture({ rawUrl, prefs, rules, rest });
      if (throwError) throw throwError;
      return result;
    },
  };
}

describe("web adapter — input validation", () => {
  test("rejects empty string", () => {
    const out = cleanUrl("", makeFakeEngine());
    assert.equal(out.ok, false);
    assert.equal(out.action, "invalid");
    assert.ok(out.error);
  });

  test("rejects whitespace-only string", () => {
    const out = cleanUrl("   ", makeFakeEngine());
    assert.equal(out.ok, false);
    assert.equal(out.action, "invalid");
  });

  test("rejects non-string input without throwing", () => {
    assert.doesNotThrow(() => cleanUrl(null, makeFakeEngine()));
    assert.doesNotThrow(() => cleanUrl(undefined, makeFakeEngine()));
    assert.doesNotThrow(() => cleanUrl(1234, makeFakeEngine()));
    const out = cleanUrl(null, makeFakeEngine());
    assert.equal(out.ok, false);
    assert.equal(out.action, "invalid");
  });

  test("rejects non-URL text", () => {
    const out = cleanUrl("this is not a url", makeFakeEngine());
    assert.equal(out.ok, false);
    assert.equal(out.action, "invalid");
  });

  test("rejects javascript: scheme", () => {
    const out = cleanUrl("javascript:alert(1)", makeFakeEngine());
    assert.equal(out.ok, false);
    assert.equal(out.action, "invalid");
  });

  test("rejects data: scheme", () => {
    const out = cleanUrl("data:text/plain,hello", makeFakeEngine());
    assert.equal(out.ok, false);
    assert.equal(out.action, "invalid");
  });

  test("rejects an input longer than 2000 characters", () => {
    const longUrl = "https://example.com/?q=" + "a".repeat(2000);
    const out = cleanUrl(longUrl, makeFakeEngine());
    assert.equal(out.ok, false);
    assert.equal(out.action, "invalid");
  });
});

describe("web adapter — pure-cleaner prefs", () => {
  test("forces web-tool policy on top of engine.PREF_DEFAULTS", () => {
    let captured;
    const engine = makeFakeEngine({
      result: {
        cleanUrl: "https://example.com/",
        action: "untouched",
        removedTracking: [],
        preservedAffiliate: null,
        creatorReferralPreserved: false,
      },
      capture: (args) => { captured = args; },
    });

    cleanUrl("https://example.com/", engine);

    assert.ok(captured, "processUrl must have been called");
    assert.equal(captured.prefs.enabled, true);
    assert.equal(captured.prefs.onboardingDone, true);
    assert.equal(captured.prefs.injectOwnAffiliate, false);
    assert.equal(captured.prefs.notifyForeignAffiliate, false);
    assert.equal(captured.prefs.honorCreatorMode, false);
    assert.deepEqual(captured.prefs.blacklist, []);
    assert.deepEqual(captured.prefs.whitelist, []);
    assert.deepEqual(captured.prefs.customParams, []);
    assert.deepEqual(captured.prefs.userCustomRules, []);
    // Fields not overridden by web-tool policy still flow from the real defaults.
    assert.equal(captured.prefs.stripAllAffiliates, FAKE_PREF_DEFAULTS.stripAllAffiliates);
  });

  test("passes the mirrored domain-rules.json as processUrl's domainRules argument", () => {
    let captured;
    const engine = makeFakeEngine({
      result: {
        cleanUrl: "https://example.com/",
        action: "untouched",
        removedTracking: [],
        preservedAffiliate: null,
        creatorReferralPreserved: false,
      },
      capture: (args) => { captured = args; },
    });

    cleanUrl("https://example.com/", engine);

    assert.ok(Array.isArray(captured.rules), "domainRules must be an array");
    assert.ok(captured.rules.length > 0, "domainRules must not be empty");
    assert.ok("domain" in captured.rules[0]);
  });
});

describe("web adapter — path-strip rules wiring", () => {
  test("passes the mirrored path-strip-rules.json as processUrl's 7th argument (pathStripRules)", () => {
    let captured;
    const engine = makeFakeEngine({
      result: {
        cleanUrl: "https://example.com/",
        action: "untouched",
        removedTracking: [],
        preservedAffiliate: null,
        creatorReferralPreserved: false,
      },
      capture: (args) => { captured = args; },
    });

    cleanUrl("https://example.com/", engine);

    assert.ok(captured, "processUrl must have been called");
    // rest = [canonicalBundle, frequencyTracker, referrer, pathStripRules, pathAffiliateRules]
    assert.equal(captured.rest[0], undefined, "canonicalBundle (4th arg) must stay undefined");
    assert.equal(captured.rest[1], undefined, "frequencyTracker (5th arg) must stay undefined");
    assert.equal(captured.rest[2], undefined, "referrer (6th arg) must stay undefined");
    const pathStripRules = captured.rest[3];
    assert.ok(Array.isArray(pathStripRules), "pathStripRules (7th arg) must be an array");
    assert.ok(pathStripRules.length > 0, "pathStripRules must not be empty");
    assert.deepEqual(pathStripRules, PATH_STRIP_RULES);
    assert.equal(captured.rest[4], undefined, "pathAffiliateRules (8th arg) must stay unwired");
  });
});

describe("web adapter — result mapping", () => {
  test("maps a cleaned+unwrapped result to the stable contract", () => {
    const engine = makeFakeEngine({
      result: {
        cleanUrl: "https://example.com/page",
        action: "cleaned",
        removedTracking: ["utm_source", "fbclid"],
        preservedAffiliate: null,
        creatorReferralPreserved: false,
      },
    });
    const out = cleanUrl(
      "https://www.google.com/url?q=https://example.com/page&utm_source=x",
      engine,
    );
    assert.equal(out.ok, true);
    assert.equal(out.cleanUrl, "https://example.com/page");
    assert.deepEqual(out.removed, ["utm_source", "fbclid"]);
    assert.equal(out.unwrapped, true);
    assert.equal(out.destinationHost, "example.com");
    assert.equal(out.affiliatePreserved, false);
    assert.equal(out.action, "cleaned");
  });

  test("marks affiliatePreserved true when processUrl reports a preserved affiliate", () => {
    const engine = makeFakeEngine({
      result: {
        cleanUrl: "https://www.amazon.com/dp/X?tag=creator-20",
        action: "cleaned",
        removedTracking: ["utm_source"],
        preservedAffiliate: { param: "tag", value: "creator-20", store: "Amazon", group: "Amazon" },
        creatorReferralPreserved: false,
      },
    });
    const out = cleanUrl("https://www.amazon.com/dp/X?tag=creator-20&utm_source=y", engine);
    assert.equal(out.ok, true);
    assert.equal(out.affiliatePreserved, true);
  });

  test("marks affiliatePreserved true when processUrl reports a preserved creator referral", () => {
    const engine = makeFakeEngine({
      result: {
        cleanUrl: "https://example.com/ref/abc",
        action: "untouched",
        removedTracking: [],
        preservedAffiliate: null,
        creatorReferralPreserved: true,
      },
    });
    const out = cleanUrl("https://example.com/ref/abc", engine);
    assert.equal(out.affiliatePreserved, true);
  });

  test("no-op result reports removed:[] and unwrapped:false", () => {
    const engine = makeFakeEngine({
      result: {
        cleanUrl: "https://example.com/already-clean",
        action: "untouched",
        removedTracking: [],
        preservedAffiliate: null,
        creatorReferralPreserved: false,
      },
    });
    const out = cleanUrl("https://example.com/already-clean", engine);
    assert.equal(out.ok, true);
    assert.equal(out.cleanUrl, "https://example.com/already-clean");
    assert.deepEqual(out.removed, []);
    assert.equal(out.unwrapped, false);
    assert.equal(out.action, "untouched");
  });
});

describe("web adapter — degradation", () => {
  test("returns engine-unavailable when engine is null", () => {
    const out = cleanUrl("https://example.com/", null);
    assert.equal(out.ok, false);
    assert.equal(out.action, "error");
    assert.equal(out.error, "engine-unavailable");
  });

  test("returns engine-unavailable when the injected engine has no processUrl function", () => {
    const out = cleanUrl("https://example.com/", {});
    assert.equal(out.ok, false);
    assert.equal(out.action, "error");
    assert.equal(out.error, "engine-unavailable");
  });

  test("catches a throwing processUrl and returns processing-failed", () => {
    const engine = makeFakeEngine({ throwError: new Error("boom") });
    assert.doesNotThrow(() => cleanUrl("https://example.com/", engine));
    const out = cleanUrl("https://example.com/", engine);
    assert.equal(out.ok, false);
    assert.equal(out.action, "error");
    assert.equal(out.error, "processing-failed");
  });
});

describe("web adapter — resolveEngine()", () => {
  test("returns null when window is undefined", () => {
    assert.equal(typeof window, "undefined");
    assert.equal(resolveEngine(), null);
  });

  test("returns null when window.__mugaCleaner is absent", () => {
    const original = globalThis.window;
    globalThis.window = {};
    try {
      assert.equal(resolveEngine(), null);
    } finally {
      if (original === undefined) delete globalThis.window;
      else globalThis.window = original;
    }
  });

  test("returns null when window.__mugaCleaner has no processUrl function", () => {
    const original = globalThis.window;
    globalThis.window = { __mugaCleaner: {} };
    try {
      assert.equal(resolveEngine(), null);
    } finally {
      if (original === undefined) delete globalThis.window;
      else globalThis.window = original;
    }
  });

  test("returns window.__mugaCleaner when it exposes processUrl", () => {
    const original = globalThis.window;
    const fake = makeFakeEngine({ result: {} });
    globalThis.window = { __mugaCleaner: fake };
    try {
      assert.equal(resolveEngine(), fake);
    } finally {
      if (original === undefined) delete globalThis.window;
      else globalThis.window = original;
    }
  });
});
