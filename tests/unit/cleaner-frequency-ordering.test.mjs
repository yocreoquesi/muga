/**
 * MUGA — TS-11/TS-12: recordFrequency ordering regression guard.
 *
 * Safety-net added before refactoring processUrl (issue #627).
 * These tests MUST pass on unmodified main — they pin the ordering invariant
 * that recordFrequency (Site B, main path) fires after the tracking-param
 * strip pass runs.
 *
 * drop-affiliate-injection (PR 1a): Bookshop's own-affiliate injection has
 * been removed — MUGA never inserts its own affiliate tag anymore. TS-12
 * below now pins "no injection occurs" instead of "injection occurs after
 * the strip pass". TS-11 (tracking-param ordering) is unaffected, since
 * recordFrequency only ever observed stripped TRACKING params, never the
 * (now-removed) injection step.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";
import { pathAffiliateRulesFixture } from "./helpers/path-rules-fixture.mjs";

// ── Prefs with the (now inert) injectOwnAffiliate pref left ON, to prove
// it no longer has any effect on the pipeline.
const PREFS_INJECT = {
  enabled: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
};

// ── A bookshop.org product page that used to qualify for injection:
//    - hostname = bookshop.org
//    - pathname starts with /p/
//    - no existing ?affiliate param
const BOOKSHOP_URL = "https://bookshop.org/p/books/some-title/123456?utm_source=newsletter";

/**
 * Makes a tracker spy that records:
 *  - the exact URL search string at the time of each observe() call
 *  - the param names and values observed
 *
 * Because processUrl passes `hostname`, `names[]`, `values[]` to
 * recordFrequency (which calls tracker.observe per name), we capture the
 * call order relative to the injection step.
 */
function _makeOrderSpy(url) {
  const calls = [];
  return {
    observe(domain, name, value) {
      // Capture the url's current search string AT call time
      calls.push({ domain, name, value, searchAtCallTime: url.search });
      return Promise.resolve();
    },
    calls,
  };
}

describe("TS-11 — recordFrequency fires after Bookshop injection (Site B ordering)", () => {
  test("observe() is called exactly once for main path on a single-param URL with injection", () => {
    const tracker = {
      callCount: 0,
      observedNames: [],
      observe(domain, name, _value) {
        this.callCount++;
        this.observedNames.push(name);
        return Promise.resolve();
      },
    };

    processUrl(BOOKSHOP_URL, PREFS_INJECT, [], undefined, tracker, undefined, [], pathAffiliateRulesFixture);

    // recordFrequency is called once (Site B). Site A is only for whitelist-domain path.
    assert.equal(tracker.callCount, 1, "observe must be called exactly once on main path");
    assert.ok(tracker.observedNames.includes("utm_source"), "observe must record utm_source");
  });

  test("TS-12 — Bookshop: no affiliate is injected (injection removed), tracking still stripped", () => {
    const tracker = {
      observe() { return Promise.resolve(); },
    };

    const result = processUrl(BOOKSHOP_URL, PREFS_INJECT, [], undefined, tracker, undefined, [], pathAffiliateRulesFixture);

    assert.notEqual(result.action, "injected", "MUGA never inserts its own affiliate tag anymore");
    assert.equal(result.action, "cleaned", "utm_source is still stripped");
    assert.ok(!result.cleanUrl.includes("affiliate="), "no affiliate param must ever be added");
    assert.equal(result.creatorReferralPreserved, false, "creatorReferralPreserved must be false for /p/ path");
  });

  test("recordFrequency is NOT called on a URL with no stripped params and no injection", () => {
    const prefs = { ...PREFS_INJECT, injectOwnAffiliate: false };
    const tracker = {
      callCount: 0,
      observe() {
        this.callCount++;
        return Promise.resolve();
      },
    };

    // A URL with no tracking params on a non-bookshop domain
    processUrl("https://example.com/page", prefs, [], undefined, tracker, undefined);

    // recordFrequency no-ops when names array is empty (see recordFrequency guard)
    assert.equal(tracker.callCount, 0, "observe must not be called when nothing was stripped");
  });

  test("creatorReferralPreserved is true for Bookshop /a/{id}/ paths", () => {
    // A /a/{id}/ path is a creator referral — injection must NOT fire
    const result = processUrl(
      "https://bookshop.org/a/creator123/https://bookshop.org/p/books/title/123",
      PREFS_INJECT,
      [],
      undefined,
      undefined,
      undefined,
      [],
      pathAffiliateRulesFixture,
    );

    assert.equal(result.creatorReferralPreserved, true, "creatorReferralPreserved must be true for /a/ path");
    assert.notEqual(result.action, "injected", "injection must not fire on creator referral paths");
  });
});
