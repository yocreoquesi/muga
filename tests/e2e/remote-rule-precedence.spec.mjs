/**
 * E2E: which strip rule actually wins — remote (1001) vs static (1 / 300-799)
 *
 * This spec answers the open question in #1221, which no test, ADR or comment
 * in this repo answers today.
 *
 * src/lib/dnr-ids.js states the contract the whole ruleset is built around:
 *
 *   > Chrome applies at most ONE redirect rule per request (no cascade), so
 *   > each tailored host must match exactly one COMPLETE rule.
 *
 * The static rules honour that: rule 1 is the global strip and cedes the 45
 * tailored domains to rules 300-799 via `excludedRequestDomains`, so exactly
 * one static redirect rule matches any given request.
 *
 * The DYNAMIC rules were never folded into that arrangement.
 * `buildRemoteDnrRule()` emits rule 1001 at `priority: 1` with no
 * `requestDomains` and no `excludedRequestDomains` — it matches EVERY
 * main_frame request, including all 45 tailored domains AND every domain rule 1
 * already covers. Rule 1000 (custom params) has the identical shape.
 *
 * So on every navigation at least two priority-1 redirect rules match at once,
 * and nothing in the repo records what Chrome does about it.
 *
 * Reading cannot settle it: Chrome's precedence between a static and a dynamic
 * rule of equal priority and equal action type is not something the source can
 * be asked. This repo has been burned by exactly that gap before — a
 * `regexFilter` that passed RE2 and every unit test was silently dropped by
 * Chrome for exceeding a memory budget (#1200, and the Amazon TLD matcher
 * before it). So this runs in real Chromium and reads the answer off the wire.
 *
 * Method
 * ------
 * Each probe navigates to a URL whose params are single-rule witnesses:
 *
 *   v=keep              functional — must survive (collateral check)
 *   utm_source=strip    built-in — only a STATIC rule can remove it
 *   mugaprobe_remote=1  remote-only — only DYNAMIC rule 1001 can remove it
 *
 * A built-in name in the payload would be silently deduped and never reach
 * rule 1001, and a remote-only name is in no static rule, so each param names
 * exactly one rule. The surviving set names the winner.
 *
 * Assertions read the URL that reached the NETWORK, not `page.url()`. MUGA also
 * cleans in-page (history-defuser, the content cleaner), which rewrites the
 * address bar after load; asserting on `page.url()` would measure those paths
 * stacked on top of DNR and could not isolate it. On Chrome MV3 the network
 * layer is DNR alone — the blocking-webRequest stripper in the service worker
 * is gated on Firefox/MV2 — so a param missing from the request is DNR's doing.
 *
 * What it found
 * -------------
 * BOTH rules apply, on tailored and untailored hosts alike. The one-rule
 * premise holds per REQUEST but not per NAVIGATION: Chrome re-matches the
 * redirected request, so equal-priority redirect rules compose. Nothing is lost
 * today — and that is the answer #1221 asks for.
 *
 * The cost lands elsewhere. Because rule 1001 reaches tailored hosts, a remote
 * param that collides with a host's `preserveParams` overrides that protection
 * (third test). That is the #1212 failure class — a fact applied to a host it
 * was never learned about — reachable through the remote channel. It is not
 * live today (no such name is in the published payload) and no guard prevents
 * it: `AFFILIATE_PARAM_GUARD` covers affiliate names, not preserveParams names.
 *
 * #1221
 */

import { test as base, expect } from "./fixtures.mjs";
import { generateTestKeypair, signPayload } from "../fixtures/test-keys.mjs";

const KEYPAIR = generateTestKeypair();

/**
 * A param that exists ONLY in the remote payload.
 *
 * Constraints it has to satisfy to reach rule 1001: >= MIN_PARAM_LEN (3),
 * matches PARAM_FORMAT_RE, absent from REMOTE_PARAM_DENYLIST and
 * AFFILIATE_PARAM_GUARD, and absent from TRACKING_PARAMS (a built-in name is
 * silently deduped by filterAgainstBuiltin).
 */
const REMOTE_ONLY_PARAM = "mugaprobe_remote";

/** A built-in tracking param. Never in the payload — the static-rule witness. */
const BUILTIN_PARAM = "utm_source";

/**
 * A tailored host. youtube.com is served by rule 316 (requestDomains
 * ["youtube.com"]) and is one of the 45 names in rule 1's
 * excludedRequestDomains, so exactly one STATIC rule matches it.
 */
const TAILORED_HOST = "www.youtube.com";

/**
 * One of youtube.com's `preserveParams` in src/rules/domain-rules.json.
 *
 * Chosen because it is publishable through the remote channel while the host
 * depends on it: it appears in NO static strip rule (neither the global rule 1
 * nor the tailored rule 316), so it is not a built-in and survives dedup, yet
 * youtube.com's search page cannot function without it. `ab_channel`, the other
 * obvious candidate, is a built-in that rule 316 preserves — it would be
 * deduped out of the payload and could never reach rule 1001.
 */
const TAILORED_PRESERVED_PARAM = "search_query";

/** A host no tailored rule claims — only rule 1 and rule 1001 match here. */
const UNTAILORED_HOST = "example.com";

/** The signed-payload endpoint. Stubbed; never reached for real. */
const RULES_HOST = "rules.muga.app";

/**
 * The only hosts allowed to have a request handled at all. Everything else is
 * aborted, so a probe can never silently measure the live internet.
 */
const ALLOWED_HOSTS = [UNTAILORED_HOST, TAILORED_HOST, RULES_HOST];

// ---------------------------------------------------------------------------
// Fixture: intercept the rules endpoint before anything can wake the SW
// ---------------------------------------------------------------------------

/**
 * Registering the route inside `beforeEach` is too late.
 *
 * The `optionsPage` fixture resolves before any beforeEach body runs, and
 * opening an extension page wakes the service worker, which fetches the remote
 * payload opportunistically. A first draft of this spec did exactly that, and
 * both consequences were real: the SW reached the LIVE rules.muga.app and
 * installed the production payload into rule 1001, and the in-flight guard in
 * runRemoteRulesFetch (SC-11) then silently dropped the test's own
 * ENABLE_REMOTE_RULES — which still answered `{ok: true}`. The measurement was
 * reading a rule table the test had not built.
 *
 * Overriding `context` is the earliest hook available: it runs right after the
 * browser launches, before `extensionId` or `optionsPage` exist.
 */
const test = base.extend({
  /** Params the stubbed endpoint publishes. Overridden per describe block. */
  remotePayloadParams: [[REMOTE_ONLY_PARAM], { option: true }],

  context: async ({ context, remotePayloadParams }, use) => {
    // Serve a strictly-increasing version on every request. The SW fetches on
    // wake AND on the explicit enable; a repeated version is rejected as
    // VERSION_REGRESSION, which would leave rule 1001 holding whichever payload
    // happened to land first. Same reason as remote-rules.spec.mjs.
    let payloadVersion = 0;
    await context.route(`**/${RULES_HOST}/**`, (route) => {
      payloadVersion += 1;
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(
          signPayload(
            {
              version: payloadVersion,
              published: new Date().toISOString(),
              params: remotePayloadParams,
            },
            KEYPAIR.privateKey
          )
        ),
      });
    });

    // Hermetic guard. The bug above was invisible precisely because real egress
    // looked like a working test, so failing loudly beats quietly reaching the
    // internet: abort any external request outside ALLOWED_HOSTS.
    //
    // Scoped to http/https on purpose. A first version matched "**/*" and
    // aborted on hostname alone, which also killed every `chrome-extension://`
    // request — the extension's own pages rendered with no CSS and no scripts,
    // so the options fixture never reached its ready flag and the run died with
    // "Target page, context or browser has been closed".
    //
    // RULES_HOST must be in the allowed set even though the handler above
    // serves it: Playwright matches routes in reverse registration order, so
    // this guard is consulted FIRST and an abort here would mean the payload
    // handler never runs at all.
    await context.route(/^https?:\/\//, (route) => {
      const host = new URL(route.request().url()).hostname;
      if (ALLOWED_HOSTS.includes(host)) return route.fallback();
      return route.abort();
    });

    await use(context);
  },
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function injectTestKey(context, publicKeyB64Raw) {
  const sw =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker", { timeout: 10_000 }));
  await sw.evaluate((key) => {
    globalThis.__MUGA_TRUSTED_KEYS__ = [key];
  }, publicKeyB64Raw);
}

async function grantHostPermission(page) {
  await page.evaluate(async () => {
    if (typeof chrome?.permissions?.request === "function") {
      await chrome.permissions.request({ origins: ["https://rules.muga.app/*"] });
    }
  });
}

async function enableRemoteRules(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "ENABLE_REMOTE_RULES" }, (resp) => {
          resolve(resp || { ok: false, error: "no_response" });
        });
      })
  );
}

/** Reads the dynamic rule table straight from Chrome. */
async function getDynamicRules(page) {
  return page.evaluate(
    () =>
      new Promise((resolve) => {
        chrome.declarativeNetRequest.getDynamicRules((rules) => resolve(rules));
      })
  );
}

/**
 * Blocks until rule 1001 is live carrying `param`, re-sending
 * ENABLE_REMOTE_RULES while it is not.
 *
 * Two independent reasons one enable is not enough: the SW's own wake fetch can
 * be in flight, in which case the in-flight guard drops this one and STILL
 * returns ok; and rule installation is asynchronous after the message response
 * resolves. Polling covers both without a blind sleep.
 *
 * This is also the gate that keeps the probes honest. Without it, a probe
 * showing the remote param surviving could equally mean the rule was never
 * installed — the opposite conclusion from the one being drawn.
 */
async function armRemoteRule(page, param) {
  await expect
    .poll(
      async () => {
        const rules = await getDynamicRules(page);
        const remoteRule = rules.find((r) => r.id === 1001);
        const params =
          remoteRule?.action?.redirect?.transform?.queryTransform?.removeParams;
        if (params?.includes(param)) return "armed";
        await enableRemoteRules(page);
        return JSON.stringify({ ids: rules.map((r) => r.id), params: params ?? null });
      },
      {
        timeout: 15_000,
        message:
          `rule 1001 never came up carrying "${param}" — the probes would ` +
          "measure an empty dynamic table, not a precedence contest",
      }
    )
    .toBe("armed");
}

/**
 * Navigates and returns the URL that actually reached the network.
 *
 * Every request to `host` is stubbed, so nothing leaves the browser, and each
 * one is recorded. DNR runs ahead of the route handler, so the recorded URL is
 * post-DNR — the thing being measured.
 */
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

  // Without this the next line reads `new URL(undefined)` and the spec dies
  // with "Invalid URL" — a failure that says nothing about what happened. The
  // whole point of these probes is diagnosis, so an empty capture has to name
  // itself: it means the navigation never reached the route handler at all,
  // which is a different fault from any rule winning or losing.
  if (seen.length === 0) {
    throw new Error(
      `probe: no request to ${host} was captured — the navigation never reached ` +
        `the route handler, so no precedence conclusion can be drawn`
    );
  }

  const networkUrl = seen[seen.length - 1];
  return {
    requests: seen,
    networkUrl,
    networkParams: new URL(networkUrl).searchParams,
  };
}

/**
 * One-line report, so a CI log records the measurement itself and not just a
 * green tick. If these assertions ever start failing, this line says what
 * Chrome did instead — which is the whole point of the spec.
 */
function report(label, result, witnesses) {
  const state = witnesses
    .map((w) => `${w}=${result.networkParams.has(w) ? "SURVIVED" : "stripped"}`)
    .join(" ");
  console.log(`[#1221] ${label}: ${state} | wire=${result.networkUrl}`);
}

// ---------------------------------------------------------------------------

test.describe("DNR precedence: remote rule 1001 vs the static strip rules (#1221)", () => {
  test.beforeEach(async ({ context, optionsPage }) => {
    await injectTestKey(context, KEYPAIR.publicKeyB64Raw);
    await grantHostPermission(optionsPage);
    await armRemoteRule(optionsPage, REMOTE_ONLY_PARAM);
  });

  test("untailored host: the global rule and the remote rule BOTH apply", async ({
    context,
  }) => {
    const page = await context.newPage();
    const result = await probe(
      page,
      UNTAILORED_HOST,
      `/p?v=keep&${BUILTIN_PARAM}=strip&${REMOTE_ONLY_PARAM}=1`
    );
    report("untailored", result, [BUILTIN_PARAM, REMOTE_ONLY_PARAM]);

    // Rule 1 fired.
    expect(
      result.networkParams.has(BUILTIN_PARAM),
      "the global static rule did not fire — the remote rule shadowed it"
    ).toBe(false);

    // Rule 1001 fired on the SAME navigation. Two priority-1 redirect rules
    // matched and neither was discarded: the one-rule-per-request contract in
    // dnr-ids.js does not mean one rule per navigation.
    expect(
      result.networkParams.has(REMOTE_ONLY_PARAM),
      "the remote rule did not fire — the static rule shadowed it"
    ).toBe(false);

    expect(result.networkParams.get("v")).toBe("keep");

    await page.close();
  });

  test("tailored host: the tailored rule and the remote rule BOTH apply", async ({
    context,
  }) => {
    const page = await context.newPage();
    const result = await probe(
      page,
      TAILORED_HOST,
      `/watch?v=keep&${BUILTIN_PARAM}=strip&${REMOTE_ONLY_PARAM}=1`
    );
    report("tailored", result, [BUILTIN_PARAM, REMOTE_ONLY_PARAM]);

    // Rule 316 fired: it carries utm_source, and rule 1 excludes this host.
    expect(
      result.networkParams.has(BUILTIN_PARAM),
      "the tailored rule did not fire on a tailored host"
    ).toBe(false);

    // So the remote channel is NOT inert on the 45 tailored domains.
    expect(
      result.networkParams.has(REMOTE_ONLY_PARAM),
      "the remote rule was shadowed by the tailored rule"
    ).toBe(false);

    // And the tailored rule's protection still held through the composition.
    expect(
      result.networkParams.get("v"),
      "a preserveParams name was lost on a tailored host"
    ).toBe("keep");

    await page.close();
  });
});

test.describe("A remote param that collides with a host's preserveParams (#1221)", () => {
  // The payload publishes a name youtube.com depends on. When this spec was
  // written nothing stopped that: the name is not a built-in, not denylisted,
  // not an affiliate param, and long enough for MIN_PARAM_LEN — so it reached
  // rule 1001, which has no host scope, and came off a host whose domain-rules
  // entry exists to keep it. That was the measurement this file recorded.
  //
  // It is now guarded. `filterAgainstPreserved` (src/lib/remote-rules.js) drops
  // any param some host declares in `preserveParams` before the dynamic rule is
  // built, so the collision can no longer be armed at all. The spec is kept and
  // inverted rather than deleted: the defect was real, and this is the only
  // place it is proved absent in a real browser rather than in a fixture.
  test.use({ remotePayloadParams: [TAILORED_PRESERVED_PARAM] });

  test.beforeEach(async ({ context, optionsPage }) => {
    await injectTestKey(context, KEYPAIR.publicKeyB64Raw);
    await grantHostPermission(optionsPage);
    // Deliberately NOT armRemoteRule(): arming asserts the param REACHES rule
    // 1001, which is exactly what must no longer happen. Enable the channel and
    // let the guard act.
    await enableRemoteRules(optionsPage);
  });

  test("cannot reach rule 1001 at all — the guard drops it before the rule is built", async ({
    optionsPage,
  }) => {
    // Give the fetch+validate+filter path the same budget arming used to get,
    // so a slow pipeline reads as a slow pipeline and not as a passing guard.
    await expect
      .poll(
        async () => {
          const rules = await getDynamicRules(optionsPage);
          const remoteRule = rules.find((r) => r.id === 1001);
          return JSON.stringify(
            remoteRule?.action?.redirect?.transform?.queryTransform?.removeParams ?? null
          );
        },
        {
          timeout: 15_000,
          message:
            `rule 1001 came up carrying "${TAILORED_PRESERVED_PARAM}" — a name ` +
            "youtube.com declares in preserveParams reached the global strip rule",
        }
      )
      .not.toContain(TAILORED_PRESERVED_PARAM);
  });

  test("so the host keeps the param it declared it needs", async ({ context }) => {
    const page = await context.newPage();
    const result = await probe(
      page,
      TAILORED_HOST,
      `/results?${TAILORED_PRESERVED_PARAM}=muga&${BUILTIN_PARAM}=strip`
    );
    report("preserve-collision", result, [BUILTIN_PARAM, TAILORED_PRESERVED_PARAM]);

    // The outcome that matters, read on the wire rather than inferred from the
    // rule table: the search query survives to the network.
    expect(
      result.networkParams.get(TAILORED_PRESERVED_PARAM),
      "a name youtube.com lists in preserveParams was stripped anyway (#1221)"
    ).toBe("muga");

    // And the guard did not cost the host its normal cleaning: the built-in
    // still comes off through rule 316, so this is a scoped protection rather
    // than the channel going inert on this host.
    expect(
      result.networkParams.has(BUILTIN_PARAM),
      "the tailored rule stopped stripping the built-in — the guard was too broad"
    ).toBe(false);

    await page.close();
  });
});
