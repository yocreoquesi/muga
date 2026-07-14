/**
 * E2E smoke: hot-path query splice preserves surviving-param bytes
 * (audit-2026-07 S3).
 *
 * Exercises the LIVE extension's window.name accessor (world:MAIN,
 * window-name-defuser-mainworld.js) in a real Chromium. The accessor cleans
 * URL-shaped values on READ via the same raw-query splice the other four
 * sync content-script copies use, so this is the cleanest end-to-end proof
 * that a signature/token in a surviving param is no longer corrupted.
 *
 * Not part of `npm test` (unit). Run via:
 *   npx playwright test tests/e2e/hot-path-query-splice.spec.mjs
 */

import { test, expect } from "./fixtures.mjs";

const HOST = "smoke.test";

async function completeOnboarding(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate(() =>
    new Promise((resolve) => {
      chrome.storage.sync.set({ enabled: true, onboardingDone: true }, () => {
        chrome.storage.local.set({
          mugaConsent: { onboardingDone: true, consentVersion: "1.1", consentDate: Date.now() },
        }, resolve);
      });
    })
  );
  await page.close();
}

async function stubHost(page) {
  await page.route(`**://${HOST}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: "<!doctype html><html><head><title>smoke</title></head><body>ok</body></html>",
    })
  );
}

test("window.name accessor preserves surviving-param bytes (S3)", async ({ context, extensionId }) => {
  await completeOnboarding(context, extensionId);

  const page = await context.newPage();
  await stubHost(page);
  await page.goto(`https://${HOST}/`);

  // Wait for the active-defense gate to open (prefs → muga:history-gate). Until
  // then the accessor is pass-through, so poll a known utm URL until it cleans.
  await page.waitForFunction(() => {
    window.name = "https://smoke.test/?utm_source=probe&keep=1";
    return window.name === "https://smoke.test/?keep=1";
  }, null, { timeout: 20_000 });

  const out = await page.evaluate(() => {
    const rt = (input) => { window.name = input; return window.name; };
    const r = {
      A: rt("https://example.com/p?utm_source=newsletter&id=42"),
      F: rt("https://example.com/p?sig=ab%20cd&utm_source=x"),
      G: rt("https://example.com/p?tok=a!b(c)~d*e&fbclid=z"),
      H: rt("https://example.com/#/route?utm_source=x"),
    };
    window.name = "";
    return r;
  });

  // A — sanity: tracking stripped, real param kept.
  expect(out.A, "A: utm stripped, id kept").toBe("https://example.com/p?id=42");
  // F — the S3 fix: %20 stays %20 (old code produced sig=ab+cd).
  expect(out.F, "F: %20 preserved, not '+'").toBe("https://example.com/p?sig=ab%20cd");
  // G — !()~ not percent-encoded (old code encoded them).
  expect(out.G, "G: !()~ preserved verbatim").toBe("https://example.com/p?tok=a!b(c)~d*e");
  // H — a '?' inside the fragment is left untouched.
  expect(out.H, "H: hash-router fragment untouched").toBe("https://example.com/#/route?utm_source=x");
});
