/**
 * E2E: Onboarding regression — Firefox window.close() + consent gate
 *
 * Three regressions guarded here:
 *
 *   1. The success state renders in-place after the user clicks
 *      "Start browsing clean". Firefox refuses window.close() on tabs
 *      not opened by JS, so the page would silently stay open and the
 *      user assumed nothing happened. Now consent persistence is
 *      followed by a visible confirmation that survives even if both
 *      window.close() and chrome.tabs.remove() are no-ops.
 *
 *   2. While onboardingDone === false the toolbar action surfaces a
 *      global "!" badge so the user is told from outside the popup
 *      that setup is required. Cleared after acceptance.
 *
 *   3. While onboardingDone === false the DNR `tracking_params`
 *      ruleset is disabled — the cleaner does not run on URLs until
 *      the user has accepted the ToS. Enabled after acceptance.
 */

import { test, expect } from "./fixtures.mjs";
import {
  installTestModeSentinel,
  clearTestModeSentinel,
} from "./helpers/index.mjs";

async function clearAll(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  await page.evaluate(() =>
    Promise.all([
      new Promise(r => chrome.storage.sync.clear(r)),
      new Promise(r => chrome.storage.local.clear(r)),
    ])
  );
  if (opened) await page.close();
}

async function readEnabledRulesets(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  const page = await context.newPage();
  await page.goto(`${extOrigin}/popup/popup.html`);
  const result = await page.evaluate(() =>
    new Promise(resolve =>
      chrome.runtime.sendMessage({ type: "__TEST__readDnrEnabledRulesets" }, resolve)
    )
  );
  await page.close();
  return result;
}

/**
 * Simulates Firefox's behaviour, where neither window.close() nor
 * chrome.tabs.remove() can close the extension's own tab. The success
 * state then has to be the user-visible signal that the click worked.
 * Used by the badge + DNR tests so they can assert SW-side state
 * after a deterministic "click landed + UI confirmed" anchor.
 */
async function completeOnboardingAndKeepPageOpen(page) {
  await page.evaluate(() => {
    window.close = () => {};
    if (chrome?.tabs?.remove) {
      chrome.tabs.remove = () => {};
    }
  });
  await page.locator("#tos-check").check();
  await page.locator("#start-btn").click();
  await expect(page.locator('[data-testid="ob-success"]')).toBeVisible();
}

async function readGlobalBadge(context, extensionId) {
  // Reads the GLOBAL badge text — the one applyOnboardingBadge() sets
  // without a tabId. We deliberately avoid the {tabId} read because
  // toolbar-presenter clears per-tab badges on navigationStarted, and
  // opening a new tab to send the runtime message would itself fire
  // that event and mask the global value with a per-tab "".
  const extOrigin = `chrome-extension://${extensionId}`;
  const page = await context.newPage();
  await page.goto(`${extOrigin}/popup/popup.html`);
  const result = await page.evaluate(() =>
    new Promise(resolve =>
      chrome.runtime.sendMessage({ type: "__TEST__readGlobalBadge" }, resolve)
    )
  );
  await page.close();
  return result?.badgeText ?? null;
}

test.describe("Onboarding regression: Firefox close + consent gate", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    await clearAll(context, extensionId);
    // The badge + DNR introspection helpers go through __TEST__
    // handlers, which are gated on chrome.storage.local["__muga_test_mode"].
    await installTestModeSentinel(context, extensionId);
  });

  test.afterEach(async ({ context, extensionId }) => {
    await clearTestModeSentinel(context, extensionId);
  });

  test("clicking Start renders success state and persists consent without relying on window.close()", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    // Simulate Firefox's behaviour, where window.close() and
    // chrome.tabs.remove() on the extension's own tab silently no-op.
    // Without this override, Chromium would close the tab and we could
    // not assert that the in-place success state is the safety net.
    // The whole point of the regression: when both close paths fail,
    // the user MUST still see confirmation.
    await page.evaluate(() => {
      window.close = () => {};
      if (chrome?.tabs?.remove) {
        chrome.tabs.remove = () => {};
      }
    });

    await page.locator("#tos-check").check();
    await page.locator("#start-btn").click();

    // Success state appears in-place. Asserting this is the regression
    // guard: pre-fix, the page just sat there silently if window.close()
    // was a no-op (Firefox).
    await expect(page.locator('[data-testid="ob-success"]')).toBeVisible();
    await expect(page.locator("#ob-success-close")).toBeVisible();
    await expect(page.locator(".ob-success-title")).not.toBeEmpty();

    // ob_ready flag flipped to indicate completion is rendered.
    expect(await page.evaluate(() => document.body.dataset.mugaOnboardingDone)).toBe("1");

    // Consent persisted regardless of whether close worked.
    const verify = await context.newPage();
    await verify.goto(`chrome-extension://${extensionId}/popup/popup.html`);
    const consent = await verify.evaluate(() =>
      new Promise(resolve =>
        chrome.storage.local.get({ mugaConsent: null }, r => resolve(r.mugaConsent))
      )
    );
    expect(consent).not.toBeNull();
    expect(consent.onboardingDone).toBe(true);
    expect(consent.consentVersion).toBe("1.0");
    expect(consent.consentDate).toBeGreaterThan(0);
    await verify.close();

    if (!page.isClosed()) await page.close();
  });

  test("global '!' badge is shown while onboardingDone is false and cleared after acceptance", async ({ context, extensionId }) => {
    // Pre-onboarding: badge surfaces "!". Poll because the storage
    // change from the beforeEach clearAll triggers an async listener
    // that re-applies the badge against the now-empty consent record.
    await expect.poll(
      () => readGlobalBadge(context, extensionId),
      { timeout: 5000 }
    ).toBe("!");

    // Complete onboarding.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");
    await completeOnboardingAndKeepPageOpen(page);

    // The mugaConsent storage change triggers the SW listener which
    // re-applies the badge. Poll briefly to absorb the round-trip.
    await expect.poll(
      () => readGlobalBadge(context, extensionId),
      { timeout: 5000 }
    ).toBe("");

    if (!page.isClosed()) await page.close();
  });

  test("global '!' badge survives tab navigation while onboardingDone is false", async ({ context, extensionId }) => {
    // Reproduces the bug the user hit on addons.mozilla.org: navigating
    // any tab made toolbar-presenter clear the per-tab badge to "",
    // masking the global "!" until the next SW restart. The fix gates
    // the navigationStarted emit on onboardingDone — when false, no
    // per-tab override is written.
    await expect.poll(
      () => readGlobalBadge(context, extensionId),
      { timeout: 5000 }
    ).toBe("!");

    // Drive a real navigation through the loading state.
    const tab = await context.newPage();
    await tab.goto("data:text/html,<title>nav-trigger</title>");
    await tab.waitForLoadState("domcontentloaded");

    // Badge must still be "!" — pre-fix this returned "".
    await expect.poll(
      () => readGlobalBadge(context, extensionId),
      { timeout: 5000 }
    ).toBe("!");

    await tab.close();
  });

  test("after completing onboarding, opening Settings does NOT bounce back to onboarding", async ({ context, extensionId }) => {
    // Reproduces the user-facing bug: options.js was reading
    // onboardingDone from chrome.storage.sync, but the consent fields
    // moved to chrome.storage.local in #355 (ADR-0001). After a clean
    // first acceptance, clicking Settings re-rendered onboarding
    // because the gate always saw the sync default `false`.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");
    await completeOnboardingAndKeepPageOpen(page);
    if (!page.isClosed()) await page.close();

    // Open the options page directly (the popup link does the same
    // chrome.runtime.openOptionsPage / window.location nav).
    const options = await context.newPage();
    await options.goto(`chrome-extension://${extensionId}/options/options.html`);

    // mugaReady is set at the end of options.js init — only reachable
    // when the consent gate did NOT short-circuit with a redirect. If
    // the gate fires, the page navigates to onboarding and this wait
    // would error out, which is also a deterministic signal of the
    // bug. Either way: no wall-clock waitForTimeout needed.
    await options.waitForFunction(
      () => document.body.dataset.mugaReady === "1",
      { timeout: 5000 }
    );

    expect(options.url()).toContain("/options/options.html");
    expect(options.url()).not.toContain("/onboarding/");

    await options.close();
  });

  test("DNR tracking_params ruleset is disabled until onboardingDone, enabled after", async ({ context, extensionId }) => {
    // Pre-onboarding: ruleset must be disabled. Poll so the result
    // does not race with applyDnrState() after the beforeEach clear.
    await expect.poll(
      async () => {
        const r = await readEnabledRulesets(context, extensionId);
        return r.ruleIds || [];
      },
      { timeout: 5000 }
    ).not.toContain("tracking_params");

    // Complete onboarding without letting the page self-close — the
    // assertion is on the SW side, but we still want a deterministic
    // visible signal that the click landed.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/onboarding/onboarding.html`);
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");
    await completeOnboardingAndKeepPageOpen(page);

    // After acceptance, the storage listener re-applies DNR state. The
    // ruleset becomes enabled. Poll to absorb the listener latency.
    await expect.poll(
      async () => {
        const r = await readEnabledRulesets(context, extensionId);
        return r.ruleIds || [];
      },
      { timeout: 5000 }
    ).toContain("tracking_params");

    if (!page.isClosed()) await page.close();
  });
});
