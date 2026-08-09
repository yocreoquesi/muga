/**
 * MUGA — Onboarding / Consent Gate Tests
 *
 * browsewrap Phase 1: MUGA moved from a forced "Accept ToS" gate to implicit
 * acceptance on install ("terms available + acceptance by use"). This file
 * now verifies (a) the ~13 individual onboardingDone feature gates that
 * remain as defense-in-depth (service-worker's handleProcessUrl, cleaner.js)
 * still exist, (b) popup/options no longer hard-block on onboardingDone,
 * and (c) only one onboarding tab opens per background lifetime (dedup) —
 * the welcome tab is now informational, not a wall.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const SERVICE_WORKER_SOURCE = readFileSync(
  join(__dirname, "../../src/background/service-worker.js"), "utf8"
);
const POPUP_JS = readFileSync(
  join(__dirname, "../../src/popup/popup.js"), "utf8"
);
const OPTIONS_JS = readFileSync(
  join(__dirname, "../../src/options/options.js"), "utf8"
);
const CLEANER_JS = readFileSync(
  join(__dirname, "../../src/content/cleaner.js"), "utf8"
);
const ONBOARDING_JS = readFileSync(
  join(__dirname, "../../src/onboarding/onboarding.js"), "utf8"
);

// ---------------------------------------------------------------------------
// Consent gate: the ~13 individual onboardingDone feature gates remain as
// defense-in-depth (untouched by browsewrap Phase 1 — an install now writes
// onboardingDone:true immediately, so these gates pass in practice, but they
// still exist as a safety net for an edge case where the implicit-accept
// write somehow failed).
// ---------------------------------------------------------------------------
describe("Consent gate — onboardingDone feature gates (defense-in-depth)", () => {
  // Service worker: handleProcessUrl must return untouched when !onboardingDone
  test("service-worker blocks URL processing when onboardingDone is false", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("!prefs.onboardingDone"),
      "handleProcessUrl must check prefs.onboardingDone"
    );
    // The guard must be in the same conditional as !prefs.enabled
    assert.ok(
      /!prefs\.enabled\s*\|\|\s*!prefs\.onboardingDone/.test(SERVICE_WORKER_SOURCE),
      "onboardingDone guard must be combined with enabled check in handleProcessUrl"
    );
  });

  // Content script: must check onboardingDone for ping blocking
  test("cleaner.js checks onboardingDone before ping blocking", () => {
    assert.ok(
      CLEANER_JS.includes("onboardingDone"),
      "cleaner.js must check onboardingDone pref"
    );
  });
});

// ---------------------------------------------------------------------------
// browsewrap Phase 1 — popup and options no longer hard-block on
// onboardingDone. The consent-gate overlay (popup) and the onboarding
// redirect (options) are gone; both surfaces render normally regardless of
// onboarding state, since a fresh install already recorded implicit consent.
// ---------------------------------------------------------------------------
describe("browsewrap Phase 1 — popup is non-blocking", () => {
  test("popup.js no longer renders a consent-gate overlay", () => {
    assert.ok(
      !POPUP_JS.includes("consent-gate"),
      "popup.js must not render a consent-gate element — the popup is never blocked (Phase 1 browsewrap)"
    );
    assert.ok(
      !/if\s*\(\s*!prefsCheck\.onboardingDone\s*\)/.test(POPUP_JS),
      "popup.js must not gate rendering on !prefsCheck.onboardingDone"
    );
  });
});

describe("browsewrap Phase 1 — options is non-blocking", () => {
  test("options.js no longer redirects to onboarding", () => {
    // Dev-tools keeps a legitimate "Show onboarding" button that opens the
    // page in a NEW tab via chrome.tabs.create — that stays. What must be
    // gone is the init-time consent-gate REDIRECT that replaced the whole
    // page via window.location.href.
    assert.ok(
      !/window\.location\.href\s*=\s*chrome\.runtime\.getURL\(\s*["']onboarding\/onboarding\.html["']\s*\)/.test(OPTIONS_JS),
      "options.js must not redirect (window.location.href) to the onboarding page — Settings is always accessible (Phase 1 browsewrap)"
    );
    assert.ok(
      !OPTIONS_JS.includes("getConsent"),
      "options.js must not import/call getConsent for a consent redirect (the gate was removed)"
    );
  });
});

// ---------------------------------------------------------------------------
// Onboarding dedup: only one tab should open per background lifetime
// ---------------------------------------------------------------------------
describe("Onboarding dedup — prevent double tabs", () => {
  test("service-worker uses openOnboardingOnce() dedup function", () => {
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("_onboardingTabOpened"),
      "service-worker must have _onboardingTabOpened dedup flag"
    );
    assert.ok(
      SERVICE_WORKER_SOURCE.includes("function openOnboardingOnce"),
      "service-worker must define openOnboardingOnce function"
    );
  });

  test("both onInstalled and fallback use openOnboardingOnce (not direct tabs.create)", () => {
    // Find the onInstalled block and fallback block
    const onInstalledIdx = SERVICE_WORKER_SOURCE.indexOf("onInstalled.addListener");
    const fallbackIdx = SERVICE_WORKER_SOURCE.indexOf("Fallback: onInstalled is unreliable");

    // After onInstalled, the next tabs.create for onboarding should be via openOnboardingOnce
    const afterOnInstalled = SERVICE_WORKER_SOURCE.slice(onInstalledIdx, fallbackIdx);
    assert.ok(
      afterOnInstalled.includes("openOnboardingOnce()"),
      "onInstalled handler must call openOnboardingOnce()"
    );
    assert.ok(
      !afterOnInstalled.includes('chrome.tabs.create({ url: chrome.runtime.getURL("onboarding'),
      "onInstalled handler must NOT directly call chrome.tabs.create for onboarding"
    );

    const afterFallback = SERVICE_WORKER_SOURCE.slice(fallbackIdx);
    assert.ok(
      afterFallback.includes("openOnboardingOnce()"),
      "fallback IIFE must call openOnboardingOnce()"
    );
  });
});

// ---------------------------------------------------------------------------
// #741 — consent persistence must be atomic-ish: sync writes first,
// onboardingDone (the gate flag) written LAST so a sync failure can't leave
// the user gated-open after seeing a save error.
// ---------------------------------------------------------------------------
describe("#741 — onboarding consent write ordering", () => {
  test("sync prefs are written and awaited BEFORE setConsent(onboardingDone:true)", () => {
    const allIdx = ONBOARDING_JS.indexOf("await Promise.all(preConsentOps)");
    const consentIdx = ONBOARDING_JS.indexOf("onboardingDone: true");
    assert.ok(allIdx !== -1, "must await the pre-consent ops (sync set + overrides)");
    assert.ok(consentIdx !== -1, "must write onboardingDone: true");
    assert.ok(
      allIdx < consentIdx,
      "setConsent({ onboardingDone: true }) must run AFTER the sync writes resolve"
    );
  });

  test("the pre-consent batch carries the sync write, not setConsent", () => {
    const start = ONBOARDING_JS.indexOf("const preConsentOps");
    const end = ONBOARDING_JS.indexOf("await Promise.all(preConsentOps)");
    assert.ok(start !== -1 && end > start, "preConsentOps batch must exist");
    const batch = ONBOARDING_JS.slice(start, end);
    assert.ok(batch.includes("chrome.storage.sync.set(syncWrites"), "sync write belongs in the pre-consent batch");
    assert.ok(!batch.includes("setConsent("), "setConsent must NOT be in the parallel pre-consent batch");
  });

  test("save-error catch does not use the dead .disabled no-op (Phase 1: no aria-disabled gate to restore)", () => {
    const catchIdx = ONBOARDING_JS.indexOf('t("ob_save_error"');
    assert.ok(catchIdx !== -1, "error path must exist");
    const tail = ONBOARDING_JS.slice(catchIdx, catchIdx + 500);
    assert.ok(!/startBtn\.disabled\s*=\s*false/.test(tail), "must not use the no-op startBtn.disabled = false");
    // Phase 1 browsewrap: the button is never gated, so there is no
    // updateButton()/aria-disabled state left to re-sync on a save error.
    assert.ok(
      !ONBOARDING_JS.includes("function updateButton("),
      "updateButton() must not exist — the Start button is never gated (Phase 1 browsewrap)"
    );
  });
});

// ---------------------------------------------------------------------------
// drop-affiliate-injection (PR 1b) — the #888 sync-get-fallback fix and its
// tests were tied entirely to the guarded-pref confirmation flow (which only
// ever wired injectOwnAffiliate). That whole flow was deleted along with the
// affiliate onboarding step; remoteRulesEnabled has no onboarding UI or
// sync-get fallback to guard here. See the replacement coverage in
// synced-affiliate-pref-guard.test.mjs and per-device-prefs.test.mjs.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// browsewrap Phase 1 — the gated-CTA flash (#728 item 25) was entirely a
// mechanism for signaling "you must check the ToS box before this button
// works". That requirement no longer exists: fresh-install consent is
// implicit and the Start button is never disabled. These tests guard the
// removal — flashTosGate, ob_cta_gated_msg wiring, the tosCheck-gated click
// branch, and the aria-disabled attribute must all be gone.
// ---------------------------------------------------------------------------
describe("browsewrap Phase 1 — onboarding Start button is never gated", () => {
  const ONBOARDING_HTML = readFileSync(
    join(__dirname, "../../src/onboarding/onboarding.html"),
    "utf8",
  );

  test("flashTosGate no longer exists in onboarding.js", () => {
    assert.ok(
      !ONBOARDING_JS.includes("function flashTosGate("),
      "flashTosGate must be removed — there is no ToS gate left to flash"
    );
  });

  test("onboarding.js no longer references ob_cta_gated_msg", () => {
    assert.ok(
      !ONBOARDING_JS.includes("ob_cta_gated_msg"),
      "the gated-CTA message key must no longer be written by onboarding.js"
    );
  });

  test("the start button click handler no longer branches on tosCheck.checked", () => {
    assert.ok(
      !/tosCheck/.test(ONBOARDING_JS),
      "onboarding.js must not reference tosCheck at all — the button is never gated on it"
    );
  });

  test("start-btn has no aria-disabled attribute in onboarding.html", () => {
    const tagMatch = ONBOARDING_HTML.match(/<button[^>]+id="start-btn"[^>]*>/);
    assert.ok(tagMatch, "#start-btn must exist");
    assert.ok(
      !/aria-disabled/.test(tagMatch[0]),
      "#start-btn must not carry aria-disabled — it is never gated (Phase 1 browsewrap)"
    );
  });

  test("onboarding.html no longer contains #cta-gated-msg", () => {
    assert.ok(
      !ONBOARDING_HTML.includes('id="cta-gated-msg"'),
      "#cta-gated-msg must be removed along with flashTosGate"
    );
  });

  test("the Terms and Privacy links stay visible, with nothing to accept", () => {
    assert.ok(ONBOARDING_HTML.includes('href="../privacy/tos.html"'), "the Terms link stays visible");
    assert.ok(ONBOARDING_HTML.includes('href="../privacy/privacy.html"'), "the Privacy link stays visible");
    assert.ok(
      !ONBOARDING_HTML.includes("tos-required-hint"),
      "the 'Required to continue' hint must be removed — it is no longer accurate"
    );
    // Phase 1 left the checkbox in place as informational. That was a
    // half-measure: it recorded no decision and gated nothing, so it implied
    // an acceptance step that did not exist. Acceptance is by use; the markup
    // must not offer anything to tick.
    assert.ok(
      !ONBOARDING_HTML.includes('id="tos-check"'),
      "the dead ToS checkbox must be gone — it gated nothing and implied a decision was being recorded"
    );
    assert.ok(
      !/<input[^>]*type="checkbox"/.test(ONBOARDING_HTML),
      "onboarding must carry no checkbox at all"
    );
  });
});

// ---------------------------------------------------------------------------
// drop-affiliate-injection (PR 1b) — audit #1038's per-device-override
// regression coverage was entirely about the affiliate checkbox and
// injectOwnAffiliate sync/override writes, all removed with the affiliate
// onboarding step.
// ---------------------------------------------------------------------------
describe("drop-affiliate-injection PR 1b — the guarded-pref confirmation cluster is gone", () => {
  test("onboarding.js no longer reads or writes the retired injectOwnAffiliate pref", () => {
    // A historical mention in a doc comment is fine; what must be gone is any
    // live code path that reads or writes the key.
    assert.ok(
      !/\.injectOwnAffiliate\b/.test(ONBOARDING_JS),
      "onboarding.js must not read or write .injectOwnAffiliate anywhere",
    );
  });

  test("onboarding.js no longer imports the guarded-pref confirmation helpers", () => {
    assert.ok(
      !/from\s*["']\.\.\/lib\/synced-affiliate-pref-guard\.js["']/.test(ONBOARDING_JS),
      "onboarding.js must not import from synced-affiliate-pref-guard.js",
    );
    assert.ok(
      !/from\s*["']\.\.\/lib\/per-device-prefs\.js["']/.test(ONBOARDING_JS),
      "onboarding.js must not import from per-device-prefs.js",
    );
  });

  test("no setOverrides call remains reachable in onboarding.js", () => {
    assert.ok(
      !ONBOARDING_JS.includes("setOverrides("),
      "onboarding.js must not call setOverrides — the guarded-pref confirmation step was deleted",
    );
  });

  test("onboarding.html no longer contains the affiliate checkbox or synced-note", () => {
    const ONBOARDING_HTML = readFileSync(
      join(__dirname, "../../src/onboarding/onboarding.html"),
      "utf8",
    );
    assert.ok(!ONBOARDING_HTML.includes('id="affiliate-check"'));
    assert.ok(!ONBOARDING_HTML.includes('id="affiliate-synced-note"'));
    assert.ok(!ONBOARDING_HTML.includes('id="affiliate-label"'));
  });
});

// ---------------------------------------------------------------------------
// drop-cookie-consent (Slice D of 6) — the Cookie Consent Minimizer feature
// bullet in the fresh-onboarding features list is gone, along with the
// runtime it described (removed in Slices A-C).
// ---------------------------------------------------------------------------
describe("drop-cookie-consent Slice D — the cookie-consent feature bullet is gone", () => {
  const ONBOARDING_HTML = readFileSync(
    join(__dirname, "../../src/onboarding/onboarding.html"),
    "utf8",
  );

  test("onboarding.html no longer contains the ob_feat4 cookie-consent bullet", () => {
    assert.ok(!ONBOARDING_HTML.includes('data-i18n="ob_feat4_title"'));
    assert.ok(!ONBOARDING_HTML.includes('data-i18n="ob_feat4_desc"'));
  });

  test("the remaining feature rows (feat1-3, aggressive-privacy) are intact", () => {
    assert.ok(ONBOARDING_HTML.includes('data-i18n="ob_feat1_title"'));
    assert.ok(ONBOARDING_HTML.includes('data-i18n="ob_feat2_title"'));
    assert.ok(ONBOARDING_HTML.includes('data-i18n="ob_feat3_title"'));
    assert.ok(ONBOARDING_HTML.includes('data-i18n="ob_aggressive_privacy_title"'));
  });
});
