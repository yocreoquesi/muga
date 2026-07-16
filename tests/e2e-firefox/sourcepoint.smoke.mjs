/**
 * Firefox smoke: Cookie Consent Minimizer — Sourcepoint reject path (#1128).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-sourcepoint.spec.mjs's fixture
 * page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.__tcfapi("postRejectAll", 2, cb)` path
 * (src/content/cookie-noise.js) actually fires in Gecko.
 *
 * Sourcepoint rides the generic IAB TCF surface (`__tcfapi`) that every
 * TCF-compliant CMP exposes (including Didomi, already shipped) — the
 * dispatcher requires BOTH `__tcfapi` AND the Sourcepoint-specific
 * `div[id^="sp_message_container"]` DOM anchor (dual-mandatory) before it
 * will act (src/lib/cmp-adapters.js).
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as tests/e2e/cookie-consent-minimizer-sourcepoint.spec.mjs's
// stubSourcepointPage: both mandatory signals (__tcfapi fn,
// sp_message_container DOM anchor) present, plus a corroborating iframe.
// Records every __tcfapi command invoked so the test can assert
// "postRejectAll" specifically fired (not some other TCF command).
const SOURCEPOINT_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="sp_message_container_1234">
    <iframe src="https://some-account.privacy-mgmt.com/consent/some-message" title="consent"></iframe>
    <button id="sp-btn-accept">Accept All</button>
    <button id="sp-btn-reject">Reject All</button>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.__tcfapiCalls = [];
    window.__tcfapi = function (command, version, callback) {
      window.__tcfapiCalls.push(command);
      if (command !== "postRejectAll") {
        if (typeof callback === "function") callback(false, false);
        return;
      }
      window.__consentState = "necessary-only";
      document.getElementById("sp_message_container_1234").remove();
      if (typeof callback === "function") {
        setTimeout(() => callback(true, true), 0);
      }
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

test('Firefox smoke: Sourcepoint __tcfapi("postRejectAll", ...) fires via wrappedJSObject when the feature is enabled', async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(SOURCEPOINT_FIXTURE_HTML);
    await driver.get(server.url);

    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    // postRejectAll was actually invoked (not some other TCF command).
    const tcfCalls = await driver.executeScript("return window.__tcfapiCalls");
    assert.ok(Array.isArray(tcfCalls) && tcfCalls.includes("postRejectAll"), `expected __tcfapiCalls to include "postRejectAll", got ${JSON.stringify(tcfCalls)}`);

    const bannerGone = await driver.executeScript(
      "return document.querySelector('div[id^=\"sp_message_container\"]') === null"
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

test("Firefox smoke: Sourcepoint __tcfapi postRejectAll does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(SOURCEPOINT_FIXTURE_HTML);
    await driver.get(server.url);

    // Negative assertion — no positive signal to poll on, so use a fixed
    // settle window (mirrors the Chromium spec's disabled-state test).
    await new Promise((r) => setTimeout(r, 1500));

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.querySelector('div[id^=\"sp_message_container\"]') !== null"
    );
    assert.equal(bannerStillThere, true);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
