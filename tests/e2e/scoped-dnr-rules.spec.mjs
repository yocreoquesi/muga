/**
 * E2E: the rules `buildScopedDnrRules()` actually emits compose with the global
 * strip rule, in real Chromium, on the wire.
 *
 * Why this exists alongside scoped-rule-composition.spec.mjs
 * ----------------------------------------------------------
 * That spec answered a DESIGN question — can a thin host-scoped redirect rule
 * add to the global rule rather than replace it? — with a hand-written rule at
 * a scratch id (9001) and a hand-chosen priority. Its answer set the constraint
 * this slice was built to: composition is real, and the scoped rule has to
 * OUTRANK the global rule for it to be deterministic (11 of 12 at equal
 * priority, and the twelfth failed on CI; 24 of 24 at priority 2).
 *
 * A probe proving a synthetic rule composes is not the same claim as MUGA's own
 * rules composing. Everything between the two is production code: the
 * fact-major → host-major inversion, the profile grouping, the id range, and
 * the priority constant. Any of those could be wrong while the probe stays
 * green. So this spec installs the EXACT objects `buildScopedDnrRules()`
 * returns and reads the result off the wire.
 *
 * How the rules get installed
 * ---------------------------
 * By the service worker, from the cache, exactly as they are in production:
 * the spec seeds `remoteRulesMeta.scopedFacts` into `chrome.storage.local` and
 * flips `dnrEnabled`, and `reconcileRemoteDnrRule()` builds and registers the
 * range from there.
 *
 * Pushing the rules in directly with `updateDynamicRules` was tried first and
 * is not viable: the service worker OWNS 3100-4099 and clears it on every gate
 * transition, so injected rules are wiped non-deterministically — one probe
 * lost its rule before the navigation, another before it even entered the
 * table. That is correct behaviour (the consent gate must be able to withdraw
 * every scoped rule), and it is why the earlier design probe used a scratch id
 * outside every managed range. Going through the owner instead removes the race
 * AND covers more: the cache read, the gate, and the builder.
 *
 * Signature verification is not exercised here — that half is unit-tested on
 * the orchestrator. What no unit test can answer is what Chrome does with the
 * resulting rule objects, which is the gap #1200 and the Amazon TLD matcher
 * both fell into: valid by every local check, silently dropped by the browser.
 *
 * Witnesses, one rule each
 * ------------------------
 *   mugascoped_e2e=1   in no static rule and no payload — only a scoped rule
 *   utm_source=strip   built-in — only a static rule can remove it
 *   v=keep             functional, and in youtube.com's preserveParams
 *
 * #1221 slice 2, #1229
 */

import { test, expect, waitForInstallSettled } from "./fixtures.mjs";
import { buildScopedDnrRules } from "../../src/lib/remote-rules.js";
import { DNR_SCOPED_PARAMS_RULE_ID_BASE } from "../../src/lib/dnr-ids.js";

/** Not in TRACKING_PARAMS and in no domain profile — only a scoped rule removes it. */
const SCOPED_ONLY_PARAM = "mugascoped_e2e";
/** A built-in: only a static rule can remove it. */
const BUILTIN_PARAM = "utm_source";
/** Functional witness — nothing may remove it. */
const KEEP_PARAM = "v";

/** Rule 1 applies here (not one of the tailored domains). */
const PROBE_HOST = "example.com";
/** Rule 1 is excluded here; a complete rule in 300-799 does the static work. */
const TAILORED_HOST = "www.youtube.com";

/**
 * Seeds one scoped fact into the remote-rules cache and makes the service
 * worker register it, then waits for the rule to be matchable.
 *
 * Writing `dnrEnabled` is the trigger: its storage change drives
 * `applyDnrState` → `reconcileRemoteDnrRule`, which is the production path that
 * restores the scoped range from the cache. `set()` fires `onChanged` whether
 * or not the value moved.
 *
 * The trigger is RE-SENT on every poll iteration rather than fired once. One
 * write is enough only if the service worker is alive to receive it: a single
 * fire-and-forget write is lost if the worker is asleep or being recycled in
 * that window, and then no amount of waiting recovers it. That is not a
 * hypothetical — it failed twice on CI with "never registered" (not
 * "registered late") while passing 138/138 locally, which is the signature of a
 * lost event rather than a slow one. Re-sending is idempotent: the production
 * path it drives is a reconcile.
 *
 * An off-then-on flip is a different thing and stays rejected: the `false` pass
 * CLEARS the scoped range and can land after the `true` pass registered it,
 * removing the rule between the poll and the navigation. It failed 1 run in 6
 * that way, with the scoped param surviving while the static rule fired —
 * which reads exactly like a priority bug and is not one.
 *
 * The install barrier comes first for the same reason (#1231): the install-time
 * consent write drives its own `applyDnrState`, and seeding before it settles
 * puts that clear-and-rebuild in the same window.
 *
 * The wait is not politeness: `updateDynamicRules` resolves before a rule is
 * matchable, and the registration here is several async hops further away.
 * Without it, "the scoped param survived" would mean "no rule was installed
 * yet" — the opposite conclusion from the one being drawn.
 */
async function installScopedRules(page, host) {
  await waitForInstallSettled(page);
  const expected = buildScopedDnrRules([{ param: SCOPED_ONLY_PARAM, hosts: [host] }]);

  // Guard the premise before spending a navigation on it. If the builder ever
  // stops emitting at the documented id, this fails here rather than as a
  // confusing "the rule did not fire" three assertions later.
  expect(expected.length, "the builder emitted no rule for one scoped fact").toBe(1);
  expect(expected[0].id).toBe(DNR_SCOPED_PARAMS_RULE_ID_BASE);

  const seedAndTrigger = () =>
    page.evaluate(
      ([param, h]) =>
        new Promise((resolve) => {
          chrome.storage.local.set(
            {
              // A non-empty param list keeps rule 1001 in play, so this also
              // exercises the scoped and global rules coexisting.
              remoteParams: ["mugaremote_e2e"],
              remoteRulesMeta: {
                version: 1,
                fetchedAt: new Date().toISOString(),
                paramCount: 1,
                lastError: null,
                published: new Date().toISOString(),
                scopedFacts: [{ param, hosts: [h] }],
              },
            },
            () => chrome.storage.sync.set({ dnrEnabled: true }, () => resolve())
          );
        }),
      [SCOPED_ONLY_PARAM, host]
    );

  await seedAndTrigger();

  // Find OUR rule by what it strips, not by its id.
  //
  // This used to look for DNR_SCOPED_PARAMS_RULE_ID_BASE exactly, which quietly
  // assumed the test's fact is the only scoped fact the worker knows about, so it
  // always lands first in the range. That held only while the published payload
  // carried zero scoped facts. The moment real ones exist, id 3100 belongs to one
  // of THEM, the identity assertions below compare our expectation against a
  // stranger's rule, and it fails as a deep-equality mismatch on requestDomains —
  // which reads like a product bug and is not one.
  //
  // SCOPED_ONLY_PARAM is a test-only name, so matching on it identifies our rule
  // regardless of how many real facts share the range.
  const ours = (rules) =>
    rules.find((r) =>
      r.action?.redirect?.transform?.queryTransform?.removeParams?.includes(SCOPED_ONLY_PARAM)
    );

  let live = [];
  await expect
    .poll(
      async () => {
        live = await page.evaluate(
          () =>
            new Promise((resolve) =>
              chrome.declarativeNetRequest.getDynamicRules((r) => resolve(r))
            )
        );
        if (ours(live)) return true;
        // Re-send rather than just wait: a lost storage event is not something
        // a longer timeout recovers from.
        await seedAndTrigger();
        return false;
      },
      {
        timeout: 30_000,
        intervals: [250, 500, 1000],
        message: `the service worker never registered a scoped rule stripping ${SCOPED_ONLY_PARAM}`,
      }
    )
    .toBe(true);

  const registered = ours(live);

  // Still pinned: whatever id it got must belong to the range the service worker
  // owns for scoped rules. That is the property #1221 cares about; being FIRST in
  // that range never was.
  expect(
    registered.id,
    `scoped rule ${registered.id} is outside the range the worker owns`,
  ).toBeGreaterThanOrEqual(DNR_SCOPED_PARAMS_RULE_ID_BASE);
  // What the service worker registered must be what the builder produced —
  // otherwise the wire results below are about some other rule.
  expect(registered.condition.requestDomains).toEqual(expected[0].condition.requestDomains);
  expect(registered.action.redirect.transform.queryTransform.removeParams).toEqual(
    expected[0].action.redirect.transform.queryTransform.removeParams
  );
  return registered;
}

/** Navigates and returns the URL that reached the NETWORK, not page.url(). */
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
        "the route handler, so no conclusion can be drawn"
    );
  }
  const networkUrl = seen[seen.length - 1];
  return { networkUrl, networkParams: new URL(networkUrl).searchParams };
}

function report(label, result) {
  const state = [SCOPED_ONLY_PARAM, BUILTIN_PARAM, KEEP_PARAM]
    .map((w) => `${w}=${result.networkParams.has(w) ? "SURVIVED" : "stripped"}`)
    .join(" ");
  console.log(`[#1221-slice2] ${label}: ${state} | wire=${result.networkUrl}`);
}

test.describe("buildScopedDnrRules output in real Chromium (#1221 slice 2)", () => {
  test("outranks the global rule, which is what makes the thin shape work", async ({
    optionsPage,
  }) => {
    // Pinned here as well as in the unit tests because this is the constant a
    // future refactor is most likely to "tidy" back to the DNR default. At
    // priority 1 the composition below passes almost every run and drops the
    // scoped param the rest of the time.
    const rule = await installScopedRules(optionsPage, PROBE_HOST);
    expect(rule.priority).toBeGreaterThan(1);
  });

  test("on a host rule 1 covers: the scoped rule ADDS, the global rule still fires", async ({
    context,
    optionsPage,
  }) => {
    await installScopedRules(optionsPage, PROBE_HOST);

    const page = await context.newPage();
    const result = await probe(
      page,
      PROBE_HOST,
      `/p?${SCOPED_ONLY_PARAM}=1&${BUILTIN_PARAM}=strip&${KEEP_PARAM}=keep`
    );
    report("untailored + built scoped rule", result);

    expect(
      result.networkParams.has(SCOPED_ONLY_PARAM),
      "the rule buildScopedDnrRules emitted never fired"
    ).toBe(false);

    // If the scoped rule replaced the global one instead of adding to it, every
    // scoped profile would have to carry the whole global list to be safe — the
    // ~3.6 MB shape #1229 priced, rather than ~149 KB.
    expect(
      result.networkParams.has(BUILTIN_PARAM),
      "the scoped rule SHADOWED the global rule — thin scoped profiles would be unsafe"
    ).toBe(false);

    expect(result.networkParams.get(KEEP_PARAM), "a functional param was lost").toBe("keep");

    await page.close();
  });

  test("on a tailored host: composes with the complete rule, and costs it no preserve", async ({
    context,
    optionsPage,
  }) => {
    await installScopedRules(optionsPage, TAILORED_HOST);

    const page = await context.newPage();
    const result = await probe(
      page,
      TAILORED_HOST,
      `/watch?${SCOPED_ONLY_PARAM}=1&${BUILTIN_PARAM}=strip&${KEEP_PARAM}=keep`
    );
    report("tailored + built scoped rule", result);

    expect(
      result.networkParams.has(SCOPED_ONLY_PARAM),
      "the scoped rule did not fire on a tailored host"
    ).toBe(false);
    expect(
      result.networkParams.has(BUILTIN_PARAM),
      "the tailored complete rule stopped firing once a scoped rule matched the same host"
    ).toBe(false);
    // The protection a scoped fact must never buy its coverage with. The
    // validator refuses a fact naming a host's own preserveParams; this is the
    // runtime half of that guarantee.
    expect(
      result.networkParams.get(KEEP_PARAM),
      "youtube.com lists v in preserveParams — the scoped rule must not cost that protection"
    ).toBe("keep");

    await page.close();
  });
});
