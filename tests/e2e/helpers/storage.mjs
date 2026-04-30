/**
 * MUGA E2E helper — storage seeding and test-mode sentinel (#398)
 *
 * Helpers for pre-populating chrome.storage.{sync,local} before a test
 * navigates, and for toggling the production-safe test-mode sentinel
 * that gates `__TEST__`-prefixed runtime message handlers in the
 * service worker.
 */

/**
 * Pre-populates chrome.storage.{sync,local} with the provided values.
 * Reuses an existing extension page if one is open; otherwise opens a
 * popup page transiently. Returns when both writes have completed.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 * @param {{ sync?: object, local?: object }} payload
 */
export async function seedStorage(context, extensionId, { sync = {}, local = {} } = {}) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let openedTransient = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    openedTransient = true;
  }
  await page.evaluate(({ sync, local }) => {
    return Promise.all([
      new Promise(resolve => chrome.storage.sync.set(sync, resolve)),
      new Promise(resolve => chrome.storage.local.set(local, resolve)),
    ]);
  }, { sync, local });
  if (openedTransient) await page.close();
}

/**
 * Sets the test-mode sentinel in chrome.storage.local. While set, the
 * service worker enables `__TEST__`-prefixed message handlers — see
 * src/background/service-worker.js for the gate. Production builds
 * never set this, so the handlers are dead code at runtime.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} extensionId
 */
export async function installTestModeSentinel(context, extensionId) {
  await seedStorage(context, extensionId, { local: { __muga_test_mode: true } });
}

/**
 * Clears the test-mode sentinel. Tests should call this on teardown
 * to leave the storage clean for any subsequent test (Playwright
 * persistent context is reused unless explicitly disposed).
 */
export async function clearTestModeSentinel(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let openedTransient = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    openedTransient = true;
  }
  await page.evaluate(() => {
    return new Promise(resolve => chrome.storage.local.remove("__muga_test_mode", resolve));
  });
  if (openedTransient) await page.close();
}
