/**
 * Firefox smoke: Cookie Consent Minimizer — Cookiebot reject path (#1128).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-cookiebot.spec.mjs's fixture
 * page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.Cookiebot.submitCustomConsent(false, false, false)`
 * path (src/content/cookie-noise.js) actually fires in Gecko.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as tests/e2e/cookie-consent-minimizer-cookiebot.spec.mjs's
// stubCookiebotPage: mandatory signal (Cookiebot global + submitCustomConsent
// fn) plus corroborating secondary signals (Cybot dialog DOM, consent object
// global, hasResponse boolean).
const COOKIEBOT_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="CybotCookiebotDialog">
    <button id="CybotCookiebotDialogBodyLevelButtonAccept">Allow all</button>
    <button id="CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll">Allow all</button>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.Cookiebot = {
      consent: { necessary: true, preferences: false, statistics: false, marketing: false },
      hasResponse: false,
      submitCustomConsent(preferences, statistics, marketing) {
        window.__consentState =
          preferences === false && statistics === false && marketing === false
            ? "necessary-only"
            : "unexpected-consent";
        document.getElementById("CybotCookiebotDialog").remove();
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

test("Firefox smoke: Cookiebot submitCustomConsent(false, false, false) fires via wrappedJSObject when the feature is enabled", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(COOKIEBOT_FIXTURE_HTML);
    await driver.get(server.url);

    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    const bannerGone = await driver.executeScript(
      "return document.getElementById('CybotCookiebotDialog') === null"
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

test("Firefox smoke: Cookiebot submitCustomConsent does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(COOKIEBOT_FIXTURE_HTML);
    await driver.get(server.url);

    // Negative assertion — no positive signal to poll on, so use a fixed
    // settle window (mirrors the Chromium spec's disabled-state test).
    await new Promise((r) => setTimeout(r, 1500));

    // WebDriver's executeScript serializes a JS `undefined` return value as
    // `null` over the wire — assert against `null`, not `undefined`.
    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.getElementById('CybotCookiebotDialog') !== null"
    );
    assert.equal(bannerStillThere, true);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
