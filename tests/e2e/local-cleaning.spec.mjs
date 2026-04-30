/**
 * E2E: Local cleaning paths — click on affiliate-domain link (#409)
 *
 * Verifies the click-interception path introduced by #366: the
 * content-script cleans clicked affiliate-domain URLs locally via
 * `window.__mugaCleaner.processUrl()` — no service-worker round-trip,
 * no 3-second timeout fall-through. This is the critical user-visible
 * proof that local cleaning works end-to-end against a real browser.
 *
 * Scope-limit notes (deferred to follow-up slices):
 *
 *   - Copy-event interception: requires triggering a copy on a text
 *     selection AND reading the clipboard, which needs the
 *     `clipboard-read` permission to be granted to the test origin.
 *     Defer to a copy-specific slice that owns the permission setup.
 *   - Context-menu "Copy clean link": Chromium's contextMenu API is
 *     not directly drivable from Playwright; needs a separate harness.
 *   - Foreign-affiliate toast: the toast injects DOM into the page
 *     world; verifying its content from Playwright requires a
 *     different cross-world bridge. Out of scope here.
 *
 * What this spec proves:
 *   - Click on an affiliate-domain link with tracking params lands on
 *     the cleaned URL (no utm_source).
 *   - The same click works after the service worker has been killed
 *     (proves SW-independence — local cleaning, not 3s fallback).
 *   - Stats counters increment after a successful click+clean (the
 *     fire-and-forget BADGE_AND_STATS message is honored by the SW).
 */

import { test, expect } from "./fixtures.mjs";
import { killServiceWorker } from "./helpers/index.mjs";

const FROM_HOST = "muga-test-from.invalid";
const TO_HOST = "amazon.com";

/**
 * Stubs both the from-page (a fixture HTML page hosting the clickable
 * link) and the to-page (the affiliate destination). The to-page
 * stub captures `route.request().url()` so the test can assert the
 * URL the browser actually requested after MUGA's interception.
 */
async function stubFromAndTo(page, capturedUrls) {
  await page.route(`**://${FROM_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <a id="affiliate-link" href="https://${TO_HOST}/dp/X12345?tag=other-21&utm_source=test&fbclid=abc">Amazon link</a>
      </body></html>`,
    })
  );
  await page.route(`**://${TO_HOST}/**`, (route) => {
    capturedUrls.push(route.request().url());
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><body>amazon stub</body></html>",
    });
  });
}

async function completeOnboarding(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(() =>
    new Promise(resolve => {
      chrome.storage.sync.set({ enabled: true, dnrEnabled: true }, () => {
        chrome.storage.local.set({
          mugaConsent: { onboardingDone: true, consentVersion: "1.0", consentDate: Date.now() },
        }, resolve);
      });
    })
  );
  await page.close();
  // DNR rule propagation has no observable signal after storage.set resolves.
  await new Promise(r => setTimeout(r, 500));
}

async function readStats(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  const stats = await page.evaluate(() =>
    new Promise(resolve =>
      chrome.storage.local.get({ stats: {} }, r => resolve(r.stats || {}))
    )
  );
  await page.close();
  return stats;
}

test.describe("Local cleaning: click path (#409)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
  });

  test("click on affiliate-domain link with tracking params navigates to the cleaned URL", async ({ context }) => {
    const page = await context.newPage();
    const captured = [];
    await stubFromAndTo(page, captured);

    await page.goto(`https://${FROM_HOST}/index.html`);
    await page.locator("#affiliate-link").click();
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toContain(TO_HOST);
    expect(page.url()).not.toContain("utm_source");
    expect(page.url()).not.toContain("fbclid");
    // The third-party affiliate tag was preserved (MUGA never replaces
    // someone else's tag without the user explicitly asking — #353).
    expect(page.url()).toContain("tag=other-21");

    // The destination request that actually hit the wire must also be
    // the cleaned URL. (page.url() reflects the final URL after any
    // browser-level redirect; this guards against a regression where
    // we land on the cleaned URL via a redirect from the dirty one.)
    expect(captured.length).toBeGreaterThan(0);
    const lastRequest = captured[captured.length - 1];
    expect(lastRequest).not.toContain("utm_source");
    expect(lastRequest).not.toContain("fbclid");

    await page.close();
  });

  test("click still cleans synchronously after killing the service worker", async ({ context }) => {
    // Kill the SW first — proves the click path does not depend on a
    // live SW round-trip. With #366, cleaning runs locally inside the
    // content script's bundle.
    await killServiceWorker(context);

    const page = await context.newPage();
    const captured = [];
    await stubFromAndTo(page, captured);

    await page.goto(`https://${FROM_HOST}/index.html`);

    const start = Date.now();
    await page.locator("#affiliate-link").click();
    await page.waitForLoadState("domcontentloaded");
    const elapsed = Date.now() - start;

    expect(page.url()).not.toContain("utm_source");
    expect(page.url()).not.toContain("fbclid");
    // Pre-#366 the path could pause up to 3s waiting on the SW. With
    // local cleaning the click→nav round-trip stays well under 1s.
    expect(elapsed).toBeLessThan(2500);

    await page.close();
  });

  test("stats increment after a successful click+clean (BADGE_AND_STATS fire-and-forget)", async ({ context, extensionId }) => {
    // Baseline before the click.
    const before = await readStats(context, extensionId);
    const beforeUrls = before.urlsCleaned || 0;

    const page = await context.newPage();
    const captured = [];
    await stubFromAndTo(page, captured);

    await page.goto(`https://${FROM_HOST}/index.html`);
    // REASON: getContentPrefs() is async; until _contentPrefs is set,
    // the click bails on !enabled and DNR silently cleans the URL,
    // skipping BADGE_AND_STATS. 800ms covers cold-SW CI variance.
    await page.waitForTimeout(800);
    await page.locator("#affiliate-link").click();
    await page.waitForLoadState("domcontentloaded");

    // The SW batches stats writes through a 50ms flush timer; on CI the
    // round-trip takes longer than locally. Poll for up to 5s.
    let after;
    for (let i = 0; i < 50; i++) {
      after = await readStats(context, extensionId);
      if ((after.urlsCleaned || 0) > beforeUrls) break;
      await new Promise(r => setTimeout(r, 100));
    }
    expect(after.urlsCleaned || 0).toBeGreaterThan(beforeUrls);

    await page.close();
  });
});
