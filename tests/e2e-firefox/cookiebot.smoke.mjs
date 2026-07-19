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
    window.__cbCalls = [];
    window.Cookiebot = {
      consent: { necessary: true, preferences: false, statistics: false, marketing: false },
      hasResponse: false,
      submitCustomConsent(preferences, statistics, marketing) {
        window.__cbCalls.push("submitCustomConsent");
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

    const cbCalls = await driver.executeScript("return window.__cbCalls");
    assert.deepEqual(cbCalls, ["submitCustomConsent"]);
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

    // LOW-2 (#1134): a wrongly-open gate could fire the reject slowly; a
    // single sample after a fixed sleep would miss a fire that lands after
    // the sample. Poll the whole window and fail fast if the reject ever
    // fires. (A fire slower than this window is the acknowledged residual
    // limit — a closed gate leaves no page-world readiness signal to key on.)
    let firedWhileOff = false;
    try {
      await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 3000, intervalMs: 200 });
      firedWhileOff = true;
    } catch {
      // timed out without firing — the expected feature-OFF behavior
    }
    assert.equal(firedWhileOff, false, "reject fired while the feature was OFF");

    const bannerStillThere = await driver.executeScript(
      "return document.getElementById('CybotCookiebotDialog') !== null"
    );
    assert.equal(bannerStillThere, true);

    // LOW-1 (#1134): prove the reject method was never invoked — distinguishes
    // "gate correctly closed" from "extension never loaded".
    const cbCalls = await driver.executeScript("return window.__cbCalls");
    assert.deepEqual(cbCalls, []);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
