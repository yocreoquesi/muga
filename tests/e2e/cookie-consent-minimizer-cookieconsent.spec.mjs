/**
 * E2E: Cookie Consent Minimizer — cookieconsent.js (Osano/Insites) Tier 2
 * rule (standalone follow-up to cookie-consent-toggle-reject PR 3, live
 * probe 2026-07).
 *
 * Verifies the BUNDLED `cookieconsent` entry in TIER2_RULES
 * (src/lib/cmp-tier2-rules.js) against a real Chromium with the extension
 * loaded, using a SYNTHETIC fixture that reproduces cookieconsent.js's
 * banner DOM shape: `.cc-window` (banner anchor) containing a `.cc-deny`
 * reject control and a structurally distinct opt-in control (`.cc-allow`).
 * Mirrors tests/e2e/cookie-consent-minimizer-osano.spec.mjs's structure —
 * this rule needs no remote-rule injection because it is a real BUNDLED
 * entry, not fixture-only data.
 *
 * Also covers the library's common "info" variant, which ships only a
 * `.cc-dismiss` ("Got it") acknowledgement button and NO `.cc-deny` at
 * all: `present` still matches (`.cc-window` is there), but the fail-closed
 * 0-match branch in `resolveTier2Reject` must NOOP — the banner stays and
 * nothing is clicked.
 *
 * HONEST LIMIT (same posture as the sibling Tier 2 e2e specs): a
 * synthetic-fixture regression oracle only, Chromium-only. It does not
 * prove compatibility with real cookieconsent.js markup beyond the 2026-07
 * EU-vantage live probe (11+ deployments) this rule's selectors are cited
 * from — re-capture this fixture manually whenever the library's markup
 * changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-cookieconsent.invalid";
const INFO_HOST = "muga-test-cookie-consent-cookieconsent-info.invalid";

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
  await waitForDnrPropagation(page);
}

/**
 * Fixture: reproduces cookieconsent.js's opt-in/opt-out banner DOM shape —
 * the `.cc-window` anchor, a `.cc-deny` reject button (EN "Decline"), and
 * a structurally distinct opt-in control (`.cc-allow`) that must NEVER be
 * clicked.
 */
async function stubCookieconsentPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div class="cc-window cc-banner cc-type-opt-out" id="cc-window-marker">
          <button class="cc-deny cc-btn" id="cc-deny-btn">Decline</button>
          <button class="cc-allow cc-btn" id="cc-allow-btn">Allow cookies</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__e2eClicks = [];
          var banner = document.getElementById("cc-window-marker");
          document.getElementById("cc-deny-btn").addEventListener("click", function () {
            window.__e2eClicks.push("deny");
            window.__consentState = "necessary-only";
            banner.remove();
          });
          document.getElementById("cc-allow-btn").addEventListener("click", function () {
            window.__e2eClicks.push("accept");
          });
        </script>
      </body></html>`,
    })
  );
}

/**
 * Fixture: reproduces cookieconsent.js's "info" variant DOM shape — a
 * `.cc-window` anchor with ONLY a `.cc-dismiss` ("Got it") acknowledgement
 * button, no `.cc-deny` at all. `resolveTier2Reject` must fail-closed NOOP
 * here (0 reject candidates), leaving the banner untouched.
 */
async function stubCookieconsentInfoPage(page) {
  await page.route(`**://${INFO_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div class="cc-window cc-banner cc-type-info" id="cc-window-info-marker">
          <button class="cc-dismiss cc-btn" id="cc-dismiss-btn">Got it</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__e2eClicks = [];
          document.getElementById("cc-dismiss-btn").addEventListener("click", function () {
            window.__e2eClicks.push("dismiss");
          });
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — cookieconsent.js (Osano/Insites)", () => {
  test("clicks the bundled .cc-deny reject control, dismisses the banner, and never clicks the .cc-allow decoy", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubCookieconsentPage(page);
    await page.goto(`https://${HOST}/index.html`);

    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const clicks = await page.evaluate(() => window.__e2eClicks);
    expect(clicks).toEqual(["deny"]);
    expect(clicks).not.toContain("accept");

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    const bannerGone = await page.evaluate(() => document.getElementById("cc-window-marker") === null);
    expect(bannerGone).toBe(true);

    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("takes no action when the feature is disabled (default OFF) — the .cc-allow decoy is never clicked either", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: false });

    const page = await context.newPage();
    await stubCookieconsentPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // REASON: negative assertion (feature OFF) — no positive signal to wait
    // on; fixed settle window, the standard pattern for this suite's
    // negatives (see cookie-consent-minimizer.spec.mjs).
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__e2eClicks);
    expect(clicks).toEqual([]);
    const bannerStillThere = await page.evaluate(() => document.getElementById("cc-window-marker") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });

  test("the dismiss-only 'info' variant (no .cc-deny) is a fail-closed NOOP — banner stays, nothing is clicked", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    await stubCookieconsentInfoPage(page);
    await page.goto(`https://${INFO_HOST}/index.html`);

    // REASON: negative assertion (fail-closed NOOP, no `.cc-deny` present) —
    // no positive signal to wait on; fixed settle window, mirroring the
    // disabled-feature negative above.
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__e2eClicks);
    expect(clicks).toEqual([]);
    const bannerStillThere = await page.evaluate(() => document.getElementById("cc-window-info-marker") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
