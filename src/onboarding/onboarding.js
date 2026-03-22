/**
 * MUGA — Onboarding page
 *
 * Two checkboxes:
 *   - ToS acceptance (mandatory — button stays disabled until checked)
 *   - Affiliate opt-in (optional — activates injectOwnAffiliate if checked)
 *
 * On "Get started": saves consent metadata + prefs, then closes the tab.
 */

const CONSENT_VERSION = "1.0";

document.addEventListener("DOMContentLoaded", () => {
  const tosCheck       = document.getElementById("tos-check");
  const affiliateCheck = document.getElementById("affiliate-check");
  const startBtn       = document.getElementById("start-btn");

  function updateButton() {
    startBtn.disabled = !tosCheck.checked;
  }

  tosCheck.addEventListener("change", updateButton);

  startBtn.addEventListener("click", async () => {
    if (!tosCheck.checked) return;

    await chrome.storage.sync.set({
      onboardingDone:        true,
      consentVersion:        CONSENT_VERSION,
      consentDate:           Date.now(),
      injectOwnAffiliate:    affiliateCheck.checked,
      notifyForeignAffiliate: false,
    });

    window.close();
  });
});
