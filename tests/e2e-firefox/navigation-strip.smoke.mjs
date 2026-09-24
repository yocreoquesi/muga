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
 * Loads a start page on the capturing server, then navigates to DIRTY_PATH
 * from page script. Loading the start page also re-warms the prefs cache: the
 * listener fails OPEN on a cold cache (`!cachedPrefs`) and every storage write
 * invalidates it. Returns the paths the server saw for that navigation only.
 */
async function navigateFromPage(driver, server) {
  await driver.get(`${server.origin}/start`);
  await pollFor(server, (r) => r.path === "/start");
  await sleep(300);
  server.requests.length = 0;

  await driver.executeScript(`window.location.assign(${JSON.stringify(DIRTY_PATH)})`);
  const arrived = await pollFor(server, (r) => r.path.startsWith("/page"));
  assert.ok(arrived, "the navigation never reached the server");
  await sleep(300);
  return server.requests.map((r) => r.path).filter((p) => p.startsWith("/page"));
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
    const paths = await navigateFromPage(driver, server);
    assert.deepStrictEqual(
      paths,
      [CLEAN_PATH],
      `the server must only see the cleaned URL; it saw ${JSON.stringify(paths)}`,
    );
  });
});

test("Firefox smoke: an allowlisted host is navigated to untouched", async () => {
  await withFirefox(async ({ driver, server }) => {
    const host = new URL(server.origin).hostname;
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
    await driver.executeAsyncScript((cb) => {
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
      }, () => cb());
    });
    const paths = await navigateFromPage(driver, server);
    assert.deepStrictEqual(paths, [CLEAN_PATH]);
  });
});
