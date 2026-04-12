/**
 * MUGA — Onboarding / Consent Gate Tests
 *
 * Verifies the extension does not function until the user accepts ToS and
 * that only one onboarding tab opens per background lifetime (dedup).
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, dirname } from "node:path";
import { TRANSLATIONS } from "../../src/lib/i18n.js";

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

// ---------------------------------------------------------------------------
// Consent gate: extension must not function until user accepts ToS
// ---------------------------------------------------------------------------
describe("Consent gate — onboardingDone enforcement", () => {
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

  // Popup: must check onboardingDone and show consent gate
  test("popup.js checks onboardingDone before rendering", () => {
    assert.ok(
      POPUP_JS.includes("onboardingDone"),
      "popup.js must check onboardingDone pref"
    );
    assert.ok(
      POPUP_JS.includes("consent-gate"),
      "popup.js must render a consent-gate element when onboarding not done"
    );
  });

  // Options: must redirect to onboarding when !onboardingDone
  test("options.js redirects to onboarding when consent not given", () => {
    assert.ok(
      OPTIONS_JS.includes("onboardingDone"),
      "options.js must check onboardingDone pref"
    );
    assert.ok(
      OPTIONS_JS.includes("onboarding/onboarding.html"),
      "options.js must redirect to onboarding page"
    );
  });

  // Content script: must check onboardingDone for ping blocking
  test("cleaner.js checks onboardingDone before ping blocking", () => {
    assert.ok(
      CLEANER_JS.includes("onboardingDone"),
      "cleaner.js must check onboardingDone pref"
    );
  });

  // i18n: consent gate strings must exist in both languages
  test("i18n has consent_gate_msg and consent_gate_btn in EN and ES", () => {
    assert.ok(TRANSLATIONS.consent_gate_msg?.en, "consent_gate_msg must have EN translation");
    assert.ok(TRANSLATIONS.consent_gate_msg?.es, "consent_gate_msg must have ES translation");
    assert.ok(TRANSLATIONS.consent_gate_btn?.en, "consent_gate_btn must have EN translation");
    assert.ok(TRANSLATIONS.consent_gate_btn?.es, "consent_gate_btn must have ES translation");
  });

  // Popup CSS: must have consent-gate styles
  test("popup.css includes consent-gate styles", () => {
    const popupCSS = readFileSync(
      join(__dirname, "../../src/popup/popup.css"), "utf8"
    );
    assert.ok(
      popupCSS.includes(".consent-gate"),
      "popup.css must contain .consent-gate class"
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
