/**
 * MUGA: Onboarding page
 *
 * Two checkboxes:
 *   - ToS acceptance (mandatory: button stays disabled until checked)
 *   - Affiliate opt-in (optional: activates injectOwnAffiliate if checked)
 *
 * On "Get started": saves consent metadata + prefs, then closes the tab.
 */

import { applyTranslations, getStoredLang } from "../lib/i18n.js";

const CONSENT_VERSION = "1.0";

document.addEventListener("DOMContentLoaded", async () => {
  const tosCheck       = document.getElementById("tos-check");
  const affiliateCheck = document.getElementById("affiliate-check");
  const startBtn       = document.getElementById("start-btn");

  // Apply translations using the shared i18n module
  const lang = await getStoredLang();
  document.documentElement.lang = lang;
  applyTranslations(lang);

  function updateButton() {
    startBtn.disabled = !tosCheck.checked;
  }

  tosCheck.addEventListener("change", updateButton);

  startBtn.addEventListener("click", async () => {
    if (!tosCheck.checked) return;

    try {
      await chrome.storage.sync.set({
        onboardingDone:        true,
        consentVersion:        CONSENT_VERSION,
        consentDate:           Date.now(),
        injectOwnAffiliate:    affiliateCheck.checked,
        notifyForeignAffiliate: false,
        language:              lang,
      });
      window.close();
    } catch (err) {
      console.error("[MUGA] onboarding save:", err);
      startBtn.textContent = "Error — please try again";
      startBtn.disabled = false;
    }
  });
});
