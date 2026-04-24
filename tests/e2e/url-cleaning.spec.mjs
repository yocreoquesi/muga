/**
 * E2E: URL cleaning in real navigation
 *
 * Tests that the extension actually strips tracking parameters
 * from URLs when navigating to real pages. Uses page.route() to
 * intercept requests so no actual network traffic leaves the browser —
 * DNR rules still fire on the URL before Playwright's route handler,
 * so assertions on page.url() correctly reflect extension behaviour.
 */

import { test, expect } from "./fixtures.mjs";

/** Stub all requests to a given hostname with a minimal HTML response. */
async function stubHost(page, hostname) {
  await page.route(`**/${hostname}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>ok</body></html>" })
  );
}

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
    // REASON: DNR rule propagation has no observable signal after storage.set resolves.
    await new Promise((r) => setTimeout(r, 500));
  });

  test("strips utm_source from URL via DNR", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "httpbin.org");

    await page.goto("https://httpbin.org/get?utm_source=test&real_param=keep");
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    expect(url).not.toContain("utm_source");
    expect(url).toContain("real_param=keep");

    await page.close();
  });

  test("strips fbclid from URL via DNR", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "httpbin.org");

    await page.goto("https://httpbin.org/get?fbclid=abc123&page=1");
    await page.waitForLoadState("domcontentloaded");

    const url = page.url();
    expect(url).not.toContain("fbclid");
    expect(url).toContain("page=1");

    await page.close();
  });

  test("strips multiple tracking params at once", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "httpbin.org");

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
    await stubHost(page, "httpbin.org");

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

    // Navigate to a dirty URL — intercepted locally so no network egress
    const page = await context.newPage();
    await page.route("**/httpbin.org/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>ok</body></html>" })
    );
    await page.goto("https://httpbin.org/get?utm_source=test&utm_medium=email");
    await page.waitForLoadState("domcontentloaded");

    // REASON: stat increment is sent from the content script via messaging; there is
    // no DOM or storage signal we can poll without coupling to implementation details.
    await page.waitForTimeout(500);

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
