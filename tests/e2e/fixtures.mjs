/**
 * Playwright fixtures for MUGA Chrome extension E2E tests.
 *
 * Provides a persistent browser context with the extension loaded,
 * plus helpers to open popup, options, and onboarding pages.
 *
 * IMPORTANT: The extension redirects to onboarding on first run
 * when onboardingDone is false. Most fixtures complete onboarding
 * automatically to avoid this redirect. The onboardingPage fixture
 * does NOT do this (so it can test the actual onboarding flow).
 */

import { test as base, chromium } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TERMS_VERSION } from "../../src/lib/consent-storage.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionPath = path.resolve(__dirname, "../../src");

/**
 * Completes onboarding by setting storage flags directly,
 * reusing an existing extension page if available.
 * Closes all stale tabs (about:blank, auto-opened onboarding).
 */
async function completeOnboarding(context, extensionId) {
  // Find an existing extension page to run evaluate() on (auto-opened onboarding)
  const extOrigin = `chrome-extension://${extensionId}`;
  let extPage = context.pages().find((p) => p.url().startsWith(extOrigin));

  if (!extPage) {
    extPage = await context.newPage();
    await extPage.goto(`${extOrigin}/onboarding/onboarding.html`);
  }

  // termsVersion is passed as an evaluate ARGUMENT, not closed over: the
  // callback below is serialised and runs inside the page, where Node-scope
  // imports like TERMS_VERSION do not exist.
  await extPage.evaluate((termsVersion) => {
    // Consent fields (onboardingDone, consentVersion, consentDate) live
    // in chrome.storage.local under "mugaConsent" since #355 / ADR-0001.
    // Behavioural prefs stay in chrome.storage.sync. Writing
    // onboardingDone to sync (the pre-#355 location) silently appears to
    // work but no production reader looks there — popup, options, and
    // service-worker all go through getPrefs / getConsent which read
    // from local. Splitting the write here is what guarantees fixtures
    // mirror the real post-acceptance state.
    return new Promise((resolve) => {
      const syncWrite = new Promise((r) =>
        chrome.storage.sync.set(
          {
            notifyForeignAffiliate: false,
            language: "en",
          },
          r
        )
      );
      const localWrite = new Promise((r) =>
        chrome.storage.local.set(
          {
            mugaConsent: {
              onboardingDone: true,
              // Provenance only: the Terms wording this fixtured user was
              // shown. Read from TERMS_VERSION rather than hardcoded, so a
              // Terms bump does not require touching every e2e spec. Nothing
              // gates on it any more — the versioned re-acceptance engine and
              // its soft/hard re-onboard states were removed in ADR-0007.
              consentVersion: termsVersion,
              consentDate: Date.now(),
            },
          },
          r
        )
      );
      Promise.all([syncWrite, localWrite]).then(() => resolve());
    });
  }, TERMS_VERSION);

  // Close auto-opened onboarding tabs (keep about:blank — browser needs ≥1 page)
  for (const p of context.pages()) {
    if (p.url().includes("/onboarding/")) {
      await p.close();
    }
  }
}

/**
 * Barrier: waits until the service worker's install-time implicit-accept
 * write has landed in chrome.storage.local before the caller is allowed
 * to proceed (#1231).
 *
 * WHY this exists: `chrome.runtime.onInstalled` fires with
 * `details.reason === "install"` on every context this fixture launches
 * — `launchPersistentContext("", ...)` gives each test a fresh profile,
 * so every test IS a fresh install in the extension's eyes. That handler
 * calls `recordImplicitAcceptOnInstall()` (src/background/service-worker.js),
 * which writes `mugaConsent` to chrome.storage.local asynchronously, on a
 * schedule the test does not control. A spec's `beforeEach` that clears
 * storage and then seeds its own consent/legacy state does not cancel
 * that in-flight write — if it lands after the clear (or after the
 * spec's own seed), it silently stomps onboardingDone/consentVersion/
 * consentDate underneath the test. A fixed sleep cannot fix this: the
 * write isn't slow, it's unsequenced. So this polls for the write's
 * actual, observable side effect — `mugaConsent` appearing in
 * chrome.storage.local — instead of waiting on a clock.
 *
 * Call this BEFORE a spec's own storage clear/seed, so that clear runs
 * only once the install-time write has already happened and there is
 * nothing left in flight to race it.
 *
 * Takes an ALREADY-OPEN extension page rather than opening (and closing)
 * one of its own. The caller controls the page's lifetime deliberately:
 * an install-time write is itself part of a sequence of service-worker
 * events (onInstalled goes on to call applyDnrState, openOnboardingOnce,
 * several migrations, ...), and opening/closing an extra tab mid-sequence
 * perturbs that timing rather than merely observing it. A barrier that
 * introduces its own page churn to fix a race risks relocating the race
 * instead of closing it — see the full-suite popup.spec.mjs regression
 * this shape caused when the barrier managed its own page.
 *
 * Bounded: if `mugaConsent` never appears within `timeoutMs`, this
 * throws naming what it was waiting for and the last value it actually
 * observed, rather than hanging silently — a real regression here (e.g.
 * recordImplicitAcceptOnInstall stops firing, or stops being called on
 * install) must fail loud, not time out a test suite mysteriously.
 *
 * @param {import('@playwright/test').Page} page - an already-open page
 *   on the extension's origin (chrome-extension://<id>/...). Its
 *   lifecycle is entirely the caller's responsibility — this function
 *   never opens or closes a page.
 * @param {number} [timeoutMs] - defaults to 5000ms.
 * @returns {Promise<object>} the settled mugaConsent record.
 */
export async function waitForInstallSettled(page, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(
      () => new Promise((resolve) =>
        chrome.storage.local.get({ mugaConsent: null }, (r) => resolve(r.mugaConsent))
      )
    );
    if (last !== null) return last;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `waitForInstallSettled: timed out after ${timeoutMs}ms waiting for chrome.storage.local.mugaConsent ` +
    `to be written by the install-time recordImplicitAcceptOnInstall() (service-worker.js). ` +
    `Last observed value: ${JSON.stringify(last)}. If this function has stopped running on install, ` +
    `that is a real regression, not a flake — this barrier existing to protect e2e determinism (#1231) ` +
    `does not mean it is safe to delete when it fails.`
  );
}

export const test = base.extend({
  context: async ({}, use) => {
    const ctx = await chromium.launchPersistentContext("", {
      headless: false,
      args: [
        `--disable-extensions-except=${extensionPath}`,
        `--load-extension=${extensionPath}`,
        "--no-first-run",
        "--disable-search-engine-choice-screen",
      ],
    });
    await use(ctx);
    await ctx.close();
  },

  extensionId: async ({ context }, use) => {
    let sw = context.serviceWorkers()[0];
    if (!sw) {
      sw = await context.waitForEvent("serviceworker", { timeout: 10_000 });
    }
    const id = sw.url().split("/")[2];
    await use(id);
  },

  /** Opens the onboarding page WITHOUT completing onboarding first. */
  onboardingPage: async ({ context, extensionId }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    // onboarding.js init is async (reads stored lang from chrome.storage).
    // Wait for the init-complete flag before yielding — avoids fixture-ready
    // races where test clicks land before change listeners are registered.
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");
    await use(page);
    await page.close();
  },

  /** Opens popup — completes onboarding first to prevent redirect. */
  popupPage: async ({ context, extensionId }, use) => {
    await completeOnboarding(context, extensionId);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await page.waitForLoadState("domcontentloaded");
    await use(page);
    await page.close();
  },

  /** Opens options — completes onboarding first to prevent redirect. */
  optionsPage: async ({ context, extensionId }, use) => {
    await completeOnboarding(context, extensionId);
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await page.waitForLoadState("domcontentloaded");
    // options.js init is async (reads devMode from chrome.storage.local).
    // Wait for the init-complete flag to avoid races where a test click
    // lands before the stored value has been applied to the DOM.
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");
    await use(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
