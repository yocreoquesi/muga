/**
 * E2E: SPA reclean on same-document navigation (#951 Layer B)
 *
 * Layer A (#955) fixed DNR + the document_start self-clean, but a
 * same-document SPA navigation (e.g. an on-site banner click that calls
 * `history.pushState`) never hits the network layer, so DNR never sees it,
 * and the document_start self-clean only runs once at page load. This left
 * two independent gaps on Amazon-shaped URLs:
 *   - Path rules ("/ref=..." trailing segment) were never re-applied.
 *   - The domain-scoped "aref" query param (declared per-domain in
 *     domain-rules.json, not in the main-world's hard-coded query subset)
 *     survived a pushState navigation.
 *
 * This spec drives a REAL pushState navigation (not a page.goto network
 * request) against a stubbed Amazon-shaped host and proves the full local
 * pipeline (domain rules + path rules) gets re-applied via the
 * muga:history-committed cross-world signal, and that the reclean does not
 * loop.
 *
 * The unit tests in tests/unit/history-defuser.test.mjs cover the pure
 * processUrl behaviour and the structural wiring; this spec proves the
 * end-to-end wiring actually fires in a real Chromium with the extension
 * loaded.
 *
 * NOTE: like tests/e2e/history-defuser.spec.mjs, this is NOT run as part of
 * `npm test` (unit suite). Run via `npm run test:e2e` or equivalent.
 *
 * DEPENDS ON THE WAR FIX SHIPPED WITH THIS CHANGE: on Chrome MV3 a content
 * script's fetch(chrome.runtime.getURL("rules/*.json")) is attributed to the
 * PAGE's origin and fails with net::ERR_FAILED unless the resource is listed
 * in web_accessible_resources — so getDomainRulesCached()/getPathRulesCached()
 * in content/cleaner.js silently fell back to empty arrays on EVERY
 * content-script execution (not just this reclean path, but also the
 * document_start self-clean, click handler, and copy handler, meaning #955
 * Layer A path-strip was dead at runtime on Chrome). This change adds
 * "rules/domain-rules.json", "rules/path-strip-rules.json", and
 * "rules/path-affiliate-rules.json" to web_accessible_resources in both
 * manifests, which is why the full local pipeline now re-applies at runtime.
 * Empirically confirmed: without the WAR entry this spec times out (/ref=
 * survives); with it, it passes. web_accessible_resources is NOT a permission,
 * so no new install/update permission warning.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "www.amazon.com";

async function completeOnboarding(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(() =>
    new Promise(resolve => {
      chrome.storage.sync.set({ enabled: true }, () => {
        chrome.storage.local.set({
          mugaConsent: { onboardingDone: true, consentVersion: "1.1", consentDate: Date.now() },
        }, () => {
          chrome.storage.sync.set({ onboardingDone: true }, resolve);
        });
      });
    })
  );
  await page.close();
  await waitForDnrPropagation(page);
}

/**
 * Stubs an Amazon-shaped host. The initial load is a clean, simple page
 * (no /dp/ pattern, no query) so the amazon_path_canonical DNR rule and the
 * global tracking-params DNR rule are both no-ops on the FIRST navigation —
 * the interesting behaviour under test is entirely client-side pushState,
 * which never generates a network request DNR could intercept anyway.
 */
async function stubAmazonHost(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <button id="muga-push-btn">on-site banner link</button>
        <script>
          // Count replaceState calls at the page-world level (same world as
          // history-defuser-mainworld.js, since it runs with world: MAIN).
          // Bounds the "no rewrite loop" assertion: a runaway reclean loop
          // would keep calling replaceState indefinitely.
          window.__mugaReplaceCount = 0;
          const _origReplace = history.replaceState.bind(history);
          history.replaceState = function (...args) {
            window.__mugaReplaceCount++;
            return _origReplace(...args);
          };

          // Simulates an on-site banner click driving a client-side router
          // navigation (no network request) to a dirty Amazon product URL:
          // an SEO slug + trailing /ref= path marker, plus the domain-scoped
          // "aref" tracking query param and a functional "th" param.
          document.getElementById("muga-push-btn").addEventListener("click", () => {
            history.pushState({ tag: "muga-test" }, "Product",
              "/Some-Product-Name/dp/B0044R881I/ref=sr_1_1?aref=abc123&th=1");
          });
        </script>
      </body></html>`,
    })
  );
}

test.describe("SPA reclean on pushState (#951 Layer B)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
  });

  test("Amazon-like banner pushState: /ref= and aref are cleaned, no rewrite loop", async ({ context }) => {
    const page = await context.newPage();
    await stubAmazonHost(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the page-world wrap flag set by history-defuser-mainworld.js.
    await page.waitForFunction(() => window.__mugaHistoryDefused === true, { timeout: 10000 });

    await page.locator("#muga-push-btn").click();

    // The full reclean is async (main-world dispatch -> isolated-world
    // muga:history-committed listener -> window.__mugaReclean ->
    // processUrl -> replaceState), unlike the main-world synchronous
    // query-subset strip. Poll until the path segment is gone.
    await page.waitForFunction(
      () => !window.location.pathname.includes("/ref="),
      { timeout: 10000 }
    );

    const finalUrl = await page.evaluate(() => window.location.href);
    const finalPath = await page.evaluate(() => window.location.pathname);
    const finalSearch = await page.evaluate(() => window.location.search);

    // Path rule: the SEO slug + trailing /ref= marker are gone.
    expect(finalPath).not.toContain("/ref=");
    expect(finalPath).toContain("/dp/B0044R881I");
    // Domain-scoped query strip: aref is gone (not in the main-world's
    // hard-coded subset — only reachable via the full domainRules pipeline).
    expect(finalSearch).not.toContain("aref");
    // Functional param preserved.
    expect(finalSearch).toContain("th=1");

    // No rewrite loop: give any further (incorrect) recleans a chance to
    // fire, then assert the replaceState call count stayed bounded. One
    // call cleans the URL; a second may occur if the committed event for
    // our own replaceState round-trips before the loop guard catches it;
    // anything beyond that indicates the guard failed to terminate.
    // REASON: there is no observable "reclean settled" signal to poll for
    // (the whole point is proving nothing further happens) — a short fixed
    // wait is the only way to assert an absence of runaway async activity.
    await page.waitForTimeout(500);
    const replaceCount = await page.evaluate(() => window.__mugaReplaceCount);
    expect(replaceCount).toBeLessThanOrEqual(2);

    // URL stayed stable after settling (no oscillation).
    const settledUrl = await page.evaluate(() => window.location.href);
    expect(settledUrl).toBe(finalUrl);

    await page.close();
  });
});
