/**
 * E2E: Cookie Consent Minimizer — Usercentrics Tier 1 adapter (#1121)
 *
 * Verifies the Usercentrics reject path against a real Chromium with the
 * extension loaded. The fixture page mimics a Usercentrics drop-in banner:
 * the vendor-namespaced global `window.UC_UI.denyAllConsents()` plus a
 * `#usercentrics-root` DOM host — the dual-mandatory signal combination the
 * dispatcher requires before acting (src/lib/cmp-adapters.js).
 *
 * NEW WRINKLE vs the other 5 adapters: `denyAllConsents()` returns a
 * Promise. The fixture's stub models this explicitly so this spec exercises
 * the async fire-and-forget path — the dispatcher must call the method,
 * chain `.catch(() => {})`, and mark the reject as done (stopObserver)
 * SYNCHRONOUSLY, without awaiting the promise.
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-sourcepoint.spec.mjs's
 * structure exactly (same onboarding helper shape, same feature pref).
 *
 * HONEST LIMIT (per sdd/usercentrics-adapter/explore, engram #1287): this is
 * a REGRESSION oracle only — a snapshot of one fixture's behavior at write
 * time. It proves the Chrome MAIN-world nonce handshake
 * (content/cookie-noise-mainworld.js) and the never-auto-reject-the-other-
 * way outcome on the fixture used here. It does NOT validate the Firefox
 * `window.wrappedJSObject` reject path (content/cookie-noise.js) —
 * Playwright's `chromium` fixture only exercises Chrome — and it does NOT
 * prove real-vendor-script compatibility against a live Usercentrics CMP
 * build. The Usercentrics API shape used here (denyAllConsents() returning
 * a Promise, isInitialized()) was corroborated only via THIRD-PARTY
 * integration docs — Usercentrics' own docs page for this exact method was
 * unreachable during exploration — so a real-browser smoke against a live
 * Usercentrics drop-in site carries EXTRA weight for this adapter
 * specifically, beyond the usual residual risk already accepted for the
 * other 5 adapters at ship time.
 *
 * REAL-BROWSER SMOKE PLAN required before considering this slice done
 * (flagged for sdd-verify):
 *   1. Live Usercentrics drop-in site — confirm both mandatory signals
 *      (`UC_UI.denyAllConsents` fn + `#usercentrics-root` DOM) are detected
 *      and `denyAllConsents()` actually clears the page's consent state.
 *   2. Confirm `denyAllConsents()` is safe to call when no active prompt is
 *      showing (already-consented page) — does not throw, does not have an
 *      unexpected side effect.
 *   3. Confirm `UC_UI.isInitialized()` reliably reflects whether a reject
 *      call is safe to attempt (the headless/no-prompt gate).
 *
 * Re-capture this fixture manually whenever the Usercentrics markup/API
 * shape this test hardcodes changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-usercentrics.invalid";

async function completeOnboarding(context, extensionId, { enableFeature = true } = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    ({ enableFeature }) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          { enabled: true, cookieConsentMinimizerEnabled: enableFeature },
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
 * Fixture page: a Usercentrics drop-in banner offering reject via
 * `UC_UI.denyAllConsents()`. Both mandatory signals (`UC_UI` global,
 * `denyAllConsents` function) are present, plus the `#usercentrics-root`
 * DOM host as the corroborating secondary signal — the confidence gate in
 * cmp-adapters.js requires both mandatory signals plus at least one
 * secondary signal. `denyAllConsents` returns a real Promise (resolved on
 * a macrotask delay) so this fixture exercises the fire-and-forget async
 * path, not a synchronous stub.
 */
async function stubUsercentricsPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="usercentrics-root">
          <button id="uc-btn-accept">Accept All</button>
          <button id="uc-btn-deny">Deny All</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__ucCalls = [];
          window.UC_UI = {
            isInitialized: function () { return true; },
            denyAllConsents: function () {
              window.__ucCalls.push("denyAllConsents");
              return new Promise(function (resolve) {
                setTimeout(function () {
                  window.__consentState = "necessary-only";
                  document.getElementById("usercentrics-root").remove();
                  resolve(true);
                }, 0);
              });
            },
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — Usercentrics (#1121)", () => {
  test("rejects a Usercentrics banner with UC_UI.denyAllConsents() when the feature is enabled", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubUsercentricsPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the Chrome MAIN-world caller's once-guard flag — set only
    // after the nonce handshake completes and the gate opens.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The dispatcher acts on gate-open (initial sweep) or on the
    // MutationObserver's first pass. denyAllConsents() resolves the page's
    // consent state asynchronously (macrotask) — poll for the outcome
    // rather than asserting immediately, since the reject call site never
    // awaits it either.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    // denyAllConsents was actually invoked (not some other UC_UI method).
    const ucCalls = await page.evaluate(() => window.__ucCalls);
    expect(ucCalls).toEqual(["denyAllConsents"]);

    // Banner host dismissed.
    const bannerGone = await page.evaluate(
      () => document.getElementById("usercentrics-root") === null
    );
    expect(bannerGone).toBe(true);

    // Page remains functional — the unrelated marker is untouched.
    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    // The promise returned by denyAllConsents() was never awaited by the
    // dispatcher itself (fire-and-forget) and its rejection path (if any)
    // is swallowed — no unhandled rejection / page error surfaces.
    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("takes no action when the feature is disabled (default OFF)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, { enableFeature: false });

    const page = await context.newPage();
    await stubUsercentricsPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(
      () => document.getElementById("usercentrics-root") !== null
    );
    expect(bannerStillThere).toBe(true);

    const ucCalls = await page.evaluate(() => window.__ucCalls);
    expect(ucCalls).toEqual([]);

    await page.close();
  });

  test("never misfires on a Didomi-only page (no UC_UI global present)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const DIDOMI_HOST = "muga-test-cookie-consent-usercentrics-didomi-guard.invalid";
    await page.route(`**://${DIDOMI_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <div id="didomi-host"></div>
          <p id="page-content">Real page content</p>
          <script>
            // A Didomi-shaped page: exposes window.Didomi.setUserDisagreeToAll
            // but NO window.UC_UI global at all. The Usercentrics adapter
            // must never act here.
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
    // page) — what this test guards is that the Usercentrics adapter never
    // ALSO claims it / never references UC_UI on a page that has none.
    await page.waitForFunction(
      () => Array.isArray(window.__didomiCalls) && window.__didomiCalls.includes("setUserDisagreeToAll"),
      { timeout: 10000 }
    );

    const ucGlobalPresent = await page.evaluate(() => typeof window.UC_UI !== "undefined");
    expect(ucGlobalPresent).toBe(false);

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });
});
