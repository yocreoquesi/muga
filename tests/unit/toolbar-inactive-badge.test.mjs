/**
 * MUGA — Toolbar inactive badge (toolbar-inactive-badge)
 *
 * Verifies the service-worker-side half of the inactive-badge feature: the
 * "Active-on-tab" computation and the wiring that recomputes/repaints it on
 * navigation commit and on prefs changes.
 *
 * The presenter-side precedence (glyph vs count vs onboarding vs showBadge)
 * is exhaustively covered behaviorally in toolbar-presenter.test.mjs. This
 * file covers what that file cannot: the SERVICE WORKER cannot be imported
 * in Node (it makes top-level chrome.* calls), so:
 *
 *   1. `computeTabActiveState` is re-implemented as a pure function here,
 *      built on the REAL `isSiteFullyExempt` from src/lib/cleaner.js (not a
 *      mirror) — only the enabled/onboardingDone gate is duplicated, and it
 *      is a one-line boolean formula lifted verbatim from the design.
 *   2. A small number of source-string assertions pin that the real
 *      service-worker.js wires the pure logic above into the onUpdated
 *      listener and the storage.onChanged repaint triggers. This file is
 *      independent of the #706 drift-guard baseline in
 *      service-worker-patterns.test.mjs (that guard only counts assertions
 *      in that one file), but keeps the same "prefer behavioral, use
 *      source-text sparingly" discipline.
 *   3. A guard confirming production source never calls `actionApi.setIcon`
 *      (#910 / f6a6e2b regression) — the e2e spec proves this behaviorally
 *      in a real browser (tests/e2e/toolbar-badge.spec.mjs); this is the
 *      static-analysis backstop for environments (like this one) that
 *      cannot launch a browser.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { isSiteFullyExempt } from "../../src/lib/cleaner.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(join(__dirname, "../../src/background/service-worker.js"), "utf8");
const presenterSource = readFileSync(join(__dirname, "../../src/lib/toolbar-presenter.js"), "utf8");

/**
 * Pure re-implementation of service-worker.js#computeTabActiveState.
 * Mirrors the production one-line formula exactly:
 *   prefs.enabled === true && prefs.onboardingDone === true &&
 *   !isSiteFullyExempt(hostname, prefs)
 * DRIFT GUARD: if the real formula changes, update this mirror to match —
 * otherwise these behavioral tests keep passing against a stale formula.
 */
function computeTabActiveState(prefs, hostname) {
  return prefs?.enabled === true && prefs?.onboardingDone === true && !isSiteFullyExempt(hostname, prefs);
}

describe("computeTabActiveState — Active-on-tab formula", () => {
  const BASE = { enabled: true, onboardingDone: true, whitelist: [], blacklist: [] };

  test("active when enabled + onboarded + not exempt", () => {
    assert.equal(computeTabActiveState(BASE, "example.com"), true);
  });

  test("inactive when globally disabled", () => {
    assert.equal(computeTabActiveState({ ...BASE, enabled: false }, "example.com"), false);
  });

  test("inactive when onboarding is not done", () => {
    assert.equal(computeTabActiveState({ ...BASE, onboardingDone: false }, "example.com"), false);
  });

  test("inactive when the site is fully exempt (domain-only whitelist entry)", () => {
    const prefs = { ...BASE, whitelist: ["example.com"] };
    assert.equal(computeTabActiveState(prefs, "example.com"), false);
  });

  test("inactive on a subdomain of a fully-exempt domain (domainMatches semantics)", () => {
    const prefs = { ...BASE, whitelist: ["example.com"] };
    assert.equal(computeTabActiveState(prefs, "www.example.com"), false);
  });

  test("active on an unrelated domain even when another domain is exempt", () => {
    const prefs = { ...BASE, whitelist: ["example.com"] };
    assert.equal(computeTabActiveState(prefs, "other.com"), true);
  });

  test("a param-scoped whitelist entry (domain::param::value) does NOT count as full exemption", () => {
    // isSiteFullyExempt only matches domain-only entries (entry.param must
    // be absent) — a scoped affiliate-tag override must not turn the whole
    // tab inactive.
    const prefs = { ...BASE, whitelist: ["example.com::tag::creator-1"] };
    assert.equal(computeTabActiveState(prefs, "example.com"), true);
  });

  test("fail-safe: missing/malformed prefs never grants an exemption (stays inactive only via enabled/onboardingDone gates)", () => {
    assert.equal(computeTabActiveState(null, "example.com"), false);
    assert.equal(computeTabActiveState(undefined, "example.com"), false);
  });

  test("blacklist entries do not affect Active-on-tab (only whitelist = full exemption)", () => {
    const prefs = { ...BASE, blacklist: ["example.com"] };
    assert.equal(computeTabActiveState(prefs, "example.com"), true);
  });
});

// Structural guards below use the `pattern.test(source)` idiom (regex as
// receiver, full source as argument) rather than `source.slice()/indexOf()`
// substring surgery — a single anchored regex per invariant, no brittle
// manual offsets. This idiom is already established elsewhere in the suite
// (e.g. service-worker-patterns.test.mjs, verify-warnings-regression.test.mjs)
// for exactly this "SW/content-script not importable in Node" situation.
describe("service-worker.js — inactive-badge wiring (structural)", () => {
  test("imports isSiteFullyExempt from cleaner.js", () => {
    assert.ok(
      /import\s*\{[^}]*isSiteFullyExempt[^}]*\}\s*from\s*"\.\.\/lib\/cleaner\.js"/.test(swSource),
      "service worker must import isSiteFullyExempt from ../lib/cleaner.js"
    );
  });

  test("defines computeTabActiveState with the exact Active-on-tab formula", () => {
    assert.ok(
      /function computeTabActiveState\(prefs, hostname\) \{\s*return prefs\?\.enabled === true && prefs\?\.onboardingDone === true && !isSiteFullyExempt\(hostname, prefs\);\s*\}/
        .test(swSource),
      "computeTabActiveState must be exactly: prefs.enabled===true && prefs.onboardingDone===true && !isSiteFullyExempt(hostname, prefs)"
    );
  });

  test("repaintAllTabsActiveState enumerates the live tab list and emits tabActiveStateChanged per tab", () => {
    assert.ok(
      /async function repaintAllTabsActiveState\(prefs\)[\s\S]{0,600}chrome\.tabs\.query[\s\S]{0,700}type:\s*"tabActiveStateChanged"/
        .test(swSource),
      "repaintAllTabsActiveState must enumerate tabs via chrome.tabs.query and emit tabActiveStateChanged per tab"
    );
  });

  test("onUpdated listener emits tabActiveStateChanged AFTER navigationStarted", () => {
    // Order matters (see toolbar-presenter.js module doc): navigationStarted's
    // per-page reset must not clobber the freshly-recomputed active flag.
    assert.ok(
      /chrome\.tabs\.onUpdated\.addListener[\s\S]{0,1500}type:\s*"navigationStarted"[\s\S]{0,800}type:\s*"tabActiveStateChanged"/
        .test(swSource),
      "onUpdated handler must emit navigationStarted before tabActiveStateChanged"
    );
  });

  test("sync storage change listener repaints active-state on enabled/whitelist/blacklist changes", () => {
    assert.ok(
      /if \(changes\.enabled \|\| changes\.whitelist \|\| changes\.blacklist\)\s*\{[^}]*repaintAllTabsActiveState/.test(swSource),
      "sync-area storage listener must call repaintAllTabsActiveState when enabled/whitelist/blacklist change"
    );
  });

  test("local storage change listener repaints active-state on mugaConsent and mugaPerDevicePrefs changes", () => {
    assert.ok(
      /if \(changes\.mugaConsent\)[\s\S]{0,400}repaintAllTabsActiveState/.test(swSource),
      "mugaConsent branch must call repaintAllTabsActiveState"
    );
    assert.ok(
      /if \(changes\.mugaPerDevicePrefs\)[\s\S]{0,400}repaintAllTabsActiveState/.test(swSource),
      "mugaPerDevicePrefs branch must call repaintAllTabsActiveState"
    );
  });

  test("__TEST__emitToolbarEvent threads the `active` field for tabActiveStateChanged", () => {
    assert.ok(
      /inner\.type === "tabActiveStateChanged"/.test(swSource),
      "test harness must special-case tabActiveStateChanged to thread event.active"
    );
  });
});

// ── #910 regression guard: setIcon must never be called (f6a6e2b) ──────────
describe("setIcon guard — static analysis backstop (#910)", () => {
  test("service-worker.js never calls actionApi.setIcon(...) or chrome.action.setIcon(...)", () => {
    assert.ok(
      !/\bactionApi\.setIcon\s*\(/.test(swSource),
      "service-worker.js must never call actionApi.setIcon — see f6a6e2b regression"
    );
    assert.ok(
      !/chrome\.action\.setIcon\s*\(/.test(swSource) && !/chrome\.browserAction\.setIcon\s*\(/.test(swSource),
      "service-worker.js must never call chrome.action.setIcon/browserAction.setIcon directly"
    );
  });

  test("toolbar-presenter.js never calls actionApi.setIcon(...)", () => {
    assert.ok(
      !/\bactionApi\.setIcon\s*\(/.test(presenterSource),
      "toolbar-presenter.js must never call actionApi.setIcon — the badge is a native overlay, not a composited icon"
    );
  });

  test("_testActionCalls counter still tracks setIcon at zero uses (regression sentinel intact)", () => {
    assert.ok(
      /let _testActionCalls = \{ setTitle: 0, setBadgeText: 0, setIcon: 0 \}/.test(swSource),
      "the #910 e2e regression counter must still track setIcon — do not remove or weaken this guard"
    );
  });
});
