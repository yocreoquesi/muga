/**
 * E2E: Redirect unwrap — merged module (#410)
 *
 * Verifies the redirect-unwrap content-script logic from #371: the
 * extension navigates the user directly to the destination of an
 * affiliate-network redirect URL, bypassing the intermediary tracking
 * server entirely. The unit suite covers the matcher logic; this
 * spec proves the navigation in a real browser.
 *
 * Cases: awin1, shareasale, Amazon /sspa/click, Pepper meta-refresh,
 * and a negative (corporate-flow `destination=` is not unwrapped).
 */

import { test, expect } from "./fixtures.mjs";

async function stubHost(page, hostname, body = `<!doctype html><html><body>${hostname} stub</body></html>`) {
  await page.route(`**://${hostname}/**`, (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body })
  );
}

async function ensureUnwrapEnabled(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(() =>
    new Promise(resolve => {
      chrome.storage.sync.set({
        enabled: true,
        unwrapRedirects: true,
        onboardingDone: true,
      }, () => {
        chrome.storage.local.set({
          mugaConsent: { onboardingDone: true, consentVersion: "1.0", consentDate: Date.now() },
        }, resolve);
      });
    })
  );
  await page.close();
  // REASON: chrome.storage.set has no observable signal that the SW's
  // prefs cache has refreshed; the next page must read the new prefs
  // from the SW message round-trip. 500ms is the empirical floor.
  await new Promise(r => setTimeout(r, 500));
}

test.describe("Redirect unwrap merged module (#410)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await ensureUnwrapEnabled(context, extensionId);
  });

  test("awin1.com unwrap follows ?ued= to the real destination", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "www.awin1.com");
    await stubHost(page, "destination.test");

    await page.goto("https://www.awin1.com/cread.php?ued=https%3A%2F%2Fdestination.test%2Fproduct%2F1");
    // REASON: the unwrap fires window.location.replace from the content
    // script after DOMContentLoaded; we must wait for the resulting
    // navigation to settle before reading page.url().
    await page.waitForURL("https://destination.test/product/1", { timeout: 5000 });

    expect(page.url()).toBe("https://destination.test/product/1");
    await page.close();
  });

  test("shareasale.com unwrap follows ?urllink= to the real destination", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "shareasale.com");
    await stubHost(page, "destination.test");

    await page.goto("https://shareasale.com/r.cfm?b=1&u=2&urllink=https%3A%2F%2Fdestination.test%2Fitem%2F2");
    await page.waitForURL("https://destination.test/item/2", { timeout: 5000 });

    expect(page.url()).toBe("https://destination.test/item/2");
    await page.close();
  });

  test("Amazon /sspa/click unwrap follows ?url= to the real destination", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "www.amazon.com");

    await page.goto("https://www.amazon.com/sspa/click?url=%2Fdp%2FB0XYZ&someparam=1");
    await page.waitForURL("https://www.amazon.com/dp/B0XYZ", { timeout: 5000 });

    expect(page.url()).toBe("https://www.amazon.com/dp/B0XYZ");
    await page.close();
  });

  test("Pepper meta-refresh unwrap follows the digidip url= to the real destination", async ({ context }) => {
    const page = await context.newPage();
    // The Pepper /visit/ page contains a <meta refresh> pointing at
    // a digidip.net intermediary. The intermediary URL embeds the
    // real destination in `?url=`. Unwrap should reach the destination
    // directly without ever loading digidip.net.
    await page.route("**://www.chollometro.com/visit/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><head>
          <meta http-equiv="refresh" content="0;url=https://chollometro.digidip.net/visit?url=https%3A%2F%2Fdestination.test%2Fdeal%2F42">
        </head><body>chollometro</body></html>`,
      })
    );
    await stubHost(page, "destination.test");

    await page.goto("https://www.chollometro.com/visit/category/12345");
    await page.waitForURL("https://destination.test/deal/42", { timeout: 5000 });

    expect(page.url()).toBe("https://destination.test/deal/42");
    await page.close();
  });

  test("negative case: corporate ?destination= param is NOT unwrapped (#158)", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, "internal.test");
    await stubHost(page, "login.test");

    // Path matches the generic /redirect/ pattern, but the param key
    // `destination` is excluded from REDIRECT_PARAMS to avoid breaking
    // SSO/corporate post-login redirect flows.
    await page.goto("https://internal.test/redirect?destination=https%3A%2F%2Flogin.test%2Fauth");
    await page.waitForLoadState("domcontentloaded");
    // REASON: the unwrap-or-not decision is sync-ish from the content
    // script after DOMContentLoaded. A short settle window guards
    // against the unwrap firing slightly later and surprising us.
    await page.waitForTimeout(800);

    // We should still be on the original URL — `destination` is one
    // of the documented exclusions.
    expect(page.url()).toContain("internal.test/redirect");
    expect(page.url()).not.toContain("login.test/auth");
    await page.close();
  });
});
