/**
 * MUGA E2E helper — runtime fixture overrides (#407)
 *
 * Drives the dormant re-onboard rendering modes (#370) and the
 * migration banner UI (#369) by writing fixture overrides into
 * `chrome.storage.local` under the key read by `src/lib/test-fixtures.js`.
 *
 * Fixtures only take effect when the test-mode sentinel is set (see
 * `installTestModeSentinel`). Production builds never set the
 * sentinel, so the static module-level constants always win at
 * runtime.
 */

import { seedStorage } from "./storage.mjs";

const FIXTURES_KEY = "__muga_test_fixtures";

/**
 * Writes a fixture overrides bundle to chrome.storage.local. The shape
 * matches what `getTestFixtures()` returns:
 *
 *   {
 *     consentManifest:        Array<{version, additive}> | null,
 *     requiredConsentVersion: string                     | null,
 *     consentClausesByVersion: Record<string, string[]>  | null,
 *     migrations:             Array<MigrationSpec>       | null,
 *     i18nOverrides:          Record<string, string>     | null,
 *     currentVersion:         string                     | null,
 *   }
 *
 * Caller is responsible for installing the test-mode sentinel before
 * the fixtures will be honoured. Caller is also responsible for
 * clearing fixtures on teardown via `clearFixtures`.
 */
export async function withFixtureManifest(context, extensionId, fixtures) {
  await seedStorage(context, extensionId, {
    local: { [FIXTURES_KEY]: fixtures },
  });
}

/**
 * Removes any fixture overrides. Tests should call this on teardown.
 */
export async function clearFixtures(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  await page.evaluate((key) =>
    new Promise(resolve => chrome.storage.local.remove(key, resolve)), FIXTURES_KEY
  );
  if (opened) await page.close();
}
