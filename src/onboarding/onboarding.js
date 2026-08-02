/**
 * MUGA: Onboarding page
 *
 * browsewrap Phase 1: this page is a NON-BLOCKING informational welcome.
 * Fresh-install acceptance is now recorded implicitly by the service worker
 * (see service-worker.js's recordImplicitAcceptOnInstall) the moment MUGA is
 * installed, so every feature already works before this tab is even read.
 * The Start button here is a "close this notice" action, not a consent gate
 * — it is never disabled and does not require checking any box first.
 *
 * There is exactly one mode: the feature explainer. MUGA follows the uBlock
 * Origin model — the Terms and Privacy policy are available and linked,
 * acceptance is by use, and changing them never re-prompts an existing user.
 * The delta / material re-onboard modes and the versioned-consent policy that
 * selected between them were removed.
 *
 * drop-affiliate-injection (PR 1b): the guarded-pref confirmation step
 * (#364) that used to run alongside the re-onboard rendering was
 * deleted — its only wired pref was injectOwnAffiliate, retired in this
 * PR. remoteRulesEnabled remains in GUARDED_PREFS (synced-affiliate-
 * pref-guard.js) but has never had onboarding UI wired to it; that gap
 * predates this PR and is unchanged by it.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { setConsent, TERMS_VERSION } from "../lib/consent-storage.js";

document.addEventListener("DOMContentLoaded", async () => {
  const startBtn = document.getElementById("start-btn");

  // Apply translations using the shared i18n module
  const lang = await getStoredLang();
  document.documentElement.lang = lang;
  applyTranslations(lang);

  // browsewrap Phase 1: the Start button is never gated on the ToS checkbox.
  // It is always enabled — clicking it simply records/advances consent
  // (already implicit for a fresh install; moves the version forward for a
  // delta/material re-onboard) and closes this informational tab. There is
  // no aria-disabled state, no updateButton()/flashTosGate() flow, and the
  // checkbox is optional.

  // Signal that DOMContentLoaded setup is complete — tests wait for this flag
  // before interacting with the page (same pattern as options.html; avoids
  // fixture-ready races where clicks land before listeners are registered).
  document.body.dataset.mugaReady = "1";

  // Guard against a rapid double-click running the async completion twice
  // (duplicate history writes, double tab-remove, focus flicker) — audit #1048.
  let submitInFlight = false;
  startBtn.addEventListener("click", async () => {
    if (submitInFlight) return;
    submitInFlight = true;

    try {
      const syncWrites = {
        notifyForeignAffiliate: false,
        language: lang,
      };

      // #741: write sync prefs FIRST, and only mark consent complete
      // (onboardingDone:true) AFTER it succeeds. setConsent writes
      // mugaConsent to storage.local independently, so running it in
      // parallel meant a sync-write failure (quota / MAX_WRITE_OPERATIONS) left
      // the local record with onboardingDone:true permanently — the user was
      // told the save failed yet was treated as fully onboarded, with no
      // rollback. Sequencing makes onboardingDone the last write, so any
      // failure aborts before the gate flips and the user can safely retry.
      const preConsentOps = [
        new Promise((resolve, reject) => {
          chrome.storage.sync.set(syncWrites, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        }),
      ];
      await Promise.all(preConsentOps);

      // Consent record carries the Terms version that was current when the
      // user was shown this page. Provenance only — nothing evaluates it
      // (see consent-storage's TERMS_VERSION). Written LAST (the gate flag).
      await setConsent({
        onboardingDone: true,
        consentVersion: TERMS_VERSION,
        consentDate:    Date.now(),
      });

      // Persistence is done. Now confirm visually + try to close.
      // Firefox refuses window.close() on tabs it did not open via JS, so
      // relying on it would leave the user staring at the unchanged
      // onboarding page assuming the click failed (the original bug).
      // Render an in-place success state first, then attempt close — if
      // both attempts fail, the success state remains as the safety net.
      renderSuccess(lang);
      attemptCloseTab();
    } catch (err) {
      console.error("[MUGA] onboarding save:", err);
      startBtn.textContent = t("ob_save_error", lang);
      // Release the double-submit guard so the user can retry after a failure.
      // (Phase 1: the button has no aria-disabled gate to re-sync anymore —
      // it stays enabled throughout.)
      submitInFlight = false;
    }
  });
});

/**
 * Replaces the onboarding form with a success confirmation. Pure DOM —
 * no innerHTML, so we do not need to re-sanitize anything.
 */
function renderSuccess(lang) {
  const container = document.querySelector(".container");
  if (!container) return;

  const wrap = document.createElement("div");
  wrap.className = "ob-success";
  wrap.setAttribute("role", "status");
  wrap.setAttribute("aria-live", "polite");
  wrap.dataset.testid = "ob-success";

  const title = document.createElement("h1");
  title.className = "ob-success-title";
  title.textContent = t("ob_success_title", lang);

  const msg = document.createElement("p");
  msg.className = "ob-success-msg";
  msg.textContent = t("ob_success_msg", lang);

  const btn = document.createElement("button");
  btn.className = "btn-primary";
  btn.id = "ob-success-close";
  btn.textContent = t("ob_success_close_btn", lang);
  btn.addEventListener("click", attemptCloseTab);

  wrap.appendChild(title);
  wrap.appendChild(msg);
  wrap.appendChild(btn);

  // Replace container content. We keep <main> wrapper styles by swapping
  // the inner container.
  while (container.firstChild) container.removeChild(container.firstChild);
  container.appendChild(wrap);
  document.body.dataset.mugaOnboardingDone = "1";
  btn.focus();
}

/**
 * Best-effort tab close. Tries window.close() (works in Chrome for
 * tabs the extension opened), falls back to chrome.tabs.remove on the
 * current tab id (works in Firefox even without the "tabs" permission
 * for the extension's own tabs). Both throwing is fine — the success
 * state is already visible.
 */
function attemptCloseTab() {
  try { window.close(); } catch { /* Firefox blocks this on non-script-opened tabs */ }
  try {
    if (chrome?.tabs?.getCurrent && chrome?.tabs?.remove) {
      chrome.tabs.getCurrent((tab) => {
        if (tab && typeof tab.id === "number") {
          try { chrome.tabs.remove(tab.id); } catch { /* best-effort */ }
        }
      });
    }
  } catch { /* tabs API unavailable in some contexts */ }
}
