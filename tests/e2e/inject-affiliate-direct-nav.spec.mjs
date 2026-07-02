/**
 * E2E: direct-navigation affiliate injection on Chrome (#905)
 *
 * Proves — in a real Chrome browser — that a DIRECT navigation (address bar /
 * bookmark / external app) to an Amazon product URL already gets MUGA's own
 * tag injected today, with no new feature code. The content-script self-clean
 * runs on every load (its `!_hasDNR` guard never skips on Chrome, because
 * `chrome.declarativeNetRequest` is not exposed to content scripts) and its
 * `processUrl` Step 6 injects our tag via history.replaceState when
 * `injectOwnAffiliate` is on and the URL carries no tag.
 *
 * These are regression guards for behavior that was previously untested (and
 * widely misunderstood as "skipped on Chrome"): they prove the injection
 * fires, that it does NOT overwrite a creator's existing tag, that it does NOT
 * loop, and — critically — that DNR still strips tracking params on already-
 * tagged URLs. The unit suite pins the processUrl action contract this relies
 * on; this spec proves the end-to-end result in the browser.
 */

import { test, expect } from "./fixtures.mjs";
import { seedStorage, waitForDnrPropagation } from "./helpers/index.mjs";

// OUR_TAGS["amazon-associates"]["amazon.com"] — the tag MUGA injects.
const OUR_TAG = "muga0b-20";

async function enableInjection(context, extensionId) {
  // Accept consent (local, ADR-0001) AND opt into injection (sync). Seeding
  // storage directly bypasses the onboarding/options UI and the per-device
  // confirmation dialog, matching a user who has opted in.
  await seedStorage(context, extensionId, {
    sync: {
      injectOwnAffiliate: true,
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

async function stubHost(page, hostname) {
  await page.route(`**://${hostname}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${hostname} stub</body></html>`,
    }),
  );
}

test.describe("Chrome direct-nav affiliate self-inject (#905)", () => {
  test("injects our tag on an untagged Amazon product URL via replaceState", async ({ context, extensionId }) => {
    await enableInjection(context, extensionId);
    const page = await context.newPage();
    await stubHost(page, "www.amazon.com");

    await page.goto("https://www.amazon.com/dp/B0044R881I");
    // Injection is applied by the content script shortly after load.
    await page.waitForFunction(
      (tag) => new URL(location.href).searchParams.get("tag") !== null && location.href.includes(tag),
      OUR_TAG,
      { timeout: 5000 },
    );

    expect(new URL(page.url()).searchParams.get("tag")).toBe(OUR_TAG);
    await page.close();
  });

  test("preserves a creator's tag AND still strips tracking junk on an already-tagged URL", async ({ context, extensionId }) => {
    // Load-bearing guard: on an already-tagged URL the creator's tag must
    // survive (no overwrite by injection) WHILE DNR still strips tracking
    // params. This is exactly the combination a network-layer inject-via-DNR
    // design would have broken (a high-priority `allow` rule to skip tagged
    // URLs would also shadow the strip rules); the content-script path keeps
    // injection and DNR stripping fully independent, so both hold.
    await enableInjection(context, extensionId);
    const page = await context.newPage();
    await stubHost(page, "www.amazon.com");

    await page.goto("https://www.amazon.com/dp/B0044R881I?tag=creator-21&utm_source=spam&fbclid=abc");
    await page.waitForLoadState("domcontentloaded");
    // REASON: negative assertion (tag must NOT be overwritten) — there is no
    // positive "content script finished without acting" signal to await, so we
    // settle briefly to let the injection branch run, then assert it did not.
    await page.waitForTimeout(750);

    const params = new URL(page.url()).searchParams;
    expect(params.get("tag")).toBe("creator-21"); // creator attribution untouched
    expect(params.has("utm_source")).toBe(false); // DNR strip NOT suppressed
    expect(params.has("fbclid")).toBe(false);
    await page.close();
  });

  test("URL already carrying our tag is left unchanged (idempotent, no loop)", async ({ context, extensionId }) => {
    await enableInjection(context, extensionId);
    const page = await context.newPage();
    await stubHost(page, "www.amazon.com");

    let navigationError = null;
    try {
      await page.goto(`https://www.amazon.com/dp/B0044R881I?tag=${OUR_TAG}`);
      await page.waitForLoadState("domcontentloaded");
    } catch (err) {
      navigationError = err;
    }
    // REASON: negative assertion (no redirect loop / no re-injection) — settle
    // to let any erroneous replaceState fire before asserting the URL is stable.
    await page.waitForTimeout(500);

    expect(navigationError).toBeNull();
    expect(new URL(page.url()).searchParams.get("tag")).toBe(OUR_TAG);
    await page.close();
  });

  test("does NOT inject on a non-affiliate domain", async ({ context, extensionId }) => {
    await enableInjection(context, extensionId);
    const page = await context.newPage();
    await stubHost(page, "example.com");

    await page.goto("https://example.com/product?id=1");
    await page.waitForLoadState("domcontentloaded");
    // REASON: negative assertion (non-affiliate domain must never be injected) —
    // settle to let the content script run before asserting no tag was added.
    await page.waitForTimeout(500);

    expect(new URL(page.url()).searchParams.has("tag")).toBe(false);
    await page.close();
  });
});
