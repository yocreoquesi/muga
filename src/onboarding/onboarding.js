/**
 * MUGA: Onboarding page
 *
 * Renders the consent flow on first install. Surfaces:
 *   - ToS acceptance (mandatory: button stays disabled until checked).
 *   - Affiliate opt-in (optional: activates injectOwnAffiliate if checked).
 *   - Per-device confirmation prompts (#364) for sync-inherited prefs
 *     that need explicit acceptance on this device.
 *
 * On "Get started": saves consent metadata to local storage; saves
 * behavioural prefs to sync; records per-device overrides for any
 * sync-inherited prefs the user declined here.
 */

import { applyTranslations, getStoredLang, t } from "../lib/i18n.js";
import { setConsent, getConsent } from "../lib/consent-storage.js";
import { setOverrides, getOverrides } from "../lib/per-device-prefs.js";
import { pendingConfirmations } from "../lib/synced-affiliate-pref-guard.js";

const CONSENT_VERSION = "1.0";

document.addEventListener("DOMContentLoaded", async () => {
  const tosCheck         = document.getElementById("tos-check");
  const affiliateCheck   = document.getElementById("affiliate-check");
  const affiliateSynced  = document.getElementById("affiliate-synced-note");
  const remoteRulesSection = document.getElementById("remote-rules-section");
  const remoteRulesCheck = document.getElementById("remote-rules-check");
  const startBtn         = document.getElementById("start-btn");

  // Apply translations using the shared i18n module
  const lang = await getStoredLang();
  document.documentElement.lang = lang;
  applyTranslations(lang);

  // --- Per-device confirmation prompt setup (#364) ----------------------
  // Read sync prefs + local consent + existing overrides. If sync brought
  // any guarded pref enabled and the user has not yet confirmed it on
  // this device, surface the matching prompt(s).
  const [syncPrefs, localConsent, existingOverrides] = await Promise.all([
    new Promise((resolve) => {
      chrome.storage.sync.get(
        { injectOwnAffiliate: false, remoteRulesEnabled: false },
        (r) => resolve(r || {})
      );
    }),
    getConsent(),
    getOverrides(),
  ]);

  const pending = new Set(
    pendingConfirmations({ syncPrefs, localConsent, overrides: existingOverrides })
  );

  if (pending.has("injectOwnAffiliate")) {
    // Pre-check the existing affiliate checkbox; show the synced note.
    affiliateCheck.checked = true;
    affiliateSynced.hidden = false;
  }

  if (pending.has("remoteRulesEnabled")) {
    // Reveal the remote-rules confirmation section, pre-checked.
    remoteRulesSection.hidden = false;
    remoteRulesCheck.checked = true;
  }

  function updateButton() {
    startBtn.disabled = !tosCheck.checked;
  }

  tosCheck.addEventListener("change", updateButton);

  // Signal that DOMContentLoaded setup is complete — tests wait for this flag
  // before interacting with the page (same pattern as options.html; avoids
  // fixture-ready races where clicks land before listeners are registered).
  document.body.dataset.mugaReady = "1";

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

      // Sync writes: only push values that were not sync-inherited. If
      // sync already had injectOwnAffiliate=true and the user kept it
      // checked, we leave sync alone. If sync had it false and user
      // now checked it, write true.
      const syncWrites = {
        notifyForeignAffiliate: false,
        language: lang,
      };
      if (!pending.has("injectOwnAffiliate")) {
        // No sync-override needed; this is the first-device flow.
        syncWrites.injectOwnAffiliate = affiliateCheck.checked;
      }
      // Note: remoteRulesEnabled is intentionally not written to sync from
      // onboarding even on a first-device install (it stays as the default
      // off; the user enables it later via Settings if they want it).

      const ops = [
        setConsent({
          onboardingDone: true,
          consentVersion: CONSENT_VERSION,
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
