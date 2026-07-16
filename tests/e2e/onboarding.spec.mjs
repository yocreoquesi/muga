/**
 * E2E: Onboarding flow
 *
 * Tests the first-run experience: ToS acceptance, affiliate opt-in,
 * and storage persistence.
 */

import { test, expect } from "./fixtures.mjs";

test.describe("Onboarding", () => {
  test("start button is disabled until ToS is accepted", async ({ onboardingPage: page }) => {
    const startBtn = page.locator("#start-btn");
    await expect(startBtn).toBeDisabled();

    // Check ToS
    await page.locator("#tos-check").check();
    await expect(startBtn).toBeEnabled();

    // Uncheck ToS
    await page.locator("#tos-check").uncheck();
    await expect(startBtn).toBeDisabled();
  });

  test("page renders with correct structure", async ({ onboardingPage: page }) => {
    // Logo
    await expect(page.locator(".logo")).toHaveText("MUGA");

    // Feature rows (3 features)
    const features = page.locator(".feature-row");
    await expect(features).toHaveCount(3);

    // ToS checkbox exists
    await expect(page.locator("#tos-check")).toBeVisible();

    // Affiliate checkbox exists
    await expect(page.locator("#affiliate-check")).toBeVisible();

    // Start button exists
    await expect(page.locator("#start-btn")).toBeVisible();
  });

  test("ob_tagline_sub renders the 2.1 denoise-first wording (no 'Fair to creators')", async ({ onboardingPage: page }) => {
    // 2.1 pivot replaced the creator-favouring 2.0 wording ("Fair to creators ·
    // nice to you · honest about both") with a creator-agnostic denoise frame.
    // See ADR-0002 and the original miss flagged in #704. This test guards
    // against a regression that brings the moral-positioning copy back.
    const tagline = page.locator('[data-i18n="ob_tagline_sub"]');
    await expect(tagline).toBeVisible();
    const text = await tagline.textContent();
    expect(text).toContain("Denoise every URL");
    expect(text).toContain("zero telemetry");
    expect(text).not.toContain("Fair to creators");
    expect(text).not.toContain("honest about both");
  });

  test("ob_browser_sync_note paragraph is rendered with the chrome.storage.sync clarification", async ({ onboardingPage: page }) => {
    const syncNote = page.locator(".sync-note");
    await expect(syncNote).toBeVisible();
    // The point of this paragraph is to prevent the misread "MUGA syncs my
    // data": it must explicitly say MUGA doesn't send data anywhere AND that
    // the sync is the browser's, not MUGA's. Both assertions, both load-bearing.
    await expect(syncNote).toContainText("MUGA does not send your data anywhere on its own");
    await expect(syncNote).toContainText("browser feature, not MUGA");
  });

  test("affiliate checkbox is on by default and can be turned off", async ({ onboardingPage: page }) => {
    const affiliateCheck = page.locator("#affiliate-check");
    // #1032: injection is on by default on a fresh install; the onboarding box
    // reflects that and the user can turn it off right here (revertible, with no
    // loss of cleaning or protection).
    await expect(affiliateCheck).toBeChecked();

    // Can turn it off without affecting start button state
    await affiliateCheck.uncheck();
    await expect(affiliateCheck).not.toBeChecked();
    await expect(page.locator("#start-btn")).toBeDisabled(); // still disabled without ToS
  });

  test("completing onboarding saves preferences to storage", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    // Wait for init-complete flag so change listeners are registered before we click
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    // Accept ToS
    await page.locator("#tos-check").check();

    // Opt in to affiliate
    await page.locator("#affiliate-check").check();

    // Click start — this calls window.close(), so the page will close
    await page.locator("#start-btn").click();

    // Wait for the page to close (onboarding calls window.close())
    await page.waitForEvent("close", { timeout: 5000 }).catch(() => {});

    // Verify storage via a different page
    const verifyPage = await context.newPage();
    await verifyPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Consent fields live in chrome.storage.local (#355 / ADR-0001);
    // behavioural prefs continue to live in chrome.storage.sync.
    const { sync, consent } = await verifyPage.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.get(null, (syncPrefs) => {
          chrome.storage.local.get({ mugaConsent: {} }, (local) => {
            resolve({ sync: syncPrefs, consent: local.mugaConsent || {} });
          });
        });
      });
    });

    expect(consent.onboardingDone).toBe(true);
    expect(sync.injectOwnAffiliate).toBe(true);
    expect(consent.consentVersion).toBe("1.2");
    expect(consent.consentDate).toBeGreaterThan(0);

    await verifyPage.close();
  });

  test("ToS and privacy links open in new tabs", async ({ onboardingPage: page }) => {
    const tosLink = page.locator('.tos-check-label a[href*="tos.html"]');
    const privacyLink = page.locator('.tos-check-label a[href*="privacy.html"]');

    await expect(tosLink).toHaveAttribute("target", "_blank");
    await expect(tosLink).toHaveAttribute("rel", /noopener/);
    await expect(privacyLink).toHaveAttribute("target", "_blank");
    await expect(privacyLink).toHaveAttribute("rel", /noopener/);
  });
});
