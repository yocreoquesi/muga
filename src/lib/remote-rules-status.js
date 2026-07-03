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
 * (The weekly signed fetch itself only begins once the user grants the
 * `rules.muga.app` optional host permission via the Settings toggle — it is
 * not running pre-grant.) Routing through `getPrefs()` keeps the Settings
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
 * @returns {Promise<{ok: true, enabled: boolean, meta: object, remoteParams: string[], supportsDNR: boolean}>}
 */
export async function buildRemoteRulesStatus({ getPrefs, local, hasDNR }) {
  // Canonical effective value (sync + consent + per-device overrides).
  const prefs = await getPrefs();
  const enabled = !!prefs.remoteRulesEnabled;

  // Meta + params live in chrome.storage.local (device-local fetch state).
  const localData = await local.get({
    remoteParams: [],
    remoteRulesMeta: { version: 0, fetchedAt: null, paramCount: 0, lastError: null, published: null },
  });

  return {
    ok: true,
    enabled,
    meta: localData.remoteRulesMeta,
    remoteParams: localData.remoteParams,
    // Feature-detect flag (REQ-UI-5). Since v1.10.1 the only remaining runtime
    // gate is DNR availability (chrome.alarms dependency was removed).
    supportsDNR: !!hasDNR,
  };
}
