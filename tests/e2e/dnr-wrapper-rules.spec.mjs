/**
 * E2E: DNR wrapper-redirect rules (#510 / B6 phase 2)
 *
 * Validates that the static DNR rules at `src/rules/wrapper-dnr-rules.json`
 * actually redirect main-frame navigations from each wrapper host to the
 * destination URL the wrapper carries — BEFORE any wrapper content loads.
 *
 * Pattern mirrors `amp-dnr.spec.mjs`: stub both the wrapper host and the
 * destination host. If DNR fires, the wrapper-host stub is never invoked
 * (the request URL is rewritten before reaching the network) and
 * `page.url()` lands on the destination. If DNR fails to fire, the
 * wrapper-host stub serves a placeholder page and `page.url()` stays on
 * the wrapper — that fails the assertion.
 *
 * Empirical question this answers (carried forward from B6 phase 1):
 * Chromium's `regexSubstitution` copies the captured group VERBATIM into
 * the redirect target (no URL-decode). So a destination carried as
 * `?p=https%3A%2F%2Fmerchant.com%2Fpath` redirects to the percent-encoded
 * form. In practice browsers re-parse the redirect URL on navigation, so
 * the percent-encoded form resolves to the same destination. These tests
 * pin that behavior — if a future Chromium changes how it handles
 * regexSubstitution, the assertions trip and we find out before users do.
 */

import { test, expect } from "./fixtures.mjs";

async function stubHost(page, hostname) {
  await page.route(`**://${hostname}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${hostname} stub</body></html>`,
    })
  );
}

const DEST_HOST = "muga-test-merchant.example.com";
const DEST_URL = `https://${DEST_HOST}/path`;
const DEST_ENC = encodeURIComponent(DEST_URL);

const WRAPPERS = [
  {
    name: "Awin",
    wrapperHost: "www.awin1.com",
    url: `https://www.awin1.com/cread.php?awinmid=1234&awinaffid=5678&p=${DEST_ENC}`,
  },
  {
    name: "Facebook l.facebook.com",
    wrapperHost: "l.facebook.com",
    url: `https://l.facebook.com/l.php?u=${DEST_ENC}&h=AT0`,
  },
  {
    name: "Facebook lm.facebook.com",
    wrapperHost: "lm.facebook.com",
    url: `https://lm.facebook.com/l.php?u=${DEST_ENC}&h=AT0`,
  },
  {
    name: "Skimlinks redirectingat.com",
    wrapperHost: "go.redirectingat.com",
    url: `https://go.redirectingat.com/?id=12345X678&xs=1&url=${DEST_ENC}`,
  },
  {
    name: "Skimlinks skimresources.com",
    wrapperHost: "go.skimresources.com",
    url: `https://go.skimresources.com/?id=12345X678&xs=1&url=${DEST_ENC}`,
  },
  {
    name: "ShareASale",
    wrapperHost: "www.shareasale.com",
    url: `https://www.shareasale.com/r.cfm?b=1&u=2&m=3&urllink=${DEST_ENC}`,
  },
  {
    name: "Rakuten LinkSynergy",
    wrapperHost: "click.linksynergy.com",
    url: `https://click.linksynergy.com/deeplink?id=foo&mid=42&murl=${DEST_ENC}`,
  },
];

test.describe("DNR wrapper-redirect rules (#510)", () => {
  for (const w of WRAPPERS) {
    test(`${w.name} → destination via DNR (no wrapper hit)`, async ({ context }) => {
      const page = await context.newPage();

      // Stub both: if DNR fires, the wrapper stub is never invoked and the
      // page lands on the destination stub. If DNR misses, the wrapper stub
      // serves a placeholder and page.url() stays on the wrapper, failing
      // the assertion below.
      await stubHost(page, DEST_HOST);
      await stubHost(page, w.wrapperHost);

      await page.goto(w.url);
      await page.waitForLoadState("domcontentloaded");

      // Chromium re-parses the percent-encoded redirect target, so the
      // final URL collapses to the canonical destination form regardless
      // of whether DNR substituted the encoded or decoded captured group.
      expect(page.url()).toBe(DEST_URL);

      await page.close();
    });
  }

  test("non-wrapper URL on a wrapper-adjacent host is NOT redirected", async ({ context }) => {
    // Awin's wrapper rule is anchored to `awin1.com.*[?&]p=([^&]+)`. A
    // request to a different awin1.com path without `p=` must pass
    // through unmodified — we don't want to over-match the regex and
    // break legitimate wrapper-host pages.
    const page = await context.newPage();
    await stubHost(page, "www.awin1.com");

    await page.goto("https://www.awin1.com/about/");
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://www.awin1.com/about/");
    await page.close();
  });
});
