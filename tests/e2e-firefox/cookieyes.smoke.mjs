/**
 * Firefox smoke: Cookie Consent Minimizer — CookieYes reject path (#1128).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-cookieyes.spec.mjs's fixture
 * page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.performBannerAction("reject")` path
 * (src/content/cookie-noise.js) actually fires in Gecko.
 *
 * CookieYes deviates from OneTrust/Cookiebot/Didomi: it exposes BARE page
 * globals (`getCkyConsent`, `performBannerAction`), not methods on a
 * vendor-namespaced object — the dispatcher requires BOTH bare globals
 * (dual-mandatory) plus at least one DOM secondary signal
 * (`.cky-consent-container`) before it will act (src/lib/cmp-adapters.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as tests/e2e/cookie-consent-minimizer-cookieyes.spec.mjs's
// stubCookieYesPage: both mandatory bare globals (getCkyConsent,
// performBannerAction) present alongside the .cky-consent-container DOM
// anchor.
const COOKIEYES_FIXTURE_HTML = `<!doctype html><html><body>
  <div class="cky-consent-container">
    <div class="cky-consent-bar">
      <button id="cky-btn-accept">Accept All</button>
      <button id="cky-btn-reject">Reject All</button>
    </div>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.getCkyConsent = function () {
      return {
        activeLaw: "gdpr",
        categories: { necessary: true, functional: false, analytics: false, performance: false, advertisement: false },
        isUserActionCompleted: false,
        consentID: "test-consent-id",
        languageCode: "en",
      };
    };
    window.performBannerAction = function (action) {
      if (action !== "reject") {
        window.__consentState = "unexpected-consent";
        return;
      }
      window.__consentState = "necessary-only";
      document.querySelector(".cky-consent-container").remove();
    };
  </script>
</body></html>`;

async function pollUntil(driver, predicateFn, { timeoutMs = 10000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await driver.executeScript(predicateFn);
    if (result) return result;
    if (Date.now() > deadline) {
      throw new Error(`pollUntil timed out after ${timeoutMs}ms waiting on: ${predicateFn}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

test('Firefox smoke: CookieYes performBannerAction("reject") fires via wrappedJSObject when the feature is enabled', async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(COOKIEYES_FIXTURE_HTML);
    await driver.get(server.url);

    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    const bannerGone = await driver.executeScript(
      "return document.querySelector('.cky-consent-container') === null"
    );
    assert.equal(bannerGone, true);

    const pageContent = await driver.executeScript(
      "return document.getElementById('page-content') ? document.getElementById('page-content').textContent : null"
    );
    assert.equal(pageContent, "Real page content");
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});

test("Firefox smoke: CookieYes performBannerAction does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(COOKIEYES_FIXTURE_HTML);
    await driver.get(server.url);

    // Negative assertion — no positive signal to poll on, so use a fixed
    // settle window (mirrors the Chromium spec's disabled-state test).
    await new Promise((r) => setTimeout(r, 1500));

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.querySelector('.cky-consent-container') !== null"
    );
    assert.equal(bannerStillThere, true);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
