/**
 * Firefox smoke: Cookie Consent Minimizer — CookieScript reject path.
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-cookiescript.spec.mjs's
 * fixture page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.CookieScript.instance.rejectAllAction()` path
 * (src/content/cookie-noise.js) actually fires in Gecko.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as
// tests/e2e/cookie-consent-minimizer-cookiescript.spec.mjs's
// stubCookieScriptPage: all three mandatory signals (global, instance,
// rejectAllAction fn) plus the #cookiescript_injected DOM anchor as the
// corroborating secondary signal. `window.CookieScript` is a callable
// FUNCTION with `.instance` hung off it — the real vendor shape confirmed
// on cookie-script.com via real-site verification (2026-07-17), not the
// plain object this fixture originally (incorrectly) modeled.
const COOKIESCRIPT_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="cookiescript_injected">
    <button id="cookiescript_accept">Accept</button>
    <button id="cookiescript_reject">Reject all</button>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.__csCalls = [];
    window.CookieScript = function CookieScript() {};
    window.CookieScript.instance = {
      rejectAllAction: function () {
        window.__csCalls.push("rejectAllAction");
        window.__consentState = "necessary-only";
        document.getElementById("cookiescript_injected").remove();
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

test("Firefox smoke: CookieScript instance.rejectAllAction() fires via wrappedJSObject when the feature is enabled", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(COOKIESCRIPT_FIXTURE_HTML);
    await driver.get(server.url);

    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    const csCalls = await driver.executeScript("return window.__csCalls");
    assert.deepEqual(csCalls, ["rejectAllAction"]);

    const bannerGone = await driver.executeScript(
      "return document.getElementById('cookiescript_injected') === null"
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

test("Firefox smoke: CookieScript instance.rejectAllAction() does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(COOKIESCRIPT_FIXTURE_HTML);
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
      "return document.getElementById('cookiescript_injected') !== null"
    );
    assert.equal(bannerStillThere, true);

    const csCalls = await driver.executeScript("return window.__csCalls");
    assert.deepEqual(csCalls, []);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
