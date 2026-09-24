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
 *   https://l.facebook.com/l.php?u=
 *     https%3A%2F%2Fwww.merchant.com%2Fproduct%2F123&h=AT0
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
 * with the empirical reason inline. What stays ACTIVE (#1410) targets the
 * two rules the ruleset actually holds, l.facebook.com and lm.facebook.com:
 * the unencoded shape Chromium does honour must redirect without the
 * wrapper host ever being requested, and an `l.php` URL without `u=` must
 * not be redirected at all. The Awin case that used to sit here asserted a
 * negative against a rule that had been retired, so it could not fail.
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
  // Awin's DNR rule was retired too (awin1.com is a pass-through network in
  // src/lib/opaque-networks.js), so it is not listed here (#1410).
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
  // Rakuten LinkSynergy DNR rule retired in #692 (ADR-0003 follow-up).
  // click.linksynergy.com is now in AFFILIATE_REDIRECT_NETWORKS (pass-through).
  //
  // Skimlinks (go.redirectingat.com, go.skimresources.com) and ShareASale
  // (www.shareasale.com) DNR rules retired in #907 — both hosts are now in
  // AFFILIATE_REDIRECT_NETWORKS (pass-through) and src/rules/wrapper-dnr-rules.json
  // no longer contains a redirect rule for any of them (only l.facebook.com /
  // lm.facebook.com remain — see tests/unit/wrapper-dnr-rules-sync.test.mjs).
  // Do not re-add these entries without first re-adding the rules themselves.
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

  /**
   * Stubs a wrapper host and records every request that reached it. A DNR
   * redirect happens before the request is sent, so a rule that fires leaves
   * the record empty; the content-script unwrap path, which also knows
   * l.facebook.com, can only act after the wrapper page has loaded.
   */
  async function recordingStub(page, hostname) {
    const hits = [];
    await page.route(`**://${hostname}/**`, (route) => {
      hits.push(route.request().url());
      return route.fulfill({
        status: 200,
        contentType: "text/html",
        body: `<!doctype html><html><body>${hostname} stub</body></html>`,
      });
    });
    return hits;
  }

  // `u=` is the LAST param on purpose here — the case with trailing params
  // after `u=` (e.g. Facebook's `&h=AT0` link-shim token) is covered by the
  // "params after u= are not appended" tests below (#1449).
  for (const host of ["l.facebook.com", "lm.facebook.com"]) {
    test(`${host}: an unencoded u= destination is redirected by DNR before the wrapper is hit`, async ({ context }) => {
      const page = await context.newPage();
      await stubHost(page, DEST_HOST);
      const wrapperHits = await recordingStub(page, host);

      await page.goto(`https://${host}/l.php?h=AT0&u=${DEST_URL}`);
      await page.waitForLoadState("domcontentloaded");

      expect(page.url()).toBe(DEST_URL);
      expect(wrapperHits, "the wrapper host must never be requested").toEqual([]);
      await page.close();
    });
  }

  // Fixed for #1449: the rule regex now matches through the end of the URL
  // (`.*$` after the capture), so the unmatched tail is pulled into the
  // match and discarded along with it instead of surviving the substitution.
  for (const host of ["l.facebook.com", "lm.facebook.com"]) {
    test(`${host}: params after u= are not appended to the destination`, async ({ context }) => {
      const page = await context.newPage();
      await stubHost(page, DEST_HOST);
      await recordingStub(page, host);
      await page.goto(`https://${host}/l.php?u=${DEST_URL}&h=AT0`);
      await page.waitForLoadState("domcontentloaded");
      expect(page.url()).toBe(DEST_URL);
      await page.close();
    });
  }

  test("an l.facebook.com/l.php URL without u= is NOT redirected", async ({ context }) => {
    // The live rule is anchored to `l.facebook.com/l.php.*[?&]u=([^&]+)`. The
    // same endpoint without `u=` must pass through unmodified: over-matching
    // would break legitimate wrapper-host pages.
    const page = await context.newPage();
    const wrapperHits = await recordingStub(page, "l.facebook.com");

    await page.goto("https://l.facebook.com/l.php?h=AT0");
    await page.waitForLoadState("domcontentloaded");

    expect(page.url()).toBe("https://l.facebook.com/l.php?h=AT0");
    expect(wrapperHits).toEqual(["https://l.facebook.com/l.php?h=AT0"]);
    await page.close();
  });
});
