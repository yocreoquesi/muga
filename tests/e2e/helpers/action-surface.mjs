/**
 * MUGA E2E helper — toolbar action-surface inspection (#398)
 *
 * The chrome.action surface (toolbar tooltip, badge text, badge color,
 * icon path) is not directly readable from a content script's world.
 * This helper sends a `__TEST__readActionSurface` runtime message to
 * the service worker, which calls the chrome.action read APIs and
 * returns the values. The handler is gated by the test-mode sentinel
 * (see installTestModeSentinel); production builds never expose it.
 *
 * Used by the toolbar-visibility e2e spec (#408 / #395-4) and by any
 * future spec that needs to assert what the user sees on the toolbar.
 */

/**
 * Reads the action-surface state for a given tab via the SW.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @param {number} tabId
 * @returns {Promise<{ ok: boolean, title: string, badgeText: string, state: object }>}
 */
export async function readActionSurface(context, extensionId, tabId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let openedTransient = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    openedTransient = true;
  }
  const result = await page.evaluate((tabId) => {
    return new Promise(resolve => {
      chrome.runtime.sendMessage(
        { type: "__TEST__readActionSurface", tabId },
        (r) => resolve(r || null)
      );
    });
  }, tabId);
  if (openedTransient) await page.close();
  return result;
}
