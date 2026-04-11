/**
 * E2E: Options page
 *
 * Tests settings toggles, blacklist/whitelist management,
 * language switcher, export/import, and dev tools.
 *
 * NOTE: All toggle checkboxes are visually hidden by custom CSS
 * (.toggle input is opacity:0, position:absolute). We use
 * page.evaluate() to toggle them and check their state, or click
 * the parent label.
 */

import { test, expect } from "./fixtures.mjs";

/** Helper: toggle a checkbox by evaluating in page context. */
async function setCheckbox(page, id, checked) {
  await page.evaluate(
    ({ id, checked }) => {
      const el = document.getElementById(id);
      if (el.checked !== checked) {
        el.click();
      }
    },
    { id, checked }
  );
  await page.waitForTimeout(200);
}

test.describe("Options — toggles", () => {
  test("all main toggles render and respond to clicks", async ({ optionsPage: page }) => {
    const toggles = [
      { id: "inject", default: false },
      { id: "notify", default: false },
      { id: "strip-affiliates", default: false },
      { id: "context-menu-toggle", default: true },
    ];

    for (const { id, default: def } of toggles) {
      const el = page.locator(`#${id}`);
      await expect(el).toBeAttached();

      if (def) {
        await expect(el).toBeChecked();
      } else {
        await expect(el).not.toBeChecked();
      }

      // Toggle it
      await setCheckbox(page, id, !def);
      if (def) {
        await expect(el).not.toBeChecked();
      } else {
        await expect(el).toBeChecked();
      }

      // Restore
      await setCheckbox(page, id, def);
    }
  });

  test("toggle changes persist to storage", async ({ optionsPage: page }) => {
    // Enable affiliate injection
    await setCheckbox(page, "inject", true);

    const val = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.get({ injectOwnAffiliate: false }, (r) =>
          resolve(r.injectOwnAffiliate)
        );
      });
    });
    expect(val).toBe(true);

    // Restore
    await setCheckbox(page, "inject", false);
  });
});

test.describe("Options — blacklist", () => {
  test("add and remove a blacklist entry", async ({ optionsPage: page }) => {
    const input = page.locator("#bl-input");
    const addBtn = page.locator("#bl-add-btn");
    const list = page.locator("#blacklist-items");

    // Add
    await input.fill("example.com");
    await addBtn.click();
    await page.waitForTimeout(300);

    // Entry appears in list
    await expect(list).toContainText("example.com");

    // Remove (click the × button)
    const removeBtn = list.locator("button").first();
    await removeBtn.click();
    await page.waitForTimeout(300);

    // Entry is gone
    await expect(list).not.toContainText("example.com");
  });

  test("rejects empty input", async ({ optionsPage: page }) => {
    const input = page.locator("#bl-input");
    const addBtn = page.locator("#bl-add-btn");

    await input.fill("");
    await addBtn.click();

    // No entry added
    const items = page.locator("#blacklist-items .list-item");
    const initialCount = await items.count();
    await addBtn.click();
    await expect(items).toHaveCount(initialCount);
  });
});

test.describe("Options — whitelist", () => {
  test("add and remove a whitelist entry", async ({ optionsPage: page }) => {
    const input = page.locator("#wl-input");
    const addBtn = page.locator("#wl-add-btn");
    const list = page.locator("#whitelist-items");

    await input.fill("mysite.org::tag::partner-01");
    await addBtn.click();
    await page.waitForTimeout(300);

    await expect(list).toContainText("mysite.org");

    const removeBtn = list.locator("button").first();
    await removeBtn.click();
    await page.waitForTimeout(300);

    await expect(list).not.toContainText("mysite.org");
  });
});

test.describe("Options — language", () => {
  test("language selector has 4 options", async ({ optionsPage: page }) => {
    const options = page.locator("#lang-select option");
    await expect(options).toHaveCount(4);
  });

  test("switching language updates UI text", async ({ optionsPage: page }) => {
    const select = page.locator("#lang-select");
    const title = page.locator("h1");

    // Switch to Spanish
    await select.selectOption("es");
    await page.waitForTimeout(500);
    await expect(title).toHaveText("Ajustes");

    // Switch to Portuguese
    await select.selectOption("pt");
    await page.waitForTimeout(500);
    await expect(title).toHaveText("Configurações");

    // Switch to German
    await select.selectOption("de");
    await page.waitForTimeout(500);
    await expect(title).toHaveText("Einstellungen");

    // Back to English
    await select.selectOption("en");
    await page.waitForTimeout(500);
    await expect(title).toHaveText("Settings");
  });
});

test.describe("Options — advanced settings", () => {
  test("dev tools are hidden by default and shown when toggled", async ({ optionsPage: page }) => {
    const devToolsCard = page.locator("#dev-tools-card");
    await expect(devToolsCard).toBeHidden();

    // Enable advanced mode via evaluate (checkbox hidden by CSS)
    await setCheckbox(page, "dev-mode", true);
    await expect(devToolsCard).toBeVisible();

    // Disable again
    await setCheckbox(page, "dev-mode", false);
    await expect(devToolsCard).toBeHidden();
  });

  test("advanced toggles are visible when dev mode is on", async ({ optionsPage: page }) => {
    await setCheckbox(page, "dev-mode", true);

    const advancedToggles = ["dnr-enabled", "block-pings", "amp-redirect", "unwrap-redirects"];
    for (const id of advancedToggles) {
      await expect(page.locator(`#${id}`)).toBeAttached();
      await expect(page.locator(`#${id}`)).toBeChecked();
    }

    await setCheckbox(page, "dev-mode", false);
  });

  test("URL tester produces a clean result", async ({ optionsPage: page }) => {
    await setCheckbox(page, "dev-mode", true);

    const input = page.locator("#dev-url-input");
    const testBtn = page.locator("#dev-url-test-btn");
    const result = page.locator("#dev-url-result");
    const cleanUrl = page.locator("#dev-url-clean");

    await input.scrollIntoViewIfNeeded();
    await input.fill("https://example.com?utm_source=test&utm_medium=email&fbclid=abc123");
    await testBtn.click();
    await page.waitForTimeout(500);

    await expect(result).toBeVisible();
    const text = await cleanUrl.textContent();
    // URL constructor normalizes: example.com -> example.com/
    expect(text).toMatch(/^https:\/\/example\.com\/?$/);

    await setCheckbox(page, "dev-mode", false);
  });
});

test.describe("Options — version", () => {
  test("version number is displayed at the bottom", async ({ optionsPage: page }) => {
    const version = page.locator("#version-number");
    await expect(version).toBeAttached();
    await expect(version).not.toHaveText("", { timeout: 5000 });
    const text = await version.textContent();
    expect(text).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
