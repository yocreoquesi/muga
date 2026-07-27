/**
 * E2E: Cookie Consent Minimizer — Osano Tier 2 rule (cookie-consent-toggle-
 * reject, PR 3 — PIVOTED from a `toggleScope` multi-step rule to a simple
 * direct-reject rule after a live probe of osano.com found Osano exposes a
 * genuine one-click "Reject Non-Essential" control and, under GDPR, defaults
 * its non-essential categories to OFF — the toggle-sweep-and-save machinery
 * (design.md ADR-1/ADR-5) is the wrong tool for this CMP).
 *
 * Verifies the BUNDLED `osano` entry in TIER2_RULES (src/lib/cmp-tier2-rules.js)
 * against a real Chromium with the extension loaded, using a SYNTHETIC
 * fixture that reproduces Osano's banner DOM shape:
 * `.osano-cm-dialog--type_bar` (banner anchor) containing a
 * `.osano-cm-denyAll` reject control and a structurally distinct opt-in
 * control. Mirrors tests/e2e/cookie-consent-minimizer.spec.mjs's structure
 * (the OneTrust Tier 1 spec) — this rule needs no remote-rule injection
 * because, unlike the toggle-reject mechanism's PR 2 synthetic fixture, it
 * is a real BUNDLED entry, not fixture-only data.
 *
 * HONEST LIMIT (same posture as the sibling Tier 2 e2e specs): a
 * synthetic-fixture regression oracle only, Chromium-only. It does not
 * prove compatibility with real osano.com markup beyond the 2026-07 EU-
 * vantage live probe this rule's selectors are cited from — re-capture this
 * fixture manually whenever Osano's markup changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-osano.invalid";

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
 * Fixture: reproduces Osano's bottom-bar banner DOM shape — the
 * `.osano-cm-dialog--type_bar` anchor, a `.osano-cm-denyAll` reject
 * button (localized text, EN here), and a structurally distinct opt-in
 * control that must NEVER be clicked.
 */
async function stubOsanoPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div class="osano-cm-dialog--type_bar" role="dialog" aria-label="Cookie Consent Banner" id="osano-random-uuid-marker">
          <button class="osano-cm-denyAll osano-cm-button--type_denyAll" id="osano-deny-btn">Reject Non-Essential</button>
          <button class="osano-cm-accept-all osano-cm-button--type_accept" id="osano-accept-btn">Accept All</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__e2eClicks = [];
          var banner = document.getElementById("osano-random-uuid-marker");
          document.getElementById("osano-deny-btn").addEventListener("click", function () {
            window.__e2eClicks.push("deny");
            window.__consentState = "necessary-only";
            banner.remove();
          });
          document.getElementById("osano-accept-btn").addEventListener("click", function () {
            window.__e2eClicks.push("accept");
          });
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — Osano (cookie-consent-toggle-reject, PR 3)", () => {
  test("clicks the bundled Osano reject control, dismisses the banner, and never clicks the opt-in decoy", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubOsanoPage(page);
    await page.goto(`https://${HOST}/index.html`);

    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const clicks = await page.evaluate(() => window.__e2eClicks);
    expect(clicks).toEqual(["deny"]);
    expect(clicks).not.toContain("accept");

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    const bannerGone = await page.evaluate(() => document.getElementById("osano-random-uuid-marker") === null);
    expect(bannerGone).toBe(true);

    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("takes no action when the feature is disabled (default OFF) — the opt-in decoy is never clicked either", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: false });

    const page = await context.newPage();
    await stubOsanoPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // REASON: negative assertion (feature OFF) — no positive signal to wait
    // on; fixed settle window, the standard pattern for this suite's
    // negatives (see cookie-consent-minimizer.spec.mjs).
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__e2eClicks);
    expect(clicks).toEqual([]);
    const bannerStillThere = await page.evaluate(() => document.getElementById("osano-random-uuid-marker") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
