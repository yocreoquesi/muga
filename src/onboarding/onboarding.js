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
 * Renders one of three informational modes based on the consent state of
 * THIS device:
 *
 *   fresh    — first install. Full feature explainer.
 *   delta    — soft re-onboard. User has accepted an older version;
 *              every intermediate ToS bump up to required is additive.
 *              Surfaces only the new clauses; declining keeps the
 *              previously accepted version valid.
 *   material — hard re-onboard. At least one intermediate bump is
 *              material. Purely a disclosure banner in the browsewrap
 *              model — it does not block the button or require an
 *              action before the page can be closed.
 *
 * Mode is selected by ConsentPolicy.evaluate() (#365). The actual
 * acceptance write uses REQUIRED_CONSENT_VERSION (#365), so a user
 * who completes a re-onboard moves their stored consent forward.
 *
 * drop-affiliate-injection (PR 1b): the guarded-pref confirmation step
 * (#364) that used to run alongside the re-onboard rendering was
 * deleted — its only wired pref was injectOwnAffiliate, retired in this
 * PR. remoteRulesEnabled remains in GUARDED_PREFS (synced-affiliate-
 * pref-guard.js) but has never had onboarding UI wired to it; that gap
 * predates this PR and is unchanged by it.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { setConsent, getConsent } from "../lib/consent-storage.js";
import { evaluate as evaluateConsent } from "../lib/consent-policy.js";
import {
  CONSENT_VERSION_MANIFEST,
  REQUIRED_CONSENT_VERSION,
} from "../lib/consent-version-manifest.js";
import { clausesForDelta, CONSENT_CLAUSES_BY_VERSION } from "../lib/consent-clauses.js";
import { getTestFixtures } from "../lib/test-fixtures.js";

document.addEventListener("DOMContentLoaded", async () => {
  const startBtn         = document.getElementById("start-btn");
  const featuresSection  = document.getElementById("features-section");
  const reonboardDelta   = document.getElementById("reonboard-delta");
  const reonboardDeltaClauses = document.getElementById("reonboard-delta-clauses");
  const reonboardMaterial = document.getElementById("reonboard-material");

  // Apply translations using the shared i18n module
  const lang = await getStoredLang();
  document.documentElement.lang = lang;
  applyTranslations(lang);

  // --- Read state ----------------------------------------------------------
  const [localConsent, fixtures] = await Promise.all([
    getConsent(),
    getTestFixtures(),
  ]);

  // Test-only overrides (#407). Fixtures are null in production.
  const activeManifest = fixtures?.consentManifest || CONSENT_VERSION_MANIFEST;
  const activeRequiredVersion = fixtures?.requiredConsentVersion || REQUIRED_CONSENT_VERSION;
  const activeClausesByVersion = fixtures?.consentClausesByVersion || CONSENT_CLAUSES_BY_VERSION;

  // --- Re-onboard mode dispatch (#370) ------------------------------------
  const policy = evaluateConsent({
    stored: localConsent,
    requiredVersion: activeRequiredVersion,
    manifest: activeManifest,
  });
  const mode = policy.status === "soft-reonboard"
    ? "delta"
    : policy.status === "hard-reonboard"
      ? "material"
      : "fresh";

  if (mode === "delta") {
    // Soft re-onboard: feature explainer hidden; delta banner with the
    // new clauses since the user's last accepted version.
    if (featuresSection) featuresSection.hidden = true;
    if (reonboardDelta) {
      reonboardDelta.hidden = false;
      // Move focus to the revealed banner so screen-reader users land on (and
      // hear) the terms-changed notice instead of it being silently shown (#740).
      reonboardDelta.focus();
      const clauseKeys = clausesForDelta({
        acceptedVersion: policy.acceptedVersion,
        requiredVersion: policy.requiredVersion,
        manifest: activeManifest,
        clausesByVersion: activeClausesByVersion,
      });
      if (reonboardDeltaClauses) {
        // Build the clause list with createElement + textContent (no innerHTML).
        for (const key of clauseKeys) {
          const li = document.createElement("li");
          li.textContent = t(key, lang);
          reonboardDeltaClauses.appendChild(li);
        }
      }
    }
  } else if (mode === "material") {
    // Hard re-onboard: feature explainer hidden; banner explains the
    // material change. This is a disclosure only in the browsewrap model —
    // the Start button below is never disabled and requires no prior action.
    if (featuresSection) featuresSection.hidden = true;
    if (reonboardMaterial) {
      reonboardMaterial.hidden = false;
      // Move focus to the alert banner so it is announced and reachable by
      // screen readers, not silently shown (#740) — an accessibility
      // courtesy, not a functional gate.
      reonboardMaterial.focus();
    }
  }

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
  document.body.dataset.mugaReonboardMode = mode;

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

      // Consent record carries the active required version — moves the user
      // forward whether this is fresh, delta, or material acceptance. Under
      // test fixtures (#407), activeRequiredVersion may differ from the static
      // REQUIRED_CONSENT_VERSION export. Written LAST (the gate flag).
      await setConsent({
        onboardingDone: true,
        consentVersion: activeRequiredVersion,
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
