/**
 * E2E: Remote rules — what a fresh install actually does, with no user action
 *
 * `remote-rules.spec.mjs` covers the enable / disable / dedup pipeline, but it
 * always pre-grants `https://rules.muga.app/*` before triggering a fetch, so it
 * never answers the question these tests exist for: on a brand new install,
 * where the user has granted nothing and opened no settings, does the signed
 * GET to rules.muga.app happen?
 *
 * It matters because two places in the codebase disagreed about the answer.
 * `remote-rules-status.js` stated the fetch "is not running pre-grant", while
 * the #888 comment in `service-worker.js` described exactly the opposite. Only
 * one of those can be true, and a privacy policy is written from whichever the
 * author happens to read.
 *
 * The mechanism these tests pin down: `rules.muga.app` is declared in
 * `optional_host_permissions`, but `host_permissions` already declares
 * `<all_urls>`, which COVERS it. `chrome.permissions.contains()` reports
 * coverage, not exact declaration, so the "optional" grant is satisfied the
 * moment the extension installs. Combined with `runRemoteRulesFetch()` carrying
 * no permission check of its own and `onInstalled` calling
 * `maybeFetchRemoteRules()` directly, the fetch is opt-OUT, not opt-in.
 *
 * These tests deliberately use the raw `context` fixture rather than
 * `optionsPage` / `popupPage`, because those complete onboarding first and a
 * completed onboarding is exactly the user action we must not perform.
 *
 * Network isolation: the endpoint is routed so no run reaches the real host.
 * See the note on the install race in the second test.
 */

import { test, expect } from "./fixtures.mjs";

const RULES_GLOB = "**/rules.muga.app/**";

test.describe("Remote rules — fresh install, no user action", () => {
  test("the optional rules.muga.app grant is already satisfied by <all_urls>", async ({
    context,
    extensionId,
  }) => {
    // Nothing is granted here. No onboarding, no Settings visit, no
    // permissions.request(). This is the state a user is in the instant the
    // extension finishes installing.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await page.waitForLoadState("domcontentloaded");

    const granted = await page.evaluate(() =>
      chrome.permissions.contains({ origins: ["https://rules.muga.app/*"] }),
    );

    expect(
      granted,
      "rules.muga.app reads as granted on a fresh install because <all_urls> " +
        "covers it, so listing it in optional_host_permissions gates nothing",
    ).toBe(true);

    // The same is true of the shortener hosts, which is why the click-time
    // resolver works out of the box on Chrome. Asserted here so the two
    // "optional" lists are documented as behaving identically.
    const shortenerGranted = await page.evaluate(() =>
      chrome.permissions.contains({ origins: ["https://bit.ly/*"] }),
    );
    expect(
      shortenerGranted,
      "shortener hosts are likewise covered by <all_urls> on Chrome",
    ).toBe(true);

    await page.close();
  });

  test("the signed GET fires without the user granting or enabling anything", async ({
    context,
    extensionId,
  }) => {
    // Route as early as the test body allows. There is an unavoidable race:
    // the service worker starts with the browser and onInstalled calls
    // maybeFetchRemoteRules() immediately, so that very first attempt may fire
    // before this route is registered. That is precisely the behaviour under
    // test, and it is why the assertion below reads persisted state rather
    // than counting intercepted requests: whichever attempt wins the race, the
    // evidence lands in remoteRulesMeta either way.
    const seen = [];
    await context.route(RULES_GLOB, (route) => {
      seen.push(route.request().url());
      // An unsigned body is rejected by verification, which is fine: a
      // recorded lastError still proves an attempt was made, and it keeps this
      // test independent of the signing fixtures.
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ version: 1, params: [] }),
      });
    });

    // The only thing the user does is browse. No extension UI is touched.
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options/options.html`);
    await page.waitForLoadState("domcontentloaded");

    // maybeFetchRemoteRules is fire-and-forget, so poll for the persisted
    // outcome instead of racing it. Note: waitForFunction is the wrong tool
    // here — an async predicate returns a Promise, which it treats as truthy
    // and resolves on the first tick.
    await expect
      .poll(
        async () =>
          page.evaluate(async () => {
            const { remoteRulesMeta } = await chrome.storage.local.get({
              remoteRulesMeta: { fetchedAt: null, lastError: null },
            });
            return (
              remoteRulesMeta?.fetchedAt !== null ||
              remoteRulesMeta?.lastError !== null
            );
          }),
        {
          timeout: 20_000,
          message:
            "a fresh install with zero user action must have attempted the " +
            "fetch: the attempt writes either fetchedAt or lastError",
        },
      )
      .toBe(true);

    // Whether or not this run's route caught the request (see the race note
    // above), the attempt itself is what the assertion above proves.
    console.log(`[fresh-install] intercepted rules requests: ${seen.length}`);

    await page.close();
  });
});
