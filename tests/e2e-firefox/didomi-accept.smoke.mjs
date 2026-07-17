/**
 * Firefox smoke: Cookie Consent Minimizer — Didomi accept-when-necessary
 * pilot (cookie-consent-accept Slice 2a).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-didomi-accept.spec.mjs's
 * fixture page and assertions, but drives REAL headless Firefox via
 * Selenium + geckodriver (see ./fixtures.mjs) instead of Playwright's
 * chromium fixture, to prove the Firefox-only
 * `window.wrappedJSObject.Didomi.setCurrentUserStatus()` path
 * (src/content/cookie-noise.js's @sync:cmp-accept-dispatch region)
 * actually fires in Gecko.
 *
 * HONEST LIMIT (mirrors the Chromium spec's own note): this is a
 * REGRESSION oracle only, proving the mechanics against a synthetic
 * fixture. It does NOT prove a real Didomi SDK actually honors
 * setCurrentUserStatus on a live hard wall — see
 * docs/qa/cookie-consent-release-smoke.md's "Didomi accept-when-necessary
 * pilot" subsection, a HARD pre-enable gate for real users.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage } from "./helpers/local-server.mjs";

// Same fixture shape as the Chromium spec's stubDidomiHardWallPage: a
// Didomi hard wall for the REJECT adapter (no setUserDisagreeToAll) that
// ALSO exposes the full accept-capable surface.
const DIDOMI_ACCEPT_FIXTURE_HTML = `<!doctype html><html><body>
  <div id="didomi-host">
    <button id="didomi-notice-agree-button">Agree</button>
  </div>
  <p id="page-content">Real page content</p>
  <script>
    window.Didomi = {
      getCurrentUserStatus() {
        return { purposes: {}, vendors: {} };
      },
      getRequiredPurposeIds() {
        return ["cookies_functional"];
      },
      getRequiredVendorIds() {
        return ["vendor-required-1"];
      },
      getPurposes() {
        return ["cookies_functional", "advertising", "analytics"];
      },
      getVendors() {
        return ["vendor-required-1", "vendor-ads-2", "vendor-analytics-3"];
      },
      setCurrentUserStatus(payload) {
        window.__mugaAcceptPayload = payload;
        window.__consentState = "minimum-accepted";
        document.getElementById("didomi-host").remove();
      },
    };
  </script>
</body></html>`;

async function completeOnboardingWithAcceptPrefs(driver, extensionOrigin, { cookieConsentMode, cookieConsentAcceptConsented }) {
  await driver.get(`${extensionOrigin}/popup/popup.html`);

  await driver.executeAsyncScript(
    (mode, consented, callback) => {
      chrome.storage.sync.set(
        {
          enabled: true,
          cookieConsentMode: mode,
          cookieConsentAcceptConsented: consented,
          injectOwnAffiliate: false,
          notifyForeignAffiliate: false,
          language: "en",
        },
        () => {
          chrome.storage.local.set(
            {
              mugaConsent: {
                onboardingDone: true,
                consentVersion: "1.3",
                consentDate: Date.now(),
              },
            },
            () => {
              chrome.storage.sync.set({ onboardingDone: true }, () => callback());
            }
          );
        }
      );
    },
    cookieConsentMode,
    cookieConsentAcceptConsented
  );

  // Mirrors tests/e2e-firefox/fixtures.mjs's completeOnboarding: no
  // observable signal exists for prefs-cache propagation after a
  // storage.set call, so a short fixed settle window is used (#824 debt).
  await new Promise((resolve) => setTimeout(resolve, 500));
}

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

test("Firefox smoke: Didomi setCurrentUserStatus() fires the minimum payload when mode is accept-when-necessary AND the gesture is confirmed", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboardingWithAcceptPrefs(driver, extensionOrigin, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    server = await serveFixturePage(DIDOMI_ACCEPT_FIXTURE_HTML);
    await driver.get(server.url);

    await pollUntil(driver, "return window.__consentState === 'minimum-accepted'", { timeoutMs: 10000 });

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, "minimum-accepted");

    const payload = await driver.executeScript("return window.__mugaAcceptPayload");
    assert.deepEqual(payload.purposes.enabled, ["cookies_functional"]);
    assert.deepEqual(payload.purposes.disabled, ["advertising", "analytics"]);
    assert.deepEqual(payload.vendors.enabled, ["vendor-required-1"]);
    assert.deepEqual(payload.vendors.disabled, ["vendor-ads-2", "vendor-analytics-3"]);

    const bannerGone = await driver.executeScript(
      "return document.getElementById('didomi-host') === null"
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

test("Firefox smoke ADVERSARIAL: setCurrentUserStatus() does NOT fire in reject-only mode, even on the exact same hard wall", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboardingWithAcceptPrefs(driver, extensionOrigin, {
      cookieConsentMode: "reject-only",
      cookieConsentAcceptConsented: true,
    });

    server = await serveFixturePage(DIDOMI_ACCEPT_FIXTURE_HTML);
    await driver.get(server.url);

    await new Promise((r) => setTimeout(r, 1500));

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.getElementById('didomi-host') !== null"
    );
    assert.equal(bannerStillThere, true);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});

test("Firefox smoke ADVERSARIAL: setCurrentUserStatus() does NOT fire in accept-when-necessary mode without the explicit consent gesture", async () => {
  let driver;
  let extDir;
  let server;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboardingWithAcceptPrefs(driver, extensionOrigin, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: false,
    });

    server = await serveFixturePage(DIDOMI_ACCEPT_FIXTURE_HTML);
    await driver.get(server.url);

    await new Promise((r) => setTimeout(r, 1500));

    const consentState = await driver.executeScript("return window.__consentState");
    assert.equal(consentState, null);

    const bannerStillThere = await driver.executeScript(
      "return document.getElementById('didomi-host') !== null"
    );
    assert.equal(bannerStillThere, true);
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
});
