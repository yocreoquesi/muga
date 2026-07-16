/**
 * Firefox smoke: Cookie Consent Minimizer — Usercentrics reject path (#1128).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-usercentrics.spec.mjs's fixture
 * page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.UC_UI.denyAllConsents()` path
 * (src/content/cookie-noise.js) actually fires in Gecko.
 *
 * THE ASYNC WRINKLE: unlike the other 5 adapters, `denyAllConsents()`
 * returns a Promise. The fixture's stub models this explicitly (a Promise
 * resolved on a macrotask delay), so this spec exercises the fire-and-forget
 * async path — src/content/cookie-noise.js calls
 * `window.wrappedJSObject.UC_UI.denyAllConsents().catch(() => {})` and marks
 * the reject as done SYNCHRONOUSLY, without awaiting the promise. This test
 * confirms the reject still fires (polling for the async outcome) AND that
 * the page never surfaces an unhandled error / rejection despite the
 * Promise-returning call — Selenium has no `page.on("pageerror")`
 * equivalent, so a `window.onerror` / `unhandledrejection` listener is
 * installed via `executeScript` right after navigation (before the
 * dispatcher's async gate-open/act sequence has had time to run) and polled
 * at assertion time.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as tests/e2e/cookie-consent-minimizer-usercentrics.spec.mjs's
// stubUsercentricsPage: both mandatory signals (UC_UI global,
// denyAllConsents function) present, plus the #usercentrics-root DOM host as
// the corroborating secondary signal. denyAllConsents returns a real
// Promise (resolved on a macrotask delay) so this fixture exercises the
// fire-and-forget async path, not a synchronous stub.
const USERCENTRICS_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="usercentrics-root">
    <button id="uc-btn-accept">Accept All</button>
    <button id="uc-btn-deny">Deny All</button>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.__ucCalls = [];
    window.UC_UI = {
      isInitialized: function () { return true; },
      denyAllConsents: function () {
        window.__ucCalls.push("denyAllConsents");
        return new Promise(function (resolve) {
          setTimeout(function () {
            window.__consentState = "necessary-only";
            document.getElementById("usercentrics-root").remove();
            resolve(true);
          }, 0);
        });
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

/**
 * Installs a window-level error/unhandledrejection collector. Called right
 * after navigation, before the dispatcher's async gate-open/act sequence has
 * had time to run (chrome.runtime.sendMessage + the isolated-world gate read
 * both take at least one macrotask), so it is in place before
 * denyAllConsents()'s promise settles.
 */
async function installPageErrorCollector(driver) {
  await driver.executeScript(`
    window.__mugaPageErrors = [];
    window.addEventListener("error", function (e) {
      window.__mugaPageErrors.push(String((e && e.message) || e));
    });
    window.addEventListener("unhandledrejection", function (e) {
      window.__mugaPageErrors.push("unhandledrejection: " + String((e && e.reason) || e));
    });
  `);
}

test("Firefox smoke: Usercentrics UC_UI.denyAllConsents() fires via wrappedJSObject when the feature is enabled, no unhandled error despite the Promise-returning call", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    server = await serveFixturePage(USERCENTRICS_FIXTURE_HTML);
    await driver.get(server.url);
    await installPageErrorCollector(driver);

    // denyAllConsents() resolves the page's consent state asynchronously
    // (macrotask) — poll for the outcome rather than asserting immediately,
    // since the dispatcher's call site never awaits it either.
    await pollUntil(driver, "return window.__consentState === 'necessary-only'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "necessary-only");

    // denyAllConsents was actually invoked (not some other UC_UI method).
    const ucCalls = await driver.executeScript("return window.__ucCalls");
    assert.deepEqual(ucCalls, ["denyAllConsents"]);

    // Banner host dismissed.
    const bannerGone = await driver.executeScript(
      "return document.getElementById('usercentrics-root') === null"
    );
    assert.equal(bannerGone, true);

    const pageContent = await driver.executeScript(
      "return document.getElementById('page-content') ? document.getElementById('page-content').textContent : null"
    );
    assert.equal(pageContent, "Real page content");

    // The promise returned by denyAllConsents() was never awaited by the
    // dispatcher itself (fire-and-forget) and its rejection path (if any) is
    // swallowed via .catch(() => {}) — no unhandled error / rejection
    // surfaces on the page.
    const pageErrors = await driver.executeScript("return window.__mugaPageErrors");
    assert.deepEqual(pageErrors, []);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});

test("Firefox smoke: Usercentrics UC_UI.denyAllConsents() does NOT fire when the feature is disabled (default OFF)", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: false });

    server = await serveFixturePage(USERCENTRICS_FIXTURE_HTML);
    await driver.get(server.url);
    await installPageErrorCollector(driver);

    // Negative assertion — no positive signal to poll on, so use a fixed
    // settle window (mirrors the Chromium spec's disabled-state test).
    await new Promise((r) => setTimeout(r, 1500));

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.getElementById('usercentrics-root') !== null"
    );
    assert.equal(bannerStillThere, true);

    const ucCalls = await driver.executeScript("return window.__ucCalls");
    assert.deepEqual(ucCalls, []);

    const pageErrors = await driver.executeScript("return window.__mugaPageErrors");
    assert.deepEqual(pageErrors, []);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
