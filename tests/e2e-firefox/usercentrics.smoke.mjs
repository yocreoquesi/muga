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
 * the reject as done SYNCHRONOUSLY, without awaiting the promise.
 *
 * WHAT ACTUALLY PROVES THE PATH: the reject-fired assertions below — the
 * stub's `denyAllConsents` was invoked (`__ucCalls`), the page consent
 * state flipped to "necessary-only", and the banner host was removed. Those
 * page-world side effects are the real proof that the async fire-and-forget
 * call reached the page's object via `wrappedJSObject` in Gecko.
 *
 * THE PAGE-ERROR COLLECTOR IS A BEST-EFFORT SANITY CHECK, NOT A GUARANTEE.
 * `installPageErrorCollector` listens on the page-world `window.onerror` /
 * `unhandledrejection`, so it can only catch throws in the fixture's OWN
 * page-world stub. It CANNOT observe an exception thrown inside the
 * extension's isolated-world content script (src/content/cookie-noise.js):
 * on Firefox, isolated-world content-script throws do not surface on the
 * page-world window, so `assert.deepEqual(__mugaPageErrors, [])` can
 * essentially never fail on a content-script error. On top of that, the
 * collector is installed AFTER `driver.get()` returns (page `load`), while
 * the content script runs at `document_start` — so the reject may already
 * have settled before it attaches. Treat an empty `__mugaPageErrors` as
 * "the fixture stub itself did not blow up", not as a verified async-safety
 * property of the dispatcher.
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
 * Installs a PAGE-WORLD error/unhandledrejection collector. Best-effort
 * only: it runs in the page world, so it observes throws from the fixture's
 * own stub but NOT throws inside the extension's isolated-world content
 * script (Firefox does not surface isolated-world content-script errors on
 * the page-world window). It is also attached AFTER `driver.get()` returns
 * (page `load`), whereas the content script runs at `document_start`, so
 * denyAllConsents()'s promise may already have settled before this attaches.
 * See the file docblock — the reject-fired assertions are the real proof.
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
