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
    window.__otCalls = [];
    window.OnetrustActiveGroups = "C0001";
    window.OneTrust = {
      RejectAll() {
        window.__otCalls.push("RejectAll");
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

    const otCalls = await driver.executeScript("return window.__otCalls");
    assert.deepEqual(otCalls, ["RejectAll"]);
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
      "return document.getElementById('onetrust-banner-sdk') !== null"
    );
    assert.equal(bannerStillThere, true);

    // LOW-1 (#1134): prove the reject method was never invoked — distinguishes
    // "gate correctly closed" from "extension never loaded".
    const otCalls = await driver.executeScript("return window.__otCalls");
    assert.deepEqual(otCalls, []);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
