/**
 * E2E: Cookie Consent Minimizer — consentmanager.net Tier 1 adapter
 *
 * Verifies the consentmanager.net reject path against a real Chromium with
 * the extension loaded. The fixture page mimics a consentmanager.net
 * banner: a `window.cmpmngr` object plus a `window.__cmp` function and the
 * `#cmpbox` DOM anchor — the triple-mandatory (cmpmngr global + __cmp fn +
 * #cmpbox DOM) plus corroboration signal combination the dispatcher
 * requires before acting (src/lib/cmp-adapters.js).
 *
 * Mirrors tests/e2e/cookie-consent-minimizer-tarteaucitron.spec.mjs's
 * structure exactly (same onboarding helper shape, same feature pref) — the
 * one structural difference is the reject call
 * (`__cmp("setConsent", 0, callback, true)`) takes a literal command name
 * PLUS a literal consent-value argument, so the fixture records the exact
 * arguments it received.
 *
 * HONEST LIMIT: this is a REGRESSION oracle only — a snapshot of one
 * fixture's behavior at write time. It proves the Chrome MAIN-world nonce
 * handshake (content/cookie-noise-mainworld.js) and the
 * never-auto-reject-the-other-way outcome on the fixture used here. It does
 * NOT validate the Firefox `window.wrappedJSObject` reject path
 * (content/cookie-noise.js) — Playwright's `chromium` fixture only exercises
 * Chrome — see tests/e2e-firefox/consentmanager.smoke.mjs for that. It does
 * confirm real-vendor-script compatibility against a live probe (engram
 * sdd/cookie-consent-coverage/tier1-live-probe), but this fixture itself is
 * a synthetic reproduction, not a live site. Re-capture this fixture
 * manually whenever the consentmanager.net markup/API shape this test
 * hardcodes changes upstream.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-consentmanager.invalid";

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
 * Fixture page: a consentmanager.net banner offering a reject-all via
 * `window.__cmp("setConsent", 0, callback, true)`. All three mandatory
 * signals (cmpmngr global, __cmp fn, #cmpbox DOM) are present alongside the
 * `#cmpwelcomebtnyes`/`#cmpwelcomebtnno` DOM anchors — the confidence gate
 * in cmp-adapters.js requires the mandatory triple plus at least one
 * corroborating DOM secondary.
 */
async function stubConsentmanagerPage(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="cmpbox">
          <button id="cmpwelcomebtnyes">Accept all</button>
          <button id="cmpwelcomebtnno">Reject all</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__cmpCalls = [];
          window.cmpmngr = {};
          window.__cmp = function (command, consentValue, callback, isAsync) {
            window.__cmpCalls.push([command, consentValue]);
            if (command === "setConsent") {
              window.__consentState = consentValue === 0 ? "necessary-only" : "accepted";
              document.getElementById("cmpbox").remove();
              if (typeof callback === "function") callback(true);
            }
          };
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — consentmanager.net", () => {
  test("rejects a consentmanager.net banner with __cmp('setConsent', 0, callback, true) when the feature is enabled", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubConsentmanagerPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the Chrome MAIN-world caller's once-guard flag — set only
    // after the nonce handshake completes and the gate opens.
    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // The dispatcher acts on gate-open (initial sweep) or on the
    // MutationObserver's first pass — poll for the outcome.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBe("necessary-only");

    // __cmp was actually invoked with the literal setConsent command and
    // the literal 0 consent value — not accept (1), not omitted, not some
    // other command.
    const cmpCalls = await page.evaluate(() => window.__cmpCalls);
    expect(cmpCalls).toEqual([["setConsent", 0]]);

    // Banner dismissed.
    const bannerGone = await page.evaluate(() => document.getElementById("cmpbox") === null);
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
    await stubConsentmanagerPage(page);
    await page.goto(`https://${HOST}/index.html`);

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this test suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const bannerStillThere = await page.evaluate(() => document.getElementById("cmpbox") !== null);
    expect(bannerStillThere).toBe(true);

    const cmpCalls = await page.evaluate(() => window.__cmpCalls);
    expect(cmpCalls).toEqual([]);

    await page.close();
  });

  test("never misfires on a Didomi-only page (no cmpmngr/__cmp/#cmpbox present)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    const DIDOMI_HOST = "muga-test-cookie-consent-consentmanager-didomi-guard.invalid";
    await page.route(`**://${DIDOMI_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <div id="didomi-host"></div>
          <p id="page-content">Real page content</p>
          <script>
            // A Didomi-shaped page: exposes window.Didomi.setUserDisagreeToAll
            // but NO window.cmpmngr / window.__cmp / #cmpbox at all. The
            // consentmanager.net adapter must never act here.
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
    // page) — what this test guards is that the consentmanager.net adapter
    // never ALSO claims it / never references __cmp on a page that has
    // none.
    await page.waitForFunction(
      () => Array.isArray(window.__didomiCalls) && window.__didomiCalls.includes("setUserDisagreeToAll"),
      { timeout: 10000 }
    );

    const cmpFnPresent = await page.evaluate(() => typeof window.__cmp !== "undefined");
    expect(cmpFnPresent).toBe(false);

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("never misfires on a bare-__cmp-only page (legacy TCF v1.1 CMP shape, no cmpmngr/#cmpbox)", async ({
    context,
    extensionId,
  }) => {
    // Regression guard for the exact discrimination hazard the
    // triple-mandatory gate exists to prevent: __cmp is the legacy IAB TCF
    // v1.1 generic surface shared by many CMPs. A page that exposes a bare
    // __cmp function but NOT the consentmanager.net-specific cmpmngr global
    // or #cmpbox DOM must never trigger this adapter.
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const BARE_CMP_HOST = "muga-test-cookie-consent-consentmanager-bare-cmp-guard.invalid";
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.route(`**://${BARE_CMP_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <p id="page-content">Real page content</p>
          <script>
            // A generic TCF v1.1 CMP shape: bare __cmp function, but NO
            // window.cmpmngr and NO #cmpbox — this is exactly the
            // discrimination gap the triple-mandatory gate closes.
            window.__cmpCalls = [];
            window.__cmp = function (command, consentValue, callback) {
              window.__cmpCalls.push([command, consentValue]);
              if (typeof callback === "function") callback(true);
            };
          </script>
        </body></html>`,
      })
    );
    await page.goto(`https://${BARE_CMP_HOST}/index.html`);

    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // Asserting an ABSENCE of behavior (the gate must stay closed) has no
    // positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const cmpCalls = await page.evaluate(() => window.__cmpCalls);
    expect(cmpCalls).toEqual([]);

    const cmpMngrPresent = await page.evaluate(() => typeof window.cmpmngr !== "undefined");
    expect(cmpMngrPresent).toBe(false);

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("does not throw or reject when __cmp is present but cmpmngr/#cmpbox are absent (null-safety)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const NO_ANCHOR_HOST = "muga-test-cookie-consent-consentmanager-no-anchor.invalid";
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));

    await page.route(`**://${NO_ANCHOR_HOST}/**`, (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>
          <p id="page-content">Real page content</p>
          <script>
            // __cmp present, but no cmpmngr global and no #cmpbox DOM —
            // the mandatory triple must fail closed without throwing.
            window.__cmp = function () {};
          </script>
        </body></html>`,
      })
    );
    await page.goto(`https://${NO_ANCHOR_HOST}/index.html`);

    await page.waitForFunction(() => window.__mugaCookieNoise === true, { timeout: 10000 });

    // Asserting an ABSENCE of behavior (the gate must stay closed and no
    // TypeError must surface) has no positive DOM/window signal to wait on.
    // REASON: a fixed settle window is the standard pattern for a negative
    // assertion in this suite — there is nothing to waitForFunction on.
    await page.waitForTimeout(1500);

    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();

    const cmpMngrShape = await page.evaluate(() => ({
      hasCmp: typeof window.__cmp === "function",
      hasCmpMngr: typeof window.cmpmngr !== "undefined",
      hasCmpBox: document.getElementById("cmpbox") !== null,
    }));
    expect(cmpMngrShape).toEqual({ hasCmp: true, hasCmpMngr: false, hasCmpBox: false });

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });
});
