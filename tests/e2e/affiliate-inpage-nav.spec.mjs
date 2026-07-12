/**
 * E2E: MUGA must not hijack in-page fragment navigation on affiliate domains.
 *
 * Regression guard for the amazon.es feed-carousel bug. MUGA's affiliate click
 * interceptor (content/cleaner.js) preventDefault+navigate()s clicks bound for
 * affiliate store domains so it can clean/inject. But an in-page control — a
 * carousel arrow `<a href="#">`, a tab, a hash router — is same-document
 * navigation the page handles itself; hijacking it reloads the page instead of
 * advancing the control. The interceptor's old `anchor.href.startsWith("#")`
 * guard never matched because `anchor.href` (the IDL property) resolves "#" to
 * an absolute URL. The fix skips same-document navigation (same
 * origin+path+query, only the fragment differs).
 *
 * These run on a STUBBED www.amazon.com so the interceptor's affiliate-domain
 * branch is exercised in a real Chrome, exactly as it is on the live site — and
 * the same guard protects every other site with hash-based in-page navigation.
 */

import { test, expect } from "./fixtures.mjs";
import { seedStorage, waitForDnrPropagation } from "./helpers/index.mjs";

async function activateOnAffiliateDomain(context, extensionId) {
  // Onboarded + enabled so the click interceptor is armed. Injection OFF to
  // isolate the click behaviour from load-time tag replaceState noise — the
  // interceptor still fires on affiliate domains regardless of injection.
  await seedStorage(context, extensionId, {
    sync: {
      injectOwnAffiliate: false,
      notifyForeignAffiliate: false,
      stripAllAffiliates: false,
      language: "en",
    },
    local: {
      mugaConsent: {
        onboardingDone: true,
        consentVersion: "1.1",
        consentDate: Date.now(),
      },
    },
  });
  await waitForDnrPropagation(context, extensionId);
}

// A minimal hash-router "carousel": clicking the arrow changes the fragment and
// a hashchange handler advances the slide — the exact pattern MUGA was breaking.
async function stubCarousel(page) {
  await page.route("**://www.amazon.com/**", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="current">start</div>
        <a id="next" class="feed-carousel-control" href="#slide2">next</a>
        <a id="prod" href="https://www.amazon.com/dp/B0044R881I?utm_source=x">product</a>
        <script>
          window.addEventListener("hashchange", function () {
            document.getElementById("current").textContent = location.hash || "start";
          });
        </script>
      </body></html>`,
    }),
  );
}

test.describe("Affiliate-domain in-page fragment navigation (carousel regression)", () => {
  test("a carousel arrow <a href='#slide2'> performs the fragment nav — MUGA does not hijack it", async ({ context, extensionId }) => {
    await activateOnAffiliateDomain(context, extensionId);
    const page = await context.newPage();
    await stubCarousel(page);

    await page.goto("https://www.amazon.com/");
    // Sanity: on an affiliate domain, cleanly loaded, no fragment yet.
    expect(await page.evaluate(() => location.hash)).toBe("");

    await page.click("#next");

    // The fragment navigation must have happened. This is the deterministic
    // proof the click was NOT hijacked: if MUGA had preventDefault()'d the
    // affiliate-domain click, the browser would never set the fragment, so
    // location.hash would stay "". The page's own hashchange handler then runs
    // (a reload would reset #current AND drop us off "/"), which we assert to
    // confirm we stayed on the same document.
    await expect
      .poll(() => page.evaluate(() => location.hash), { timeout: 3000 })
      .toBe("#slide2");
    // Same document — no reload/navigate away.
    expect(await page.evaluate(() => location.pathname)).toBe("/");
    // The page's hashchange handler ran (poll to absorb the async handler tick;
    // if MUGA had reloaded the page this would reset to "start" and never reach
    // "#slide2").
    await expect
      .poll(() => page.evaluate(() => document.getElementById("current").textContent), { timeout: 3000 })
      .toBe("#slide2");
  });

  test("a real cross-path affiliate link IS still intercepted and cleaned (guard not over-broadened)", async ({ context, extensionId }) => {
    await activateOnAffiliateDomain(context, extensionId);
    const page = await context.newPage();
    await stubCarousel(page);

    await page.goto("https://www.amazon.com/");
    await page.click("#prod");

    // A genuine navigation to a DIFFERENT path must still be intercepted and
    // cleaned: the tracking param is gone after MUGA rewrites the destination.
    await expect
      .poll(() => page.evaluate(() => location.pathname), { timeout: 5000 })
      .toBe("/dp/B0044R881I");
    expect(await page.evaluate(() => new URL(location.href).searchParams.get("utm_source"))).toBeNull();
  });
});
