/**
 * MUGA: Onboarding page
 *
 * Renders one of three modes based on the consent state of THIS device:
 *
 *   fresh    — first install, never accepted. Full flow.
 *   delta    — soft re-onboard. User has accepted an older version;
 *              every intermediate ToS bump up to required is additive.
 *              Surfaces only the new clauses; declining keeps the
 *              previously accepted version valid.
 *   material — hard re-onboard. At least one intermediate bump is
 *              material. Features stay gated until the user re-accepts.
 *
 * Mode is selected by ConsentPolicy.evaluate() (#365). The actual
 * acceptance write uses REQUIRED_CONSENT_VERSION (#365), so a user
 * who completes a re-onboard moves their stored consent forward.
 *
 * Per-device confirmation prompts (#364) for sync-inherited prefs are
 * still surfaced when applicable, alongside the re-onboard rendering.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { setConsent, getConsent } from "../lib/consent-storage.js";
import { setOverrides, getOverrides } from "../lib/per-device-prefs.js";
import { pendingConfirmations } from "../lib/synced-affiliate-pref-guard.js";
import { evaluate as evaluateConsent } from "../lib/consent-policy.js";
import {
  CONSENT_VERSION_MANIFEST,
  REQUIRED_CONSENT_VERSION,
} from "../lib/consent-version-manifest.js";
import { clausesForDelta, CONSENT_CLAUSES_BY_VERSION } from "../lib/consent-clauses.js";
import { getTestFixtures } from "../lib/test-fixtures.js";

document.addEventListener("DOMContentLoaded", async () => {
  const tosCheck         = document.getElementById("tos-check");
  const affiliateCheck   = document.getElementById("affiliate-check");
  const affiliateSynced  = document.getElementById("affiliate-synced-note");
  const remoteRulesSection = document.getElementById("remote-rules-section");
  const remoteRulesCheck = document.getElementById("remote-rules-check");
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
  const [syncPrefs, localConsent, existingOverrides, fixtures] = await Promise.all([
    new Promise((resolve) => {
      chrome.storage.sync.get(
        { injectOwnAffiliate: false, remoteRulesEnabled: false },
        (r) => resolve(r || {})
      );
    }),
    getConsent(),
    getOverrides(),
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
    // material change. Full ToS link + checkbox + button stay visible.
    if (featuresSection) featuresSection.hidden = true;
    if (reonboardMaterial) reonboardMaterial.hidden = false;
  }

  // --- Per-device confirmation prompt setup (#364) ------------------------
  const pending = new Set(
    pendingConfirmations({ syncPrefs, localConsent, overrides: existingOverrides })
  );

  if (pending.has("injectOwnAffiliate")) {
    affiliateCheck.checked = true;
    if (affiliateSynced) affiliateSynced.hidden = false;
  }
  if (pending.has("remoteRulesEnabled")) {
    if (remoteRulesSection) remoteRulesSection.hidden = false;
    if (remoteRulesCheck) remoteRulesCheck.checked = true;
  }

  function updateButton() {
    if (tosCheck.checked) {
      startBtn.removeAttribute("aria-disabled");
    } else {
      startBtn.setAttribute("aria-disabled", "true");
    }
  }

  tosCheck.addEventListener("change", updateButton);

  // Flash the ToS card when the user clicks the CTA without accepting.
  // Without this, the disabled state was silent — clicks went nowhere
  // and users couldn't discover the gating reason.
  const tosLabel = document.getElementById("tos-label");
  const ctaGatedMsg = document.getElementById("cta-gated-msg");
  function flashTosGate() {
    if (!tosLabel) return;
    tosLabel.classList.remove("is-flashing");
    // Force reflow so the animation can re-trigger on consecutive clicks.
    void tosLabel.offsetWidth;
    tosLabel.classList.add("is-flashing");
    tosLabel.scrollIntoView({ behavior: "smooth", block: "center" });
    if (tosCheck && typeof tosCheck.focus === "function") tosCheck.focus({ preventScroll: true });
    if (ctaGatedMsg) {
      ctaGatedMsg.textContent = "";
      // Re-write on the next tick so aria-live announces it even if the
      // text didn't change since the last gated click.
      setTimeout(() => { ctaGatedMsg.textContent = t("ob_cta_gated_msg", lang); }, 50);
    }
  }

  // Signal that DOMContentLoaded setup is complete — tests wait for this flag
  // before interacting with the page (same pattern as options.html; avoids
  // fixture-ready races where clicks land before listeners are registered).
  document.body.dataset.mugaReady = "1";
  document.body.dataset.mugaReonboardMode = mode;

  startBtn.addEventListener("click", async () => {
    if (!tosCheck.checked) {
      flashTosGate();
      return;
    }

    try {
      // Compute per-device overrides for any synced pref the user
      // declined here. Sync stays untouched — declining on Device B
      // must not propagate back to Device A's settings (#364).
      const overrideUpdates = {};
      if (pending.has("injectOwnAffiliate") && !affiliateCheck.checked) {
        overrideUpdates.injectOwnAffiliate = false;
      }
      if (pending.has("remoteRulesEnabled") && !remoteRulesCheck.checked) {
        overrideUpdates.remoteRulesEnabled = false;
      }

      // Sync writes: only push values that were not sync-inherited.
      const syncWrites = {
        notifyForeignAffiliate: false,
        language: lang,
      };
      if (!pending.has("injectOwnAffiliate")) {
        syncWrites.injectOwnAffiliate = affiliateCheck.checked;
      }

      // #741: write sync prefs + per-device overrides FIRST, and only mark
      // consent complete (onboardingDone:true) AFTER they succeed. setConsent
      // writes mugaConsent to storage.local independently, so running it in
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
      if (Object.keys(overrideUpdates).length > 0) {
        preConsentOps.push(setOverrides(overrideUpdates));
      }
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
      // The button is gated via the aria-disabled attribute (updateButton),
      // not the .disabled property, so the previous reset here was a no-op.
      // Re-sync the gate to the checkbox so the user can retry (#741).
      updateButton();
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
