/**
 * E2E: Cookie Consent Minimizer — Sourcepoint Tier 1 adapter (#1123)
 *
 * Verifies the Sourcepoint reject path against a real Chromium with the
 * extension loaded. The fixture page mimics a Sourcepoint banner: the
 * generic IAB TCF surface `window.__tcfapi(command, version, callback)`
 * plus a `div[id^="sp_message_container"]` DOM anchor — the dual-mandatory
 * signal combination the dispatcher requires before acting
 * (src/lib/cmp-adapters.js), since `__tcfapi` alone is exposed by every
 * TCF-compliant CMP (including Didomi, already shipped in this extension).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-cookieyes.spec.mjs's structure
 * exactly (same onboarding helper shape, same feature pref).
 *
 * HONEST LIMIT (per design doc / exploration #1283): this is a REGRESSION
 * oracle only — a snapshot of one fixture's behavior at write time. It
 * proves the Chrome MAIN-world nonce handshake
 * (content/cookie-noise-mainworld.js) and the never-auto-reject-the-other-
 * way outcome on the fixture used here. It does NOT validate the Firefox
 * `window.wrappedJSObject` reject path (content/cookie-noise.js) —
 * Playwright's `chromium` fixture only exercises Chrome — and it does NOT
 * prove real-vendor-script compatibility against a live Sourcepoint CMP
 * build. Per MUGA's Chrome DNR-regex memory-limit lesson: unit/Chromium-
 * green does not guarantee real-env-green on every engine.
 *
 * REAL-BROWSER SMOKE PLAN required before considering this slice done
 * (flagged for sdd-verify — this is the riskiest unknown in the design,
 * since `__tcfapi` is a generic TCF surface unit tests cannot fully
 * validate against a real vendor stub):
 *   1. Live Sourcepoint site — confirm both mandatory signals
 *      (`__tcfapi` fn + `sp_message_container` DOM) are detected and
 *      `postRejectAll` actually clears the page's consent state.
 *   2. Live Didomi-only site (no Sourcepoint) — confirm zero misfire: the
 *      Sourcepoint adapter must never claim a Didomi-only TCF page.
 *   3. Calling `postRejectAll` against a foreign (e.g. Didomi's) `__tcfapi`
 *      stub is inert — no console error, no page breakage, no accidental
 *      grant. Cannot be verified against a real Didomi stub without a live
 *      dual-CMP fixture; this fixture only proves the fire-and-forget
 *      shape is safe against a throwing/foreign stub in isolation.
 *
 * Re-capture this fixture manually whenever the Sourcepoint markup/API
 * shape this test hardcodes changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-sourcepoint.invalid";

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
 * Fixture page: a Sourcepoint banner offering reject via the generic IAB
 * TCF surface `__tcfapi("postRejectAll", 2, callback)`. Both mandatory
 * signals (`__tcfapi` function, `sp_message_container` DOM anchor) are
 * present, plus one corroborating iframe — the confidence gate in
 * cmp-adapters.js requires both mandatory signals plus at least one DOM
 * secondary signal.
 */
async function stubSourcepointPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="sp_message_container_1234">
          <iframe src="https://some-account.privacy-mgmt.com/consent/some-message" title="consent"></iframe>
          <button id="sp-btn-accept">Accept All</button>
          <button id="sp-btn-reject">Reject All</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__tcfapiCalls = [];
          window.__tcfapi = function (command, version, callback) {
            window.__tcfapiCalls.push(command);
            if (command !== "postRejectAll") {
              if (typeof callback === "function") callback(false, false);
              return;
            }
            window.__consentState = "necessary-only";
            document.getElementById("sp_message_container_1234").remove();
            if (typeof callback === "function") {
              setTimeout(() => callback(true, true), 0);
            }
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — Sourcepoint (#1123)", () => {
  test('rejects a Sourcepoint banner with __tcfapi("postRejectAll", ...) when the feature is enabled', async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubSourcepointPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the Chrome MAIN-world caller's once-guard flag — set only
    // after the nonce handshake completes and the gate opens.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The dispatcher acts on gate-open (initial sweep) or on the
    // MutationObserver's first pass — poll for the outcome.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    // postRejectAll was actually invoked (not some other TCF command).
    const tcfCalls = await page.evaluate(() => window.__tcfapiCalls);
    expect(tcfCalls).toContain("postRejectAll");

    // Banner dismissed.
    const bannerGone = await page.evaluate(
      () => document.querySelector('div[id^="sp_message_container"]') === null
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
    await stubSourcepointPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(
      () => document.querySelector('div[id^="sp_message_container"]') !== null
    );
    expect(bannerStillThere).toBe(true);

    await page.close();
  });

  test("never misfires on a Didomi-only TCF page (no sp_message_container DOM anchor)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const DIDOMI_HOST = "muga-test-cookie-consent-sourcepoint-didomi-guard.invalid";
    await page.route(`**://${DIDOMI_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <p id="page-content">Real page content</p>
          <script>
            // A Didomi-shaped page: exposes the generic __tcfapi surface
            // (as any TCF-compliant CMP does) but WITHOUT the
            // Sourcepoint-specific sp_message_container DOM anchor. The
            // Sourcepoint adapter must never act here.
            window.__tcfapiCalls = [];
            window.__tcfapi = function (command, version, callback) {
              window.__tcfapiCalls.push(command);
              if (typeof callback === "function") callback(false, false);
            };
          </script>
        </body></html>`,
      })
    );
    await page.goto(`https://${DIDOMI_HOST}/index.html`);

    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // REASON: negative assertion (no misfire) has no positive signal to
    // wait on — fixed settle window, same pattern as the disabled-feature
    // test above.
    await page.waitForTimeout(1500);

    const tcfCalls = await page.evaluate(() => window.__tcfapiCalls);
    expect(tcfCalls).not.toContain("postRejectAll");

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });
});
