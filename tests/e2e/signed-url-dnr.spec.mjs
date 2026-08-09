/**
 * E2E: signed-URL DNR guard (#1200)
 *
 * The unit suite proves the regex and the runtime predicate agree. It cannot
 * prove the thing that actually matters in production: that **Chrome accepts
 * the rule**.
 *
 * Rule id 2 in src/rules/tracking-params.json is the only `regexFilter` rule
 * MUGA ships in that ruleset. Chrome compiles DNR regexes with RE2 under a
 * per-ruleset memory budget and DROPS a rule it cannot compile — with no
 * error, no console warning, and no API to enumerate what survived. A dropped
 * guard is indistinguishable from a working one until a user's download
 * returns 403. This repo has been bitten by exactly that before (see the
 * Amazon TLD matcher reshaped for the same limit).
 *
 * So this spec loads the real extension in real Chromium and navigates. Both
 * directions are asserted, because either one failing is a shipped bug:
 *
 *   1. A presigned URL survives untouched  -> the allow rule compiled AND
 *      outranks the strip rule.
 *   2. An unsigned URL on the SAME host is still cleaned -> the allow rule
 *      did not accidentally exempt everything.
 *
 * The host is the one from the original report: GitHub Actions redirects
 * artifact downloads to productionresultssa*.blob.core.windows.net.
 */

import { test, expect } from "./fixtures.mjs";

const SAS_HOST = "productionresultssa10.blob.core.windows.net";

/** A realistic Azure Blob SAS query, in the field order Azure emits. */
const SAS_QUERY =
  "sv=2025-01-05&spr=https&se=2026-08-08T22%3A00%3A00Z&sr=b&sp=r" +
  "&sig=nBx7Qk2ZfLp9YwR4tVhC8mJdE6sA1uGvXo0KpTzN5Ic%3D";

async function stubHost(page, hostname) {
  await page.route(`**://${hostname}/**`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${hostname} stub</body></html>`,
    })
  );
}

test.describe("signed-URL DNR guard (#1200)", () => {
  test("a presigned URL reaches the network with every signed field intact", async ({ context }) => {
    const page = await context.newPage();
    await stubHost(page, SAS_HOST);

    const target = `https://${SAS_HOST}/actions-results/1a2b/artifacts/build.zip?${SAS_QUERY}`;
    await page.goto(target);
    await page.waitForLoadState("domcontentloaded");

    // Byte-for-byte: a SAS signature covers the field values AND their
    // presence, so "close enough" is still a 403.
    expect(page.url()).toBe(target);

    const params = new URL(page.url()).searchParams;
    for (const field of ["sv", "spr", "se", "sr", "sp", "sig"]) {
      expect(params.has(field), `SAS field "${field}" was stripped`).toBe(true);
    }

    await page.close();
  });

  test("an unsigned URL on the same host is still cleaned", async ({ context }) => {
    // The negative control. Without it, a guard that exempted every request
    // would pass the test above and look correct.
    const page = await context.newPage();
    await stubHost(page, SAS_HOST);

    await page.goto(`https://${SAS_HOST}/public/file.zip?utm_source=newsletter&id=keep`);
    await page.waitForLoadState("domcontentloaded");

    const params = new URL(page.url()).searchParams;
    expect(params.has("utm_source"), "utm_source survived on an unsigned URL").toBe(false);
    expect(params.get("id"), "a functional param was collateral damage").toBe("keep");

    await page.close();
  });

  test("a short sig value does not buy an exemption from cleaning", async ({ context }) => {
    // The length floor is what separates a credential from a marketing value
    // that happens to be called "sig". If it regressed, any site could opt out
    // of cleaning with `?sig=x`.
    const page = await context.newPage();
    await stubHost(page, "example.com");

    await page.goto("https://example.com/p?sig=short&utm_source=newsletter");
    await page.waitForLoadState("domcontentloaded");

    const params = new URL(page.url()).searchParams;
    expect(params.has("utm_source"), "a short sig= exempted the URL from cleaning").toBe(false);

    await page.close();
  });
});
