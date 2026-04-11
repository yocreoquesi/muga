/**
 * E2E: Popup UI
 *
 * Tests the popup page: stats display, enable toggle, URL preview,
 * history, and settings link.
 */

import { test, expect } from "./fixtures.mjs";

test.describe("Popup", () => {
  test("renders with correct structure", async ({ popupPage: page }) => {
    // Logo
    await expect(page.locator("#logo-text")).toHaveText("MUGA");

    // Enable toggle (hidden by custom CSS, check attached)
    await expect(page.locator("#enabled-toggle")).toBeAttached();

    // Stats section — 3 stat values
    await expect(page.locator(".stat-value")).toHaveCount(3);

    // Footer with settings link
    await expect(page.locator("#open-options")).toBeVisible();
  });

  test("enable toggle is checked by default", async ({ popupPage: page }) => {
    await expect(page.locator("#enabled-toggle")).toBeChecked();
  });

  test("disabling toggle persists to storage", async ({ popupPage: page }) => {
    // Wait for popup JS to set the toggle from prefs
    await expect(page.locator("#enabled-toggle")).toBeChecked({ timeout: 5000 });

    // Toggle checkbox hidden by custom CSS — use evaluate + dispatch change
    await page.evaluate(() => {
      const el = document.getElementById("enabled-toggle");
      el.checked = false;
      el.dispatchEvent(new Event("change"));
    });
    await page.waitForTimeout(300);

    // Verify in storage
    const enabled = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.get({ enabled: true }, (r) => resolve(r.enabled));
      });
    });
    expect(enabled).toBe(false);

    // Re-enable
    await page.evaluate(() => {
      const el = document.getElementById("enabled-toggle");
      el.checked = true;
      el.dispatchEvent(new Event("change"));
    });
    await page.waitForTimeout(300);
  });

  test("settings link opens options page", async ({ context, extensionId, popupPage: page }) => {
    const pagePromise = context.waitForEvent("page");
    await page.locator("#open-options").click();
    const optionsPage = await pagePromise;
    await optionsPage.waitForLoadState();

    expect(optionsPage.url()).toContain("options/options.html");
    await optionsPage.close();
  });

  test("history section is hidden when empty", async ({ popupPage: page }) => {
    await expect(page.locator("#history")).toBeHidden();
  });

  test("domain stats section is hidden when empty", async ({ popupPage: page }) => {
    await expect(page.locator("#domain-stats")).toBeHidden();
  });

  test("preview section is hidden on blank popup", async ({ popupPage: page }) => {
    await expect(page.locator("#preview")).toBeHidden();
  });
});
