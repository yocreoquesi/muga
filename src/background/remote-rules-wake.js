/**
 * MUGA — Remote-rules on-wake throttle, extracted so it can be imported in
 * Node (#1266 item 5, slice 4)
 *
 * `src/background/service-worker.js` makes `chrome.*` calls at module scope,
 * so Node cannot import it, and `maybeFetchRemoteRules` — the throttle that
 * replaces `chrome.alarms` by piggybacking on natural MV3 wake events and
 * gating on a stored `fetchedAt` timestamp — has only ever been testable
 * through a hand-written mirror. `tests/unit/service-worker-patterns.test.mjs`
 * carried `makeMaybeFetchHelper()`, "Pure extraction of maybeFetchRemoteRules
 * for unit testing. Mirrors the production logic in service-worker.js" by its
 * own docblock — a reimplementation with no generator and no structural check
 * tying it to the original, so the two could drift apart while the mirror
 * stayed green. `tests/unit/remote-rules-wake.test.mjs` now imports and
 * exercises the real function instead.
 *
 * Import choice for `shouldOpenOnboarding`: this module imports it directly
 * from `./onboarding-gate.js` rather than taking it as an injected
 * dependency. Unlike the toolbar-badge collaborators (`toolbarBus`,
 * `getPrefsWithCache`), `shouldOpenOnboarding` does not live in
 * `service-worker.js` any more — slice 3 of this same decomposition moved it
 * to `onboarding-gate.js`, a sibling leaf module with no dependency on this
 * file (or on anything that depends on this file), so importing it creates no
 * cycle. `getPrefs`, `getRemoteParams` and `runRemoteRulesFetch` are plain
 * imports for the same reason: they already live in `../lib/storage.js` and
 * `../lib/remote-rules.js`, not in the service worker, so this is the same
 * "pure move plus import wiring" `dnr-sync.js` did for its own lib imports.
 *
 * The `deps` parameter `maybeFetchRemoteRules` takes and forwards to
 * `runRemoteRulesFetch` is unchanged — it is still built by
 * `service-worker.js`'s `_remoteRulesDeps()`, which stays there because it
 * reaches into `hasDNR()` / `chrome.declarativeNetRequest` / the test-key
 * seam, all composition-root concerns.
 */

import { getPrefs, getRemoteParams } from "../lib/storage.js";
import { runRemoteRulesFetch } from "../lib/remote-rules.js";
import { shouldOpenOnboarding } from "./onboarding-gate.js";

// --- Remote-rules opportunistic fetch ---
// MV3 service workers wake on many events (navigation, message, onInstalled,
// onStartup, etc.). Instead of using chrome.alarms — which requires a separate
// permission and a Privacy-practices justification — we piggyback on those
// natural wake-ups and throttle with a time-gate stored in remoteRulesMeta.
// Users who never open the browser don't need fresh rules; users who do, get
// one fetch per ~7 days as a side-effect of normal activity.

// Target interval between successful remote-rules fetches (7 days).
export const REMOTE_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

// Module-level flag — checked once per SW lifetime so repeated wake events
// (one per message, one per navigation, etc.) don't hit chrome.storage on
// every call. Resets automatically when the SW dies and respawns.
let _remoteRulesCheckedThisLifetime = false;

/**
 * Fires a remote-rules fetch iff (a) the user has opted in, (b) no fetch is
 * currently in flight (enforced by runRemoteRulesFetch internally), and (c)
 * the last successful fetch is older than REMOTE_REFRESH_INTERVAL_MS (or has
 * never happened). Silent no-op on any failure to read state — this is a
 * best-effort path that must never block callers.
 *
 * Deduplicated per SW lifetime via `_remoteRulesCheckedThisLifetime` so
 * hot paths (PROCESS_URL, message handlers) can call it freely without
 * extra storage reads.
 *
 * @param {object} deps - Dependencies for runRemoteRulesFetch (same shape as Phase 2).
 * @returns {Promise<void>}
 */
export async function maybeFetchRemoteRules(deps) {
  if (_remoteRulesCheckedThisLifetime) return;
  _remoteRulesCheckedThisLifetime = true;
  try {
    // Read the FULL merged prefs (not just remoteRulesEnabled): getPrefs()
    // overlays the per-device consent record (onboardingDone / consentVersion /
    // consentDate), which the consent gate below needs.
    const prefs = await getPrefs();
    if (!prefs.remoteRulesEnabled) return;
    // Egress gate. Blocks the weekly signed GET to rules.muga.app until this
    // device has a recorded acceptance at all.
    //
    // DELIBERATE CHANGE, not an oversight. #888 review C1 originally coupled
    // this egress to a consent VERSION: a user still at stored consentVersion
    // 1.0 (accepted before v1.1 disclosed the request) stayed blocked until
    // they accepted a delta re-onboard. Adopting the uBlock Origin model
    // removed the versioned-consent engine, so that per-version coupling is
    // gone: a 1.0 user now makes the request on the next SW wake.
    //
    // Accepted on the same reasoning uBO applies to its own filter-list
    // fetches — the Terms describing the request are available and linked, the
    // request carries no data about the user (Ed25519-signed, credentials
    // omitted, no body), and it can be turned off in Settings, which returns
    // MUGA to making no outbound requests. Re-coupling disclosure to a version
    // would mean reintroducing the version engine; that trade was considered
    // and declined.
    if (shouldOpenOnboarding(prefs)) return;
    const { remoteRulesMeta } = await getRemoteParams();
    const last = remoteRulesMeta?.fetchedAt ? Date.parse(remoteRulesMeta.fetchedAt) : 0;
    if (Number.isFinite(last) && Date.now() - last < REMOTE_REFRESH_INTERVAL_MS) return;
    await runRemoteRulesFetch(deps);
  } catch (err) {
    // Non-fatal: remote rules are optional. Leave built-in rules active.
    console.warn("[MUGA] maybeFetchRemoteRules:", err?.message || err);
  }
}
