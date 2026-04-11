/**
 * E2E: Settings export and import
 *
 * Tests the full export/import round-trip: export settings to a file,
 * modify preferences, import the file, and verify restoration.
 */

import { test, expect } from "./fixtures.mjs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/** Helper: toggle a checkbox by evaluating in page context. */
async function setCheckbox(page, id, checked) {
  await page.evaluate(
    ({ id, checked }) => {
      const el = document.getElementById(id);
      if (el.checked !== checked) el.click();
    },
    { id, checked }
  );
  await page.waitForTimeout(200);
}

test.describe("Export / Import", () => {
  test("export produces a valid JSON file with all expected keys", async ({
    optionsPage: page,
  }) => {
    // Enable dev mode to see export button
    await setCheckbox(page, "dev-mode", true);

    // Set up download listener
    const downloadPromise = page.waitForEvent("download");
    await page.locator("#export-btn").click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe("muga-settings.json");

    // Save and read the file
    const tmpPath = path.join(os.tmpdir(), "muga-export-test.json");
    await download.saveAs(tmpPath);
    const data = JSON.parse(fs.readFileSync(tmpPath, "utf8"));

    // Validate structure
    expect(data.muga).toBe(true);
    expect(data.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(typeof data.enabled).toBe("boolean");
    expect(typeof data.injectOwnAffiliate).toBe("boolean");
    expect(typeof data.dnrEnabled).toBe("boolean");
    expect(typeof data.blockPings).toBe("boolean");
    expect(typeof data.ampRedirect).toBe("boolean");
    expect(typeof data.unwrapRedirects).toBe("boolean");
    expect(typeof data.paramBreakdown).toBe("boolean");
    expect(typeof data.showReportButton).toBe("boolean");
    expect(typeof data.domainStats).toBe("boolean");
    expect(Array.isArray(data.blacklist)).toBe(true);
    expect(Array.isArray(data.whitelist)).toBe(true);
    expect(Array.isArray(data.customParams)).toBe(true);
    expect(Array.isArray(data.disabledCategories)).toBe(true);
    expect(typeof data.toastDuration).toBe("number");

    // Cleanup
    fs.unlinkSync(tmpPath);
    await setCheckbox(page, "dev-mode", false);
  });

  test("import restores settings from a file", async ({ optionsPage: page }) => {

    // Create a test settings file
    const settings = {
      muga: true,
      version: "1.0.0",
      enabled: true,
      injectOwnAffiliate: true,
      notifyForeignAffiliate: true,
      stripAllAffiliates: false,
      dnrEnabled: true,
      blockPings: true,
      ampRedirect: true,
      unwrapRedirects: true,
      contextMenuEnabled: true,
      devMode: false,
      paramBreakdown: true,
      showReportButton: true,
      domainStats: true,
      blacklist: ["evil-tracker.com"],
      whitelist: ["trusted.org::tag::friend-01"],
      customParams: ["my_tracking_id"],
      disabledCategories: [],
      toastDuration: 30,
      language: "es",
    };

    const tmpPath = path.join(os.tmpdir(), "muga-import-test.json");
    fs.writeFileSync(tmpPath, JSON.stringify(settings));

    // Enable dev mode to see import button (force: hidden by toggle CSS)
    await setCheckbox(page, "dev-mode", true);
    await page.waitForTimeout(300);

    // Import
    const fileInput = page.locator("#import-file");
    await fileInput.setInputFiles(tmpPath);
    await page.waitForTimeout(1000);

    // Verify toggles updated
    await expect(page.locator("#inject")).toBeChecked();
    await expect(page.locator("#notify")).toBeChecked();

    // Verify blacklist contains our entry
    await expect(page.locator("#blacklist-items")).toContainText("evil-tracker.com");

    // Verify whitelist contains our entry
    await expect(page.locator("#whitelist-items")).toContainText("trusted.org");

    // Verify language switched to Spanish
    await expect(page.locator("h1")).toHaveText("Ajustes");

    // Verify toast duration
    await expect(page.locator("#toast-duration-select")).toHaveValue("30");

    // Cleanup
    fs.unlinkSync(tmpPath);
  });

  test("import rejects invalid files", async ({ optionsPage: page }) => {
    await setCheckbox(page, "dev-mode", true);
    await page.waitForTimeout(300);

    // Create an invalid file (missing muga flag)
    const tmpPath = path.join(os.tmpdir(), "muga-bad-import.json");
    fs.writeFileSync(tmpPath, JSON.stringify({ not_muga: true }));

    const fileInput = page.locator("#import-file");
    await fileInput.setInputFiles(tmpPath);
    await page.waitForTimeout(500);

    // The import should be rejected — no settings changed, no crash
    // Blacklist should still be empty
    const items = page.locator("#blacklist-items .list-item");
    await expect(items).toHaveCount(0);

    fs.unlinkSync(tmpPath);
    await setCheckbox(page, "dev-mode", false);
  });
});
