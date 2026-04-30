/**
 * E2E: Re-onboard rendering — delta + material modes (#407)
 *
 * Drives the dormant rendering paths from #370 by injecting fixture
 * overrides for `CONSENT_VERSION_MANIFEST` and `REQUIRED_CONSENT_VERSION`
 * via `withFixtureManifest` (gated on the test-mode sentinel from #398).
 *
 * Three scenarios:
 *
 *   delta:    accepted 1.0, manifest [1.0, 1.1 additive], required 1.1
 *             → mugaReonboardMode === "delta"
 *             → features section hidden, delta banner visible
 *             → clicking Start writes consent.consentVersion === "1.1"
 *
 *   material: accepted 1.0, manifest [1.0, 1.1 material], required 1.1
 *             → mugaReonboardMode === "material"
 *             → material banner visible, features section hidden
 *             → getPrefs() onboardingDone falls back to false (gate
 *               fires) — verified by reading prefs from the SW.
 *
 *   fresh:    no fixture; default behaviour stays "fresh".
 */

import { test, expect } from "./fixtures.mjs";
import {
  seedStorage,
  installTestModeSentinel,
  clearTestModeSentinel,
  withFixtureManifest,
  clearFixtures,
} from "./helpers/index.mjs";

async function clearAll(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  await page.evaluate(() =>
    Promise.all([
      new Promise(r => chrome.storage.sync.clear(r)),
      new Promise(r => chrome.storage.local.clear(r)),
    ])
  );
  if (opened) await page.close();
}

async function readPrefsViaSW(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  const prefs = await page.evaluate(() =>
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "getPrefs" }, resolve);
    })
  );
  if (opened) await page.close();
  return prefs;
}

test.describe("Re-onboard rendering: delta + material (#407)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await clearAll(context, extensionId);
    await installTestModeSentinel(context, extensionId);
  });

  test.afterEach(async ({ context, extensionId }) => {
    await clearFixtures(context, extensionId);
    await clearTestModeSentinel(context, extensionId);
  });

  test("delta mode: additive bump renders soft re-onboard banner", async ({ context, extensionId }) => {
    // Local consent: user accepted 1.0 previously.
    await seedStorage(context, extensionId, {
      local: {
        mugaConsent: {
          onboardingDone: true,
          consentVersion: "1.0",
          consentDate: 1700000000000,
        },
      },
    });

    // Manifest fixture: 1.0 baseline + 1.1 additive. Required is 1.1.
    await withFixtureManifest(context, extensionId, {
      consentManifest: [
        { version: "1.0", additive: false },
        { version: "1.1", additive: true },
      ],
      requiredConsentVersion: "1.1",
      consentClausesByVersion: { "1.0": [], "1.1": [] }, // empty clauses ok
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    expect(await page.evaluate(() => document.body.dataset.mugaReonboardMode)).toBe("delta");
    await expect(page.locator("#features-section")).toBeHidden();
    await expect(page.locator("#reonboard-delta")).toBeVisible();
    await expect(page.locator("#reonboard-material")).toBeHidden();

    // Click Start — writes consent.consentVersion === "1.1" against the
    // fixture's required version.
    await page.locator("#tos-check").check();
    await page.locator("#start-btn").click();
    await page.waitForEvent("close", { timeout: 5000 }).catch(() => {});

    const verifyPage = await context.newPage();
    await verifyPage.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    const consent = await verifyPage.evaluate(() =>
      new Promise(resolve =>
        chrome.storage.local.get({ mugaConsent: null }, r => resolve(r.mugaConsent))
      )
    );
    expect(consent.onboardingDone).toBe(true);
    expect(consent.consentVersion).toBe("1.1");
    await verifyPage.close();
  });

  test("material mode: non-additive bump renders hard re-onboard banner", async ({ context, extensionId }) => {
    await seedStorage(context, extensionId, {
      local: {
        mugaConsent: {
          onboardingDone: true,
          consentVersion: "1.0",
          consentDate: 1700000000000,
        },
      },
    });

    await withFixtureManifest(context, extensionId, {
      consentManifest: [
        { version: "1.0", additive: false },
        { version: "1.1", additive: false }, // material change
      ],
      requiredConsentVersion: "1.1",
      consentClausesByVersion: { "1.0": [], "1.1": [] },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    expect(await page.evaluate(() => document.body.dataset.mugaReonboardMode)).toBe("material");
    await expect(page.locator("#features-section")).toBeHidden();
    await expect(page.locator("#reonboard-material")).toBeVisible();
    await expect(page.locator("#reonboard-delta")).toBeHidden();

    await page.close();

    // Hard-reonboard gate (#370) — getPrefs() forces onboardingDone:false
    // when the consent policy says material change pending. Verify by
    // reading prefs through the SW message handler.
    const prefs = await readPrefsViaSW(context, extensionId);
    expect(prefs.onboardingDone).toBe(false);
  });

  test("fresh mode: no fixtures means default rendering", async ({ context, extensionId }) => {
    // No consent stored, no fixtures applied beyond the sentinel —
    // onboarding renders the standard fresh flow.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    expect(await page.evaluate(() => document.body.dataset.mugaReonboardMode)).toBe("fresh");
    await expect(page.locator("#features-section")).toBeVisible();
    await expect(page.locator("#reonboard-delta")).toBeHidden();
    await expect(page.locator("#reonboard-material")).toBeHidden();

    await page.close();
  });
});
