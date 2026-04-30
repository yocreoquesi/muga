/**
 * E2E: Migration banner round-trip (#407)
 *
 * Drives the dormant migration-banner UI from #369 by injecting a
 * fixture migration spec + fixture i18n keys via `withFixtureManifest`
 * (gated on the test-mode sentinel from #398).
 *
 * Fixture migration:
 *   id              = "fixture-flip"
 *   fromVersion     = "1.0.0"
 *   toVersion       = "2.0.0"
 *   prefs           = ["fixturePref"]
 *   proposedValue   = { fixturePref: true }
 *   networkRelated  = false
 *   bannerCopyKey   = "fixture_banner"
 *
 * Fixture i18n:
 *   fixture_banner_title = "Fixture migration"
 *   fixture_banner_body  = "We'd like to enable a fixture pref. Confirm?"
 *
 * Storage seed: `mugaPrevVersion = "1.0.0"`, fixture currentVersion =
 * "2.0.0", so the upgrade window matches.
 *
 * Cases: accept (writes pref + records "accept"), decline (no pref,
 * records "decline"), dismiss (no pref, records "dismiss", banner
 * does not re-show on next popup open within the same session).
 */

import { test, expect } from "./fixtures.mjs";
import {
  seedStorage,
  installTestModeSentinel,
  clearTestModeSentinel,
  withFixtureManifest,
  clearFixtures,
} from "./helpers/index.mjs";

const FIXTURE = {
  migrations: [
    {
      id: "fixture-flip",
      fromVersion: "1.0.0",
      toVersion: "2.0.0",
      prefs: ["fixturePref"],
      proposedValue: { fixturePref: true },
      networkRelated: false,
      bannerCopyKey: "fixture_banner",
    },
  ],
  i18nOverrides: {
    fixture_banner_title: "Fixture migration",
    fixture_banner_body: "We'd like to enable a fixture pref. Confirm?",
  },
  currentVersion: "2.0.0",
};

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

async function seedConsentAndPrev(context, extensionId) {
  await seedStorage(context, extensionId, {
    sync: {
      onboardingDone: true,  // legacy sync (will overlay-lose to local consent)
    },
    local: {
      mugaConsent: { onboardingDone: true, consentVersion: "1.0", consentDate: 1700000000000 },
      mugaPrevVersion: "1.0.0",
    },
  });
}

async function readState(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  const state = await page.evaluate(() =>
    new Promise(resolve => {
      chrome.storage.sync.get(["fixturePref"], sync => {
        chrome.storage.local.get({ migrationResponses: {} }, local =>
          resolve({ sync, local })
        );
      });
    })
  );
  if (opened) await page.close();
  return state;
}

test.describe("Migration banner round-trip (#407)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await clearAll(context, extensionId);
    await installTestModeSentinel(context, extensionId);
    await seedConsentAndPrev(context, extensionId);
    await withFixtureManifest(context, extensionId, FIXTURE);
  });

  test.afterEach(async ({ context, extensionId }) => {
    await clearFixtures(context, extensionId);
    await clearTestModeSentinel(context, extensionId);
  });

  test("banner renders with fixture copy when the fixture migration is pending", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const banner = page.locator("#migration-banner");
    await expect(banner).toBeVisible();
    await expect(page.locator("#migration-banner-title")).toHaveText("Fixture migration");
    await expect(page.locator("#migration-banner-body")).toHaveText("We'd like to enable a fixture pref. Confirm?");

    await page.close();
  });

  test("accept writes the pref + records 'accept' + hides the banner", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await expect(page.locator("#migration-banner")).toBeVisible();
    await page.locator("#migration-banner-accept").click();
    await expect(page.locator("#migration-banner")).toBeHidden();

    await page.close();

    const { sync, local } = await readState(context, extensionId);
    expect(sync.fixturePref).toBe(true);
    expect(local.migrationResponses["fixture-flip"]).toBe("accept");
  });

  test("decline leaves the pref untouched + records 'decline' + hides the banner", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await expect(page.locator("#migration-banner")).toBeVisible();
    await page.locator("#migration-banner-decline").click();
    await expect(page.locator("#migration-banner")).toBeHidden();

    await page.close();

    const { sync, local } = await readState(context, extensionId);
    expect(sync.fixturePref).toBeUndefined();
    expect(local.migrationResponses["fixture-flip"]).toBe("decline");
  });

  test("dismiss leaves the pref untouched + records 'dismiss' + banner does not re-show on next popup open", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    await expect(page.locator("#migration-banner")).toBeVisible();
    await page.locator("#migration-banner-dismiss").click();
    await expect(page.locator("#migration-banner")).toBeHidden();

    await page.close();

    const { sync, local } = await readState(context, extensionId);
    expect(sync.fixturePref).toBeUndefined();
    expect(local.migrationResponses["fixture-flip"]).toBe("dismiss");

    // Re-open popup — banner should stay hidden (response recorded, the
    // evaluator skips migrations with any recorded response).
    const page2 = await context.newPage();
    await page2.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    await expect(page2.locator("#migration-banner")).toBeHidden();
    await page2.close();
  });
});
