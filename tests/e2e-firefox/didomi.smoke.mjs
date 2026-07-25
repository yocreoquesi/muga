/**
 * Firefox smoke: Cookie Consent Minimizer — Didomi reject path (#1128).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-didomi.spec.mjs's fixture page
 * and assertions, but drives REAL headless Firefox via Selenium + geckodriver
 * (see ./fixtures.mjs) instead of Playwright's chromium fixture, to prove the
 * Firefox-only `window.wrappedJSObject.Didomi.setUserDisagreeToAll()` path
 * (src/content/cookie-noise.js) actually fires in Gecko.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as tests/e2e/cookie-consent-minimizer-didomi.spec.mjs's
// stubDidomiPage: mandatory signal (Didomi global + setUserDisagreeToAll fn)
// plus corroborating secondary signals (#didomi-host DOM anchor,
// getCurrentUserStatus function).
const DIDOMI_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="didomi-host">
    <button id="didomi-notice-agree-button">Agree</button>
    <button id="didomi-notice-disagree-button">Disagree</button>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.__ddCalls = [];
    window.Didomi = {
      getCurrentUserStatus() {
        return { purposes: {}, vendors: {} };
      },
      setUserDisagreeToAll() {
        window.__ddCalls.push("setUserDisagreeToAll");
        window.__consentState = "necessary-only";
        document.getElementById("didomi-host").remove();
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

test("Firefox smoke: Didomi setUserDisagreeToAll() fires via wrappedJSObject when the feature is enabled", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(DIDOMI_FIXTURE_HTML);
    await driver.get(server.url);

    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    const bannerGone = await driver.executeScript(
      "return document.getElementById('didomi-host') === null"
    );
    assert.equal(bannerGone, true);

    const pageContent = await driver.executeScript(
      "return document.getElementById('page-content') ? document.getElementById('page-content').textContent : null"
    );
    assert.equal(pageContent, "Real page content");

    const ddCalls = await driver.executeScript("return window.__ddCalls");
    assert.deepEqual(ddCalls, ["setUserDisagreeToAll"]);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});

test("Firefox smoke: Didomi setUserDisagreeToAll() does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(DIDOMI_FIXTURE_HTML);
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
      "return document.getElementById('didomi-host') !== null"
    );
    assert.equal(bannerStillThere, true);

    // LOW-1 (#1134): prove the reject method was never invoked — distinguishes
    // "gate correctly closed" from "extension never loaded".
    const ddCalls = await driver.executeScript("return window.__ddCalls");
    assert.deepEqual(ddCalls, []);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
