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

  await extPage.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.sync.set(
        {
          onboardingDone: true,
          consentVersion: "1.0",
          consentDate: Date.now(),
          injectOwnAffiliate: false,
          notifyForeignAffiliate: false,
          language: "en",
        },
        resolve
      );
    });
  });

  // Close auto-opened onboarding tabs (keep about:blank — browser needs ≥1 page)
  for (const p of context.pages()) {
    if (p.url().includes("/onboarding/")) {
      await p.close();
    }
  }
}

export const test = base.extend({
  // eslint-disable-next-line no-empty-pattern
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
    await use(page);
    await page.close();
  },
});

export { expect } from "@playwright/test";
