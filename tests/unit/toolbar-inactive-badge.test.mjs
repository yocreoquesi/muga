/**
 * MUGA — Toolbar inactive badge (toolbar-inactive-badge)
 *
 * Verifies the service-worker-side half of the inactive-badge feature: the
 * "Active-on-tab" computation and the wiring that recomputes/repaints it on
 * navigation commit and on prefs changes.
 *
 * The presenter-side precedence (glyph vs count vs onboarding vs showBadge)
 * is exhaustively covered behaviorally in toolbar-presenter.test.mjs.
 *
 * Before #1266 item 5's second slice, `computeTabActiveState` and
 * `repaintAllTabsActiveState` lived in service-worker.js, which cannot be
 * imported in Node (top-level chrome.* calls) — so this file used to carry
 * a hand-written mirror of the formula plus source-text assertions pinning
 * the wiring. Both are now real, imported code:
 *
 *   - `computeTabActiveState` is imported directly from
 *     src/background/toolbar-badge.js and exercised below against its real
 *     behavior — no mirror.
 *   - `repaintAllTabsActiveState`'s tab enumeration and the onUpdated
 *     handler's navigationStarted-before-tabActiveStateChanged ordering are
 *     covered behaviorally in tests/unit/toolbar-badge.test.mjs, against
 *     the real functions with a stubbed tabsApi/bus — including the
 *     #1266 item 2 cold-start repaint proof this file could never write.
 *
 * What remains below is source-text on purpose: the storage.onChanged
 * listener and the `__TEST__emitToolbarEvent` harness case both stay in
 * service-worker.js as the composition root (the module doc in
 * toolbar-badge.js explains why the addListener/listener wiring can't move
 * without re-breaking importability), so there is no real function to
 * import and no behavioral proxy for "the SW calls repaintAllTabsActiveState
 * from this branch." These are the "genuinely still needs the composition
 * root" cases #1266 item 5 anticipates.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { computeTabActiveState } from "../../src/background/toolbar-badge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const swSource = readFileSync(join(__dirname, "../../src/background/service-worker.js"), "utf8");
const presenterSource = readFileSync(join(__dirname, "../../src/lib/toolbar-presenter.js"), "utf8");

describe("computeTabActiveState — Active-on-tab formula (real, imported function)", () => {
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
//
// Only the composition-root wiring remains here — the pure logic these
// branches call (computeTabActiveState, repaintAllTabsActiveState, the
// onUpdated ordering) is covered behaviorally above and in
// tests/unit/toolbar-badge.test.mjs.
describe("service-worker.js — inactive-badge wiring (structural, composition-root only)", () => {
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
