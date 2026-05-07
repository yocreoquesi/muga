/**
 * E2E: Toolbar visibility — tooltip, badge color, icon variant (#408)
 *
 * Drives synthetic toolbar events onto the same bus the production
 * code uses (via __TEST__emitToolbarEvent in the SW), then reads back
 * the chrome.action surface state for assertion (via the
 * readActionSurface helper from #398).
 *
 * The unit suite (tests/unit/toolbar-presenter.test.mjs) exercises the
 * presenter's pure logic. This spec exercises the actual chrome.action
 * surface a real browser would render, including the per-tab state
 * cache, idempotency guards, and tab-close eviction semantics.
 */

import { test, expect } from "./fixtures.mjs";
import {
  installTestModeSentinel,
  clearTestModeSentinel,
  readActionSurface,
} from "./helpers/index.mjs";

const BADGE_BLUE   = [37, 99, 235, 255];
const BADGE_GREEN  = [22, 163, 74, 255];
const BADGE_YELLOW = [202, 138, 4, 255];

async function emitToolbarEvent(context, extensionId, event) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  // The SW dispatches on `message.type` to find the __TEST__ handler;
  // the inner toolbar event has its own `type` field. Pass the inner
  // event under `event` so the keys do not collide.
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

async function openHostPageWithTabId(context, extensionId) {
  // Opens a stable extension page that stays alive for the test, and
  // returns its tabId. chrome.action per-tab calls only persist on
  // live tabs — closing the host page after each emit/read would
  // make setBadgeText / setIcon silent no-ops on subsequent reads.
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

test.describe("Toolbar visibility (#408)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await installTestModeSentinel(context, extensionId);
    await resetActionApiCounts(context, extensionId);
  });

  test.afterEach(async ({ context, extensionId }) => {
    await clearTestModeSentinel(context, extensionId);
  });

  test("tooltip transitions: default → cleaned → preserved → cleaned+preserved", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    // urlCleaned with paramsRemoved=3 → tooltip becomes "tooltip_cleaned".
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 3 });
    let surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.ok).toBe(true);
    expect(surface.title).toBeTruthy();
    const cleanedTitle = surface.title;
    expect(cleanedTitle.toLowerCase()).toMatch(/tracking|removed|cleaned|limpi|removid/i);
    expect(surface.badgeText).toBe("3");

    // Now creatorReferralPreserved fires too → tooltip becomes the
    // combined string.
    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.title).not.toBe(cleanedTitle);
    expect(surface.iconKind).toBe("preserved");

    await hostPage.close();
  });

  test("badge color: routine cleaning is blue, preserved switches to green, navigation resets to blue", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 2 });
    let surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeColor).toEqual(BADGE_BLUE);

    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeColor).toEqual(BADGE_GREEN);

    // navigationStarted clears the per-tab override → falls back to the
    // global default (blue) we set at SW startup.
    await emitToolbarEvent(context, extensionId, { type: "navigationStarted", tabId });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeColor).toEqual(BADGE_BLUE);
    expect(surface.badgeText).toBe("");

    await hostPage.close();
  });

  test("badge color: foreignAffiliateDetected switches to yellow", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "foreignAffiliateDetected", tabId });
    const surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeColor).toEqual(BADGE_YELLOW);

    await hostPage.close();
  });

  test("badge text: count accumulates per tab and resets on navigationStarted", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 4 });
    let surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("4");

    // navigationStarted clears badge text.
    await emitToolbarEvent(context, extensionId, { type: "navigationStarted", tabId });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("");

    await hostPage.close();
  });

  test("icon variant: creatorReferralPreserved switches the icon, navigation reset returns to default", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    let surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.iconKind).toBe("preserved");

    await emitToolbarEvent(context, extensionId, { type: "navigationStarted", tabId });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.iconKind).toBe("default");

    await hostPage.close();
  });

  test("idempotency: repeated events with the same state do not produce redundant action calls", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await resetActionApiCounts(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    const after1 = await readActionApiCounts(context, extensionId);

    // Emit again — state is already creatorReferralPreserved=true, so
    // nothing in the resolved tooltip / badge color / icon changes.
    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    const after2 = await readActionApiCounts(context, extensionId);

    // setTitle / setBadgeBackgroundColor / setIcon must NOT have been
    // called again — the resolved values are the same.
    // Sanity check: the FIRST emit must have produced calls — otherwise
    // the equality below passes vacuously when nothing fires at all.
    expect(after1.setTitle).toBeGreaterThan(0);
    expect(after1.setIcon).toBeGreaterThan(0);

    expect(after2.setTitle).toBe(after1.setTitle);
    expect(after2.setBadgeBackgroundColor).toBe(after1.setBadgeBackgroundColor);
    expect(after2.setIcon).toBe(after1.setIcon);

    await hostPage.close();
  });

  test("tab close: per-tab state evicted; reused tabId starts fresh", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    // Build up state on tabId.
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 5 });
    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });

    // Close the tab — state is evicted. (chrome.action surface lingers
    // until the browser re-uses the tabId, but the internal per-tab
    // state cache is cleared so the next event starts from defaults.)
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    // Reuse tabId. urlCleaned with 1 param should produce badgeText="1"
    // (not "6"), and the icon resolves from a fresh state with no
    // creatorReferralPreserved flag.
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 1 });
    const surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.badgeText).toBe("1");
    expect(surface.iconKind).toBe("default");

    await hostPage.close();
  });
});
