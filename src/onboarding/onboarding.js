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
    startBtn.disabled = !tosCheck.checked;
  }

  tosCheck.addEventListener("change", updateButton);

  // Signal that DOMContentLoaded setup is complete — tests wait for this flag
  // before interacting with the page (same pattern as options.html; avoids
  // fixture-ready races where clicks land before listeners are registered).
  document.body.dataset.mugaReady = "1";
  document.body.dataset.mugaReonboardMode = mode;

  startBtn.addEventListener("click", async () => {
    if (!tosCheck.checked) return;

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

      // Consent record carries the active required version — moves the
      // user forward whether this is fresh, delta, or material acceptance.
      // Under test fixtures (#407), activeRequiredVersion may differ from
      // the static REQUIRED_CONSENT_VERSION export.
      const ops = [
        setConsent({
          onboardingDone: true,
          consentVersion: activeRequiredVersion,
          consentDate:    Date.now(),
        }),
        new Promise((resolve, reject) => {
          chrome.storage.sync.set(syncWrites, () => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve();
          });
        }),
      ];
      if (Object.keys(overrideUpdates).length > 0) {
        ops.push(setOverrides(overrideUpdates));
      }
      await Promise.all(ops);
      window.close();
    } catch (err) {
      console.error("[MUGA] onboarding save:", err);
      startBtn.textContent = t("ob_save_error", lang);
      startBtn.disabled = false;
    }
  });
});
