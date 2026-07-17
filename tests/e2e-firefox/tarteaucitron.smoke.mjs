/**
 * Firefox smoke: Cookie Consent Minimizer — tarteaucitron reject path.
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-tarteaucitron.spec.mjs's
 * fixture page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.tarteaucitron.userInterface.respondAll(false)`
 * path (src/content/cookie-noise.js) actually fires in Gecko.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as
// tests/e2e/cookie-consent-minimizer-tarteaucitron.spec.mjs's
// stubTarteaucitronPage: all three mandatory signals (global, userInterface,
// respondAll fn) plus the #tarteaucitronRoot DOM anchor as the
// corroborating secondary signal.
const TARTEAUCITRON_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="tarteaucitronRoot">
    <div id="tarteaucitronAlertBig">
      <button id="tarteaucitronAllAllowed">Tout accepter</button>
      <button id="tarteaucitronAllDenied">Tout refuser</button>
    </div>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.__tacCalls = [];
    window.tarteaucitron = {
      userInterface: {
        respondAll: function (status) {
          window.__tacCalls.push(["respondAll", status]);
          window.__consentState = status === false ? "necessary-only" : "accepted";
          document.getElementById("tarteaucitronRoot").remove();
        },
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

test("Firefox smoke: tarteaucitron userInterface.respondAll(false) fires via wrappedJSObject when the feature is enabled", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(TARTEAUCITRON_FIXTURE_HTML);
    await driver.get(server.url);

    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    const tacCalls = await driver.executeScript("return window.__tacCalls");
    assert.deepEqual(tacCalls, [["respondAll", false]]);

    const bannerGone = await driver.executeScript(
      "return document.getElementById('tarteaucitronRoot') === null"
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

test("Firefox smoke: tarteaucitron userInterface.respondAll(false) does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(TARTEAUCITRON_FIXTURE_HTML);
    await driver.get(server.url);

    // Negative assertion — no positive signal to poll on, so use a fixed
    // settle window (mirrors the Chromium spec's disabled-state test).
    await new Promise((r) => setTimeout(r, 1500));

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.getElementById('tarteaucitronRoot') !== null"
    );
    assert.equal(bannerStillThere, true);

    const tacCalls = await driver.executeScript("return window.__tacCalls");
    assert.deepEqual(tacCalls, []);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
