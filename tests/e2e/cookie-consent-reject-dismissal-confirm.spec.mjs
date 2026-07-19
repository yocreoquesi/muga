/**
 * E2E: Cookie Consent Minimizer — post-reject dismissal confirmation
 * (#1123 / reject() honesty follow-up)
 *
 * Verifies `confirmRejectDismissal` in content/cookie-noise-mainworld.js:
 * a PURELY OBSERVATIONAL, bounded async check that runs AFTER a Tier-1
 * reject call has already fired (and after `_acted`/`stopObserver()` have
 * already run). It never gates or alters that existing behavior — it only
 * warns to the console when the reject call fired but the banner did not
 * clear from the DOM within the bounded window, surfacing silent
 * vendor-API drift. On the normal (confirmed-dismissal) path it stays
 * silent.
 *
 * Mirrors tests/e2e/cookie-consent-minimizer.spec.mjs's structure exactly
 * (same onboarding helper shape, same feature pref, same OneTrust fixture
 * family) since the confirmation mechanism is adapter-agnostic and the
 * OneTrust adapter is the simplest one to exercise it against.
 *
 * HONEST LIMIT (per design doc): this is a REGRESSION oracle only — a
 * snapshot of one fixture's behavior at write time. It proves the Chrome
 * MAIN-world caller's confirmation timer (content/cookie-noise-mainworld.js).
 * It does NOT validate the Firefox `window.wrappedJSObject` mirror
 * (content/cookie-noise.js) — Playwright's `chromium` fixture only
 * exercises Chrome. The Firefox path requires a real Firefox run (per
 * MUGA's Chrome DNR-regex memory-limit lesson: unit/Chromium-green does
 * not guarantee real-env-green on every engine) — flagged for sdd-verify.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST_DISMISSES = "muga-test-cookie-consent-confirm-ok.invalid";
const HOST_SILENT_FAIL = "muga-test-cookie-consent-confirm-drift.invalid";

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
 * Fixture page: a OneTrust banner whose RejectAll() genuinely removes the
 * banner from the DOM — the normal, confirmed-dismissal path. Same signal
 * shape as tests/e2e/cookie-consent-minimizer.spec.mjs's stubOneTrustPage.
 */
async function stubOneTrustPageDismisses(page) {
  await page.route(`**://${HOST_DISMISSES}/**`, (route) =>
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

/**
 * Fixture page: a OneTrust banner whose RejectAll() fires (sets a marker,
 * exactly like a real vendor call) but does NOT remove the banner from the
 * DOM — simulating a silent vendor-API drift where the reject call
 * "succeeds" (no throw) yet the banner never actually clears.
 */
async function stubOneTrustPageSilentFail(page) {
  await page.route(`**://${HOST_SILENT_FAIL}/**`, (route) =>
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
              // Fires (marker set, no throw) but deliberately leaves the
              // banner DOM node in place — the drift this test proves MUGA
              // surfaces via a console warning instead of silently no-oping.
              window.__consentState = "necessary-only";
            },
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — post-reject dismissal confirmation (#1123)", () => {
  test("stays silent when the banner is confirmed dismissed", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    const consoleWarnings = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    page.on("console", (msg) => {
      if (msg.type() === "warning" && msg.text().includes("[MUGA] cookie-consent")) {
        consoleWarnings.push(msg.text());
      }
    });
    await stubOneTrustPageDismisses(page);
    await page.goto(`https://${HOST_DISMISSES}/index.html`);

    // Wait for the Chrome MAIN-world caller's once-guard flag — set only
    // after the nonce handshake completes and the gate opens.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The dispatcher acts on gate-open (initial sweep) or on the
    // MutationObserver's first pass — poll for the outcome.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const bannerGone = await page.evaluate(() => document.getElementById("onetrust-banner-sdk") === null);
    expect(bannerGone).toBe(true);

    // REASON: confirmRejectDismissal polls up to 3000ms before it could warn —
    // settle past that window to prove no warning was EVER emitted on the
    // confirmed-dismissal path, not just that none had fired yet.
    await page.waitForTimeout(3500);

    expect(consoleWarnings).toHaveLength(0);
    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("warns once when a reject fires but the banner does not clear within the bounded window", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    const consoleWarnings = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    page.on("console", (msg) => {
      if (msg.type() === "warning" && msg.text().includes("[MUGA] cookie-consent")) {
        consoleWarnings.push(msg.text());
      }
    });
    await stubOneTrustPageSilentFail(page);
    await page.goto(`https://${HOST_SILENT_FAIL}/index.html`);

    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The reject call fires (its marker is set) even though the banner
    // never clears — this is the existing, unaltered _acted behavior.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    // The banner is still present — the drift this test is proving.
    const bannerStillThere = await page.evaluate(
      () => document.getElementById("onetrust-banner-sdk") !== null
    );
    expect(bannerStillThere).toBe(true);

    // REASON: the confirmation warning only fires after the bounded
    // REJECT_CONFIRM_WINDOW_MS (3000ms) elapses — settle past that window
    // before asserting the warning was logged.
    await page.waitForTimeout(3500);

    const driftWarning = consoleWarnings.find((text) =>
      text.includes("[MUGA] cookie-consent: onetrust reject fired but its banner did not clear")
    );
    expect(driftWarning).toBeTruthy();

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });
});
