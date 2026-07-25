/**
 * Firefox smoke: referer-beacon-privacy PR 3 — beacon block (task 3.4).
 *
 * Drives REAL headless Firefox via Selenium + geckodriver (see ./fixtures.mjs)
 * to prove the blocking `onBeforeRequest` listener filtered to
 * `types:["ping","beacon"]` (onBeforeRequestBlockBeacons,
 * src/background/service-worker.js) actually cancels `navigator.sendBeacon()`
 * traffic on the wire, not just in a unit-test mirror
 * (tests/unit/referer-beacon-privacy-ff.test.mjs). Firefox emits a distinct
 * "beacon" resourceType for `sendBeacon()` (reserving "ping" for `<a ping>`),
 * unlike Chrome which folds both into "ping" — this smoke test is exactly what
 * caught that; sendBeacon() is used here because it fires without a
 * user-gesture-driven navigation.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, setStorageSync, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage, serveCapturingServer } from "./helpers/local-server.mjs";

function beaconPageHtml(destUrl) {
  return `<!doctype html><html><body>
  <p id="page-content">Real page content</p>
  <script>
    window.__beaconSent = navigator.sendBeacon(${JSON.stringify(destUrl)}, "ping-payload");
  </script>
</body></html>`;
}

async function pollUntilRequestArrives(server, { timeoutMs = 3000, intervalMs = 150 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (server.requests.length === 0) {
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  return true;
}

test("Firefox smoke: onBeforeRequest cancels a ping-type request (sendBeacon) on a blocklisted host", async () => {
  let driver;
  let extDir;
  let pageServer;
  let destServer;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    destServer = await serveCapturingServer();
    const destHost = new URL(destServer.origin).hostname;

    // Global toggle OFF, destination BLOCKLISTED — D2 force-block must still
    // fire even though blockBeacons itself is off.
    await setStorageSync(driver, extensionOrigin, {
      suppressReferer: false,
      blockBeacons: false,
      whitelist: [],
      blacklist: [destHost],
    });

    pageServer = await serveFixturePage(beaconPageHtml(destServer.url));
    await driver.get(pageServer.url);

    // LOW-2-style residual limit (see didomi.smoke.mjs): a wrongly-open gate
    // could let the beacon through slowly; poll the whole window and fail if
    // it EVER arrives. A beacon slower than this window is the acknowledged
    // residual limit of a poll-based proof (no observable "was cancelled"
    // signal exists client-side for a webRequest-blocked request).
    const arrived = await pollUntilRequestArrives(destServer, { timeoutMs: 3000 });
    assert.strictEqual(arrived, false, "the beacon must be CANCELLED on a blocklisted destination, never reaching the server");

    const beaconSent = await driver.executeScript("return window.__beaconSent");
    assert.strictEqual(beaconSent, true, "sendBeacon() itself must return true (queued) — the block happens at the network layer, not the API call");
  } finally {
    if (pageServer) await pageServer.close();
    if (destServer) await destServer.close();
    await teardown(driver, extDir);
  }
});

test("Firefox smoke: onBeforeRequest does NOT cancel a ping-type request (sendBeacon) on an exempt (allowlisted) host", async () => {
  let driver;
  let extDir;
  let pageServer;
  let destServer;

  try {
    ({ driver, extDir } = await launchFirefoxWithExtension());
    const extensionOrigin = `moz-extension://${FIXED_EXTENSION_UUID}`;

    await completeOnboarding(driver, extensionOrigin, { enableFeature: true });

    destServer = await serveCapturingServer();
    const destHost = new URL(destServer.origin).hostname;

    // Global toggle ON, destination ALLOWLISTED — allowlist must win over the
    // global toggle (mirrors the Chrome DNR allow-rule precedence, D3).
    await setStorageSync(driver, extensionOrigin, {
      suppressReferer: false,
      blockBeacons: true,
      whitelist: [destHost],
      blacklist: [],
    });

    pageServer = await serveFixturePage(beaconPageHtml(destServer.url));
    await driver.get(pageServer.url);

    const arrived = await pollUntilRequestArrives(destServer, { timeoutMs: 10000 });
    assert.strictEqual(arrived, true, "the beacon must reach the server on an exempt (allowlisted) destination even with blockBeacons ON");
    assert.strictEqual(destServer.requests.length, 1);
  } finally {
    if (pageServer) await pageServer.close();
    if (destServer) await destServer.close();
    await teardown(driver, extDir);
  }
});
