/**
 * E2E: Cookie Consent Toggle-Reject sweep (cookie-consent-toggle-reject,
 * PR 2 — design.md ADR-2/ADR-3/ADR-5)
 *
 * Verifies the reject-only multi-step toggle sweep (open settings -> sweep
 * every category toggle reject-only -> verify the fail-closed save
 * invariant -> click Save only when safe) against a real Chromium with the
 * extension loaded, using a SYNTHETIC fixture rule — NOT Osano, no live
 * site (that curated pilot rule ships in PR 3). The fixture rule is
 * injected directly into `chrome.storage.local.remoteTier2Rules`, exactly
 * the same content-side extension point PR B2 (#1027 Slice 2) already
 * ships for reject/openSettings selectors — see
 * `tier2FilterRemoteToggleScope` in src/content/cookie-noise.js. This is
 * deliberately NOT routed through the signed background fetch pipeline
 * (src/lib/remote-tier2-rules.js), which still enforces an EXACT 4-key
 * rule shape with no toggleScope field at all — a real signed payload
 * cannot carry a toggleScope today; only a direct storage write (what this
 * spec does, mirroring how other e2e specs seed chrome.storage.sync/local
 * directly) can reach this code path.
 *
 * Every negative scenario proves the SAME thing from a different angle:
 * the "save" click-veto role only ever fires after
 * computeSaveInvariant is satisfied, and any failure to reach that state
 * is a silent NOOP that leaves the banner exactly as-is — Save is never
 * clicked, and a decoy Accept-All control (present on every fixture
 * variant) is NEVER clicked either.
 *
 * HONEST LIMIT (same posture as the sibling Tier 2 e2e specs): a
 * synthetic-fixture regression oracle only, Chromium-only. It does not
 * prove compatibility with any real CMP's markup — that is exactly what
 * PR 3's curated, probe-gated Osano rule is for.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const HOST = "muga-test-cookie-consent-toggle-reject.invalid";

const TOGGLE_RULE = Object.freeze({
  id: "e2e-toggle-fixture",
  present: ["#e2e-toggle-cmp"],
  reject: [".e2e-toggle-noop-reject"], // never present on this fixture — always noop, harmless
  openSettings: ["#e2e-open-settings"],
  toggleScope: {
    container: "#e2e-panel",
    toggle: "[role='switch']",
    lockedOn: "[aria-disabled='true']",
    save: ["#e2e-save"],
  },
});

async function completeOnboardingAndSeedRule(context, extensionId, { enableFeature = true } = {}) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    ({ enableFeature, rule }) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          { enabled: true, cookieConsentMode: enableFeature ? "reject-only" : "off" },
          () => {
            chrome.storage.local.set(
              {
                mugaConsent: { onboardingDone: true, consentVersion: "1.2", consentDate: Date.now() },
                // Synthetic fixture rule, injected the SAME way the real
                // background pipeline would eventually cache a signed
                // Tier2 payload's rules — see this file's docblock.
                remoteTier2Rules: [rule],
              },
              () => {
                chrome.storage.sync.set({ onboardingDone: true }, resolve);
              }
            );
          }
        );
      }),
    { enableFeature, rule: TOGGLE_RULE }
  );
  await page.close();
  await waitForDnrPropagation(page);
}

/**
 * Fixture: a banner exposing only a "Manage preferences" settings-opener.
 * Clicking it reveals (asynchronously, mirroring the real Sourcepoint
 * multi-layer fixture's timing) a panel with a locked/necessary switch, one
 * or more category switches whose click behavior is scenario-controlled,
 * a decoy "Accept All" control (must NEVER be clicked), and a "Save
 * preferences" control.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{
 *   toggleStartsOn?: boolean,
 *   toggleFlipsOnClick?: boolean,
 *   extraUncuratedCheckedBox?: boolean,
 * }} opts
 */
async function stubToggleFixturePage(page, {
  toggleStartsOn = true,
  toggleFlipsOnClick = true,
  extraUncuratedCheckedBox = false,
} = {}) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="e2e-toggle-cmp">
          <button id="e2e-open-settings">Manage preferences</button>
        </div>
        <p id="page-content">Real page content</p>
        <script>
          window.__e2eClicks = [];
          var cmp = document.getElementById("e2e-toggle-cmp");
          var openBtn = document.getElementById("e2e-open-settings");
          openBtn.addEventListener("click", function () {
            window.__e2eClicks.push("open-settings");
            if (document.getElementById("e2e-panel")) return;
            // Asynchronous panel render — same deliberate timing as the
            // Sourcepoint multi-layer fixture: the extension's
            // MutationObserver must react to a later mutation task, not a
            // mutation fired synchronously inside its own click call.
            setTimeout(function () {
              var panel = document.createElement("div");
              panel.id = "e2e-panel";

              var locked = document.createElement("div");
              locked.setAttribute("role", "switch");
              locked.setAttribute("aria-checked", "true");
              locked.setAttribute("aria-disabled", "true");
              locked.textContent = "Strictly necessary";
              panel.appendChild(locked);

              var category = document.createElement("div");
              category.setAttribute("role", "switch");
              category.setAttribute("aria-checked", ${toggleStartsOn ? "\"true\"" : "\"false\""});
              category.textContent = "Analytics";
              category.addEventListener("click", function () {
                window.__e2eClicks.push("category-click");
                ${toggleFlipsOnClick ? 'category.setAttribute("aria-checked", "false");' : "/* stuck — deliberately does NOT flip */"}
              });
              panel.appendChild(category);

              ${
                extraUncuratedCheckedBox
                  ? `var rogue = document.createElement("input");
                     rogue.type = "checkbox";
                     rogue.checked = true;
                     rogue.id = "e2e-rogue-checkbox";
                     // Deliberately NO role="switch" — the curated toggle
                     // selector ([role='switch']) never enumerates this,
                     // only the CMP-selector-independent backstop can.
                     panel.appendChild(rogue);`
                  : ""
              }

              var accept = document.createElement("button");
              accept.id = "e2e-accept";
              accept.textContent = "Accept All";
              accept.addEventListener("click", function () { window.__e2eClicks.push("accept"); });
              panel.appendChild(accept);

              var save = document.createElement("button");
              save.id = "e2e-save";
              save.textContent = "Save preferences";
              save.addEventListener("click", function () {
                window.__e2eClicks.push("save");
                window.__e2eConsentState = "necessary-only";
                cmp.remove();
              });
              panel.appendChild(save);

              cmp.appendChild(panel);
            }, 50);
          });
        </script>
      </body></html>`,
    })
  );
}

test.describe("Cookie Consent Toggle-Reject sweep (cookie-consent-toggle-reject, PR 2)", () => {
  test("(a) all non-locked toggles read OFF after the sweep -> the save invariant is satisfied -> Save is clicked, banner dismissed", async ({
    context,
    extensionId,
  }) => {
    await completeOnboardingAndSeedRule(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubToggleFixturePage(page, { toggleStartsOn: true, toggleFlipsOnClick: true });
    await page.goto(`https://${HOST}/index.html`);

    await page.waitForFunction(() => window.__e2eConsentState === "necessary-only", { timeout: 10000 });

    const clicks = await page.evaluate(() => window.__e2eClicks);
    // Exact sequence: open settings -> sweep clicks the category toggle
    // once -> Save. The decoy Accept control is NEVER clicked.
    expect(clicks).toEqual(["open-settings", "category-click", "save"]);
    expect(clicks).not.toContain("accept");

    const bannerGone = await page.evaluate(() => document.getElementById("e2e-toggle-cmp") === null);
    expect(bannerGone).toBe(true);

    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("(b) a defaulted-ON standard toggle the curated selector never enumerated -> the CMP-selector-independent backstop catches it -> Save is VETOED (NOOP), banner stays", async ({
    context,
    extensionId,
  }) => {
    await completeOnboardingAndSeedRule(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubToggleFixturePage(page, {
      toggleStartsOn: true,
      toggleFlipsOnClick: true,
      extraUncuratedCheckedBox: true,
    });
    await page.goto(`https://${HOST}/index.html`);

    // The sweep still runs (the curated toggle gets clicked off) — wait for
    // that positive signal, then give the extension ample time to
    // (wrongly, if it regressed) click Save anyway.
    await page.waitForFunction(() => window.__e2eClicks.includes("category-click"), { timeout: 10000 });
    // REASON: adversarial negative (mirrors the Sourcepoint multi-layer
    // spec) — settle, then assert a regressed Save click never fired.
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__e2eClicks);
    expect(clicks).not.toContain("save");
    expect(clicks).not.toContain("accept");

    const consentState = await page.evaluate(() => window.__e2eConsentState);
    expect(consentState).toBeUndefined();
    const bannerStillThere = await page.evaluate(() => document.getElementById("e2e-toggle-cmp") !== null);
    expect(bannerStillThere).toBe(true);
    // The rogue, uncurated checkbox is untouched — this dispatcher only
    // ever writes to entries it actually enumerated.
    const rogueStillChecked = await page.evaluate(() => document.getElementById("e2e-rogue-checkbox")?.checked);
    expect(rogueStillChecked).toBe(true);

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("(c) a toggle that reads back ON after .click() (stuck) -> the save invariant is unsatisfied -> Save is VETOED (NOOP), no second click attempt", async ({
    context,
    extensionId,
  }) => {
    await completeOnboardingAndSeedRule(context, extensionId, { enableFeature: true });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubToggleFixturePage(page, { toggleStartsOn: true, toggleFlipsOnClick: false });
    await page.goto(`https://${HOST}/index.html`);

    await page.waitForFunction(() => window.__e2eClicks.includes("category-click"), { timeout: 10000 });
    // REASON: adversarial negative — same settle-then-assert-nothing-more
    // pattern as scenario (b) above; a correct run never resolves a save
    // candidate once the invariant is unsatisfied.
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__e2eClicks);
    // The toggle was clicked exactly once — never retried, never forced.
    expect(clicks.filter((c) => c === "category-click")).toHaveLength(1);
    expect(clicks).not.toContain("save");
    expect(clicks).not.toContain("accept");

    const consentState = await page.evaluate(() => window.__e2eConsentState);
    expect(consentState).toBeUndefined();
    const bannerStillThere = await page.evaluate(() => document.getElementById("e2e-toggle-cmp") !== null);
    expect(bannerStillThere).toBe(true);
    const stillOn = await page.evaluate(() => document.querySelector("#e2e-panel [role='switch']:not([aria-disabled])")?.getAttribute("aria-checked"));
    expect(stillOn).toBe("true");

    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("takes no action when the feature is disabled (default OFF) — never opens the settings panel", async ({
    context,
    extensionId,
  }) => {
    await completeOnboardingAndSeedRule(context, extensionId, { enableFeature: false });

    const page = await context.newPage();
    await stubToggleFixturePage(page, { toggleStartsOn: true, toggleFlipsOnClick: true });
    await page.goto(`https://${HOST}/index.html`);

    // REASON: negative assertion (feature OFF) — no positive signal to wait
    // on; fixed settle window, the standard pattern for this suite's
    // negatives (see cookie-consent-minimizer-sourcepoint-multilayer.spec.mjs).
    await page.waitForTimeout(1500);

    const clicks = await page.evaluate(() => window.__e2eClicks);
    expect(clicks).toEqual([]);
    const bannerStillThere = await page.evaluate(() => document.getElementById("e2e-toggle-cmp") !== null);
    expect(bannerStillThere).toBe(true);

    await page.close();
  });
});
