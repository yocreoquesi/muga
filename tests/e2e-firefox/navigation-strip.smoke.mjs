/**
 * Firefox smoke: network-layer URL cleaning (#1408).
 *
 * On Firefox, MUGA cleans a navigation at the network layer through ONE
 * blocking `webRequest.onBeforeRequest` listener, `onBeforeNavigateStrip`
 * (src/background/service-worker.js), registered on `main_frame` only when
 * `isFirefoxMV2()`. It stands in for Chrome's DNR, which is off for
 * tracking_params on Firefox, and the Chromium e2e suite cannot reach it.
 * Unit tests cover the pure `computeNavigationStrip` helper, not the listener
 * registration, its `{ redirectUrl }` return shape, the `_fxStripperReady`
 * warm-up gate or the MV2 `webRequestBlocking` permission.
 *
 * The proof is on the WIRE, not the address bar. The content script rewrites
 * the visible URL after load and cleans `<a href>` targets on click, so
 * neither `getCurrentUrl()` nor a link click proves anything about this
 * listener: both were measured to pass with the listener's redirect removed.
 * The navigation here is a page-script `location.assign()`, which no content
 * script touches, and the capturing server must only ever see the cleaned
 * path (a redirect from onBeforeRequest means the original is never sent).
 * `driver.get()` is not used for the navigation under test either: Firefox
 * calls the listener for that automation-triggered load but does not apply
 * its redirect.
 *
 * Remote rules are switched OFF so the spec is hermetic (no fetch of the live
 * channel) and so it tests this listener alone. That is not cosmetic, see the
 * todo test at the bottom: with the remote channel's DNR redirect rules
 * installed, Firefox lets them win and this listener's redirect is dropped.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, setStorageSync, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveCapturingServer } from "./helpers/local-server.mjs";

const DIRTY_PATH = "/page?utm_source=newsletter&gclid=abc123&keep=1";
const CLEAN_PATH = "/page?keep=1";
const START_HTML = "<!doctype html><html><body><p>start</p></body></html>";
const EXTENSION_ORIGIN = `moz-extension://${FIXED_EXTENSION_UUID}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollFor(server, predicate, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (!server.requests.some(predicate)) {
    if (Date.now() > deadline) return false;
    await sleep(intervalMs);
  }
  return true;
}

/** Dynamic DNR rule ids currently installed, read from an extension page. */
async function dynamicRuleIds(driver) {
  await driver.get(`${EXTENSION_ORIGIN}/popup/popup.html`);
  return driver.executeAsyncScript((cb) => {
    chrome.declarativeNetRequest.getDynamicRules((rules) => cb(rules.map((r) => r.id)));
  });
}

/**
 * Turns the remote channel off through the same message the Settings toggle
 * sends, then waits until no remote DNR rule (1001, or the scoped 3100+ range)
 * is installed and stays that way, so a fetch that was already in flight at
 * install time cannot re-add one mid-test.
 */
async function disableRemoteRules(driver) {
  await driver.get(`${EXTENSION_ORIGIN}/popup/popup.html`);
  await driver.executeAsyncScript((cb) => {
    chrome.runtime.sendMessage({ type: "DISABLE_REMOTE_RULES" }, () => cb());
  });
  const isRemote = (id) => id === 1001 || id >= 3100;
  let clearFor = 0;
  const deadline = Date.now() + 15000;
  while (clearFor < 2) {
    assert.ok(Date.now() < deadline, "remote DNR rules were never cleared after DISABLE_REMOTE_RULES");
    const ids = await dynamicRuleIds(driver);
    if (ids.some(isRemote)) {
      clearFor = 0;
      await driver.executeAsyncScript((cb) => {
        chrome.runtime.sendMessage({ type: "DISABLE_REMOTE_RULES" }, () => cb());
      });
    } else {
      clearFor++;
    }
    await sleep(1000);
  }
}

/**
 * Loads a start page on the capturing server, then navigates to `dirtyPath`
 * from page script. Returns the paths the server saw for that navigation only.
 *
 * Asserts the start page itself actually reached the server (previously
 * `pollFor`'s return value was discarded here, so a start page that never
 * arrived silently fell through to the real navigation instead of failing
 * with a clear cause).
 */
async function navigateFromPage(driver, server, dirtyPath = DIRTY_PATH) {
  const basePath = dirtyPath.split("?")[0];
  await driver.get(`${server.origin}/start`);
  const gotStart = await pollFor(server, (r) => r.path === "/start");
  assert.ok(gotStart, "the start page never reached the server");
  server.requests.length = 0;

  await driver.executeScript(`window.location.assign(${JSON.stringify(dirtyPath)})`);
  const arrived = await pollFor(server, (r) => r.path.startsWith(basePath));
  assert.ok(arrived, "the navigation never reached the server");
  await sleep(300);
  return server.requests.map((r) => r.path).filter((p) => p.startsWith(basePath));
}

/**
 * Retries `navigateFromPage` until it observes `expectedPaths`, or re-throws
 * the real assertion failure once `timeoutMs` elapses.
 *
 * Loading the start page re-warms the prefs cache (the listener fails OPEN —
 * passes the dirty URL through unmodified — on a cold `cachedPrefs`, and
 * every storage write invalidates it), but that warm-up is async
 * (`getPrefsWithCache()` plus the domain/path rule loaders) and has no
 * externally observable "ready" signal. A single navigation attempted while
 * still cold would look identical to a genuine regression: both leave the
 * dirty URL on the wire. Retrying until the strip is actually observed turns
 * that race into a real positive readiness signal instead of a fixed guess
 * at how long warm-up takes — the previous fixed 300ms sleep here.
 *
 * NOT a substitute for `navigateFromPage` when the two possible outcomes
 * (warm-but-passthrough vs. cold-and-passthrough) are indistinguishable on
 * the wire, e.g. an exempt/allowlisted host: see the control-navigation
 * pattern in the allowlist test below for that case instead.
 */
async function navigateUntilClean(driver, server, dirtyPath, expectedPaths, { timeoutMs = 10000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const paths = await navigateFromPage(driver, server, dirtyPath);
    try {
      assert.deepStrictEqual(paths, expectedPaths);
      return paths;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await sleep(intervalMs);
    }
  }
}

async function withFirefox(fn) {
  let driver;
  let extDir;
  let server;
  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    await completeOnboarding(driver, EXTENSION_ORIGIN);
    await disableRemoteRules(driver);
    server = await serveCapturingServer({ html: START_HTML });
    await fn({ driver, server });
  } finally {
    if (server) await server.close();
    await teardown(driver, extDir);
  }
}

test("Firefox smoke: onBeforeRequest strips tracking params before the request leaves the browser", async () => {
  await withFirefox(async ({ driver, server }) => {
    await setStorageSync(driver, EXTENSION_ORIGIN, { whitelist: [], blacklist: [] });
    // navigateUntilClean rather than a single navigateFromPage + fixed sleep:
    // see its docstring for why a retry-until-observed strip is the real
    // positive readiness signal for the async prefs-cache warm-up.
    await navigateUntilClean(driver, server, DIRTY_PATH, [CLEAN_PATH]);
  });
});

test("Firefox smoke: an allowlisted host is navigated to untouched", async () => {
  await withFirefox(async ({ driver, server }) => {
    const host = new URL(server.origin).hostname;

    // An allowlisted navigation is indistinguishable on the wire between two
    // very different causes: the listener is warm and correctly skipping an
    // exempt host, or the listener has not warmed up yet (fail-open passes
    // the dirty URL through either way) — retrying (navigateUntilClean)
    // cannot tell these apart either, since "still dirty" is what BOTH
    // produce. Prove the listener is live and warm first, against a second
    // server, BEFORE the allowlist below exists: every capturing server in
    // this suite binds to the same 127.0.0.1 host on a different port, and
    // the allowlist matches by hostname only (no port), so a same-host
    // "control" server would be exempted too once the real allowlist is set.
    await setStorageSync(driver, EXTENSION_ORIGIN, { whitelist: [], blacklist: [] });
    const control = await serveCapturingServer({ html: START_HTML });
    try {
      await navigateUntilClean(driver, control, DIRTY_PATH, [CLEAN_PATH]);
    } finally {
      await control.close();
    }

    await setStorageSync(driver, EXTENSION_ORIGIN, { whitelist: [host], blacklist: [] });
    const paths = await navigateFromPage(driver, server);
    assert.deepStrictEqual(
      paths,
      [DIRTY_PATH],
      "an allowlisted host must receive the URL exactly as the user asked for it",
    );
  });
});

// #1448 fix, formerly a todo reproducer here. The defect: the remote channel
// installed DNR redirect rules (1001, matching EVERY main_frame request with
// no urlFilter, and the host-scoped 3100+ range) on Firefox too. While either
// matched, Firefox did not apply the webRequest listener's own redirect for
// that request — measured true for both the unscoped rule and a rule scoped
// by requestDomains — so built-in params like utm_source silently rode along
// uncleaned. Fixed by making Firefox NEVER install a remote-channel DNR rule:
// reconcileRemoteDnrRule and mergeIntoCache (both in src, not this spec) now
// short-circuit to a remove-only update on Firefox, and onBeforeNavigateStrip
// folds the host-scoped facts into its own prefs.remoteParams via
// withScopedRemoteParams (dnr-sync.js) so nothing is lost — the listener
// becomes Firefox's sole cleaning authority for the built-in list AND both
// halves of the remote channel.
test("Firefox smoke: remote rules install no DNR redirect rule; built-in and remote (global + scoped) params are all still stripped", async () => {
  await withFirefox(async ({ driver, server }) => {
    const host = new URL(server.origin).hostname;

    // Seed a cached remote-rules payload directly into local storage — this
    // spec stays hermetic (no live fetch) — one global param and one fact
    // scoped to this test's own host.
    await driver.get(`${EXTENSION_ORIGIN}/popup/popup.html`);
    await driver.executeAsyncScript((hostArg, cb) => {
      chrome.storage.local.set({
        remoteParams: ["muga_smoke_remote_only"],
        remoteRulesMeta: {
          version: 1,
          fetchedAt: new Date().toISOString(),
          paramCount: 1,
          lastError: null,
          published: new Date().toISOString(),
          scopedFacts: [{ param: "muga_smoke_scoped_only", hosts: [hostArg] }],
        },
      }, () => cb());
    }, host);

    // Drive the real gate-open reconcile path (applyDnrState ->
    // reconcileRemoteDnrRule) the same way the ENABLE_REMOTE_RULES message
    // does, without its live fetch: flip dnrEnabled off then on — a genuine
    // value transition, guaranteed to fire storage.onChanged — with
    // remoteRulesEnabled set in the same pass. Firefox's background page is
    // persistent (unlike Chrome's service worker), so there is no wake/
    // eviction race here to retry against, unlike the Chromium scoped-DNR
    // spec's equivalent seeding dance.
    await setStorageSync(driver, EXTENSION_ORIGIN, { dnrEnabled: false });
    await setStorageSync(driver, EXTENSION_ORIGIN, {
      dnrEnabled: true, remoteRulesEnabled: true, whitelist: [], blacklist: [],
    });

    // Neither remote-channel DNR rule may exist on Firefox. Poll briefly:
    // the reconcile above is async relative to this check.
    const isRemoteRule = (id) => id === 1001 || (id >= 3100 && id < 5100);
    const deadline = Date.now() + 5000;
    let ids = await dynamicRuleIds(driver);
    while (Date.now() < deadline && ids.some(isRemoteRule)) {
      await sleep(200);
      ids = await dynamicRuleIds(driver);
    }
    assert.ok(
      !ids.some(isRemoteRule),
      `no remote-channel DNR rule may be installed on Firefox (ids: ${JSON.stringify(ids)})`,
    );

    // Both halves of the remote payload, AND the built-in params, must be
    // stripped — by the webRequest listener alone.
    const dirtyPath = "/page?utm_source=newsletter&gclid=abc123&muga_smoke_remote_only=x&muga_smoke_scoped_only=y&keep=1";
    await navigateUntilClean(driver, server, dirtyPath, [CLEAN_PATH]);
  });
});
