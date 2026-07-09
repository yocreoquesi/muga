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
const ONBOARDING_JS = readFileSync(
  join(__dirname, "../../src/onboarding/onboarding.js"), "utf8"
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

  test("save-error catch restores the gate via updateButton(), not the dead .disabled no-op", () => {
    const catchIdx = ONBOARDING_JS.indexOf('t("ob_save_error"');
    assert.ok(catchIdx !== -1, "error path must exist");
    const tail = ONBOARDING_JS.slice(catchIdx, catchIdx + 500);
    assert.ok(tail.includes("updateButton()"), "catch must re-sync the aria-disabled gate via updateButton()");
    assert.ok(!/startBtn\.disabled\s*=\s*false/.test(tail), "must not use the no-op startBtn.disabled = false");
  });
});

// ---------------------------------------------------------------------------
// #888 — onboarding must source sync-get fallbacks from PREF_DEFAULTS, not a
// hardcoded `false`. After remoteRulesEnabled flipped to true by default, a
// hardcoded false fallback would hide the per-device confirmation section on
// fresh installs even though the effective default is on.
// ---------------------------------------------------------------------------
describe("#888 — onboarding sync-get fallback comes from PREF_DEFAULTS", () => {
  test("onboarding.js imports PREF_DEFAULTS", () => {
    assert.ok(
      /import\s*\{[^}]*\bPREF_DEFAULTS\b[^}]*\}\s*from\s*["']\.\.\/lib\/prefs\.js["']/.test(ONBOARDING_JS),
      "onboarding.js must import PREF_DEFAULTS from ../lib/prefs.js"
    );
  });

  test("the storage.sync.get fallback uses PREF_DEFAULTS for both guarded prefs", () => {
    assert.ok(
      ONBOARDING_JS.includes("remoteRulesEnabled: PREF_DEFAULTS.remoteRulesEnabled"),
      "remoteRulesEnabled fallback must read PREF_DEFAULTS.remoteRulesEnabled"
    );
    assert.ok(
      ONBOARDING_JS.includes("injectOwnAffiliate: PREF_DEFAULTS.injectOwnAffiliate"),
      "injectOwnAffiliate fallback must read PREF_DEFAULTS.injectOwnAffiliate"
    );
  });

  test("no hardcoded remoteRulesEnabled: false fallback remains", () => {
    assert.ok(
      !/remoteRulesEnabled:\s*false/.test(ONBOARDING_JS),
      "onboarding.js must not hardcode remoteRulesEnabled: false as a sync-get fallback"
    );
  });
});

describe("#728 item 25 — gated-CTA flash + aria-live announcement", () => {
  const ONBOARDING_HTML = readFileSync(
    join(__dirname, "../../src/onboarding/onboarding.html"),
    "utf8",
  );

  test("flashTosGate exists and re-triggers the flash animation", () => {
    const fnIdx = ONBOARDING_JS.indexOf("function flashTosGate(");
    assert.ok(fnIdx !== -1, "flashTosGate must exist in onboarding.js");
    const body = ONBOARDING_JS.slice(fnIdx, fnIdx + 700);
    assert.ok(
      /classList\.remove\(\s*["']is-flashing["']\s*\)/.test(body),
      "flashTosGate must remove is-flashing to reset the animation",
    );
    assert.ok(
      /void\s+tosLabel\.offsetWidth/.test(body),
      "flashTosGate must force a reflow so the flash re-triggers on consecutive clicks",
    );
    assert.ok(
      /classList\.add\(\s*["']is-flashing["']\s*\)/.test(body),
      "flashTosGate must add is-flashing to flash the gate",
    );
  });

  test("flashTosGate re-writes #cta-gated-msg on a tick so aria-live re-announces", () => {
    const fnIdx = ONBOARDING_JS.indexOf("function flashTosGate(");
    const body = ONBOARDING_JS.slice(fnIdx, fnIdx + 700);
    assert.ok(
      /ctaGatedMsg\.textContent\s*=\s*""/.test(body),
      "flashTosGate must clear #cta-gated-msg first",
    );
    assert.ok(
      /setTimeout\([\s\S]{0,160}ctaGatedMsg\.textContent\s*=\s*t\(\s*["']ob_cta_gated_msg["']/.test(body),
      "flashTosGate must re-write the gated message on a tick so a live region announces even when the text is unchanged",
    );
  });

  test("#cta-gated-msg is an aria-live region in onboarding.html", () => {
    const tagMatch = ONBOARDING_HTML.match(/<p[^>]+id="cta-gated-msg"[^>]*>/);
    assert.ok(tagMatch, "#cta-gated-msg must exist as a <p>");
    assert.ok(
      /aria-live="polite"/.test(tagMatch[0]),
      "#cta-gated-msg must be an aria-live=polite region for screen-reader announcement",
    );
  });

  test("the start button's gated path triggers flashTosGate when ToS is unchecked", () => {
    assert.ok(
      /if\s*\(\s*!tosCheck\.checked\s*\)\s*\{[\s\S]{0,80}flashTosGate\(\)/.test(ONBOARDING_JS),
      "an unchecked ToS on start-click must trigger flashTosGate()",
    );
  });
});

// ---------------------------------------------------------------------------
// audit #1038 — re-onboard must honor the per-device override and must NOT
// re-sync injectOwnAffiliate to shared sync.
//
// The affiliate checkbox was defaulted from the raw synced value, ignoring an
// existing per-device override (#364), and the completion write pushed the
// checkbox value back to chrome.storage.sync unconditionally. On a re-onboard
// that both misrepresented THIS device's effective state and clobbered another
// device's setting the user never touched. injectOwnAffiliate is a guarded
// per-device pref: only a FRESH install establishes its synced value (#1032);
// any re-onboard change must be recorded as a per-device override.
// ---------------------------------------------------------------------------
describe("#1038 — re-onboard honors per-device affiliate override, no sync clobber", () => {
  test("the affiliate checkbox defaults from the effective (override-aware) value", () => {
    assert.ok(
      /existingOverrides\s*,\s*["']injectOwnAffiliate["']/.test(ONBOARDING_JS),
      "onboarding must read injectOwnAffiliate from existingOverrides for the effective value",
    );
    assert.ok(
      /affiliateCheck\.checked\s*=\s*effectiveAffiliate/.test(ONBOARDING_JS),
      "the affiliate checkbox must be initialized from the effective (override-aware) value, not raw sync",
    );
  });

  test("injectOwnAffiliate is written to SYNC only on a fresh install", () => {
    assert.ok(
      /mode\s*===\s*["']fresh["'][\s\S]{0,160}syncWrites\.injectOwnAffiliate\s*=/.test(ONBOARDING_JS),
      "the sync write of injectOwnAffiliate must be gated behind mode === 'fresh'",
    );
  });

  test("a re-onboard change is recorded as a per-device override, not a sync write", () => {
    assert.ok(
      /overrideUpdates\.injectOwnAffiliate\s*=\s*affiliateCheck\.checked/.test(ONBOARDING_JS),
      "a re-onboard change to injectOwnAffiliate must be recorded as a per-device override",
    );
  });
});
