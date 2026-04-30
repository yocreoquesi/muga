/**
 * MUGA: Test fixtures (#407)
 *
 * Reads runtime overrides for the consent-version manifest, the
 * migration spec, and i18n keys from `chrome.storage.local` — but ONLY
 * when the test-mode sentinel is set (see #398).
 *
 * Production builds never set the sentinel, so every accessor in this
 * module returns null at runtime in production and the code paths
 * that read them fall through to the static module-level constants
 * unchanged. The fixtures exist solely to let the e2e suite drive
 * dormant rendering paths (re-onboard delta / material, migration
 * banner) deterministically without shipping fixture data into the
 * release artifact.
 *
 * Storage shape (set via the `withFixtureManifest` e2e helper):
 *
 *   chrome.storage.local["__muga_test_fixtures"] = {
 *     consentManifest:        Array<{version, additive}> | null,
 *     requiredConsentVersion: string                     | null,
 *     consentClausesByVersion: Record<string, string[]>  | null,
 *     migrations:             Array<MigrationSpec>       | null,
 *     i18nOverrides:          Record<string, string>     | null,
 *   }
 */

const SENTINEL_KEY = "__muga_test_mode";
const FIXTURES_KEY = "__muga_test_fixtures";

async function readLocal(key, fallback) {
  return await new Promise((resolve) => {
    try {
      chrome.storage.local.get({ [key]: fallback }, (r) => resolve(r?.[key] ?? fallback));
    } catch {
      resolve(fallback);
    }
  });
}

/**
 * Returns the fixtures object when the test sentinel is set, else null.
 * Cheap to call repeatedly — no caching, since fixtures may change
 * between tests.
 */
export async function getTestFixtures() {
  const sentinel = await readLocal(SENTINEL_KEY, false);
  if (!sentinel) return null;
  const fixtures = await readLocal(FIXTURES_KEY, null);
  return fixtures || null;
}
