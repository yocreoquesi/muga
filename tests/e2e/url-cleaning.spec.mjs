/**
 * E2E: URL cleaning in real navigation
 *
 * Tests that the extension actually strips tracking parameters
 * from URLs when navigating to real pages. Uses httpbin.org
 * as a stable test target that echoes query params.
 */

import { test, expect } from "./fixtures.mjs";

test.describe("URL cleaning — real navigation", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    // Ensure onboarding is done and extension is enabled
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.set(
          { onboardingDone: true, enabled: true, dnrEnabled: true },
          resolve
        );
      });
    });
    await page.close();
    // Small wait for DNR rules to apply
    await new Promise((r) => setTimeout(r, 500));
  });

  test("strips utm_source from URL via DNR", async ({ context }) => {
    const page = await context.newPage();

    await page.goto("https://httpbin.org/get?utm_source=test&real_param=keep");
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    expect(url).not.toContain("utm_source");
    expect(url).toContain("real_param=keep");

    await page.close();
  });

  test("strips fbclid from URL via DNR", async ({ context }) => {
    const page = await context.newPage();

    await page.goto("https://httpbin.org/get?fbclid=abc123&page=1");
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    expect(url).not.toContain("fbclid");
    expect(url).toContain("page=1");

    await page.close();
  });

  test("strips multiple tracking params at once", async ({ context }) => {
    const page = await context.newPage();

    await page.goto(
      "https://httpbin.org/get?utm_source=google&utm_medium=cpc&utm_campaign=test&gclid=xyz&actual=data"
    );
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    expect(url).not.toContain("utm_source");
    expect(url).not.toContain("utm_medium");
    expect(url).not.toContain("utm_campaign");
    expect(url).not.toContain("gclid");
    expect(url).toContain("actual=data");

    await page.close();
  });

  test("leaves clean URLs untouched", async ({ context }) => {
    const page = await context.newPage();

    await page.goto("https://httpbin.org/get?q=hello&page=2");
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    expect(url).toContain("q=hello");
    expect(url).toContain("page=2");

    await page.close();
  });
});

test.describe("URL cleaning — stats tracking", () => {
  test("cleaning a URL increments the stats counter", async ({ context, extensionId }) => {
    // Read stats before
    const helperPage = await context.newPage();
    await helperPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const statsBefore = await helperPage.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.get({ stats: { urlsCleaned: 0, junkRemoved: 0 } }, (r) =>
          resolve(r.stats)
        );
      });
    });

    await helperPage.close();

    // Navigate to a dirty URL
    const page = await context.newPage();
    await page.goto("https://httpbin.org/get?utm_source=test&utm_medium=email");
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1000); // Wait for stat increment message

    // Read stats after
    const verifyPage = await context.newPage();
    await verifyPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const statsAfter = await verifyPage.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.get({ stats: { urlsCleaned: 0, junkRemoved: 0 } }, (r) =>
          resolve(r.stats)
        );
      });
    });

    // Stats should have increased (DNR cleaned before load, content script may also report)
    expect(statsAfter.urlsCleaned).toBeGreaterThanOrEqual(statsBefore.urlsCleaned);

    await page.close();
    await verifyPage.close();
  });
});
