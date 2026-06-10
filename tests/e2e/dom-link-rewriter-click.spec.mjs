/**
 * E2E: DOM Link Rewriter Click Interceptor (#450 / B9)
 *
 * Verifies the capture-phase mousedown/click rewrite against a real
 * Chromium with the extension loaded. The fixture page mimics the
 * Twitter / Facebook / LinkedIn pattern: an anchor whose `mousedown`
 * listener re-decorates `event.target.href` AFTER the page has loaded.
 * Without B9, MUGA's MutationObserver (B8) cleans the link on load,
 * but the page's reinjection-on-mousedown beats the click and the user
 * navigates to the dirty URL.
 *
 * Capture-phase listener installed by B9 runs BEFORE the page's bubble
 * mousedown, so the order is:
 *   1. user presses mouse on anchor
 *   2. B9 capture-phase mousedown — re-runs the cleaner (a no-op
 *      because nothing has been re-injected YET)
 *   3. page's bubble-phase mousedown — re-decorates with utm_source
 *   4. user releases mouse → click event
 *   5. B9 capture-phase click — re-runs the cleaner, STRIPS the
 *      reinjected utm_source
 *   6. browser navigates to the cleaned URL
 *
 * Single spec on purpose — same rationale as the B8 E2E.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-link-rewriter-click.invalid";
const TARGET_HOST = "muga-test-link-rewriter-click-target.invalid";

async function completeOnboarding(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(() =>
    new Promise(resolve => {
      chrome.storage.sync.set({ enabled: true }, () => {
        chrome.storage.local.set({
          mugaConsent: { onboardingDone: true, consentVersion: "1.0", consentDate: Date.now() },
        }, () => {
          chrome.storage.sync.set({ onboardingDone: true }, resolve);
        });
      });
    })
  );
  await page.close();
  // Prefs broadcast has no observable signal after storage.set resolves.
  // Centralised in waitForDnrPropagation so the debt is greppable (#824).
  await waitForDnrPropagation(page);
}

async function stubPages(page) {
  // Source page: anchor whose mousedown listener REINJECTS utm_source
  // onto event.target.href. Mirrors the Twitter/Facebook/LinkedIn
  // pattern that B9 exists to defeat.
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <a id="evil" href="https://${TARGET_HOST}/dest">evil link</a>
        <script>
          // The reinjection trick: bubble-phase mousedown rewrites the
          // href just before the click navigates. B9's CAPTURE-phase
          // click listener runs AFTER this bubble-mousedown but BEFORE
          // the navigation kicks off — exactly the gap we close.
          document.getElementById("evil").addEventListener("mousedown", (e) => {
            e.target.href = "https://${TARGET_HOST}/dest?utm_source=evil&id=42";
          });
        </script>
      </body></html>`,
    })
  );
  // Destination page: echoes location.search so the test can assert
  // the user landed on the CLEANED URL.
  await page.route(`**://${TARGET_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <pre id="search"></pre>
        <script>
          document.getElementById("search").textContent = location.search;
        </script>
      </body></html>`,
    })
  );
}

test.describe("DOM Link Rewriter Click (#450)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
  });

  test("capture-phase listener strips utm_source reinjected on mousedown", async ({ context }) => {
    const page = await context.newPage();
    await stubPages(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the gate to open. B9 reuses the History Defuser's gate
    // event — once that flag is set in the page, B9's listeners are up.
    await page.waitForFunction(() => window.__mugaHistoryDefused === true, { timeout: 10000 });

    // Click the anchor — the page's mousedown will reinject utm_source,
    // B9's capture-phase click should strip it before navigation fires.
    await Promise.all([
      page.waitForURL(`**://${TARGET_HOST}/**`, { timeout: 10000 }),
      page.locator("#evil").click(),
    ]);

    // The user must land on the CLEANED URL — utm_source must NOT be in
    // location.search. id=42 (a real param) survives.
    const search = await page.evaluate(() => location.search);
    expect(search).not.toContain("utm_source");
    expect(search).not.toContain("evil");

    await page.close();
  });
});
