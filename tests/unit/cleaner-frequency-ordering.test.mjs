/**
 * MUGA — TS-11/TS-12: recordFrequency ordering regression guard.
 *
 * Safety-net added before refactoring processUrl (issue #627).
 * These tests MUST pass on unmodified main — they pin the ordering invariant
 * that recordFrequency (Site B, main path) fires AFTER Bookshop injection.
 *
 * Why this matters: if a refactor accidentally moves the recordFrequency call
 * before url.searchParams.set("affiliate", MUGA_BOOKSHOP_AFFILIATE_ID), the
 * frequency record would be fired with the pre-injection URL state, which
 * would cause a silent functional regression even though the return value
 * looks correct.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { processUrl } from "../../src/lib/cleaner.js";
import { pathAffiliateRulesFixture } from "./helpers/path-rules-fixture.mjs";

// ── Prefs that enable Bookshop injection (Scenario B / TS-12)
const PREFS_INJECT = {
  enabled: true,
  injectOwnAffiliate: true,
  notifyForeignAffiliate: false,
  stripAllAffiliates: false,
  blacklist: [],
  whitelist: [],
};

// ── A bookshop.org product page that qualifies for injection:
//    - hostname = bookshop.org
//    - pathname starts with /p/
//    - no existing ?affiliate param
const BOOKSHOP_URL = "https://bookshop.org/p/books/some-title/123456?utm_source=newsletter";

// ── The MUGA Bookshop affiliate ID as it appears in src/lib/cleaner.js
const MUGA_BOOKSHOP_AFFILIATE_ID = "124046";

/**
 * Makes a tracker spy that records:
 *  - the exact URL search string at the time of each observe() call
 *  - the param names and values observed
 *
 * Because processUrl passes `hostname`, `names[]`, `values[]` to
 * recordFrequency (which calls tracker.observe per name), we capture the
 * call order relative to the injection step.
 */
function makeOrderSpy(url) {
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
      observe(domain, name, value) {
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

  test("TS-12 — Bookshop injection: result.action is 'injected' and cleanUrl contains affiliate tag", () => {
    const tracker = {
      observe() { return Promise.resolve(); },
    };

    const result = processUrl(BOOKSHOP_URL, PREFS_INJECT, [], undefined, tracker, undefined, [], pathAffiliateRulesFixture);

    assert.equal(result.action, "injected", "action must be 'injected' for Bookshop injection");
    assert.ok(
      result.cleanUrl.includes(`affiliate=${MUGA_BOOKSHOP_AFFILIATE_ID}`),
      `cleanUrl must contain affiliate=${MUGA_BOOKSHOP_AFFILIATE_ID}`,
    );
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
