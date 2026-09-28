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
import { waitForDnrPropagation } from "./helpers/index.mjs";

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
    // DNR rule propagation has no observable signal after storage.set resolves.
    // Centralised in waitForDnrPropagation so the debt is greppable (#824).
    // Waited on BEFORE closing the page (#1496 review): waitForDnrPropagation's
    // `_page` param is currently unused (see its own doc comment), so passing
    // a closed page happens to be harmless today, but it is still the wrong
    // thing to write — a future implementation that actually polls the page
    // would break silently on a closed one.
    await waitForDnrPropagation(page);
    await page.close();
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

/**
 * #1496: the stats counter is fed by `INCREMENT_STAT`/`BADGE_AND_STATS`
 * messages the CONTENT SCRIPT sends after it does its own cleaning pass.
 * That pass is a practical no-op for a plain top-level navigation on
 * Chrome: `chrome.declarativeNetRequest` strips tracking params at the
 * NETWORK layer, before document_start, so by the time the content script's
 * self-clean runs the URL it sees is already clean and `junkRemoved` is 0 —
 * no message is ever sent (see src/content/cleaner.js's `_hasDNR` comment
 * block and src/background/service-worker.js's `recordNetworkClean`).
 *
 * This used to be masked by a vacuous `toBeGreaterThanOrEqual` assertion,
 * which passes even when nothing was counted. The two tests below replace
 * it with the honest, opposite pair of assertions: a path DNR cannot see
 * (same-document SPA navigation, no network request) DOES increment the
 * counter; a path DNR fully handles (plain top-level navigation) does not,
 * on Chrome — pinned as a documented, known limitation rather than an
 * untested assumption.
 */
test.describe("URL cleaning — stats tracking (#1496)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.set({ onboardingDone: true, enabled: true, dnrEnabled: true }, resolve);
      });
    });
    // Waited on BEFORE closing the page — see the sibling beforeEach above.
    await waitForDnrPropagation(page);
    await page.close();
  });

  /** Reads {urlsCleaned, junkRemoved} from chrome.storage.local via an extension page. */
  async function readStats(context, extensionId) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    const stats = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.get({ stats: { urlsCleaned: 0, junkRemoved: 0 } }, (r) => resolve(r.stats));
      });
    });
    await page.close();
    return stats;
  }

  test("DNR-only direct navigation: DNR strips it at the network layer, and — documenting a known limitation (#1062/#1496) — the stats counter does not see it on Chrome", async ({ context, extensionId }) => {
    const statsBefore = await readStats(context, extensionId);

    // Navigate to a dirty URL — intercepted locally so no network egress.
    // This is exactly the shape DNR handles entirely at the network layer:
    // a plain top-level navigation with tracking params in the query string.
    const page = await context.newPage();
    await page.route("**/httpbin.org/**", (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<html><body>ok</body></html>" })
    );
    await page.goto("https://httpbin.org/get?utm_source=test&utm_medium=email");
    await page.waitForLoadState("domcontentloaded");

    // PRIMARY, non-racy proof: DNR genuinely cleaned this navigation at the
    // network layer. page.url() reflects the post-redirect address once the
    // page has loaded — a real synchronization signal, unlike the wait below.
    const url = page.url();
    expect(url).not.toContain("utm_source");
    expect(url).not.toContain("utm_medium");

    // SECONDARY, best-effort observation: the stats counter does not see this
    // clean (#1062, 2026-07-12: the maintainer decided against
    // webRequest/webNavigation/declarativeNetRequestFeedback, all three of
    // which would close this gap but add the "Read your browsing history"
    // permission warning). There is no positive signal to wait on for
    // "nothing happened" — this is a fixed-wait absence check, which is
    // inherently unable to distinguish "genuinely never happens" from "just
    // hasn't happened yet by the time we looked". Kept anyway, deliberately,
    // because it is the one thing in this suite that would catch a future
    // change silently starting to count this path (worth knowing either
    // way) — but this assertion documents CURRENT behavior, it is not a
    // requirement: if a future fix makes this path count (closing the
    // #1062/#1496 gap), update or delete this assertion rather than treating
    // a newly-passing count as a regression.
    await waitForDnrPropagation(page);
    const statsAfter = await readStats(context, extensionId);
    expect(statsAfter.urlsCleaned).toBe(statsBefore.urlsCleaned);

    await page.close();
  });

  test("a same-document SPA navigation with tracking params DOES increment the stats counter", async ({ context, extensionId }) => {
    const HOST = "muga-test-spa-stats.invalid";
    const page = await context.newPage();
    await page.route(`**://${HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <button id="muga-spa-nav-btn">client-side router link</button>
          <script>
            // clickid is a universal TRACKING_PARAMS entry (affiliates-data.js)
            // that is deliberately NOT in the sync hot-path STRIP subset
            // (hot-path-strip.js) — so the main-world pushState wrap
            // (history-defuser-mainworld.js) leaves it untouched, and only
            // the async full pipeline (muga:history-committed ->
            // isolated-world __mugaReclean -> processUrl -> BADGE_AND_STATS)
            // can remove it. utm_source/utm_medium are in BOTH tables, which
            // would make this test pass even if the async path were broken.
            document.getElementById("muga-spa-nav-btn").addEventListener("click", () => {
              history.pushState({ tag: "muga-test" }, "Page 2",
                "/page2?clickid=spa_test_123&real_param=keep");
            });
          </script>
        </body></html>`,
      })
    );

    const statsBefore = await readStats(context, extensionId);

    await page.goto(`https://${HOST}/index.html`);
    // Wait for the page-world history wrap (history-defuser-mainworld.js,
    // world: MAIN) to be installed before driving the pushState — mirrors
    // tests/e2e/history-defuser-reclean.spec.mjs.
    await page.waitForFunction(() => window.__mugaHistoryDefused === true, { timeout: 10000 });

    await page.locator("#muga-spa-nav-btn").click();

    // pushState never hits the network layer, so DNR cannot see it — only
    // the content script's async reclean pipeline can catch clickid here.
    // That pipeline calls history.replaceState() from the ISOLATED world,
    // which (empirically verified) resolves the browser's own native method
    // rather than any page-world monkey-patch of history.replaceState — so,
    // unlike tests/e2e/history-defuser-reclean.spec.mjs's replaceState-count
    // trick (which only bounds an UPPER limit and is satisfied by zero calls
    // too), there is no page-world-observable signal to poll on here. Use
    // the same fixed-wait convention as the rest of this file instead
    // (waitForDnrPropagation, #824) — empirically the whole reclean
    // completes well under its 500ms budget.
    await waitForDnrPropagation(page);

    const finalSearch = await page.evaluate(() => window.location.search);
    expect(finalSearch).not.toContain("clickid");
    expect(finalSearch).toContain("real_param=keep");

    const statsAfter = await readStats(context, extensionId);

    // Honest assertion (#1496): this path is genuinely counted — it must
    // strictly increase, not just "not decrease".
    expect(statsAfter.urlsCleaned).toBeGreaterThan(statsBefore.urlsCleaned);

    await page.close();
  });
});
