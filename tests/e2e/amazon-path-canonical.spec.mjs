/**
 * E2E: Amazon SEO-slug DNR redirect (#903)
 *
 * Verifies that the static DNR rule under
 * src/rules/amazon-path-canonical.json actually redirects main-frame
 * navigations from an Amazon /dp/ product URL carrying an SEO slug to the
 * canonical slug-free URL, before any product page content loads, and that
 * it does not produce a redirect loop (ERR_TOO_MANY_REDIRECTS) once the URL
 * is already canonical. The unit suite
 * (tests/unit/amazon-path-canonical-dnr.test.mjs) validates the regex
 * shape; this spec proves DNR fires in a real (Chrome) browser.
 *
 * Chrome-only: amazon_path_canonical is intentionally absent from
 * manifest.v2.json (see tests/unit/firefox-mv2.test.mjs — Firefox gets
 * slug-stripping via the in-page cleaner instead).
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

test.describe("Amazon path-canonical DNR redirect (#903)", () => {
  test("strips the SEO slug from a /dp/ product URL, preserving locale prefix and query", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "www.amazon.de");

    await page.goto(
      "https://www.amazon.de/-/en/Arcos-Serie-Universal-Kochmesser-Polyoxymethylen/dp/B0044R881I/?th=1"
    );
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://www.amazon.de/-/en/dp/B0044R881I/?th=1");
    await page.close();
  });

  test("strips the SEO slug on a no-locale /dp/ URL, preserving query", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "www.amazon.com");

    await page.goto("https://www.amazon.com/Some-Slug-Here/dp/B0044R881I?psc=1");
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://www.amazon.com/dp/B0044R881I?psc=1");
    await page.close();
  });

  test("already-canonical URL does not redirect loop (ERR_TOO_MANY_REDIRECTS)", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "www.amazon.de");

    let navigationError = null;
    try {
      await page.goto("https://www.amazon.de/-/en/dp/B0044R881I/?th=1");
      await page.waitForLoadState("domcontentloaded");
    } catch (err) {
      navigationError = err;
    }

    expect(navigationError).toBeNull();
    expect(page.url()).toBe("https://www.amazon.de/-/en/dp/B0044R881I/?th=1");
    await page.close();
  });

  test("non-product Amazon pages are NOT redirected", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "www.amazon.com");

    await page.goto("https://www.amazon.com/s?k=knife");
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://www.amazon.com/s?k=knife");
    await page.close();
  });
});
