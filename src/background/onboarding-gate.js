/**
 * MUGA — Onboarding-tab dedup gate, extracted so it can be imported in Node
 * (#1266 item 5, slice 3)
 *
 * `src/background/service-worker.js` makes `chrome.*` calls at module scope,
 * so Node cannot import it, and the #967 dedup guard this file carries —
 * `openOnboardingOnce`'s two-layer guard (a module flag for a within-lifetime
 * double call, plus a persisted `chrome.storage.local` flag surviving an MV3
 * cold start) — has only ever been provable through a mirror. Before this
 * move, `tests/unit/onboarding-tab-dedup-967.test.mjs` extracted the function
 * body out of `service-worker.js` by string search and brace matching, then
 * `new Function(...)`-evaluated it against a fresh flag/`ONBOARDING_TAB_FLAG`
 * pair it re-declared by hand — a reimplementation with no structural tie to
 * the source it was meant to prove. `tests/unit/onboarding.test.mjs` reached
 * the rest of the dedup wiring the same way `service-worker-patterns.test.mjs`
 * does elsewhere: `SERVICE_WORKER_SOURCE.includes("function openOnboardingOnce")`.
 * Both now import the real functions below and exercise them directly.
 *
 * `shouldOpenOnboarding` is a pure decision function with no `chrome.*` calls
 * at all; moving it out is what lets `remote-rules-wake.js`'s egress gate
 * (`maybeFetchRemoteRules`) and this file's own tests call it without any
 * service-worker stub.
 *
 * `openOnboardingOnce` and `clearOnboardingTabFlag` still call
 * `chrome.storage.local` and `chrome.tabs.create` / `chrome.runtime.getURL`,
 * but only inside their function bodies, never at module scope — so this
 * file is importable in Node exactly like `dnr-sync.js` and `toolbar-badge.js`
 * are: `chrome` only needs to exist by the time a caller actually invokes one
 * of these, not at import time.
 *
 * The `chrome.runtime.onInstalled` / background-load-fallback wiring that
 * calls these three functions stays in `service-worker.js` — the composition
 * root, per #1266.
 */

// --- Dedup: open the onboarding tab at most once while consent is pending. ---
// Two layers: a module flag guards a double-open within a single background
// lifetime (onInstalled + fallback both firing), and a persisted
// chrome.storage.local flag guards across MV3 service-worker cold starts (#967).
// Without the persisted layer the volatile flag reset on every wake, so an
// incomplete onboarding reopened a fresh tab on each navigation-triggered
// restart. The persisted flag is cleared (clearOnboardingTabFlag) once consent
// is valid, so a later ToS re-onboard can still surface the tab again.
let _onboardingTabOpened = false;
const ONBOARDING_TAB_FLAG = "mugaOnboardingTabOpened";

export async function openOnboardingOnce() {
  if (_onboardingTabOpened) return;
  _onboardingTabOpened = true; // synchronous within-lifetime guard (no await above)
  try {
    const already = await new Promise((resolve) => {
      chrome.storage.local.get({ [ONBOARDING_TAB_FLAG]: false }, (r) =>
        resolve(!!(r && r[ONBOARDING_TAB_FLAG])));
    });
    if (already) return; // a prior lifetime already opened it — do not spam a new tab
    // Set BEFORE creating the tab so a rapid second cold start can't double-open.
    await new Promise((resolve) => {
      chrome.storage.local.set({ [ONBOARDING_TAB_FLAG]: true }, () => resolve());
    });
  } catch { /* best-effort: worst case one extra tab, never a missing one */ }
  chrome.tabs.create({ url: chrome.runtime.getURL("onboarding/onboarding.html") });
}

// Clears the persisted onboarding-tab guard so a future re-onboard (ToS bump)
// can open the tab again. Called when consent is valid — i.e. onboarding is not
// currently needed — which is the natural point to reset the one-shot guard.
export function clearOnboardingTabFlag() {
  _onboardingTabOpened = false;
  try {
    chrome.storage.local.remove(ONBOARDING_TAB_FLAG, () => void chrome.runtime.lastError);
  } catch { /* ignore */ }
}

/**
 * Single decision function consulted by both the onInstalled and the
 * background-load fallback paths (#365). Returns true when the onboarding
 * tab should be opened, which now means one thing only: this device has no
 * recorded acceptance.
 *
 * A Terms update never reopens this tab. MUGA follows the uBlock Origin
 * model — Terms available and linked, acceptance by use, no re-prompt — so
 * the versioned-consent policy that used to return `soft-reonboard` /
 * `hard-reonboard` here was removed.
 *
 * @param {object} prefs - Merged prefs (consent overlay applied by getPrefs).
 * @returns {boolean}
 */
export function shouldOpenOnboarding(prefs) {
  return !prefs.onboardingDone;
}
