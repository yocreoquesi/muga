/**
 * Firefox smoke: Cookie Consent Minimizer — OneTrust reject path (#1128
 * slice 1, de-risking proof for a Firefox WebExtension e2e harness).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer.spec.mjs's OneTrust fixture
 * page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.OneTrust.RejectAll()` path
 * (src/content/cookie-noise.js) actually fires in Gecko.
 *
 * Scope: slice 1 proves the harness works end-to-end for ONE adapter
 * (OneTrust). Extending to the other 5 adapters (Cookiebot, Didomi,
 * CookieYes, Sourcepoint, Usercentrics) is follow-up work, not this slice.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as tests/e2e/cookie-consent-minimizer.spec.mjs's
// stubOneTrustPage: mandatory signal (OneTrust global + RejectAll fn) plus
// two corroborating secondary signals (banner DOM + OnetrustActiveGroups).
const ONETRUST_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="onetrust-banner-sdk">
    <button id="onetrust-reject-all-handler">Reject All</button>
    <button id="onetrust-accept-btn-handler">Allow All</button>
  </div>
  <div id="onetrust-consent-sdk"></div>
  <p id="page-content">Real page content</p>
  <script>
    window.OnetrustActiveGroups = "C0001";
    window.OneTrust = {
      RejectAll() {
        window.__consentState = "necessary-only";
        document.getElementById("onetrust-banner-sdk").remove();
        document.getElementById("onetrust-consent-sdk").remove();
      },
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

test("Firefox smoke: OneTrust RejectAll fires via wrappedJSObject when the feature is enabled", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(ONETRUST_FIXTURE_HTML);
    await driver.get(server.url);

    // Poll for the dispatcher's outcome — mirrors the Chromium spec's
    // waitForFunction(() => window.__consentState === "necessary-only").
    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    const bannerGone = await driver.executeScript(
      "return document.getElementById('onetrust-banner-sdk') === null"
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

test("Firefox smoke: OneTrust RejectAll does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(ONETRUST_FIXTURE_HTML);
    await driver.get(server.url);

    // Negative assertion — no positive signal to poll on, so use a fixed
    // settle window (mirrors the Chromium spec's disabled-state test).
    await new Promise((r) => setTimeout(r, 1500));

    // WebDriver's executeScript serializes a JS `undefined` return value as
    // `null` over the wire (a documented Selenium/WebDriver protocol quirk,
    // not a MUGA bug) — assert against `null`, not `undefined`.
    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.getElementById('onetrust-banner-sdk') !== null"
    );
    assert.equal(bannerStillThere, true);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
