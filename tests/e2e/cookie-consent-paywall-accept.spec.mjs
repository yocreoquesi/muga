/**
 * E2E: Cookie Consent Minimizer — consent-or-pay-wall accept-click
 * (cookie-consent-paywall-accept)
 *
 * Verifies the isolated-world accept-click dispatch (content/cookie-noise.js
 * — runAcceptClickDispatcher / isPaywallFrame / hasFreeRejectControl /
 * findFreeAcceptTarget) against a synthetic fixture modeling a real-site
 * shape found by the design's real-site probes (engram id 1333/1335): a
 * Sourcepoint-style message iframe, on a DIFFERENT (cross-origin-shaped)
 * host from the top frame, whose URL carries the `hasCsp=true` +
 * `consent/tcfv2` markers, containing a FREE-accept button AND a PAY
 * button — plus a second variant that ALSO has a free-reject button.
 *
 * HONEST LIMIT (same convention as every other cookie-consent-minimizer e2e
 * spec in this suite): this is a REGRESSION oracle only — it proves the
 * MECHANICS (correct veto precedence, correct gating, correct no-action in
 * every unsafe state) against a synthetic fixture. It does NOT prove a real
 * Sourcepoint wall's button markup matches these exact selectors/labels, or
 * that the click actually dismisses a real production wall — see
 * docs/qa/cookie-consent-release-smoke.md's HARD real-EU pre-enable gate.
 */

import { test, expect } from "./fixtures.mjs";
import { waitForDnrPropagation } from "./helpers/index.mjs";

const TOP_HOST = "muga-test-cookie-consent-paywall-accept.invalid";
const IFRAME_HOST = "sp-muga-test-cookie-consent-paywall-accept.invalid";

async function completeOnboarding(
  context,
  extensionId,
  { cookieConsentMode = "accept-when-necessary", cookieConsentAcceptConsented = true } = {}
) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(
    ({ cookieConsentMode, cookieConsentAcceptConsented }) =>
      new Promise((resolve) => {
        chrome.storage.sync.set(
          { enabled: true, cookieConsentMode, cookieConsentAcceptConsented },
          () => {
            chrome.storage.local.set(
              {
                mugaConsent: { onboardingDone: true, consentVersion: "1.4", consentDate: Date.now() },
              },
              () => {
                chrome.storage.sync.set({ onboardingDone: true }, resolve);
              }
            );
          }
        );
      }),
    { cookieConsentMode, cookieConsentAcceptConsented }
  );
  await page.close();
  await waitForDnrPropagation(page);
}

/**
 * Top-frame fixture: a plain page hosting the consent-or-pay wall in a
 * cross-origin-shaped child iframe (the real-site shape — the dialog never
 * renders in the top frame). `withFreeReject` adds a third, free reject
 * button to the SAME wall (Variant A); omitted, the wall is a true hard
 * wall with no free path except accept (Variant B).
 */
async function stubPaywallPages(
  page,
  { withFreeReject = false, includeAcceptButton = true, spUrlShape = true, wallButtonsHtml = null } = {}
) {
  // The consent-or-pay iframe URL. When spUrlShape is true it carries the
  // Sourcepoint message-iframe markers isPaywallFrame now REQUIRES: `hasCsp=true`
  // in the query AND the literal `consent/tcfv2` segment in the PATH. NOTE: the
  // marker MUST be a real `/` — a percent-encoded `%2F` never decodes back in
  // location.href, so `consent/tcfv2` would never match and the SP-URL-shape
  // branch would silently never be exercised (the original fixture bug). When
  // false, the iframe is a generic cross-origin frame (an ad/embed shape) with
  // no SP markers at all.
  const iframePath = spUrlShape
    ? "/consent/tcfv2/index.html?hasCsp=true&consent_origin=x&message_id=1"
    : "/embed/widget.html?ad=1";
  await page.route(`**://${TOP_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <p id="page-content">Real page content</p>
        <iframe id="sp-frame" src="https://${IFRAME_HOST}${iframePath}" title="consent"></iframe>
      </body></html>`,
    })
  );

  let wallHtml;
  if (wallButtonsHtml !== null) {
    wallHtml = wallButtonsHtml;
  } else {
    // Real Sourcepoint structure (engram id 1339/1341): every DECISION control
    // carries an sp_choice_type_<N> class (11 = accept-all, 9 = pay/subscribe,
    // 13 = reject-all), while incidental links are plain anchors with NO such
    // class. The incidental links below reproduce the exact shape that used to
    // false-veto every real wall — they must NOT block the accept-click now.
    const acceptButton = includeAcceptButton
      ? `<button id="accept-btn" class="message-button sp_choice_type_11" onclick="window.__mugaTestClicked='accept'">Accept all &amp; continue</button>`
      : "";
    const rejectButton = withFreeReject
      ? `<button id="reject-btn" class="message-button sp_choice_type_13" onclick="window.__mugaTestClicked='reject'">Reject</button>`
      : "";
    wallHtml = `
          ${acceptButton}
          <button id="pay-btn" class="message-button sp_choice_type_9" onclick="window.__mugaTestClicked='pay'">Subscribe for 4,99&euro;/month</button>
          ${rejectButton}
          <a class="text-link" href="https://example.invalid/datenschutz">Datenschutzerkl&auml;rung</a>
          <a class="text-link" href="https://example.invalid/impressum">Impressum</a>
          <a class="text-link" href="https://example.invalid/faq">FAQ</a>`;
  }

  await page.route(`**://${IFRAME_HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <div id="wall">${wallHtml}
        </div>
      </body></html>`,
    })
  );
}

/**
 * Polls `page.frames()` for the consent iframe (Playwright has no built-in
 * waitForFrame). A short poll interval is fine — the iframe attaches
 * synchronously with the top-frame's own load in this fixture.
 */
async function waitForIframe(page, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const frame = page.frames().find((f) => f.url().includes(IFRAME_HOST));
    if (frame) return frame;
    await page.waitForTimeout(100);
  }
  throw new Error(`iframe on ${IFRAME_HOST} did not attach within ${timeoutMs}ms`);
}

test.describe("Cookie Consent Minimizer — consent-or-pay-wall accept-click", () => {
  test("clicks ONLY the free-accept button when mode=accept-when-necessary + gesture, and no free reject exists (Variant B, hard wall)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    await stubPaywallPages(page, { withFreeReject: false });
    await page.goto(`https://${TOP_HOST}/index.html`);

    // NOTE: window.__mugaCookieNoiseGate is an ISOLATED-WORLD marker set by
    // content/cookie-noise.js — Playwright's frame.evaluate/waitForFunction
    // always runs in the MAIN world, so that marker is NEVER observable this
    // way (engram id 1335's documented gotcha). Do not wait on it here; the
    // real oracle is the page-world __mugaTestClicked marker below, which
    // IS observable (set by a plain onclick handler in the fixture's own
    // MAIN-world script).
    const iframe = await waitForIframe(page);

    await iframe.waitForFunction(() => window.__mugaTestClicked === "accept", { timeout: 10000 });
    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBe("accept");

    // The pay button was NEVER clicked.
    expect(clicked).not.toBe("pay");

    // Top-frame content untouched, no page errors from either frame.
    const pageContent = await page.evaluate(() => document.getElementById("page-content")?.textContent);
    expect(pageContent).toBe("Real page content");
    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("REAL faz.net shape: fires on the type-11 accept even when the pay alternative is an unknown-token trial link AND incidental privacy links are present", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(err));
    // faz.net's real structure (engram id 1341): a type-11 accept + a
    // sp_choice_type_link "Kostenfrei testen" trial (no pay token / no price),
    // surrounded by incidental Datenschutz/Impressum/FAQ links. The old generic
    // classifier vetoed on those unknown controls; SP-structural targeting fires.
    await stubPaywallPages(page, {
      wallButtonsHtml: `
          <button id="accept-btn" class="message-button sp_choice_type_11" onclick="window.__mugaTestClicked='accept'">Einverstanden</button>
          <a id="trial-link" class="message-button sp_choice_type_link" href="https://example.invalid/pur" onclick="window.__mugaTestClicked='trial'">Kostenfrei testen</a>
          <a class="text-link" href="https://example.invalid/datenschutz">Datenschutzerkl&auml;rung</a>
          <a class="text-link" href="https://example.invalid/impressum">Impressum</a>
          <a class="text-link" href="https://example.invalid/faq">FAQ</a>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    await iframe.waitForFunction(() => window.__mugaTestClicked === "accept", { timeout: 10000 });
    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBe("accept");
    expect(clicked).not.toBe("trial");
    expect(pageErrors).toHaveLength(0);

    await page.close();
  });

  test("ADVERSARIAL: NEVER clicks the pay button, even alone on the wall with no reject and no ambiguity", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, { withFreeReject: false, includeAcceptButton: false });
    await page.goto(`https://${TOP_HOST}/index.html`);

    // NOTE: window.__mugaCookieNoiseGate is an ISOLATED-WORLD marker set by
    // content/cookie-noise.js — Playwright's frame.evaluate/waitForFunction
    // always runs in the MAIN world, so that marker is NEVER observable this
    // way (engram id 1335's documented gotcha). Do not wait on it here; the
    // real oracle is the page-world __mugaTestClicked marker below, which
    // IS observable (set by a plain onclick handler in the fixture's own
    // MAIN-world script).
    const iframe = await waitForIframe(page);

    // REASON: negative assertion (no misfire) has no positive signal to
    // wait on — fixed settle window, matches this suite's standard pattern.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  test("NEVER acts when a free reject exists on the wall (Variant A)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, { withFreeReject: true });
    await page.goto(`https://${TOP_HOST}/index.html`);

    // NOTE: window.__mugaCookieNoiseGate is an ISOLATED-WORLD marker set by
    // content/cookie-noise.js — Playwright's frame.evaluate/waitForFunction
    // always runs in the MAIN world, so that marker is NEVER observable this
    // way (engram id 1335's documented gotcha). Do not wait on it here; the
    // real oracle is the page-world __mugaTestClicked marker below, which
    // IS observable (set by a plain onclick handler in the fixture's own
    // MAIN-world script).
    const iframe = await waitForIframe(page);

    // The wall carries a free reject ("13"), so the reject engine dismisses it
    // by clicking that control — "that is the reject engine's job" per the
    // accept-click last-resort gating design. The accept-click itself MUST
    // abstain: the oracle is that the reject fired and neither accept nor pay
    // was ever clicked.
    await iframe.waitForFunction(() => window.__mugaTestClicked === "reject", { timeout: 10000 });
    // REASON: after the reject fires, give any (wrong) accept/pay click time to
    // surface before asserting the accept-click never took over.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBe("reject");

    await page.close();
  });

  test("NEVER fires in reject-only mode, even on the exact same hard wall", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "reject-only",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, { withFreeReject: false });
    await page.goto(`https://${TOP_HOST}/index.html`);

    // NOTE: window.__mugaCookieNoiseGate is an ISOLATED-WORLD marker set by
    // content/cookie-noise.js — Playwright's frame.evaluate/waitForFunction
    // always runs in the MAIN world, so that marker is NEVER observable this
    // way (engram id 1335's documented gotcha). Do not wait on it here; the
    // real oracle is the page-world __mugaTestClicked marker below, which
    // IS observable (set by a plain onclick handler in the fixture's own
    // MAIN-world script).
    const iframe = await waitForIframe(page);

    // REASON: negative assertion — no positive signal to wait on.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  test("NEVER fires in accept-when-necessary mode without the explicit consent gesture", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: false,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, { withFreeReject: false });
    await page.goto(`https://${TOP_HOST}/index.html`);

    // NOTE: window.__mugaCookieNoiseGate is an ISOLATED-WORLD marker set by
    // content/cookie-noise.js — Playwright's frame.evaluate/waitForFunction
    // always runs in the MAIN world, so that marker is NEVER observable this
    // way (engram id 1335's documented gotcha). Do not wait on it here; the
    // real oracle is the page-world __mugaTestClicked marker below, which
    // IS observable (set by a plain onclick handler in the fixture's own
    // MAIN-world script).
    const iframe = await waitForIframe(page);

    // REASON: negative assertion — no positive signal to wait on.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  test("NEVER fires when the feature is off entirely", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "off",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, { withFreeReject: false });
    await page.goto(`https://${TOP_HOST}/index.html`);

    // NOTE: window.__mugaCookieNoiseGate is an ISOLATED-WORLD marker set by
    // content/cookie-noise.js — Playwright's frame.evaluate/waitForFunction
    // always runs in the MAIN world, so that marker is NEVER observable this
    // way (engram id 1335's documented gotcha). Do not wait on it here; the
    // real oracle is the page-world __mugaTestClicked marker below, which
    // IS observable (set by a plain onclick handler in the fixture's own
    // MAIN-world script).
    const iframe = await waitForIframe(page);

    // REASON: negative assertion — no positive signal to wait on.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  // ── ADVERSARIAL harm-path cases added for the fail-closed hardening ────────

  test("FIX 1: NEVER acts in a cross-origin, NON-Sourcepoint iframe with a lone Continue button (not a consent-or-pay wall)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, {
      spUrlShape: false,
      wallButtonsHtml: `
          <button id="continue-btn" onclick="window.__mugaTestClicked='continue'">Continue</button>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    // REASON: negative assertion — no positive signal to wait on.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  test("FIX 3: NEVER clicks a German spelled-price pay tier ('Zustimmen für 9,99 EUR pro Monat') — clicks only the free accept", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, {
      wallButtonsHtml: `
          <button id="accept-btn" class="message-button sp_choice_type_11" onclick="window.__mugaTestClicked='accept'">Alle akzeptieren und weiter</button>
          <button id="pay-btn" class="message-button sp_choice_type_9" onclick="window.__mugaTestClicked='pay'">Zustimmen f&uuml;r 9,99 EUR pro Monat</button>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    await iframe.waitForFunction(() => window.__mugaTestClicked === "accept", { timeout: 10000 });
    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBe("accept");
    expect(clicked).not.toBe("pay");

    await page.close();
  });

  test("VISIBILITY GUARD: NEVER clicks an accept hidden via opacity:0 (decoy with a live layout box)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    // A hard wall that WOULD fire (a single actionable sp_choice_type_11 accept
    // plus a pay alternative, no free reject) — except the accept button is
    // rendered opacity:0. It keeps a live layout box (so it passes the loose
    // actionability bar used for reject detection), but the user cannot see it,
    // so the final visibility guard must make the accept-click NOOP.
    await stubPaywallPages(page, {
      wallButtonsHtml: `
          <button id="accept-btn" class="message-button sp_choice_type_11" style="opacity: 0" onclick="window.__mugaTestClicked='accept'">Alle akzeptieren und weiter</button>
          <button id="pay-btn" class="message-button sp_choice_type_9" onclick="window.__mugaTestClicked='pay'">Jetzt abonnieren</button>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    // REASON: negative assertion — a correct abstain leaves no positive signal;
    // settle past the dispatcher's re-sweep/give-up window to prove neither the
    // invisible accept nor the pay button was ever clicked.
    await page.waitForTimeout(2500);
    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  test("FIX 2: NEVER acts when a free reject uses a non-basic label ('Ohne Einwilligung fortfahren')", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, {
      wallButtonsHtml: `
          <button id="accept-btn" class="message-button sp_choice_type_11" onclick="window.__mugaTestClicked='accept'">Accept all &amp; continue</button>
          <button id="reject-btn" class="message-button sp_choice_type_13" onclick="window.__mugaTestClicked='reject'">Ohne Einwilligung fortfahren</button>
          <button id="pay-btn" class="message-button sp_choice_type_9" onclick="window.__mugaTestClicked='pay'">Subscribe for 4,99&euro;/month</button>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    // The wall carries a free reject ("13", non-basic label), so the reject
    // engine dismisses it by clicking that control (its sp_choice_type_13 class
    // is what the reject engine keys on, independent of the label wording). The
    // accept-click itself MUST abstain.
    await iframe.waitForFunction(() => window.__mugaTestClicked === "reject", { timeout: 10000 });
    // REASON: after the reject fires, give any (wrong) accept/pay click time to
    // surface before asserting the accept-click never took over.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBe("reject");

    await page.close();
  });

  test("FIX 2: NEVER accepts a [Accept all][Settings] banner — a settings pane implies a reachable free reject", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, {
      wallButtonsHtml: `
          <button id="accept-btn" class="message-button sp_choice_type_11" onclick="window.__mugaTestClicked='accept'">Accept all</button>
          <button id="settings-btn" class="message-button sp_choice_type_12" onclick="window.__mugaTestClicked='settings'">Settings</button>
          <button id="pay-btn" class="message-button sp_choice_type_9" onclick="window.__mugaTestClicked='pay'">Subscribe for 4,99&euro;/month</button>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    // REASON: negative assertion — no positive signal to wait on.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  test("FIX F1: a free reject rendered as a plain <a> link (reject token, no sp_choice) blocks the accept-click", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    // A real free reject can render as a plain text-link anchor with NO
    // sp_choice_type class (e.g. "Weiterlesen ohne Zustimmung"). It is collected
    // as a candidate (a[href]) and MUST veto the accept-click. The prior
    // regression scoped the reject net to sp_choice-only buttons and let it slip.
    await stubPaywallPages(page, {
      wallButtonsHtml: `
          <button id="accept-btn" class="message-button sp_choice_type_11" onclick="window.__mugaTestClicked='accept'">Accept all &amp; continue</button>
          <button id="pay-btn" class="message-button sp_choice_type_9" onclick="window.__mugaTestClicked='pay'">Subscribe for 4,99&euro;/month</button>
          <a id="reject-link" class="text-link" href="https://example.invalid/weiter" onclick="window.__mugaTestClicked='reject'">Weiterlesen ohne Zustimmung</a>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    // REASON: negative assertion — no positive signal to wait on.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });

  test("FIX 3/M1: NEVER clicks a pay button hidden behind an aria-label of 'Continue' (price only in the visible text)", async ({
    context,
    extensionId,
  }) => {
    await completeOnboarding(context, extensionId, {
      cookieConsentMode: "accept-when-necessary",
      cookieConsentAcceptConsented: true,
    });

    const page = await context.newPage();
    await stubPaywallPages(page, {
      wallButtonsHtml: `
          <button id="aria-pay-btn" class="message-button sp_choice_type_11" aria-label="Continue" onclick="window.__mugaTestClicked='pay'">Subscribe for 9,99&euro; pro Monat</button>`,
    });
    await page.goto(`https://${TOP_HOST}/index.html`);

    const iframe = await waitForIframe(page);
    // REASON: negative assertion — the aria-label must NOT be read as a free
    // accept; there is no positive signal to wait on.
    await page.waitForTimeout(1500);

    const clicked = await iframe.evaluate(() => window.__mugaTestClicked);
    expect(clicked).toBeUndefined();

    await page.close();
  });
});
