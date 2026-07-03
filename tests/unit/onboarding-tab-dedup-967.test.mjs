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
 * service-worker.js is browser-only (top-level chrome.*), so we pin the wiring
 * via source inspection AND exercise the extracted openOnboardingOnce against a
 * fake chrome, the established pattern for this module.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const SW_SOURCE = readFileSync(resolve(root, "src/background/service-worker.js"), "utf8");

/** Extracts a top-level `async function <name>(...) { ... }` block via brace matching. */
function extractFunctionSource(src, name) {
  const idx = src.indexOf(`async function ${name}`);
  assert.ok(idx !== -1, `${name} must be defined as an async function`);
  let depth = 0;
  let started = false;
  let i = idx;
  for (; i < src.length; i++) {
    if (src[i] === "{") { depth++; started = true; }
    else if (src[i] === "}") {
      depth--;
      if (started && depth === 0) { i++; break; }
    }
  }
  return src.slice(idx, i);
}

/** Builds a callable openOnboardingOnce bound to a fake `chrome`, with fresh module state. */
function buildOpenOnboardingOnce(fakeChrome) {
  const fnSrc = extractFunctionSource(SW_SOURCE, "openOnboardingOnce");
  const factory = new Function(
    "chrome",
    `"use strict";
     let _onboardingTabOpened = false;
     const ONBOARDING_TAB_FLAG = "mugaOnboardingTabOpened";
     ${fnSrc}
     return openOnboardingOnce;`,
  );
  return factory(fakeChrome);
}

/** Minimal chrome.storage.local + tabs stub backed by an in-memory store. */
function makeFakeChrome(initialStore = {}) {
  const store = { ...initialStore };
  const calls = { created: 0, lastCreatedUrl: null };
  const fakeChrome = {
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
  return { fakeChrome, store, calls };
}

describe("#967 — onboarding tab dedup survives SW cold starts", () => {

  test("SW defines a persisted ONBOARDING_TAB_FLAG guard", () => {
    assert.ok(
      /const ONBOARDING_TAB_FLAG\s*=\s*"mugaOnboardingTabOpened"/.test(SW_SOURCE),
      "service-worker must define a persisted onboarding-tab flag key",
    );
  });

  test("openOnboardingOnce reads and writes the persisted flag in chrome.storage.local", () => {
    const fnSrc = extractFunctionSource(SW_SOURCE, "openOnboardingOnce");
    assert.ok(fnSrc.includes("chrome.storage.local.get"), "must read the persisted flag");
    assert.ok(fnSrc.includes("chrome.storage.local.set"), "must persist the flag");
    assert.ok(fnSrc.includes("ONBOARDING_TAB_FLAG"), "must key on ONBOARDING_TAB_FLAG");
  });

  test("consent-valid path clears the persisted guard for future re-onboards", () => {
    assert.ok(
      SW_SOURCE.includes("function clearOnboardingTabFlag"),
      "must define clearOnboardingTabFlag",
    );
    // The fallback IIFE's else-branch (consent satisfied) must clear it.
    assert.ok(
      /shouldOpenOnboarding\(prefs\)\)\s*\{\s*await openOnboardingOnce\(\);\s*\}\s*else\s*\{\s*[\s\S]*clearOnboardingTabFlag\(\)/.test(SW_SOURCE),
      "the fallback must clearOnboardingTabFlag when onboarding is not needed",
    );
  });

  // Behavioral: run the real extracted function against a fake chrome.
  test("first call opens exactly one tab and persists the flag", async () => {
    const { fakeChrome, store, calls } = makeFakeChrome();
    const openOnboardingOnce = buildOpenOnboardingOnce(fakeChrome);
    await openOnboardingOnce();
    assert.equal(calls.created, 1, "opens the onboarding tab on first pending call");
    assert.equal(store.mugaOnboardingTabOpened, true, "persists the guard flag");
    assert.ok(calls.lastCreatedUrl.includes("onboarding/onboarding.html"));
  });

  test("a later cold start does NOT reopen when the persisted flag is already set", async () => {
    // Simulate a fresh SW lifetime (fresh module state) where the flag persisted
    // from a previous lifetime is already true.
    const { fakeChrome, calls } = makeFakeChrome({ mugaOnboardingTabOpened: true });
    const openOnboardingOnce = buildOpenOnboardingOnce(fakeChrome);
    await openOnboardingOnce();
    assert.equal(calls.created, 0, "must not spam a new tab across cold starts");
  });

  test("two calls in the same lifetime open only one tab (module-flag guard)", async () => {
    const { fakeChrome, calls } = makeFakeChrome();
    const openOnboardingOnce = buildOpenOnboardingOnce(fakeChrome);
    await openOnboardingOnce();
    await openOnboardingOnce();
    assert.equal(calls.created, 1, "within-lifetime double call opens one tab");
  });
});
