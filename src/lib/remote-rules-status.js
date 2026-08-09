/**
 * MUGA: Remote-rules status builder (#888 follow-up)
 *
 * Single source of truth for the `GET_REMOTE_RULES_STATUS` message reply.
 *
 * The `enabled` flag MUST reflect the CANONICAL effective preference, i.e.
 * the same value the rest of the extension acts on. That value comes from
 * `getPrefs()` (src/lib/prefs.js), which overlays sync + consent + per-device
 * overrides — NOT from a raw `chrome.storage.sync.get` with a hardcoded
 * default. On a fresh install the `remoteRulesEnabled` key is never written
 * (the onboarding accept path relies on `PREF_DEFAULTS.remoteRulesEnabled =
 * true`), so a hardcoded `false` default would report the toggle as OFF even
 * though the pref DEFAULTS to enabled. The toggle must reflect that default.
 * (The weekly signed fetch is opt-OUT and already running by the time this
 * status is first read: `onInstalled` calls `maybeFetchRemoteRules()`
 * directly, `runRemoteRulesFetch()` carries no permission check, and the
 * `rules.muga.app` optional host permission reads as already granted because
 * the manifest's `<all_urls>` host permission covers it — `permissions
 * .contains()` reports coverage, not exact declaration. An earlier version of
 * this note claimed the fetch "is not running pre-grant", which was wrong and
 * is the sort of thing a privacy policy gets written from; see
 * tests/e2e/remote-rules-fresh-install.spec.mjs, which pins both facts in a
 * real browser.) Routing through `getPrefs()` keeps the Settings
 * toggle in lockstep with the effective preference, including any per-device
 * override written when a user declines a sync-inherited prompt.
 *
 * Dependency-injected (matching runRemoteRulesFetch's shape) so it is unit
 * testable without importing the whole service worker.
 *
 * @param {object} deps
 * @param {() => Promise<object>} deps.getPrefs - Canonical merged-prefs reader.
 * @param {{ get: (defaults: object) => Promise<object> }} deps.local - chrome.storage.local (or a fake).
 * @param {boolean} deps.hasDNR - Whether declarativeNetRequest is available.
 * @returns {Promise<{ok: true, enabled: boolean, meta: object, remoteParams: string[], changelog: object|null, supportsDNR: boolean}>}
 */
export async function buildRemoteRulesStatus({ getPrefs, local, hasDNR }) {
  // Canonical effective value (sync + consent + per-device overrides).
  const prefs = await getPrefs();
  const enabled = !!prefs.remoteRulesEnabled;

  // Meta + params live in chrome.storage.local (device-local fetch state).
  const localData = await local.get({
    remoteParams: [],
    remoteRulesMeta: { version: 0, fetchedAt: null, paramCount: 0, lastError: null, published: null },
    remoteRulesChangelog: null,
  });

  return {
    ok: true,
    enabled,
    meta: localData.remoteRulesMeta,
    remoteParams: localData.remoteParams,
    // Weekly diff snapshot from the last mergeIntoCache write (#984), or null
    // if no fetch has ever completed (or the cache was cleared).
    changelog: localData.remoteRulesChangelog,
    // Feature-detect flag (REQ-UI-5). Since v1.10.1 the only remaining runtime
    // gate is DNR availability (chrome.alarms dependency was removed).
    supportsDNR: !!hasDNR,
  };
}
