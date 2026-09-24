/**
 * E2E: mixed-case tracker spellings at the DNR layer (#1436)
 *
 * Chrome's queryTransform.removeParams compares keys case-sensitively, and
 * every MUGA param source is lowercase. The unit suite pins the generated
 * ruleset; only real Chromium can prove the network request itself leaves
 * the browser without the tracker. So this spec records the URL each stubbed
 * request actually reached (before any content-script rewrite could run) and
 * asserts the real-world spelling is gone.
 */

import { test, expect } from "./fixtures.mjs";

/** Stubs a host and records every request URL that reached the network. */
async function stubAndRecord(page, hostname) {
  const seen = [];
  await page.route(`**://${hostname}/**`, (route) => {
    seen.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${hostname} stub</body></html>`,
    });
  });
  return seen;
}

const CASES = [
  { host: "www.example.com", path: "/p?hsCtaTracking=abc&keep=1", key: "hsCtaTracking" },
  { host: "www.example.com", path: "/l?ScCid=abc123&keep=1", key: "ScCid" },
  { host: "www.example.com", path: "/o?elqTrackId=a&keep=1", key: "elqTrackId" },
  { host: "www.amazon.es", path: "/s?k=teclado&__mk_es_ES=x&keep=1", key: "__mk_es_ES" },
];

test.describe("DNR strips real-world mixed-case tracker spellings (#1436)", () => {
  for (const { host, path, key } of CASES) {
    test(`${key} on ${host} never reaches the server`, async ({ context }) => {
      const page = await context.newPage();
      const seen = await stubAndRecord(page, host);

      await page.goto(`https://${host}${path}`);
      await page.waitForLoadState("domcontentloaded");

      expect(seen.length, "the stub must have served the navigation").toBeGreaterThan(0);
      for (const url of seen) {
        const params = new URL(url).searchParams;
        expect(params.has(key), `${key} reached the network: ${url}`).toBe(false);
        expect(params.get("keep"), "a functional param was collateral damage").toBe("1");
      }

      await page.close();
    });
  }
});
