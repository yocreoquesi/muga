/**
 * E2E: Cookie Consent Minimizer — CookieYes Tier 1 adapter (#1120)
 *
 * Verifies the CookieYes reject path against a real Chromium with the
 * extension loaded. The fixture page mimics a CookieYes banner: BARE page
 * globals `window.getCkyConsent()` and `window.performBannerAction(action)`
 * (unlike OneTrust/Cookiebot/Didomi, CookieYes does not namespace these
 * under a vendor object), plus the `.cky-consent-container` DOM anchor —
 * the dual-mandatory-signal + DOM corroboration the dispatcher requires
 * before acting (src/lib/cmp-adapters.js).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-cookiebot.spec.mjs's structure
 * exactly (same onboarding helper shape, same feature pref).
 *
 * HONEST LIMIT (per design doc / exploration #1280): this is a REGRESSION
 * oracle only — a snapshot of one fixture's behavior at write time. It
 * proves the Chrome MAIN-world nonce handshake
 * (content/cookie-noise-mainworld.js) and the never-auto-reject-the-other-
 * way outcome on the fixture used here. It does NOT validate the Firefox
 * `window.wrappedJSObject` reject path (content/cookie-noise.js) —
 * Playwright's `chromium` fixture only exercises Chrome — and it does NOT
 * prove real-vendor-script compatibility against a live CookieYes CMP
 * build. Per MUGA's Chrome DNR-regex memory-limit lesson: unit/Chromium-
 * green does not guarantee real-env-green on every engine. A real-browser
 * smoke test against at least one live CookieYes-CMP site is required
 * before considering the CookieYes slice done — flagged for sdd-verify.
 * In particular, `performBannerAction`'s exact availability timing
 * (pre- vs post-banner-render) is UNDOCUMENTED upstream (unlike
 * `getCkyConsent`, which CookieYes's own docs say is only available after
 * the banner has fully loaded) — this fixture defines both globals
 * up-front, which may not match real-world CookieYes script-load timing.
 * Re-capture this fixture manually whenever the CookieYes markup/API shape
 * this test hardcodes changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-cookieyes.invalid";

async function completeOnboarding(context, extensionId, { enableFeature = true } = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    ({ enableFeature }) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          { enabled: true, cookieConsentMode: enableFeature ? "reject-only" : "off" },
          () => {
            chrome.storage.local.set(
              {
                mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: Date.now() },
              },
              () => {
                chrome.storage.sync.set({ onboardingDone: true }, resolve);
              }
            );
          }
        );
      }),
    { enableFeature }
  );
  await page.close();
  // Prefs broadcast has no observable signal after storage.set resolves.
  // Centralised in waitForDnrPropagation so the debt is greppable (#824).
  await waitForDnrPropagation(page);
}

/**
 * Fixture page: a CookieYes banner offering reject via the bare global
 * `performBannerAction("reject")`. Both mandatory bare globals
 * (`getCkyConsent`, `performBannerAction`) are present alongside the
 * `.cky-consent-container` DOM anchor — the confidence gate in
 * cmp-adapters.js requires both mandatory globals plus at least one DOM
 * secondary signal.
 */
async function stubCookieYesPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div class="cky-consent-container">
          <div class="cky-consent-bar">
            <button id="cky-btn-accept">Accept All</button>
            <button id="cky-btn-reject">Reject All</button>
          </div>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.getCkyConsent = function () {
            return {
              activeLaw: "gdpr",
              categories: { necessary: true, functional: false, analytics: false, performance: false, advertisement: false },
              isUserActionCompleted: false,
              consentID: "test-consent-id",
              languageCode: "en",
            };
          };
          window.performBannerAction = function (action) {
            if (action !== "reject") {
              window.__consentState = "unexpected-consent";
              return;
            }
            window.__consentState = "necessary-only";
            document.querySelector(".cky-consent-container").remove();
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — CookieYes (#1120)", () => {
  test('rejects a CookieYes banner with performBannerAction("reject") when the feature is enabled', async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubCookieYesPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the Chrome MAIN-world caller's once-guard flag — set only
    // after the nonce handshake completes and the gate opens.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The dispatcher acts on gate-open (initial sweep) or on the
    // MutationObserver's first pass — poll for the outcome.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    // Banner dismissed.
    const bannerGone = await page.evaluate(
      () => document.querySelector(".cky-consent-container") === null
    );
    expect(bannerGone).toBe(true);

    // Page remains functional — the unrelated marker is untouched.
    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("takes no action when the feature is disabled (default OFF)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, { enableFeature: false });

    const page = await context.newPage();
    await stubCookieYesPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(
      () => document.querySelector(".cky-consent-container") !== null
    );
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
