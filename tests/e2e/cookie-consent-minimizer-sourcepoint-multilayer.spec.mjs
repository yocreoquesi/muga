/**
 * E2E: Cookie Consent Minimizer — Sourcepoint MULTI-LAYER reject (#1123 follow-up)
 *
 * Verifies the multi-layer DOM-click path against a real Chromium with the
 * extension loaded. Some Sourcepoint walls expose ONLY a "12"
 * ("Options"/"Manage") control, with the real "Reject all" ("13") one layer
 * deeper inside the privacy-manager panel that "12" opens. The extension must
 * click the single actionable "12" ONCE to reveal that panel, then click the
 * revealed single "13" — and NEVER the accept/pay control.
 *
 * This fixture makes `__tcfapi("postRejectAll", ...)` a NO-OP that does not
 * dismiss the wall — the exact real-deployment gap the DOM-click fallback
 * exists for (round-2 EU verification, see cmp-adapters.js). So the ONLY path
 * that can actually reject here is the multi-layer DOM click; if it regresses,
 * the wall never clears and the positive test times out.
 *
 * WHAT THIS PROVES that unit tests cannot: real click-event propagation (the
 * extension's isolated-world element.click() firing the page's own handler,
 * which renders the deeper panel) plus the MutationObserver re-entry that
 * catches and clicks the revealed "13".
 *
 * HONEST LIMIT (same as the sibling Sourcepoint spec): a synthetic-fixture
 * regression oracle only — Chromium, one hardcoded markup shape. It does NOT
 * prove real-vendor compatibility against a live Sourcepoint privacy-manager
 * build, nor the Firefox wrappedJSObject path. A live-site headed smoke against
 * a real "12"-only Sourcepoint wall remains the gate before enabling for users.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-sp-multilayer.invalid";

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
  // Prefs broadcast has no observable signal after storage.set resolves (#824).
  await waitForDnrPropagation(page);
}

/**
 * Fixture: a Sourcepoint wall whose banner exposes ONLY a "12" (Options)
 * control. Clicking "12" reveals the privacy-manager panel — an accept "11"
 * and a reject "13" — mirroring the real second-layer flow. `postRejectAll`
 * is a no-op (records the call, never dismisses), so only the multi-layer DOM
 * click can clear the wall.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ revealReject?: boolean }} [opts] when false, the opened panel
 *   exposes ONLY an accept control (no "13") — the never-accept adversarial case.
 */
async function stubSourcepointMultiLayerPage(page, { revealReject = true } = {}) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="sp_message_container_1234">
          <iframe src="https://some-account.privacy-mgmt.com/consent/some-message" title="consent"></iframe>
          <button id="sp-btn-options" class="message-button sp_choice_type_12">Options</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__spClicks = [];
          window.__tcfapiCalls = [];
          // postRejectAll FIRES but does NOT dismiss the wall — the real-site
          // gap the DOM-click fallback exists for. The multi-layer DOM path is
          // the only thing that can actually reject on this fixture.
          window.__tcfapi = function (command, version, callback) {
            window.__tcfapiCalls.push(command);
            if (typeof callback === "function") callback(false, false);
          };
          var container = document.getElementById("sp_message_container_1234");
          var optionsBtn = document.getElementById("sp-btn-options");
          optionsBtn.addEventListener("click", function () {
            window.__spClicks.push("options-12");
            // Idempotency guard on the fixture side: render the panel once.
            if (document.getElementById("sp-panel")) return;
            // Render the privacy-manager panel ASYNCHRONOUSLY — a real
            // Sourcepoint "Options" click builds/fetches the panel on a later
            // task, never synchronously inside the click handler. This is both
            // realistic and what the extension's MutationObserver reacts to
            // (a fresh mutation task, not a mutation during its own click call).
            setTimeout(function () {
              var panel = document.createElement("div");
              panel.id = "sp-panel";

              var accept = document.createElement("button");
              accept.id = "sp-btn-accept";
              accept.className = "message-button sp_choice_type_11";
              accept.textContent = "Accept All";
              accept.addEventListener("click", function () { window.__spClicks.push("accept-11"); });
              panel.appendChild(accept);

              ${
                revealReject
                  ? `var reject = document.createElement("button");
                     reject.id = "sp-btn-reject";
                     reject.className = "message-button sp_choice_type_13";
                     reject.textContent = "Reject All";
                     reject.addEventListener("click", function () {
                       window.__spClicks.push("reject-13");
                       window.__consentState = "necessary-only";
                       container.remove();
                     });
                     panel.appendChild(reject);`
                  : `/* adversarial: the panel reveals NO reject path */`
              }

              container.appendChild(panel);
            }, 50);
          });
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Minimizer — Sourcepoint multi-layer (#1123 follow-up)", () => {
  test("clicks the '12' Options control to open the panel, then clicks the revealed '13' Reject-all — never the accept control", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubSourcepointMultiLayerPage(page, { revealReject: true });
    await page.goto(`https://${HOST}/index.html`);

    // The multi-layer path: open "12" -> panel renders -> observer clicks "13"
    // -> the page's reject handler flips consent state. Poll for that outcome.
    await page.waitForFunction(() => window.__consentState === "necessary-only", { timeout: 10000 });

    // The exact click sequence: opened the panel via "12", then rejected via
    // "13". The accept control was NEVER clicked.
    const clicks = await page.evaluate(() => window.__spClicks);
    expect(clicks).toEqual(["options-12", "reject-13"]);

    // The "12" panel-open happened exactly once (idempotent — no re-open loop).
    const optionsClicks = clicks.filter((c) => c === "options-12").length;
    expect(optionsClicks).toBe(1);

    // Banner dismissed, page still functional.
    const bannerGone = await page.evaluate(
      () => document.querySelector('div[id^="sp_message_container"]') === null
    );
    expect(bannerGone).toBe(true);
    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("NEVER-ACCEPT: if opening the '12' panel reveals only an accept control (no '13'), the accept is never clicked and the wall stays (fail-closed NOOP)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubSourcepointMultiLayerPage(page, { revealReject: false });
    await page.goto(`https://${HOST}/index.html`);

    // Wait for the panel to be opened, then give the extension ample time to
    // (wrongly, if it regressed) act on the revealed controls.
    await page.waitForFunction(() => window.__spClicks.includes("options-12"), { timeout: 10000 });
    // REASON: adversarial negative — after the panel opens there is no positive
    // reject signal (a correct run does nothing more); a fixed settle gives a
    // regressed accept-click time to wrongly fire before we assert it never did.
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__spClicks);
    // The panel was opened (once) but NO accept was ever clicked.
    expect(clicks).toContain("options-12");
    expect(clicks).not.toContain("accept-11");
    expect(clicks.filter((c) => c === "options-12").length).toBe(1);

    // Consent was never granted and the wall remains — fail-closed.
    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();
    const bannerStillThere = await page.evaluate(
      () => document.querySelector('div[id^="sp_message_container"]') !== null
    );
    expect(bannerStillThere).toBe(true);

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("takes no action when the feature is disabled (default OFF) — never opens the '12' panel", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, { enableFeature: false });

    const page = await context.newPage();
    await stubSourcepointMultiLayerPage(page, { revealReject: true });
    await page.goto(`https://${HOST}/index.html`);

    // REASON: negative assertion (feature OFF) — no positive signal to wait on;
    // fixed settle window, the standard pattern for this suite's negatives.
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__spClicks);
    expect(clicks).toEqual([]);
    const consentState = await page.evaluate(() => window.__consentState);
    expect(consentState).toBeUndefined();
    const bannerStillThere = await page.evaluate(
      () => document.querySelector('div[id^="sp_message_container"]') !== null
    );
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
