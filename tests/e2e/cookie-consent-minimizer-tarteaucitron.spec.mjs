/**
 * E2E: Cookie Consent Minimizer — tarteaucitron Tier 1 adapter
 *
 * Verifies the tarteaucitron reject path against a real Chromium with the
 * extension loaded. The fixture page mimics a tarteaucitron banner: a
 * `window.tarteaucitron.userInterface` object with a `respondAll()` method
 * plus the `#tarteaucitronRoot` DOM anchor — the triple-mandatory
 * (global + userInterface + fn) plus corroboration signal combination the
 * dispatcher requires before acting (src/lib/cmp-adapters.js).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-cookiescript.spec.mjs's
 * structure exactly (same onboarding helper shape, same feature pref, same
 * triple-mandatory-gate adapter shape) — the one structural difference is
 * the reject call takes a literal argument (`respondAll(false)`) instead of
 * zero arguments, so the fixture records the exact argument it received.
 *
 * HONEST LIMIT: this is a REGRESSION oracle only — a snapshot of one
 * fixture's behavior at write time. It proves the Chrome MAIN-world nonce
 * handshake (content/cookie-noise-mainworld.js) and the
 * never-auto-reject-the-other-way outcome on the fixture used here. It does
 * NOT validate the Firefox `window.wrappedJSObject` reject path
 * (content/cookie-noise.js) — Playwright's `chromium` fixture only exercises
 * Chrome — and it does NOT prove real-vendor-script compatibility against a
 * live tarteaucitron CMP build. A real-browser smoke test against at least
 * one live tarteaucitron deployment is required before considering this
 * adapter done — flagged for sdd-verify. Re-capture this fixture manually
 * whenever the tarteaucitron markup/API shape this test hardcodes changes
 * upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-tarteaucitron.invalid";

async function completeOnboarding(context, extensionId, { enableFeature = true } = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    ({ enableFeature }) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          { enabled: true, cookieConsentMode: enableFeature ? "reject-only" : "off" },
          () => {
            chrome.storage.local.set(
              {
                mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: Date.now() },
              },
              () => {
                chrome.storage.sync.set({ onboardingDone: true }, resolve);
              }
            );
          }
        );
      }),
    { enableFeature }
  );
  await page.close();
  // Prefs broadcast has no observable signal after storage.set resolves.
  // Centralised in waitForDnrPropagation so the debt is greppable (#824).
  await waitForDnrPropagation(page);
}

/**
 * Fixture page: a tarteaucitron banner offering a reject-all via
 * `tarteaucitron.userInterface.respondAll(false)`. All three mandatory
 * signals (global, userInterface, respondAll fn) are present alongside the
 * `#tarteaucitronRoot` DOM anchor — the confidence gate in cmp-adapters.js
 * requires the mandatory triple plus at least one corroborating DOM
 * secondary.
 */
async function stubTarteaucitronPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="tarteaucitronRoot">
          <div id="tarteaucitronAlertBig">
            <button id="tarteaucitronAllAllowed">Tout accepter</button>
            <button id="tarteaucitronAllDenied">Tout refuser</button>
          </div>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__tacCalls = [];
          window.tarteaucitron = {
            userInterface: {
              respondAll: function (status) {
                window.__tacCalls.push(["respondAll", status]);
                window.__consentState = status === false ? "necessary-only" : "accepted";
                document.getElementById("tarteaucitronRoot").remove();
              },
            },
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — tarteaucitron", () => {
  test("rejects a tarteaucitron banner with userInterface.respondAll(false) when the feature is enabled", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubTarteaucitronPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the Chrome MAIN-world caller's once-guard flag — set only
    // after the nonce handshake completes and the gate opens.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The dispatcher acts on gate-open (initial sweep) or on the
    // MutationObserver's first pass — poll for the outcome.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    // respondAll was actually invoked with the literal false — not true,
    // not omitted, not some other method.
    const tacCalls = await page.evaluate(() => window.__tacCalls);
    expect(tacCalls).toEqual([["respondAll", false]]);

    // Banner dismissed.
    const bannerGone = await page.evaluate(
      () => document.getElementById("tarteaucitronRoot") === null
    );
    expect(bannerGone).toBe(true);

    // Page remains functional — the unrelated marker is untouched.
    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("takes no action when the feature is disabled (default OFF)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, { enableFeature: false });

    const page = await context.newPage();
    await stubTarteaucitronPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(
      () => document.getElementById("tarteaucitronRoot") !== null
    );
    expect(bannerStillThere).toBe(true);

    const tacCalls = await page.evaluate(() => window.__tacCalls);
    expect(tacCalls).toEqual([]);

    await page.close();
  });

  test("never misfires on a Didomi-only page (no tarteaucitron global present)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const DIDOMI_HOST = "muga-test-cookie-consent-tarteaucitron-didomi-guard.invalid";
    await page.route(`**://${DIDOMI_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <div id="didomi-host"></div>
          <p id="page-content">Real page content</p>
          <script>
            // A Didomi-shaped page: exposes window.Didomi.setUserDisagreeToAll
            // but NO window.tarteaucitron global at all. The tarteaucitron
            // adapter must never act here.
            window.__didomiCalls = [];
            window.Didomi = {
              getCurrentUserStatus: function () { return {}; },
              setUserDisagreeToAll: function () {
                window.__didomiCalls.push("setUserDisagreeToAll");
              },
            };
          </script>
        </body></html>`,
      })
    );
    await page.goto(`https://${DIDOMI_HOST}/index.html`);

    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The Didomi adapter IS expected to fire here (it is a real Didomi
    // page) — what this test guards is that the tarteaucitron adapter never
    // ALSO claims it / never references tarteaucitron on a page that has
    // none.
    await page.waitForFunction(
      () => Array.isArray(window.__didomiCalls) && window.__didomiCalls.includes("setUserDisagreeToAll"),
      { timeout: 10000 }
    );

    const tacGlobalPresent = await page.evaluate(() => typeof window.tarteaucitron !== "undefined");
    expect(tacGlobalPresent).toBe(false);

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("does not throw or reject when tarteaucitron is present but has no .userInterface (null-safety)", async ({
    context,
    extensionId,
  }) => {
    // Regression guard for the exact TypeError hazard the triple-mandatory
    // gate exists to prevent: window.tarteaucitron is a truthy object but
    // has NO `.userInterface` (the vendor script attaches the global before
    // the UI module is constructed). Reading
    // `window.tarteaucitron.userInterface.respondAll` naively would throw
    // "Cannot read properties of undefined". The signal collector
    // short-circuits on the missing userInterface, so detection must fail
    // closed and the adapter must NOOP — with zero page errors captured.
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const NO_UI_HOST = "muga-test-cookie-consent-tarteaucitron-no-userinterface.invalid";
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.route(`**://${NO_UI_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <div id="tarteaucitronRoot">
            <div id="tarteaucitronAlertBig">
              <button id="tarteaucitronAllAllowed">Tout accepter</button>
              <button id="tarteaucitronAllDenied">Tout refuser</button>
            </div>
          </div>
          <p id="page-content">Real page content</p>
          <script>
            // Truthy tarteaucitron global WITHOUT a .userInterface — the
            // exact present-but-not-yet-populated shape the triple gate
            // guards.
            window.tarteaucitron = {};
          </script>
        </body></html>`,
      })
    );
    await page.goto(`https://${NO_UI_HOST}/index.html`);

    // Wait for the MAIN-world caller's once-guard flag — proves the signal
    // collection path (including the tarteaucitron `.userInterface`-undefined
    // branch) actually ran under real page-error capture.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // Asserting an ABSENCE of behavior (the gate must stay closed and no
    // TypeError must surface) has no positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    // The adapter must NOT have acted: no consent state was mutated.
    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    // Banner is untouched — the feature-safe NOOP left the page alone.
    const bannerStillThere = await page.evaluate(
      () => document.getElementById("tarteaucitronRoot") !== null
    );
    expect(bannerStillThere).toBe(true);

    // The global is still the userInterface-less object we planted (no
    // crash mid-collection that would have aborted the script).
    const tacShape = await page.evaluate(() => ({
      isObject: typeof window.tarteaucitron === "object" && window.tarteaucitron !== null,
      hasUserInterface: typeof window.tarteaucitron?.userInterface !== "undefined",
    }));
    expect(tacShape).toEqual({ isObject: true, hasUserInterface: false });

    // The whole point: reading `.userInterface.respondAll` never threw.
    expect(pageErrors).toHaveLength(0);

    await page.close();
  });
});
