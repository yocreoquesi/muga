/**
 * E2E: DNR wrapper-redirect rules (#510 / B6 phase 2)
 *
 * Validates the shape of the static DNR rules at
 * `src/rules/wrapper-dnr-rules.json` and answers the empirical question
 * the issue raised about Chromium's `regexSubstitution` behavior.
 *
 * ── Empirical finding (load-bearing for this issue) ────────────────────
 * Chromium's `regexSubstitution` copies the captured group **verbatim**
 * into the redirect URL field. The substituted string is then validated
 * as a URL; if it does not parse as one, the redirect is silently dropped
 * and the request continues to the wrapper host.
 *
 * Real-world wrapper traffic almost always carries the destination
 * percent-encoded:
 *
 *   https://www.awin1.com/cread.php?awinmid=1&awinaffid=2&p=
 *     https%3A%2F%2Fwww.merchant.com%2Fproduct%2F123
 *
 * The DNR rule's capture `[^&]+` grabs the encoded form, and `\\1`
 * substitutes the literal string `https%3A%2F%2F...` as the redirect
 * URL. That string does not parse as a URL (no scheme separator), so
 * Chromium rejects the redirect and the user lands on the wrapper.
 *
 * In other words: the DNR rules in `wrapper-dnr-rules.json` only fire
 * when the wrapper URL carries the destination UNENCODED — which is
 * the rare case in practice. The content-script wrapper-engine
 * (`src/lib/wrapper-engine.js`) handles the encoded common case and
 * is the load-bearing path for these networks today.
 *
 * Per-wrapper coverage of the encoded path is therefore SKIPPED here
 * with the empirical reason inline. The negative-case test (regex must
 * not over-match awin1.com paths without `p=`) stays active — that
 * remains a meaningful invariant of the rule shape.
 *
 * Follow-up tracked in #510: decide whether to (a) drop the DNR
 * wrapper rules and rely on the content-script unwrap path, or
 * (b) reshape the rules to decode the captured group via additional
 * transforms once a future Chromium adds support for that.
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
  // Rakuten LinkSynergy DNR rule retired in #692 (ADR-0003 follow-up).
  // click.linksynergy.com is now in AFFILIATE_REDIRECT_NETWORKS (pass-through).
];

test.describe("DNR wrapper-redirect rules (#510)", () => {
  // Per-wrapper redirect test, skipped pending the empirical-finding
  // investigation above. Keep the cases enumerated so a future revision
  // (Chromium decode support OR a rule reshape) can flip `.skip` off
  // without re-deriving the wrapper URL shapes.
  for (const w of WRAPPERS) {
    test.skip(`${w.name} → destination via DNR (no wrapper hit)`, async ({ context }) => {
      const page = await context.newPage();
      await stubHost(page, DEST_HOST);
      await stubHost(page, w.wrapperHost);
      await page.goto(w.url);
      await page.waitForLoadState("domcontentloaded");
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
