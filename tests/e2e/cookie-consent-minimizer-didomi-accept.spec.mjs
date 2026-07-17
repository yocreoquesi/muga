/**
 * E2E: Cookie Consent Minimizer — Didomi accept-when-necessary pilot
 * (cookie-consent-accept Slice 2a)
 *
 * Verifies the Chrome MAIN-world minimum-grant dispatch
 * (content/cookie-noise-mainworld.js's @sync:cmp-accept-dispatch region)
 * against a stub Didomi hard wall: `window.Didomi` present WITHOUT
 * `setUserDisagreeToAll` (so the reject adapter in
 * tests/e2e/cookie-consent-minimizer-didomi.spec.mjs cannot act at all —
 * this is deliberately the mirror-image fixture), but WITH the
 * accept-capable surface (`setCurrentUserStatus`, `getRequiredPurposeIds`,
 * `getRequiredVendorIds`, `getPurposes`, `getVendors`).
 *
 * HONEST LIMIT (mirrors cookie-consent-minimizer-didomi.spec.mjs's own
 * note): this is a REGRESSION oracle only — it proves the MECHANICS
 * (correct payload shape, correct double-gate, correct no-action in every
 * other state) against a synthetic fixture. It does NOT prove a real
 * Didomi SDK actually honors `setCurrentUserStatus` on a live hard wall —
 * see docs/qa/cookie-consent-release-smoke.md's "Didomi accept-when-
 * necessary pilot" subsection, a HARD pre-enable gate for real users.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-didomi-accept.invalid";

async function completeOnboarding(context, extensionId, { cookieConsentMode = "accept-when-necessary", cookieConsentAcceptConsented = true } = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    ({ cookieConsentMode, cookieConsentAcceptConsented }) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          { enabled: true, cookieConsentMode, cookieConsentAcceptConsented },
          () => {
            chrome.storage.local.set(
              {
                mugaConsent: { onboardingDone: true, consentVersion: "1.3", consentDate: Date.now() },
              },
              () => {
                chrome.storage.sync.set({ onboardingDone: true }, resolve);
              }
            );
          }
        );
      }),
    { cookieConsentMode, cookieConsentAcceptConsented }
  );
  await page.close();
  await waitForDnrPropagation(page);
}

/**
 * Fixture page: a Didomi hard wall for the REJECT adapter (no
 * setUserDisagreeToAll) that ALSO exposes the full accept-capable
 * surface. getPurposes()/getVendors() return plain arrays of id strings
 * (extractDidomiIds's simplest supported shape) — required ids are a
 * proper subset, so the minimum-payload assertions below can pin exactly
 * which ids end up enabled vs disabled.
 */
async function stubDidomiHardWallPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
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
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — Didomi accept-when-necessary pilot (cookie-consent-accept Slice 2a)", () => {
  test("submits the minimum payload and dismisses the hard wall when mode is accept-when-necessary AND the gesture is confirmed", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubDidomiHardWallPage(page);
    await page.goto(`https://${HOST}/index.html`);

    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });
    await page.waitForFunction(() => window.__consentState === "minimum-accepted", { timeout: 10000 });

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("minimum-accepted");

    // Minimum payload: only the required ids are enabled, everything else
    // from the vendor's own registry is explicitly disabled.
    const payload = await page.evaluate(() => window.__mugaAcceptPayload);
    expect(payload.purposes.enabled).toEqual(["cookies_functional"]);
    expect(payload.purposes.disabled).toEqual(["advertising", "analytics"]);
    expect(payload.vendors.enabled).toEqual(["vendor-required-1"]);
    expect(payload.vendors.disabled).toEqual(["vendor-ads-2", "vendor-analytics-3"]);

    // Banner dismissed.
    const bannerGone = await page.evaluate(() => document.getElementById("didomi-host") === null);
    expect(bannerGone).toBe(true);

    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("ADVERSARIAL: takes no action when mode is reject-only, even on the exact same hard wall", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "reject-only",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubDidomiHardWallPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // REASON: negative assertion — no positive signal to poll on, matches
    // the existing suite's standard pattern for a disabled/inert state.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(() => document.getElementById("didomi-host") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });

  test("ADVERSARIAL: takes no action in accept-when-necessary mode without the explicit consent gesture", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: false,
    });

    const page = await context.newPage();
    await stubDidomiHardWallPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // REASON: negative assertion — no positive signal to poll on, matches
    // the existing suite's standard pattern for a disabled/inert state.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(() => document.getElementById("didomi-host") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });

  test("ADVERSARIAL: takes no action when the feature is off entirely", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "off",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubDidomiHardWallPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // REASON: negative assertion — no positive signal to poll on, matches
    // the existing suite's standard pattern for a disabled/inert state.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(() => document.getElementById("didomi-host") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
