/**
 * E2E: History Defuser (#444 / B10)
 *
 * Verifies the document_start wrap of `history.pushState` /
 * `history.replaceState` against a real Chromium with the extension
 * loaded. The unit tests in tests/unit/history-defuser.test.mjs cover
 * the pure factory contract; this spec proves the wrap is actually
 * INSTALLED early enough that a page-script call to pushState lands a
 * cleaned URL in `window.location`.
 *
 * Why this is structured as one spec, not many: the wrap behaviour is
 * one observable signal (post-pushState `window.location.search` has
 * no tracking params). Splitting it into many specs would multiply the
 * persistent-context startup cost without adding coverage.
 */

import { test, expect } from "./fixtures.mjs";

const HOST = "muga-test-history.invalid";

async function completeOnboarding(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(() =>
    new Promise(resolve => {
      chrome.storage.sync.set({ enabled: true }, () => {
        chrome.storage.local.set({
          mugaConsent: { onboardingDone: true, consentVersion: "1.0", consentDate: Date.now() },
        }, () => {
          // sync.set must include onboardingDone for the prefs cache the
          // content script reads via getPrefs.
          chrome.storage.sync.set({ onboardingDone: true }, resolve);
        });
      });
    })
  );
  await page.close();
  // Allow the prefs broadcast to propagate before the next page loads.
  await new Promise(r => setTimeout(r, 500));
}

async function stubPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <button id="muga-push-btn">push</button>
        <script>
          // Drive the pushState from a button click triggered by the test.
          // The content script's prefs cache is populated asynchronously
          // (chrome.runtime.sendMessage round-trip to the SW), and the
          // disabled-state guard fail-CLOSED until prefs land. Letting the
          // test trigger the click only after the SW has answered the
          // getPrefs message keeps this spec stable. A real SPA's first
          // pushState typically happens inside a router init that runs
          // hundreds of ms after document_start (well after prefs land).
          document.getElementById("muga-push-btn").addEventListener("click", () => {
            history.pushState({ tag: "muga-test" }, "TheTitle",
              "/spa?utm_source=marketing&utm_medium=email&id=42");
            window.__mugaTestState = history.state;
            window.__mugaTestSearch = window.location.search;
          });
        </script>
      </body></html>`,
    })
  );
}

test.describe("History Defuser (#444)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
  });

  /**
   * Security regression for #811: a hostile page script that dispatches
   * `muga:history-gate` with `enabled: false` but WITHOUT the correct
   * nonce must not be able to disarm the defuser.
   *
   * NOTE: This spec is NOT run as part of `npm test` (unit suite). It
   * requires a headed Playwright browser with the extension loaded. Run
   * via `npm run test:e2e` or equivalent when validating the fix live.
   */
  test("hostile page dispatch without nonce cannot disarm the defuser (#811)", async ({ context }) => {
    const page = await context.newPage();
    await stubPage(page);
    await page.goto(`https://${HOST}/index.html`);

    await page.waitForFunction(() => window.__mugaHistoryDefused === true, { timeout: 10000 });

    // Simulate a hostile page script dispatching the gate event without the
    // correct nonce. The detail carries enabled: false but no nonce — the
    // listener must reject it and keep the gate in its current state.
    await page.evaluate(() => {
      document.dispatchEvent(new CustomEvent("muga:history-gate", {
        detail: { enabled: false },
      }));
    });

    // Now perform a pushState with tracking params. If the defuser was
    // wrongly disarmed, the URL would retain the tracking params.
    await page.locator("#muga-push-btn").click();
    await page.waitForFunction(() => typeof window.__mugaTestSearch === "string");

    const search = await page.evaluate(() => window.__mugaTestSearch);
    expect(search).not.toContain("utm_source");
    expect(search).not.toContain("utm_medium");
    expect(search).toContain("id=42");

    await page.close();
  });

  test("pushState with tracking params lands a cleaned URL in window.location", async ({ context }) => {
    const page = await context.newPage();
    await stubPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the page-world wrap flag set by the injected script.
    // The content script reads prefs via SW round-trip and only injects
    // the wrap when prefs.enabled && prefs.onboardingDone. Both are
    // ensured by completeOnboarding above. The flag is set on the page
    // window (not the isolated world) by the injected script body, so
    // page.waitForFunction() can observe it directly.
    await page.waitForFunction(() => window.__mugaHistoryDefused === true, { timeout: 10000 });

    await page.locator("#muga-push-btn").click();
    await page.waitForFunction(() => typeof window.__mugaTestSearch === "string");

    const search = await page.evaluate(() => window.__mugaTestSearch);
    const state = await page.evaluate(() => window.__mugaTestState);
    // Tracking params stripped, business param preserved.
    expect(search).not.toContain("utm_source");
    expect(search).not.toContain("utm_medium");
    expect(search).toContain("id=42");
    // State forwarded verbatim.
    expect(state).toEqual({ tag: "muga-test" });

    await page.close();
  });
});
