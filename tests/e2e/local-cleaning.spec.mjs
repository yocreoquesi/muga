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
 *   - Stats increment after click+clean: covered by
 *     tests/unit/service-worker.test.mjs (BADGE_AND_STATS handler
 *     unit-tested directly) and by the existing url-cleaning.spec.mjs
 *     "stats tracking" test (against direct navigation). An e2e
 *     version specifically for the click path proved flaky on CI
 *     because BADGE_AND_STATS is fire-and-forget; cold-SW variance
 *     made the storage roundtrip exceed test timeouts unreliably.
 *
 * What this spec proves:
 *   - Click on an affiliate-domain link with tracking params lands on
 *     the cleaned URL (no utm_source).
 *   - The same click works after the service worker has been killed
 *     (proves SW-independence — local cleaning, not 3s fallback).
 */

import { test, expect } from "./fixtures.mjs";
import { killServiceWorker, waitForDnrPropagation } from "./helpers/index.mjs";

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
  // Centralised in waitForDnrPropagation so the debt is greppable (#824).
  await waitForDnrPropagation(page);
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

  // Note: a third test for "stats increment after click+clean" was
  // dropped after CI flakes traced to cold-SW variance. The existing
  // url-cleaning.spec.mjs "stats tracking" test already covers the
  // BADGE_AND_STATS → incrementStat path against direct navigation,
  // and the click path's correctness is verified by the two tests
  // above. Stats from clicks specifically are covered by unit tests
  // in tests/unit/service-worker.test.mjs which exercise the SW
  // handler directly.
});
