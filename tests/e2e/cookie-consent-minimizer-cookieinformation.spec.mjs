/**
 * E2E: Cookie Consent Minimizer — Cookie Information Tier 1 adapter
 *
 * Verifies the Cookie Information reject path against a real Chromium with
 * the extension loaded. The fixture page mimics a Cookie Information
 * banner: a `window.CookieInformation` object with a
 * `declineAllCategories()` method plus the `#coiOverlay` DOM anchor — the
 * mandatory-plus-corroboration signal combination the dispatcher requires
 * before acting (src/lib/cmp-adapters.js).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-didomi.spec.mjs's structure
 * exactly (same onboarding helper shape, same feature pref, same
 * zero-argument synchronous reject-call shape).
 *
 * HONEST LIMIT: this is a REGRESSION oracle only — a snapshot of one
 * fixture's behavior at write time. It proves the Chrome MAIN-world nonce
 * handshake (content/cookie-noise-mainworld.js) and the
 * never-auto-reject-the-other-way outcome on the fixture used here. It does
 * NOT validate the Firefox `window.wrappedJSObject` reject path
 * (content/cookie-noise.js) — Playwright's `chromium` fixture only exercises
 * Chrome — and it does NOT prove real-vendor-script compatibility against a
 * live Cookie Information CMP build. A real-browser smoke test against at
 * least one live Cookie Information deployment is required before
 * considering this adapter done — flagged for sdd-verify. Re-capture this
 * fixture manually whenever the Cookie Information markup/API shape this
 * test hardcodes changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-cookieinformation.invalid";

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
 * Fixture page: a Cookie Information banner offering a reject-all via
 * `declineAllCategories()`. The mandatory `declineAllCategories` function is
 * present alongside the `#coiOverlay` DOM anchor — the confidence gate in
 * cmp-adapters.js requires the mandatory signal plus at least one
 * corroborating DOM secondary.
 */
async function stubCookieInformationPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="coiOverlay">
          <button id="coi-accept-button">Accept all</button>
          <button id="declineButton">Decline</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__ciCalls = [];
          window.CookieInformation = {
            declineAllCategories() {
              window.__ciCalls.push("declineAllCategories");
              window.__consentState = "necessary-only";
              document.getElementById("coiOverlay").remove();
            },
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — Cookie Information", () => {
  test("rejects a Cookie Information banner with declineAllCategories() when the feature is enabled", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubCookieInformationPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the Chrome MAIN-world caller's once-guard flag — set only
    // after the nonce handshake completes and the gate opens.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The dispatcher acts on gate-open (initial sweep) or on the
    // MutationObserver's first pass — poll for the outcome.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    // declineAllCategories was actually invoked (not some other method).
    const ciCalls = await page.evaluate(() => window.__ciCalls);
    expect(ciCalls).toEqual(["declineAllCategories"]);

    // Banner dismissed.
    const bannerGone = await page.evaluate(() => document.getElementById("coiOverlay") === null);
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
    await stubCookieInformationPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(() => document.getElementById("coiOverlay") !== null);
    expect(bannerStillThere).toBe(true);

    const ciCalls = await page.evaluate(() => window.__ciCalls);
    expect(ciCalls).toEqual([]);

    await page.close();
  });

  test("never misfires on a Didomi-only page (no CookieInformation global present)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const DIDOMI_HOST = "muga-test-cookie-consent-cookieinformation-didomi-guard.invalid";
    await page.route(`**://${DIDOMI_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <div id="didomi-host"></div>
          <p id="page-content">Real page content</p>
          <script>
            // A Didomi-shaped page: exposes window.Didomi.setUserDisagreeToAll
            // but NO window.CookieInformation global at all. The Cookie
            // Information adapter must never act here.
            window.__didomiCalls = [];
            window.Didomi = {
              getCurrentUserStatus: function () { return {}; },
              setUserDisagreeToAll: function () {
                window.__didomiCalls.push("setUserDisagreeToAll");
              },
            };
          </script>
        </body></html>`,
      })
    );
    await page.goto(`https://${DIDOMI_HOST}/index.html`);

    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The Didomi adapter IS expected to fire here (it is a real Didomi
    // page) — what this test guards is that the Cookie Information adapter
    // never ALSO claims it / never references CookieInformation on a page
    // that has none.
    await page.waitForFunction(
      () => Array.isArray(window.__didomiCalls) && window.__didomiCalls.includes("setUserDisagreeToAll"),
      { timeout: 10000 }
    );

    const ciGlobalPresent = await page.evaluate(() => typeof window.CookieInformation !== "undefined");
    expect(ciGlobalPresent).toBe(false);

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });
});
