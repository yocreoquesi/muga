/**
 * E2E: Cookie Consent Minimizer — Didomi Tier 1 adapter (#1119)
 *
 * Verifies the Didomi reject path against a real Chromium with the
 * extension loaded. The fixture page mimics a Didomi banner: a
 * `window.Didomi` object with a `setUserDisagreeToAll()` method, the
 * `#didomi-host` DOM anchor, and a `getCurrentUserStatus()` function — the
 * multi-signal corroboration the dispatcher requires before acting
 * (src/lib/cmp-adapters.js).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-cookiebot.spec.mjs's structure
 * exactly (same onboarding helper shape, same feature pref).
 *
 * HONEST LIMIT (per design doc / exploration #1278): this is a REGRESSION
 * oracle only — a snapshot of one fixture's behavior at write time. It
 * proves the Chrome MAIN-world nonce handshake
 * (content/cookie-noise-mainworld.js) and the never-auto-reject-the-other-
 * way outcome on the fixture used here. It does NOT validate the Firefox
 * `window.wrappedJSObject` reject path (content/cookie-noise.js) —
 * Playwright's `chromium` fixture only exercises Chrome — and it does NOT
 * prove real-vendor-script compatibility against a live Didomi CMP build.
 * Per MUGA's Chrome DNR-regex memory-limit lesson: unit/Chromium-green does
 * not guarantee real-env-green on every engine. A real-browser smoke test
 * against at least one live Didomi-CMP site is required before considering
 * the Didomi slice done — flagged for sdd-verify. Re-capture this fixture
 * manually whenever the Didomi markup/API shape this test hardcodes changes
 * upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-didomi.invalid";

async function completeOnboarding(context, extensionId, { enableFeature = true } = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    ({ enableFeature }) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          { enabled: true, cookieConsentMinimizerEnabled: enableFeature },
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
 * Fixture page: a Didomi banner offering a reject-all via
 * `setUserDisagreeToAll()`. Both corroborating signals are present
 * (`#didomi-host` DOM anchor, `getCurrentUserStatus` function) alongside
 * the mandatory `setUserDisagreeToAll` function — the confidence gate in
 * cmp-adapters.js requires the mandatory signal plus at least one of these.
 */
async function stubDidomiPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="didomi-host">
          <button id="didomi-notice-agree-button">Agree</button>
          <button id="didomi-notice-disagree-button">Disagree</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.Didomi = {
            getCurrentUserStatus() {
              return { purposes: {}, vendors: {} };
            },
            setUserDisagreeToAll() {
              window.__consentState = "necessary-only";
              document.getElementById("didomi-host").remove();
            },
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — Didomi (#1119)", () => {
  test("rejects a Didomi banner with setUserDisagreeToAll() when the feature is enabled", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubDidomiPage(page);
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
    const bannerGone = await page.evaluate(() => document.getElementById("didomi-host") === null);
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
    await stubDidomiPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(() => document.getElementById("didomi-host") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
