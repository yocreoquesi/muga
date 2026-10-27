/**
 * MUGA: rate nudge gate + active-day counter (#1508)
 *
 * The popup rate nudge used to require 200+ cleaned URLs, a counter Chrome's
 * DNR layer never moves, so it almost never showed. It is now gated on active
 * days. Both halves are pure (or storage-injected) so they run in Node.
 */

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import {
  RATE_NUDGE_MIN_ACTIVE_DAYS,
  RATE_NUDGE_MIN_DAYS_SINCE_FIRST_USE,
  RATE_NUDGE_MAX_SHOWS,
  RATE_NUDGE_MIN_DAYS_BETWEEN_SHOWS,
  toLocalDayIndex,
  planActiveDayUpdate,
  isActiveDayDecision,
  createActiveDayRecorder,
  shouldShowRateNudge,
} from "../../src/lib/rate-nudge.js";

const DAY = 86400000;
// Local-time constructors keep the "same calendar day" cases true in any TZ.
const NOW = new Date(2026, 9, 26, 12, 0, 0).getTime();

function eligible(overrides = {}) {
  return {
    enabled: true,
    onboardingDone: true,
    firstUsed: NOW - 30 * DAY,
    activeDaysCount: 20,
    nudgeDismissed: false,
    nudgeShownCount: 0,
    nudgeLastShown: 0,
    sessionSeen: false,
    ...overrides,
  };
}

// ── Gate ─────────────────────────────────────────────────────────────────────

describe("shouldShowRateNudge", () => {
  test("thresholds match the issue", () => {
    assert.equal(RATE_NUDGE_MIN_ACTIVE_DAYS, 14);
    assert.equal(RATE_NUDGE_MIN_DAYS_SINCE_FIRST_USE, 21);
    assert.equal(RATE_NUDGE_MAX_SHOWS, 2);
    assert.equal(RATE_NUDGE_MIN_DAYS_BETWEEN_SHOWS, 14);
  });

  test("shows when every condition holds", () => {
    assert.equal(shouldShowRateNudge(eligible(), NOW), true);
  });

  test("exactly at both thresholds is enough", () => {
    assert.equal(shouldShowRateNudge(eligible({ activeDaysCount: 14, firstUsed: NOW - 21 * DAY }), NOW), true);
  });

  test("13 active days is not enough", () => {
    assert.equal(shouldShowRateNudge(eligible({ activeDaysCount: 13 }), NOW), false);
  });

  test("20 days since first use is not enough, however many active days", () => {
    assert.equal(shouldShowRateNudge(eligible({ firstUsed: NOW - 20 * DAY, activeDaysCount: 50 }), NOW), false);
  });

  test("a missing or invalid firstUsed never shows", () => {
    assert.equal(shouldShowRateNudge(eligible({ firstUsed: null }), NOW), false);
    assert.equal(shouldShowRateNudge(eligible({ firstUsed: "x" }), NOW), false);
  });

  test("cleaned-URL count plays no part (no urlsCleaned gate)", () => {
    assert.equal(shouldShowRateNudge(eligible({ urlsCleaned: 0 }), NOW), true);
  });

  test("dismissed is permanent", () => {
    assert.equal(shouldShowRateNudge(eligible({ nudgeDismissed: true }), NOW), false);
  });

  test("never more than 2 times ever", () => {
    assert.equal(shouldShowRateNudge(eligible({ nudgeShownCount: 2, nudgeLastShown: NOW - 100 * DAY }), NOW), false);
    assert.equal(shouldShowRateNudge(eligible({ nudgeShownCount: 3, nudgeLastShown: NOW - 100 * DAY }), NOW), false);
  });

  test("second showing needs 14 days since the first", () => {
    assert.equal(shouldShowRateNudge(eligible({ nudgeShownCount: 1, nudgeLastShown: NOW - 13 * DAY }), NOW), false);
    assert.equal(shouldShowRateNudge(eligible({ nudgeShownCount: 1, nudgeLastShown: NOW - 14 * DAY }), NOW), true);
  });

  test("once per popup session", () => {
    assert.equal(shouldShowRateNudge(eligible({ sessionSeen: true }), NOW), false);
  });

  test("paused or pre-onboarding MUGA never asks for a rating", () => {
    assert.equal(shouldShowRateNudge(eligible({ enabled: false }), NOW), false);
    assert.equal(shouldShowRateNudge(eligible({ onboardingDone: false }), NOW), false);
  });
});

// ── Active-day counter ───────────────────────────────────────────────────────

describe("planActiveDayUpdate", () => {
  test("first ever activity counts day 1", () => {
    const patch = planActiveDayUpdate({ activeDaysCount: 0, activeDaysLastDay: null }, NOW);
    assert.deepEqual(patch, { activeDaysCount: 1, activeDaysLastDay: toLocalDayIndex(NOW) });
  });

  test("same calendar day is deduplicated", () => {
    const morning = new Date(2026, 9, 26, 0, 5).getTime();
    const night = new Date(2026, 9, 26, 23, 55).getTime();
    const patch = planActiveDayUpdate({ activeDaysCount: 4, activeDaysLastDay: toLocalDayIndex(morning) }, night);
    assert.equal(patch, null);
  });

  test("a new calendar day increments by exactly one", () => {
    const yesterday = new Date(2026, 9, 25, 23, 55).getTime();
    const patch = planActiveDayUpdate({ activeDaysCount: 4, activeDaysLastDay: toLocalDayIndex(yesterday) }, NOW);
    assert.deepEqual(patch, { activeDaysCount: 5, activeDaysLastDay: toLocalDayIndex(NOW) });
  });

  test("the patch stores only a counter and the last day, never a history", () => {
    const patch = planActiveDayUpdate({ activeDaysCount: 9, activeDaysLastDay: 1 }, NOW);
    assert.deepEqual(Object.keys(patch).sort(), ["activeDaysCount", "activeDaysLastDay"]);
    assert.equal(typeof patch.activeDaysCount, "number");
    assert.equal(typeof patch.activeDaysLastDay, "number");
  });

  test("garbage stored values are treated as a fresh counter", () => {
    const patch = planActiveDayUpdate({ activeDaysCount: "nope", activeDaysLastDay: undefined }, NOW);
    assert.deepEqual(patch, { activeDaysCount: 1, activeDaysLastDay: toLocalDayIndex(NOW) });
  });
});

describe("isActiveDayDecision", () => {
  test("cleaning and unwrap decisions count", () => {
    assert.equal(isActiveDayDecision({ action: "cleaned" }), true);
    assert.equal(isActiveDayDecision({ action: "unwrapped" }), true);
  });

  test("a preserve decision counts even when the URL was left untouched", () => {
    assert.equal(isActiveDayDecision({ action: "untouched", preservedAffiliate: { param: "tag" } }), true);
    assert.equal(isActiveDayDecision({ action: "untouched", creatorReferralPreserved: true }), true);
  });

  test("untouched, error and missing results do not count", () => {
    assert.equal(isActiveDayDecision({ action: "untouched" }), false);
    assert.equal(isActiveDayDecision({ action: "error" }), false);
    assert.equal(isActiveDayDecision({}), false);
    assert.equal(isActiveDayDecision(null), false);
  });
});

describe("createActiveDayRecorder", () => {
  function fakeStore(initial = {}) {
    const data = { activeDaysCount: 0, activeDaysLastDay: null, ...initial };
    const calls = { read: 0, write: 0 };
    return {
      data,
      calls,
      read: async () => { calls.read++; return { ...data }; },
      write: async (patch) => { calls.write++; Object.assign(data, patch); },
    };
  }

  test("concurrent records on the same day count the day once", async () => {
    const store = fakeStore();
    const rec = createActiveDayRecorder({ read: store.read, write: store.write, now: () => NOW });
    await Promise.all([rec.record(), rec.record(), rec.record()]);
    assert.equal(store.data.activeDaysCount, 1);
    assert.equal(store.calls.write, 1);
  });

  test("later records the same day skip storage entirely", async () => {
    const store = fakeStore();
    const rec = createActiveDayRecorder({ read: store.read, write: store.write, now: () => NOW });
    await rec.record();
    await rec.record();
    assert.equal(store.calls.read, 1);
    assert.equal(store.data.activeDaysCount, 1);
  });

  test("a new day increments again", async () => {
    const store = fakeStore();
    let now = NOW;
    const rec = createActiveDayRecorder({ read: store.read, write: store.write, now: () => now });
    await rec.record();
    now = NOW + DAY;
    await rec.record();
    assert.equal(store.data.activeDaysCount, 2);
    assert.equal(store.data.activeDaysLastDay, toLocalDayIndex(NOW + DAY));
  });

  test("a day already counted by another context is not counted twice", async () => {
    const store = fakeStore({ activeDaysCount: 7, activeDaysLastDay: toLocalDayIndex(NOW) });
    const rec = createActiveDayRecorder({ read: store.read, write: store.write, now: () => NOW });
    await rec.record();
    assert.equal(store.data.activeDaysCount, 7);
    assert.equal(store.calls.write, 0);
  });

  test("a storage failure never throws and is retried on the next call", async () => {
    const store = fakeStore();
    let fail = true;
    const rec = createActiveDayRecorder({
      read: async () => { if (fail) throw new Error("boom"); return store.read(); },
      write: store.write,
      now: () => NOW,
    });
    await rec.record();
    assert.equal(store.data.activeDaysCount, 0);
    fail = false;
    await rec.record();
    assert.equal(store.data.activeDaysCount, 1);
  });
});
