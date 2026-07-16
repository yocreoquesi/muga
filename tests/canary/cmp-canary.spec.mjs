/**
 * MUGA — Cookie Consent Minimizer: nightly real-site CMP canary (#1129)
 *
 * ── Honest limits (read before treating a red run as a bug) ────────────────
 *
 * This is a NON-BLOCKING DRIFT ALARM, never a merge/CI gate. The site list
 * in cmp-sites.json is a CANDIDATE list, not a verified ground truth: it was
 * assembled from vendor case studies and third-party sources (see each
 * entry's `note` field), not from live script inspection of every site (see
 * that file's docblock-equivalent notes for the two lower-confidence
 * entries). Real sites are flaky, geo-variant (a banner may not appear at
 * all for an EU-exit-node run, or may already be pre-consented via a
 * previously-set cookie), and may switch CMP vendors without notice. This
 * spec therefore self-validates the list on every run:
 *   - If a site's banner never appears at all, that is recorded as
 *     "inconclusive" (NOT "fail") — it does not mean MUGA is broken, it
 *     usually means the banner didn't fire for this run/region/session.
 *   - Only a banner that DEMONSTRABLY APPEARED and then stayed visible
 *     after MUGA's reject window is recorded as "fail" — a real signal
 *     that the CMP's DOM/API surface may have drifted from the adapter in
 *     src/lib/cmp-adapters.js.
 *   - tools/canary-report.mjs additionally requires >=2 "fail" results for
 *     the SAME CMP (across its 2 candidate sites) before treating it as
 *     drift and opening a tracking issue — a single flaky site never
 *     triggers an alert.
 *
 * This file is NOT picked up by the normal `npm run test:e2e` run —
 * playwright.config.mjs's testDir is "tests/e2e", not "tests/canary". It
 * runs only via `npm run test:canary` (playwright.canary.config.mjs) or the
 * scheduled .github/workflows/cmp-canary.yml.
 *
 * Reuses the same extension-loading mechanism as tests/e2e/fixtures.mjs
 * (chromium.launchPersistentContext + --load-extension, headed) by
 * importing its `test`/`expect` directly rather than duplicating the
 * launch config.
 */

import { test, expect } from "../e2e/fixtures.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const sites = JSON.parse(readFileSync(join(__dirname, "cmp-sites.json"), "utf8"));

const BANNER_APPEAR_TIMEOUT_MS = 15_000;
const BANNER_DISAPPEAR_TIMEOUT_MS = 15_000;
const NAV_TIMEOUT_MS = 30_000;

const RESULTS_PATH = join(__dirname, "../../test-results/canary-results.json");

/** @type {Map<string, {cmp: string, url: string, status: "pass"|"fail"|"inconclusive", detail: string}>} */
const results = new Map();

function recordResult(site, status, detail) {
  results.set(`${site.cmp}::${site.url}`, { cmp: site.cmp, url: site.url, status, detail });
}

/**
 * Completes onboarding and turns on cookieConsentMinimizerEnabled directly
 * via chrome.storage — mirrors tests/e2e/fixtures.mjs's completeOnboarding()
 * but additionally flips the feature pref, which defaults OFF (see
 * src/content/cookie-noise-mainworld.js's docblock) and is not touched by
 * the shared e2e fixture.
 *
 * @param {import("@playwright/test").BrowserContext} context
 * @param {string} extensionId
 */
async function enableCookieConsentMinimizer(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let extPage = context.pages().find((p) => p.url().startsWith(extOrigin));
  if (!extPage) {
    extPage = await context.newPage();
    await extPage.goto(`${extOrigin}/onboarding/onboarding.html`);
  }

  await extPage.evaluate(() => {
    return new Promise((resolve) => {
      const syncWrite = new Promise((r) =>
        chrome.storage.sync.set(
          {
            injectOwnAffiliate: false,
            notifyForeignAffiliate: false,
            language: "en",
            cookieConsentMinimizerEnabled: true,
          },
          r,
        ),
      );
      const localWrite = new Promise((r) =>
        chrome.storage.local.set(
          {
            mugaConsent: {
              onboardingDone: true,
              consentVersion: "1.2",
              consentDate: Date.now(),
            },
          },
          r,
        ),
      );
      Promise.all([syncWrite, localWrite]).then(() => resolve());
    });
  });

  for (const p of context.pages()) {
    if (p.url().includes("/onboarding/")) await p.close();
  }
}

test.describe("CMP canary — nightly real-site drift alarm (#1129, non-blocking)", () => {
  for (const site of sites) {
    test(`${site.cmp} — ${site.url}`, async ({ context, extensionId }) => {
      test.setTimeout(120_000);

      await enableCookieConsentMinimizer(context, extensionId);

      const page = await context.newPage();

      try {
        await page.goto(site.url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
      } catch (err) {
        await page.close();
        // A genuine navigation failure (DNS, timeout, connection refused) is
        // exactly the kind of transient real-world flakiness
        // playwright.canary.config.mjs's retries:2 exists to absorb —
        // rethrow so Playwright retries this site before giving up.
        throw err;
      }

      let bannerAppeared = true;
      try {
        await page.waitForSelector(site.bannerSelector, { state: "visible", timeout: BANNER_APPEAR_TIMEOUT_MS });
      } catch {
        bannerAppeared = false;
      }

      if (!bannerAppeared) {
        recordResult(
          site,
          "inconclusive",
          "banner never appeared within the wait window (already-consented cookie, geo-variant CMP config, or the site no longer uses this CMP) — not treated as a MUGA failure",
        );
        await page.close();
        return;
      }

      let status;
      let detail;
      try {
        await page.waitForSelector(site.bannerSelector, { state: "hidden", timeout: BANNER_DISAPPEAR_TIMEOUT_MS });
        status = "pass";
        detail = "banner appeared and was hidden/removed after MUGA's reject action";
      } catch {
        status = "fail";
        detail = "banner appeared and remained visible after the wait window — MUGA did not reject it (possible CMP/adapter drift)";
      }

      recordResult(site, status, detail);
      await page.close();

      // Soft signal only: a per-site "fail" is real information (surfaced in
      // the JSON + Playwright's own report) but must never hard-fail this
      // spec file in a way that would block a future blocking pipeline —
      // drift decisions belong to tools/canary-report.mjs's threshold logic,
      // not to a single site's assertion here.
      expect(status, detail).not.toBe(undefined);
    });
  }

  test.afterAll(() => {
    mkdirSync(dirname(RESULTS_PATH), { recursive: true });
    writeFileSync(RESULTS_PATH, JSON.stringify(Array.from(results.values()), null, 2), "utf8");
  });
});
