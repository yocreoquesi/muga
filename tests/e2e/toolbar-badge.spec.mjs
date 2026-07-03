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

/**
 * Drives the REAL production updateTabBadge() path (not the synthetic
 * toolbar-bus emit). Writes the durable `tab_badge_{tabId}` session key and
 * emits urlCleaned exactly like the BADGE_AND_STATS handler.
 * @param {{ tabId: number, junkRemoved: number, coldCache?: boolean }} opts
 *   coldCache:true invalidates the prefs cache first, mirroring an evicted SW.
 */
async function updateTabBadge(context, extensionId, opts) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  const result = await page.evaluate((o) =>
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "__TEST__updateTabBadge", ...o }, resolve);
    }), opts
  );
  if (opened) await page.close();
  return result;
}

/** Wipes the presenter's in-memory badgeTotals map — simulates a SW restart. */
async function resetPresenterBadgeMap(context, extensionId) {
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
      chrome.runtime.sendMessage({ type: "__TEST__resetPresenterBadgeMap" }, resolve);
    })
  );
  if (opened) await page.close();
  return result;
}

/** Serves a tiny stub for a real https host so navigation hits no network. */
async function stubHost(page, hostname) {
  await page.route(`**://${hostname}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${hostname} stub</body></html>`,
    }),
  );
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

  test("cold/evicted SW still paints the badge — updateTabBadge warms prefs before emitting (#910 cold-SW race)", async ({ context, extensionId }) => {
    // The BADGE_AND_STATS path calls updateTabBadge fire-and-forget on a SW
    // that may be cold. If updateTabBadge emits urlCleaned before warming the
    // prefs cache, the presenter's isOnboardingDone() reads a null cachedPrefs,
    // defaults to false, and silently drops the badge write — the count would
    // never appear for that clean. This drives the REAL updateTabBadge() with
    // an invalidated cache and asserts the badge STILL paints.
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);

    const res = await updateTabBadge(context, extensionId, { tabId, junkRemoved: 3, coldCache: true });
    expect(res.ok).toBe(true);

    const surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.ok).toBe(true);
    expect(surface.badgeText).toBe("3");

    await hostPage.close();
  });

  test("showBadge OFF clears every tab's badge after a SW restart — durable session keys, empty in-memory map (#910 OFF-path)", async ({ context, extensionId }) => {
    const { page: pageA, tabId: tabIdA } = await openHostPageWithTabId(context, extensionId);
    const { page: pageB, tabId: tabIdB } = await openHostPageWithTabId(context, extensionId);
    expect(tabIdA).not.toBe(tabIdB);

    // Paint durable per-tab badges via the REAL updateTabBadge (writes the
    // tab_badge_* session keys that survive SW eviction).
    await updateTabBadge(context, extensionId, { tabId: tabIdA, junkRemoved: 4 });
    await updateTabBadge(context, extensionId, { tabId: tabIdB, junkRemoved: 6 });
    expect((await readActionSurface(context, extensionId, tabIdA)).badgeText).toBe("4");
    expect((await readActionSurface(context, extensionId, tabIdB)).badgeText).toBe("6");

    // Simulate a service-worker restart: the presenter's in-memory badge map
    // is wiped, but the durable session keys AND the browser-rendered badges
    // survive. Before the fix, the OFF handler iterated only the (now empty)
    // in-memory map and cleared nothing.
    const reset = await resetPresenterBadgeMap(context, extensionId);
    expect(reset.ok).toBe(true);

    // Toggle showBadge OFF. Must clear BOTH tabs from the durable list.
    await emitToolbarEvent(context, extensionId, { type: "showBadgePrefChanged", value: false });

    expect((await readActionSurface(context, extensionId, tabIdA)).badgeText).toBe("");
    expect((await readActionSurface(context, extensionId, tabIdB)).badgeText).toBe("");

    await pageA.close();
    await pageB.close();
  });

  test("badge survives a REAL in-tab navigation — browser clears per-tab badge on navigate; MUGA re-paints the durable total (#950 flicker regression)", async ({ context, extensionId }) => {
    // The synthetic-event tests above prove the presenter's LOGIC, but they
    // never trigger the browser's own per-tab badge reset (MDN
    // action.setBadgeText tabId: "reset when the user navigates this tab to a
    // new page"). This test drives a REAL navigation so the browser actually
    // wipes the badge, then asserts MUGA re-paints the running total from the
    // durable tab_badge_{tabId} session key via the production
    // chrome.tabs.onUpdated -> navigationStarted path.
    //
    // BEFORE the fix, navigationStarted reset only the tooltip, so after the
    // real navigation the badge stayed BLANK — the exact flicker the user saw.
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);

    // Paint a durable per-tab badge via the REAL updateTabBadge path (writes
    // the tab_badge_{tabId} session key the onUpdated handler reads back).
    await updateTabBadge(context, extensionId, { tabId, junkRemoved: 3 });
    expect((await readActionSurface(context, extensionId, tabId)).badgeText).toBe("3");

    // Perform a REAL in-tab navigation to a stubbed host (no network). This
    // fires the production onUpdated(status:"loading") handler for this tabId
    // and makes the browser reset the per-tab badge text.
    await stubHost(hostPage, "example.com");
    await hostPage.goto("https://example.com/second");

    // The onUpdated -> bus -> presenter re-paint is async; poll the real
    // chrome.action badge surface until it settles. It must return to the
    // accumulated total, NOT stay blank.
    await expect.poll(
      async () => (await readActionSurface(context, extensionId, tabId)).badgeText,
      { timeout: 5000, message: "badge must be re-painted after the navigation reset" },
    ).toBe("3");

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
