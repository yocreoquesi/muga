/**
 * E2E: DOM Link Rewriter (#443 / B8)
 *
 * Verifies the MutationObserver-driven `<a href>` rewrite against a real
 * Chromium with the extension loaded. Unit tests cover the pure factory
 * contract; this spec proves the observer is actually INSTALLED in the
 * isolated world, listens for the `muga:history-gate` event the History
 * Defuser publishes, and rewrites both pre-existing AND newly-inserted
 * anchors with tracking-decorated hrefs.
 *
 * Single spec on purpose: persistent-context startup is expensive, and
 * the rewrite behavior is one observable signal — anchors visible in the
 * DOM end up with cleaned hrefs. Splitting into many specs would
 * multiply the cost without adding coverage.
 */

import { test, expect } from "./fixtures.mjs";

const HOST = "muga-test-link-rewriter.invalid";

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
  await new Promise(r => setTimeout(r, 500));
}

async function stubPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <a id="pre" href="https://example.com/p?utm_source=marketing&id=1">pre-existing</a>
        <button id="add-btn">add</button>
        <div id="container"></div>
        <script>
          // Insert a NEW anchor with tracking — verifies subtree:true on
          // a childList mutation. The button click is driven from the
          // test (not at load time) so the observer is guaranteed
          // installed before the mutation fires.
          document.getElementById("add-btn").addEventListener("click", () => {
            const a = document.createElement("a");
            a.id = "post";
            a.href = "https://example.com/q?fbclid=abc&id=2";
            a.textContent = "new";
            document.getElementById("container").appendChild(a);
          });
        </script>
      </body></html>`,
    })
  );
}

test.describe("DOM Link Rewriter (#443)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
  });

  test("rewrites pre-existing AND newly-inserted anchors", async ({ context }) => {
    const page = await context.newPage();
    await stubPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // The rewriter listens for `muga:history-gate` and only starts
    // observing after the gate fires. Wait for the History Defuser's
    // page-world flag — same gate path, so when the wrap is in the
    // page the rewriter is also up.
    await page.waitForFunction(() => window.__mugaHistoryDefused === true, { timeout: 10000 });

    // Pre-existing anchor: the initial-pass rewriteAll should have
    // stripped utm_source, leaving id=1.
    await expect.poll(async () =>
      page.evaluate(() => document.getElementById("pre").getAttribute("href"))
    , { timeout: 5000 }).not.toContain("utm_source");
    const preHref = await page.evaluate(() => document.getElementById("pre").getAttribute("href"));
    expect(preHref).toContain("id=1");

    // Newly-inserted anchor: insert via button, then poll until the
    // observer's microtask has rewritten it.
    await page.locator("#add-btn").click();
    await expect.poll(async () =>
      page.evaluate(() => {
        const el = document.getElementById("post");
        return el ? el.getAttribute("href") : null;
      })
    , { timeout: 5000 }).not.toContain("fbclid");
    const postHref = await page.evaluate(() => document.getElementById("post").getAttribute("href"));
    expect(postHref).toContain("id=2");

    await page.close();
  });
});
