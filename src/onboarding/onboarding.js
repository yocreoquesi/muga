/**
 * MUGA — Onboarding page
 * Reads the user's toggle choices and saves them to storage, then closes.
 */

document.addEventListener("DOMContentLoaded", () => {
  const injectToggle = document.getElementById("inject-toggle");
  const notifyToggle = document.getElementById("notify-toggle");
  const startBtn     = document.getElementById("start-btn");

  startBtn.addEventListener("click", async () => {
    await chrome.storage.sync.set({
      injectOwnAffiliate:    injectToggle.checked,
      notifyForeignAffiliate: notifyToggle.checked,
      onboardingDone: true,
    });
    window.close();
  });
});
