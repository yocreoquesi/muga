/**
 * E2E: does a THIN host-scoped rule compose with the global strip rule?
 *
 * This settles the question #1221's budget comment left open and explicitly
 * flagged as unverified:
 *
 *   > Option C's "merge into the complete-per-host rule at runtime" framing may
 *   > be over-built. Rules compose across passes, so a SEPARATE scoped rule
 *   > might add rather than compete. Unverified — worth its own probe before
 *   > anyone designs on it.
 *
 * Why it decides a design rather than a detail
 * --------------------------------------------
 * `src/lib/dnr-ids.js` builds the ruleset around one-rule-per-request, so every
 * tailored host gets a COMPLETE rule: the whole global param list minus that
 * host's preserveParams, plus its extras. Complete rules are why rule 1 has to
 * exclude those 45 domains, and why a tailored rule is silently inert without
 * that exclusion (#1221 measured that too).
 *
 * Importing AdGuard's host-anchored coverage (#1229) would add ~630 new host
 * profiles. Modelled as complete-per-host rules, each copying all 447 global
 * params, that ruleset is ~3.6 MB against 97 KB today. Modelled as THIN rules
 * carrying only each host's extra params, it is ~149 KB — 25x smaller.
 *
 * The thin shape is only available if a scoped rule ADDS to the global rule
 * instead of replacing it. #1222 measured that a static rule and the dynamic
 * remote rule both apply to one navigation, because the first winner redirects
 * and Chrome re-matches the redirected request. What was never measured is the
 * case that matters here: a rule with `requestDomains` competing against rule 1
 * on a host rule 1 is NOT excluded from, with both rules carrying real work.
 *
 * Method
 * ------
 * A thin dynamic rule (id 9001) scoped to the probe host, removing ONE param
 * that no static rule knows. Then one navigation carrying three witnesses:
 *
 *   mugascoped_only=1   only the thin scoped rule can remove it
 *   utm_source=strip    built-in — only a static rule can remove it
 *   v=keep              functional — must survive either way
 *
 * Read on the wire, not from `page.url()`: MUGA also cleans in-page, and this
 * has to isolate DNR. Dynamic rules stand in for static ones deliberately —
 * the question is Chrome's composition behaviour for a host-scoped redirect
 * rule against the global one, and a dynamic rule answers it without shipping
 * 630 profiles to find out.
 *
 * #1229, #1221
 */

import { test, expect } from "./fixtures.mjs";

/** Not in TRACKING_PARAMS, not in any domain profile — only the thin rule removes it. */
const SCOPED_ONLY_PARAM = "mugascoped_only";
/** A built-in: only a static rule can remove it. */
const BUILTIN_PARAM = "utm_source";
/** Functional witness — nothing should remove it. */
const KEEP_PARAM = "v";

/** Rule 1 applies here (not one of the 45 tailored domains). */
const PROBE_HOST = "example.com";
/** Rule 1 is excluded here; rule 316 is the complete rule. */
const TAILORED_HOST = "www.youtube.com";

/** Outside every range dnr-ids.js manages, so the service worker never rewrites it. */
const THIN_RULE_ID = 9001;

async function installThinScopedRule(page, host) {
  await page.evaluate(
    ([id, h, param]) =>
      new Promise((resolve, reject) => {
        chrome.declarativeNetRequest.updateDynamicRules(
          {
            removeRuleIds: [id],
            addRules: [
              {
                id,
                priority: 1,
                action: {
                  type: "redirect",
                  redirect: { transform: { queryTransform: { removeParams: [param] } } },
                },
                condition: { requestDomains: [h], resourceTypes: ["main_frame"] },
              },
            ],
          },
          () =>
            chrome.runtime.lastError
              ? reject(new Error(chrome.runtime.lastError.message))
              : resolve()
        );
      }),
    [THIN_RULE_ID, host, SCOPED_ONLY_PARAM]
  );

  // Installation is asynchronous after the callback resolves. Without this the
  // probe can read a table the rule has not entered yet, and "the scoped param
  // survived" would mean "no rule was installed" — the opposite conclusion from
  // the one being drawn.
  await expect
    .poll(
      async () => {
        const rules = await page.evaluate(
          () =>
            new Promise((resolve) =>
              chrome.declarativeNetRequest.getDynamicRules((r) => resolve(r))
            )
        );
        return rules.some((r) => r.id === THIN_RULE_ID);
      },
      {
        timeout: 10_000,
        message: `the thin scoped rule ${THIN_RULE_ID} never entered the dynamic table`,
      }
    )
    .toBe(true);
}

async function probe(page, host, pathAndQuery) {
  const seen = [];
  await page.route(`**://${host}/**`, (route) => {
    seen.push(route.request().url());
    route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html><html><body>${host} stub</body></html>`,
    });
  });

  await page.goto(`https://${host}${pathAndQuery}`);
  await page.waitForLoadState("domcontentloaded");

  if (seen.length === 0) {
    throw new Error(
      `probe: no request to ${host} was captured — the navigation never reached ` +
        "the route handler, so no composition conclusion can be drawn"
    );
  }
  const networkUrl = seen[seen.length - 1];
  return { networkUrl, networkParams: new URL(networkUrl).searchParams };
}

function report(label, result) {
  const state = [SCOPED_ONLY_PARAM, BUILTIN_PARAM, KEEP_PARAM]
    .map((w) => `${w}=${result.networkParams.has(w) ? "SURVIVED" : "stripped"}`)
    .join(" ");
  console.log(`[#1229] ${label}: ${state} | wire=${result.networkUrl}`);
}

test.describe("A thin host-scoped rule vs the global strip rule (#1229)", () => {
  test("on a host rule 1 covers: BOTH apply — the thin rule adds, it does not replace", async ({
    context,
    optionsPage,
  }) => {
    await installThinScopedRule(optionsPage, PROBE_HOST);

    const page = await context.newPage();
    const result = await probe(
      page,
      PROBE_HOST,
      `/p?${SCOPED_ONLY_PARAM}=1&${BUILTIN_PARAM}=strip&${KEEP_PARAM}=keep`
    );
    report("untailored + thin scoped", result);

    // The thin rule fired.
    expect(
      result.networkParams.has(SCOPED_ONLY_PARAM),
      "the thin host-scoped rule did not fire at all"
    ).toBe(false);

    // ...and the global rule STILL fired. This is the whole question: if the
    // scoped rule shadowed the global one, a built-in would survive here, and
    // every scoped profile would have to carry the full global list to be safe
    // — the 3.6 MB shape. If it does not, ~149 KB of thin rules is available.
    expect(
      result.networkParams.has(BUILTIN_PARAM),
      "the scoped rule SHADOWED the global rule — thin scoped profiles are unsafe, " +
        "they would have to be complete-per-host (see #1229)"
    ).toBe(false);

    expect(result.networkParams.get(KEEP_PARAM), "a functional param was lost").toBe("keep");

    await page.close();
  });

  test("on a tailored host: the thin rule composes with the complete rule too", async ({
    context,
    optionsPage,
  }) => {
    // Rule 1 is excluded here, so the static work is rule 316's. If composition
    // depended on the global rule specifically rather than on redirect chaining,
    // this is where it would show.
    await installThinScopedRule(optionsPage, TAILORED_HOST);

    const page = await context.newPage();
    const result = await probe(
      page,
      TAILORED_HOST,
      `/watch?${SCOPED_ONLY_PARAM}=1&${BUILTIN_PARAM}=strip&${KEEP_PARAM}=keep`
    );
    report("tailored + thin scoped", result);

    expect(
      result.networkParams.has(SCOPED_ONLY_PARAM),
      "the thin scoped rule did not fire on a tailored host"
    ).toBe(false);
    expect(
      result.networkParams.has(BUILTIN_PARAM),
      "the tailored complete rule stopped firing once a scoped rule matched the same host"
    ).toBe(false);
    expect(
      result.networkParams.get(KEEP_PARAM),
      "youtube.com lists v in preserveParams — the scoped rule must not cost that protection"
    ).toBe("keep");

    await page.close();
  });
});
