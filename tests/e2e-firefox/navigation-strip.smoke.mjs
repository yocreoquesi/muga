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

// Reproducer for a defect this spec surfaced, kept as a todo so it reports
// without blocking CI until the fix lands. The remote channel installs DNR
// redirect rules (1001 and the scoped 3100+ range) that match EVERY
// main_frame request, with a queryTransform. On Firefox, while one of them
// matches, the webRequest listener's redirect is not applied, so built-in
// params such as utm_source go out on the wire. Measured locally on Firefox
// 156 with the live channel: every page-initiated navigation (location
// assignment, a 302, a meta refresh) reached the server uncleaned, and all of
// them were cleaned once the dynamic rules were removed.
test("Firefox smoke: built-in cleaning still applies while a remote DNR redirect rule is installed", {
  todo: "remote-channel DNR redirect rules override the Firefox webRequest strip (found by #1408)",
}, async () => {
  await withFirefox(async ({ driver, server }) => {
    await driver.get(`${EXTENSION_ORIGIN}/popup/popup.html`);
    const updateErr = await driver.executeAsyncScript((cb) => {
      chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds: [1001],
        addRules: [{
          id: 1001,
          priority: 1,
          action: {
            type: "redirect",
            redirect: { transform: { queryTransform: { removeParams: ["muga_smoke_remote_only"] } } },
          },
          condition: { resourceTypes: ["main_frame"] },
        }],
      }, () => cb(chrome.runtime.lastError ? chrome.runtime.lastError.message : null));
    });
    assert.equal(updateErr, null, `updateDynamicRules(1001) failed: ${updateErr}`);
    // Read the rule back before navigating: a rejected/silently-dropped rule
    // must never masquerade as "the built-in strip survived a remote rule",
    // when in fact no remote rule was installed at all.
    const idsBeforeNav = await dynamicRuleIds(driver);
    assert.ok(idsBeforeNav.includes(1001), `rule 1001 was not installed before navigating (ids: ${JSON.stringify(idsBeforeNav)})`);

    const paths = await navigateFromPage(driver, server);
    assert.deepStrictEqual(paths, [CLEAN_PATH]);
  });
});
