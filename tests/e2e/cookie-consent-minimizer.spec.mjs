/**
 * E2E: Cookie Consent Minimizer (#1027)
 *
 * Verifies the OneTrust Tier 1 reject path against a real Chromium with
 * the extension loaded. The fixture page mimics a OneTrust banner
 * offering a granular reject / necessary-only path: `window.OneTrust`
 * with a `RejectAll()` method, the `#onetrust-banner-sdk` DOM anchor, and
 * `window.OnetrustActiveGroups` — the multi-signal corroboration the
 * dispatcher requires before acting (src/lib/cmp-adapters.js).
 *
 * Mirrors tests/e2e/dom-link-rewriter-click.spec.mjs's structure: a
 * dedicated completeOnboarding() that also opts into the feature
 * (cookieConsentMode: "reject-only") and accepts the disclosing
 * consent version (1.2, see src/lib/consent-version-manifest.js).
 *
 * HONEST LIMIT (per design doc): this is a REGRESSION oracle only — a
 * snapshot of one fixture's behavior at write time. It proves the Chrome
 * MAIN-world nonce handshake (content/cookie-noise-mainworld.js) and the
 * never-auto-reject-the-other-way outcome on the fixture used here. It
 * does NOT validate the Firefox `window.wrappedJSObject` reject path
 * (content/cookie-noise.js) — Playwright's `chromium` fixture only
 * exercises Chrome. The Firefox path requires a real Firefox run (per
 * MUGA's Chrome DNR-regex memory-limit lesson: unit/Chromium-green does
 * not guarantee real-env-green on every engine) — flagged for
 * sdd-verify. Re-capture this fixture manually whenever the OneTrust
 * markup/API shape this test hardcodes changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent.invalid";

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
 * Fixture page: a OneTrust banner offering granular reject. All three
 * corroborating signals are present (banner DOM, OnetrustActiveGroups
 * global, reject-handler DOM) alongside the mandatory RejectAll function —
 * the confidence gate in cmp-adapters.js requires the mandatory signal
 * plus at least one of these.
 */
async function stubOneTrustPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="onetrust-banner-sdk">
          <button id="onetrust-reject-all-handler">Reject All</button>
          <button id="onetrust-accept-btn-handler">Allow All</button>
        </div>
        <div id="onetrust-consent-sdk"></div>
        <p id="page-content">Real page content</p>
        <script>
          window.OnetrustActiveGroups = "C0001";
          window.OneTrust = {
            RejectAll() {
              window.__consentState = "necessary-only";
              document.getElementById("onetrust-banner-sdk").remove();
              document.getElementById("onetrust-consent-sdk").remove();
            },
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer (#1027)", () => {
  test("rejects a OneTrust banner with a granular reject path when the feature is enabled", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubOneTrustPage(page);
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
    const bannerGone = await page.evaluate(() => document.getElementById("onetrust-banner-sdk") === null);
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
    await stubOneTrustPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(() => document.getElementById("onetrust-banner-sdk") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
