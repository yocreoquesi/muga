/**
 * E2E: Per-device confirmation prompts (#406)
 *
 * Exercises the per-device override flow introduced by #364.
 *
 * Setup. The user installed MUGA on Device A and enabled
 * `injectOwnAffiliate` and/or `remoteRulesEnabled`. Those prefs live in
 * chrome.storage.sync and propagate. Device B starts with the prefs
 * arriving as `true` from sync but with no local consent yet.
 *
 * Expected onboarding behaviour:
 *   - The affiliate checkbox is pre-checked AND the synced-from-other-
 *     device note is visible.
 *   - The remote-rules section (hidden by default) is revealed AND the
 *     remote-rules checkbox is pre-checked.
 *   - Unchecking the box and clicking Start writes a per-device
 *     override (`mugaPerDevicePrefs.<key> = false`) without touching
 *     the sync value.
 *
 * The unit suite covers the pure pendingConfirmations() logic. This
 * spec proves the onboarding page wires the inputs correctly and the
 * Start handler writes the correct overrides.
 */

import { test, expect } from "./fixtures.mjs";
import { seedStorage } from "./helpers/index.mjs";

async function clearAllStorage(context, extensionId) {
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
      new Promise(resolve => chrome.storage.sync.clear(resolve)),
      new Promise(resolve => chrome.storage.local.clear(resolve)),
    ])
  );
  if (opened) await page.close();
}

async function readPostOnboardingState(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  const result = await page.evaluate(() =>
    new Promise(resolve => {
      chrome.storage.sync.get(
        ["injectOwnAffiliate", "remoteRulesEnabled"],
        sync => {
          chrome.storage.local.get(
            { mugaConsent: null, mugaPerDevicePrefs: null },
            local => resolve({ sync, local })
          );
        }
      );
    })
  );
  if (opened) await page.close();
  return result;
}

test.describe("Per-device confirmation prompts (#406)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await clearAllStorage(context, extensionId);
  });

  test("affiliate prompt: pre-checked + synced-note visible when sync has injectOwnAffiliate=true", async ({ context, extensionId }) => {
    await seedStorage(context, extensionId, {
      sync: { injectOwnAffiliate: true },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    await expect(page.locator("#affiliate-check")).toBeChecked();
    await expect(page.locator("#affiliate-synced-note")).toBeVisible();

    await page.close();
  });

  test("remote-rules prompt: section revealed + checkbox pre-checked when sync has remoteRulesEnabled=true", async ({ context, extensionId }) => {
    await seedStorage(context, extensionId, {
      sync: { remoteRulesEnabled: true },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    await expect(page.locator("#remote-rules-section")).toBeVisible();
    await expect(page.locator("#remote-rules-check")).toBeChecked();

    await page.close();
  });

  test("declining the affiliate prompt writes a per-device override without touching sync", async ({ context, extensionId }) => {
    await seedStorage(context, extensionId, {
      sync: { injectOwnAffiliate: true },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    await page.locator("#affiliate-check").uncheck();
    await page.locator("#tos-check").check();
    await page.locator("#start-btn").click();
    await page.waitForEvent("close", { timeout: 5000 }).catch(() => {});

    const { sync, local } = await readPostOnboardingState(context, extensionId);

    // Sync still says true — declining on this device must NOT mutate
    // the value that other devices share.
    expect(sync.injectOwnAffiliate).toBe(true);

    // Local override records the decline for this device only.
    expect(local.mugaPerDevicePrefs).toMatchObject({ injectOwnAffiliate: false });

    // Onboarding completed.
    expect(local.mugaConsent.onboardingDone).toBe(true);
  });

  test("declining the remote-rules prompt writes a per-device override without touching sync", async ({ context, extensionId }) => {
    await seedStorage(context, extensionId, {
      sync: { remoteRulesEnabled: true },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    await page.locator("#remote-rules-check").uncheck();
    await page.locator("#tos-check").check();
    await page.locator("#start-btn").click();
    await page.waitForEvent("close", { timeout: 5000 }).catch(() => {});

    const { sync, local } = await readPostOnboardingState(context, extensionId);

    expect(sync.remoteRulesEnabled).toBe(true);
    expect(local.mugaPerDevicePrefs).toMatchObject({ remoteRulesEnabled: false });
    expect(local.mugaConsent.onboardingDone).toBe(true);
  });

  test("confirming a synced pref leaves no override (sync drives effective value)", async ({ context, extensionId }) => {
    await seedStorage(context, extensionId, {
      sync: { injectOwnAffiliate: true },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    // Box is already checked; just accept ToS and click Start.
    await page.locator("#tos-check").check();
    await page.locator("#start-btn").click();
    await page.waitForEvent("close", { timeout: 5000 }).catch(() => {});

    const { sync, local } = await readPostOnboardingState(context, extensionId);

    expect(sync.injectOwnAffiliate).toBe(true);
    // No override recorded for confirmed prefs — sync stays the source
    // of truth on this device too.
    if (local.mugaPerDevicePrefs) {
      expect(local.mugaPerDevicePrefs.injectOwnAffiliate).toBeUndefined();
    }
    expect(local.mugaConsent.onboardingDone).toBe(true);
  });

  test("no prompts when sync has neither pref enabled", async ({ context, extensionId }) => {
    // Seed sync with the prefs explicitly OFF — pendingConfirmations
    // should be empty, no synced-note, no remote-rules section.
    await seedStorage(context, extensionId, {
      sync: { injectOwnAffiliate: false, remoteRulesEnabled: false },
    });

    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    await expect(page.locator("#affiliate-synced-note")).toBeHidden();
    await expect(page.locator("#remote-rules-section")).toBeHidden();
    await expect(page.locator("#affiliate-check")).not.toBeChecked();

    await page.close();
  });
});
