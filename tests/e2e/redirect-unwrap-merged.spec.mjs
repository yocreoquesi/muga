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
import { waitForDnrPropagation } from "./helpers/index.mjs";

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
          mugaConsent: { onboardingDone: true, consentVersion: "1.1", consentDate: Date.now() },
        }, resolve);
      });
    })
  );
  await page.close();
  // SW prefs-cache has no observable refresh signal after storage.set resolves.
  // Centralised in waitForDnrPropagation so the debt is greppable (#824).
  await waitForDnrPropagation(page);
}

test.describe("Redirect unwrap merged module (#410)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await ensureUnwrapEnabled(context, extensionId);
  });

  test("awin1.com is NOT unwrapped client-side (pass-through per #684 / #695)", async ({ context }) => {
    // Awin moved to AFFILIATE_REDIRECT_NETWORKS in #684; the content-script
    // legacy unwrap that previously local-extracted `?ued=` was retired in
    // #695. The browser MUST stay on awin1.com so the network's 30x can
    // populate awc / wt_mc on the merchant landing.
    const page = await context.newPage();
    await stubHost(page, "www.awin1.com");
    await stubHost(page, "destination.test");

    const target = "https://www.awin1.com/cread.php?ued=https%3A%2F%2Fdestination.test%2Fproduct%2F1";
    await page.goto(target);
    // Negative case: the pre-#695 behaviour would have replaced the URL within
    // a few hundred ms of DOMContentLoaded. There is no observable signal that
    // the (absent) unwrap has definitely NOT fired — we must wait past the
    // window where the content script would have acted. Centralised via
    // waitForDnrPropagation with an extended timeout (#824).
    await page.waitForLoadState("domcontentloaded");
    await waitForDnrPropagation(page, 1000);

    expect(page.url()).toBe(target);
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
    //
    // Flake-hardening (#574): the content script's unwrap runs on
    // DOMContentLoaded after a `chrome.runtime.sendMessage(getPrefs)`
    // round-trip (~10-50ms). The browser's native meta-refresh, if
    // armed with `content="0;..."`, can race that and win — landing
    // the page on the un-stubbed digidip host (ERR_ABORTED, frame
    // detached, waitForURL blows up). Two fixes layered:
    //
    //   1. Set the meta-refresh timeout to 60s. The browser will not
    //      fire it within the test window (5s); the content script
    //      finds the meta tag in the DOM the moment DOMContentLoaded
    //      fires, regardless of the timeout value.
    //   2. Stub `chollometro.digidip.net` as a safety net so that even
    //      if the content script DOES somehow lose the race, the
    //      browser navigation lands on a 200 placeholder instead of
    //      ERR_ABORTED — producing a clearer test failure mode.
    await page.route("**://www.chollometro.com/visit/**", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><head>
          <meta http-equiv="refresh" content="60;url=https://chollometro.digidip.net/visit?url=https%3A%2F%2Fdestination.test%2Fdeal%2F42">
        </head><body>chollometro</body></html>`,
      })
    );
    await stubHost(page, "chollometro.digidip.net");
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
    // Negative case: there is no observable signal that the (absent) unwrap has
    // definitively NOT fired. A short settle window guards against the content
    // script acting slightly after DOMContentLoaded. No better signal exists
    // for a non-event. Centralised via waitForDnrPropagation (#824).
    await waitForDnrPropagation(page, 800);

    // We should still be on the original URL — `destination` is one
    // of the documented exclusions.
    expect(page.url()).toContain("internal.test/redirect");
    expect(page.url()).not.toContain("login.test/auth");
    await page.close();
  });
});
