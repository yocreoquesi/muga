/**
 * MUGA — #967: the onboarding tab must open at most once while consent is
 * pending, surviving MV3 service-worker cold starts.
 *
 * Before this fix the dedup guard was a module-level `_onboardingTabOpened`
 * boolean. MV3 evicts the service worker after ~30s idle and re-executes the
 * whole module on the next event, resetting the flag to false — so the
 * background-load fallback IIFE reopened a fresh onboarding tab on every wake
 * while onboarding was incomplete.
 *
 * The fix adds a persisted chrome.storage.local guard (ONBOARDING_TAB_FLAG)
 * that survives cold starts, cleared once consent is valid so a later ToS
 * re-onboard can surface the tab again.
 *
 * `openOnboardingOnce` / `clearOnboardingTabFlag` / `shouldOpenOnboarding`
 * moved to `src/background/onboarding-gate.js` (#1266 item 5, slice 3),
 * which is importable in Node. Before that move this file extracted the
 * function body out of service-worker.js by string search and brace
 * matching, then `new Function(...)`-evaluated it against a hand-rolled
 * `_onboardingTabOpened` / `ONBOARDING_TAB_FLAG` pair it re-declared itself —
 * a reimplementation with no structural tie to the source it claimed to
 * prove. Below imports and exercises the REAL functions instead. The one
 * remaining source-text assertion pins the composition-root WIRING in
 * service-worker.js (which if/else branch calls which function) — that
 * stays there by design (#1266), so it stays a source check.
 */

import { test, describe, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  openOnboardingOnce,
  clearOnboardingTabFlag,
  shouldOpenOnboarding,
} from "../../src/background/onboarding-gate.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const SW_SOURCE = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");

/** Minimal chrome.storage.local + tabs stub backed by an in-memory store. */
function makeFakeChrome(initialStore = {}) {
  const store = { ...initialStore };
  const calls = { created: 0, lastCreatedUrl: null };
  globalThis.chrome = {
    storage: {
      local: {
        get: (defaults, cb) => cb({ ...defaults, ...store }),
        set: (obj, cb) => { Object.assign(store, obj); cb && cb(); },
        remove: (key, cb) => { delete store[key]; cb && cb(); },
      },
    },
    tabs: {
      create: ({ url }) => { calls.created++; calls.lastCreatedUrl = url; },
    },
    runtime: { getURL: (p) => p, lastError: null },
  };
  return { store, calls };
}

// _onboardingTabOpened is module-scope state in onboarding-gate.js — one
// check per "SW lifetime" in production. Reset it before every test so each
// one starts from a known fresh-lifetime state, the same way a real SW
// restart would (clearOnboardingTabFlag() is itself under test below, so
// using it here is exercising real code, not a test-only backdoor).
beforeEach(() => {
  makeFakeChrome();
  clearOnboardingTabFlag();
});

describe("#967 — onboarding tab dedup survives SW cold starts", () => {
  test("consent-valid path clears the persisted guard for future re-onboards", () => {
    assert.ok(
      SW_SOURCE.includes('from "./onboarding-gate.js"'),
      "service-worker must import the onboarding-gate module",
    );
    // The fallback IIFE's else-branch (consent satisfied) must clear it.
    assert.ok(
      /shouldOpenOnboarding\(prefs\)\)\s*\{\s*await openOnboardingOnce\(\);\s*\}\s*else\s*\{\s*[\s\S]*clearOnboardingTabFlag\(\)/.test(SW_SOURCE),
      "the fallback must clearOnboardingTabFlag when onboarding is not needed",
    );
  });

  test("first call opens exactly one tab and persists the flag", async () => {
    const { store, calls } = makeFakeChrome();
    await openOnboardingOnce();
    assert.equal(calls.created, 1, "opens the onboarding tab on first pending call");
    assert.equal(store.mugaOnboardingTabOpened, true, "persists the guard flag");
    assert.ok(calls.lastCreatedUrl.includes("onboarding/onboarding.html"));
  });

  test("a later cold start does NOT reopen when the persisted flag is already set", async () => {
    // Simulate a fresh SW lifetime (beforeEach already reset the module flag)
    // where the flag persisted from a previous lifetime is already true.
    const { calls } = makeFakeChrome({ mugaOnboardingTabOpened: true });
    await openOnboardingOnce();
    assert.equal(calls.created, 0, "must not spam a new tab across cold starts");
  });

  test("two calls in the same lifetime open only one tab (module-flag guard)", async () => {
    const { calls } = makeFakeChrome();
    await openOnboardingOnce();
    await openOnboardingOnce();
    assert.equal(calls.created, 1, "within-lifetime double call opens one tab");
  });
});

describe("clearOnboardingTabFlag — real behavior, not just a source-text guard", () => {
  test("removes the persisted flag from chrome.storage.local", () => {
    const { store } = makeFakeChrome({ mugaOnboardingTabOpened: true });
    clearOnboardingTabFlag();
    assert.strictEqual(store.mugaOnboardingTabOpened, undefined);
  });

  test("resets the module flag so a later call can open a new tab", async () => {
    const { calls: firstCalls } = makeFakeChrome();
    await openOnboardingOnce();
    assert.equal(firstCalls.created, 1);

    clearOnboardingTabFlag();

    // A fresh store (as if the persisted flag was also cleared elsewhere,
    // e.g. by a real re-onboard) plus the reset module flag lets a later
    // call open the tab again.
    const { calls: secondCalls } = makeFakeChrome();
    await openOnboardingOnce();
    assert.equal(secondCalls.created, 1, "after clearOnboardingTabFlag, a later call can open again");
  });
});

describe("shouldOpenOnboarding — pure decision function", () => {
  test("true when onboardingDone is false", () => {
    assert.strictEqual(shouldOpenOnboarding({ onboardingDone: false }), true);
  });

  test("false when onboardingDone is true", () => {
    assert.strictEqual(shouldOpenOnboarding({ onboardingDone: true }), false);
  });

  test("true when onboardingDone is absent (defensive default)", () => {
    assert.strictEqual(shouldOpenOnboarding({}), true);
  });
});
