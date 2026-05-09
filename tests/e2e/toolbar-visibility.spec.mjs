/**
 * E2E: Toolbar visibility — tooltip behavior
 *
 * Drives synthetic toolbar events onto the same bus the production
 * code uses (via __TEST__emitToolbarEvent in the SW), then reads back
 * the chrome.action surface state for assertion (via the
 * readActionSurface helper).
 *
 * The unit suite (tests/unit/toolbar-presenter.test.mjs) exercises the
 * presenter's pure logic. This spec exercises the actual chrome.action
 * surface a real browser would render, including the per-tab state
 * cache, idempotency guards, and tab-close eviction semantics.
 *
 * Badge text/color and icon variant assertions were removed: the
 * presenter no longer writes those surfaces (icon swap caused a
 * flash-and-disappear regression in Firefox MV2; per-tab counter was
 * confusing). The static icon ships via the manifest only.
 */

import { test, expect } from "./fixtures.mjs";
import {
  installTestModeSentinel,
  clearTestModeSentinel,
  readActionSurface,
} from "./helpers/index.mjs";

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

test.describe("Toolbar visibility", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await installTestModeSentinel(context, extensionId);
    await resetActionApiCounts(context, extensionId);
  });

  test.afterEach(async ({ context, extensionId }) => {
    await clearTestModeSentinel(context, extensionId);
  });

  test("tooltip transitions: cleaned → cleaned+preserved", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 3 });
    let surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.ok).toBe(true);
    expect(surface.title).toBeTruthy();
    const cleanedTitle = surface.title;
    expect(cleanedTitle.toLowerCase()).toMatch(/tracking|removed|cleaned|limpi|removid/i);

    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.title).not.toBe(cleanedTitle);

    await hostPage.close();
  });

  test("tooltip resets on navigationStarted", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 4 });
    const cleanedSurface = await readActionSurface(context, extensionId, tabId);
    expect(cleanedSurface.title).toBeTruthy();

    await emitToolbarEvent(context, extensionId, { type: "navigationStarted", tabId });
    const resetSurface = await readActionSurface(context, extensionId, tabId);
    expect(resetSurface.title).not.toBe(cleanedSurface.title);

    await hostPage.close();
  });

  test("idempotency: repeated events with the same state do not produce redundant action calls", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await resetActionApiCounts(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    const after1 = await readActionApiCounts(context, extensionId);

    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });
    const after2 = await readActionApiCounts(context, extensionId);

    // Sanity check: the FIRST emit must have produced a setTitle call —
    // otherwise the equality below passes vacuously when nothing fires.
    expect(after1.setTitle).toBeGreaterThan(0);
    expect(after2.setTitle).toBe(after1.setTitle);

    await hostPage.close();
  });

  test("tab close: per-tab state evicted; reused tabId starts fresh", async ({ context, extensionId }) => {
    const { page: hostPage, tabId } = await openHostPageWithTabId(context, extensionId);
    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 5 });
    await emitToolbarEvent(context, extensionId, { type: "creatorReferralPreserved", tabId });

    await emitToolbarEvent(context, extensionId, { type: "tabClosed", tabId });

    // Reuse tabId. urlCleaned with 1 param on a fresh state should produce
    // the "cleaned" tooltip (not the combined "cleaned+preserved" string).
    await emitToolbarEvent(context, extensionId, { type: "urlCleaned", tabId, paramsRemoved: 1 });
    const surface = await readActionSurface(context, extensionId, tabId);
    expect(surface.title.toLowerCase()).toMatch(/tracking|removed|cleaned|limpi|removid/i);
    expect(surface.title.toLowerCase()).not.toMatch(/preserved|referral|preservad|referido/i);

    await hostPage.close();
  });
});
