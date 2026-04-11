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

  test("affiliate checkbox is optional and unchecked by default", async ({ onboardingPage: page }) => {
    const affiliateCheck = page.locator("#affiliate-check");
    await expect(affiliateCheck).not.toBeChecked();

    // Can check it without affecting start button state
    await affiliateCheck.check();
    await expect(affiliateCheck).toBeChecked();
    await expect(page.locator("#start-btn")).toBeDisabled(); // still disabled without ToS
  });

  test("completing onboarding saves preferences to storage", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);

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

    const prefs = await verifyPage.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.get(null, resolve);
      });
    });

    expect(prefs.onboardingDone).toBe(true);
    expect(prefs.injectOwnAffiliate).toBe(true);
    expect(prefs.consentVersion).toBe("1.0");
    expect(prefs.consentDate).toBeGreaterThan(0);

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
