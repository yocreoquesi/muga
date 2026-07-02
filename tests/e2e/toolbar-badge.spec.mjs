/**
 * E2E: Toolbar badge — per-tab running count (#910)
 *
 * Re-introduces a per-tab toolbar badge: a running count of tracking
 * params MUGA has stripped in a tab, rendered via the browser's NATIVE
 * badge API (chrome.action.setBadgeText/setBadgeBackgroundColor) — the
 * same mechanism uBlock Origin uses. This spec proves the real
 * chrome.action surface in an actual Chrome instance, exactly the same
 * way tests/e2e/toolbar-visibility.spec.mjs proves the tooltip surface:
 * synthetic events driven onto the production toolbar bus via
 * __TEST__emitToolbarEvent, then read back through
 * __TEST__readActionSurface (a real chrome.action.getBadgeText call).
 *
 * The unit suite (tests/unit/toolbar-presenter.test.mjs) exercises the
 * presenter's pure accumulation/gating logic exhaustively. This spec
 * proves the four HARD CONSTRAINTS from #910 hold in a real browser:
 *   1. The count is readable via the native chrome.action.getBadgeText.
 *   2. It is genuinely per-tab (two tabs never see each other's count).
 *   3. It resets on tab close.
 *   4. setIcon is NEVER called (the f6a6e2b regression this feature
 *      must not repeat) and the static manifest icon ships unchanged.
 */

import { test, expect } from "./fixtures.mjs";
import {
  installTestModeSentinel,
  clearTestModeSentinel,
  readActionSurface,
  seedStorage,
  waitForDnrPropagation,
} from "./helpers/index.mjs";

// The badge is gated on onboarding being complete (the global "!" consent
// badge must win over the count while onboarding is pending — #910). The
// bare `context` fixture does NOT complete onboarding (unlike popupPage /
// optionsPage), so every test here must seed consent directly, mirroring
// enableInjection() in inject-affiliate-direct-nav.spec.mjs.
//
// The SW's prefs cache refresh (storage.onChanged → getPrefsWithCache())
// is async with no observable completion signal — waitForDnrPropagation
// is the established, documented wait for exactly this race (#824), but
// its fixed 500ms floor is occasionally too short for onboardingDone
// specifically (observed flake in the full-suite run, where the SW is
// busier). Poll the actual "getPrefs" response — which reads through
// getPrefsWithCache(), the same cache the presenter's isOnboardingDone()
// accessor reads — until onboardingDone is confirmed true, so this wait
// is a real condition, not a guess.
async function completeOnboarding(context, extensionId) {
  await seedStorage(context, extensionId, {
    local: {
      mugaConsent: {
        onboardingDone: true,
        consentVersion: "1.1",
        consentDate: Date.now(),
      },
    },
  });
  await waitForDnrPropagation(context, extensionId);

  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  await page.waitForFunction(() =>
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "getPrefs" }, (r) => resolve(!!r?.onboardingDone));
    }), { timeout: 5000 }
  );
  if (opened) await page.close();
}

async function emitToolbarEvent(context, extensionId, event) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  const result = await page.evaluate((ev) =>
    new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: "__TEST__emitToolbarEvent", event: ev },
        resolve
      );
    }), event
  );
  if (opened) await page.close();
  return result;
}

/** Opens a fresh extension page (becomes the active tab) and returns its real tabId. */
async function openHostPageWithTabId(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  const page = await context.newPage();
  await page.goto(`${extOrigin}/popup/popup.html`);
  const result = await page.evaluate(() =>
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "__TEST__getActiveTabId" }, resolve);
    })
  );
  if (!result?.ok) {
    await page.close();
    throw new Error(`getActiveTabId failed: ${result?.error}`);
  }
  return { page, tabId: result.tabId };
}

async function readActionApiCounts(context, extensionId) {
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
      chrome.runtime.sendMessage({ type: "__TEST__readActionApiCounts" }, resolve);
    })
  );
  if (opened) await page.close();
  return result.counts;
}

async function resetActionApiCounts(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  await page.evaluate(() =>
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "__TEST__resetActionApiCounts" }, resolve);
    })
  );
  if (opened) await page.close();
}

test.describe("Toolbar badge — per-tab running count (#910)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await installTestModeSentinel(context, extensionId);
    await completeOnboarding(context, extensionId);
    await resetActionApiCounts(context, extensionId);
  });

  test.afterEach(async ({ context, extensionId }) => {
    await clearTestModeSentinel(context, extensionId);
  });

  test("badge shows the running count via the native chrome.action badge API", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 3 });
    let surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.ok).toBe(true);
    expect(surface.badgeText).toBe("3");

    // Accumulates — a second strip on the same tab adds to the running total.
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 2 });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("5");

    await hostPage.close();
  });

  test("badge survives navigationStarted — running tab total, not per-page", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 4 });
    await emitToolbarEvent(context, extensionId, { type: "navigationStarted", tabId });
    let surface = await readActionSurface(context, extensionId, tabId);
    // The tooltip resets on navigation, but the badge total must not.
    expect(surface.badgeText).toBe("4");

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 1 });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("5");

    await hostPage.close();
  });

  test("per-tab isolation: two tabs show independent counts", async ({ context, extensionId }) => {
    const { page: pageA, tabId: tabIdA } = await openHostPageWithTabId(context, extensionId);
    const { page: pageB, tabId: tabIdB } = await openHostPageWithTabId(context, extensionId);
    expect(tabIdA).not.toBe(tabIdB);

    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId: tabIdA });
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId: tabIdB });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId: tabIdA, paramsRemoved: 3 });
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId: tabIdB, paramsRemoved: 9 });

    const surfaceA = await readActionSurface(context, extensionId, tabIdA);
    const surfaceB = await readActionSurface(context, extensionId, tabIdB);
    expect(surfaceA.badgeText).toBe("3");
    expect(surfaceB.badgeText).toBe("9");

    // Switching "attention" between tabs (reading either at any point) must
    // never show a stale value carried over from the other tab.
    const surfaceAAgain = await readActionSurface(context, extensionId, tabIdA);
    expect(surfaceAAgain.badgeText).toBe("3");

    await pageA.close();
    await pageB.close();
  });

  test("tab close resets the running total; a reused tabId starts fresh", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 8 });
    let surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("8");

    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 1 });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("1");

    await hostPage.close();
  });

  test("no digit is shown for a fresh tab that has cleaned nothing", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    const surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("");

    await hostPage.close();
  });

  test("setIcon is NEVER called — the badge is a native overlay, not a composited icon (f6a6e2b regression guard)", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await resetActionApiCounts(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 3 });
    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    await emitToolbarEvent(context, extensionId, { type: "navigationStarted", tabId });
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 2 });
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    const counts = await readActionApiCounts(context, extensionId);
    expect(counts.setIcon).toBe(0);
    // Sanity: the badge surface DID fire (otherwise the setIcon===0
    // assertion above would pass vacuously because nothing ran at all).
    expect(counts.setBadgeText).toBeGreaterThan(0);

    await hostPage.close();
  });

  test("the static manifest icon ships unchanged and is reachable", async ({ context, extensionId }) => {
    const extOrigin = `chrome-extension://${extensionId}`;
    const page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);

    const manifest = await page.evaluate(() => chrome.runtime.getManifest());
    // No icon-variant entries (e.g. "16-preserved.png") — a single static
    // icon set declared in the manifest, per the #910 hard constraint.
    const actionIcons = manifest.action?.default_icon || manifest.browser_action?.default_icon || {};
    const iconPaths = Object.values(actionIcons);
    expect(iconPaths.length).toBeGreaterThan(0);
    for (const p of iconPaths) {
      expect(p).not.toMatch(/preserved/i);
    }

    for (const p of iconPaths) {
      const status = await page.evaluate((path) =>
        fetch(chrome.runtime.getURL(path)).then(r => r.status).catch(() => 0), p
      );
      expect(status).toBe(200);
    }

    await page.close();
  });
});
