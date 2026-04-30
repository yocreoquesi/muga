/**
 * E2E: AMP DNR redirect (#410)
 *
 * Verifies that the static DNR rules under src/rules/amp-redirect.json
 * actually redirect main-frame navigations from AMP wrapper URLs to
 * their canonical equivalents, before any AMP content loads. The
 * unit suite (tests/unit/amp-redirect-dnr.test.mjs) validates the
 * regex shape; this spec proves DNR fires in a real browser.
 */

import { test, expect } from "./fixtures.mjs";

async function stubHost(page, hostname) {
  await page.route(`**://${hostname}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${hostname} stub</body></html>`,
    })
  );
}

test.describe("AMP DNR redirect (#410)", () => {
  test("Google AMP cache redirects to canonical URL", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "example.com");
    await stubHost(page, "www.google.com");

    await page.goto("https://www.google.com/amp/s/example.com/article");
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://example.com/article");
    await page.close();
  });

  test("ampproject.org cache redirects to canonical URL", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "example.com");
    await stubHost(page, "cdn.ampproject.org");

    await page.goto("https://cdn.ampproject.org/c/s/example.com/article");
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://example.com/article");
    await page.close();
  });

  test("amp.* subdomain redirects to bare domain", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "example.com");
    await stubHost(page, "amp.example.com");

    await page.goto("https://amp.example.com/article");
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://example.com/article");
    await page.close();
  });

  test("regular non-AMP URL is NOT redirected", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "example.com");

    await page.goto("https://example.com/article");
    await page.waitForLoadState("domcontentloaded");

    // The URL should land exactly where we asked. The AMP regex must
    // not over-match plain article paths.
    expect(page.url()).toBe("https://example.com/article");
    await page.close();
  });
});
