/**
 * Firefox smoke: referer-beacon-privacy PR 3 — Referer suppression
 * (task 3.3).
 *
 * Drives REAL headless Firefox via Selenium + geckodriver (see ./fixtures.mjs)
 * to prove the blocking `onBeforeSendHeaders` listener
 * (onBeforeSendHeadersSuppressReferer, src/background/service-worker.js)
 * actually removes the `Referer` header on the wire, not just in a unit-test
 * mirror (tests/unit/referer-beacon-privacy-ff.test.mjs).
 *
 * Two local HTTP servers on 127.0.0.1 (different ports = different origins,
 * so the browser attaches a cross-origin Referer by default): one serves the
 * PAGE, the other is the request DESTINATION and records every request it
 * receives (method/path/headers) via serveCapturingServer.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { launchFirefoxWithExtension, completeOnboarding, setStorageSync, teardown, FIXED_EXTENSION_UUID } from "./fixtures.mjs";
import { serveFixturePage, serveCapturingServer } from "./helpers/local-server.mjs";

function fetchPageHtml(destUrl) {
  return `<!doctype html><html><body>
  <p id="page-content">Real page content</p>
  <script>
    window.__fetchDone = false;
    fetch(${JSON.stringify(destUrl)}, { mode: "no-cors" })
      .then(() => { window.__fetchDone = true; })
      .catch(() => { window.__fetchDone = true; });
  </script>
</body></html>`;
}

async function pollUntil(driver, predicateFn, { timeoutMs = 10000, intervalMs = 200 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await driver.executeScript(predicateFn);
    if (result) return result;
    if (Date.now() > deadline) {
      throw new Error(`pollUntil timed out after ${timeoutMs}ms waiting on: ${predicateFn}`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

test("Firefox smoke: onBeforeSendHeaders removes Referer on a blocklisted host with the global toggle OFF", async () => {
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

    // Global toggle OFF, destination is bare-domain BLOCKLISTED — D2
    // force-suppress must still fire (the core precedence proof for FF).
    await setStorageSync(driver, extensionOrigin, {
      suppressReferer: false,
      blockBeacons: false,
      whitelist: [],
      blacklist: [destHost],
    });

    pageServer = await serveFixturePage(fetchPageHtml(destServer.url));
    await driver.get(pageServer.url);

    await pollUntil(driver, "return window.__fetchDone === true", { timeoutMs: 10000 });

    assert.strictEqual(destServer.requests.length, 1, "the destination server must have received exactly one request");
    const referer = destServer.requests[0].headers.referer || destServer.requests[0].headers.referrer;
    assert.strictEqual(referer, undefined, "Referer must be ABSENT on a blocklisted destination even with the global toggle OFF");
  } finally {
    if (pageServer) await pageServer.close();
    if (destServer) await destServer.close();
    await teardown(driver, extDir);
  }
});

test("Firefox smoke: onBeforeSendHeaders keeps Referer on an allowlisted host even with the global toggle ON", async () => {
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

    // Global toggle ON, destination is ALLOWLISTED — allowlist must win over
    // the global toggle (mirrors the Chrome DNR allow-rule precedence, D3).
    await setStorageSync(driver, extensionOrigin, {
      suppressReferer: true,
      blockBeacons: false,
      whitelist: [destHost],
      blacklist: [],
    });

    pageServer = await serveFixturePage(fetchPageHtml(destServer.url));
    await driver.get(pageServer.url);

    await pollUntil(driver, "return window.__fetchDone === true", { timeoutMs: 10000 });

    assert.strictEqual(destServer.requests.length, 1, "the destination server must have received exactly one request");
    const referer = destServer.requests[0].headers.referer || destServer.requests[0].headers.referrer;
    assert.ok(referer, "Referer must be PRESENT on an allowlisted destination even with the global toggle ON");
  } finally {
    if (pageServer) await pageServer.close();
    if (destServer) await destServer.close();
    await teardown(driver, extDir);
  }
});
