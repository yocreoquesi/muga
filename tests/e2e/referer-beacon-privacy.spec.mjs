/**
 * E2E: Referer & Beacon Privacy — real-Chromium proof (referer-beacon-privacy
 * PR 4, Phase 5, MANDATORY per design.md D3/D6).
 *
 * `modifyHeaders remove referer` and `action: "block"` on `resourceTypes:
 * ["ping"]` are both thinly documented for Chromium's real network stack —
 * the same "docs are thin, verify empirically" lesson already burned this
 * codebase twice (the RE2/regexFilter Chrome DNR memory-limit gotcha, and the
 * Firefox ping-vs-beacon resourceType split caught in PR 3's mandatory FF
 * smoke). A passing unit test (tests/unit/referer-beacon-privacy-dnr.test.mjs)
 * only proves the RULE SHAPE is correct, never that Chromium actually applies
 * it to a real request. These specs are that proof.
 *
 * Two local HTTP servers on 127.0.0.1 (different ports = different origins,
 * so the browser attaches a cross-origin Referer by default): one serves the
 * PAGE, the other is the request DESTINATION and records every request it
 * receives (method/path/headers) via serveCapturingServer. Both servers bind
 * to the SAME hostname (127.0.0.1) — MUGA's domain-only allowlist/blacklist
 * matching is by hostname, not host:port (confirmed in the PR 3 Firefox
 * smoke suite), so seeding the allow/blocklist with that bare hostname
 * exempts/targets the destination the same way a real second-level domain
 * would.
 */

import { test, expect } from "./fixtures.mjs";
import { TERMS_VERSION } from "../../src/lib/consent-storage.js";
import { serveFixturePage, serveCapturingServer } from "./helpers/local-server.mjs";

/** Completes onboarding directly via storage (mirrors hot-path-query-splice.spec.mjs). */
async function completeOnboarding(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  // Passed as an argument, not closed over: this callback is serialised and
  // runs inside the page, where the Node-scope TERMS_VERSION import does not
  // exist (referencing it there throws and destroys the execution context).
  await page.evaluate(
    (termsVersion) =>
      new Promise((resolve) => {
        chrome.storage.sync.set({ enabled: true, onboardingDone: true }, () => {
          chrome.storage.local.set(
            { mugaConsent: { onboardingDone: true, consentVersion: termsVersion, consentDate: Date.now() } },
            resolve
          );
        });
      }),
    TERMS_VERSION
  );
  await page.close();
}

/**
 * Seeds the referer/beacon privacy prefs directly in chrome.storage.sync,
 * then waits out the DNR-propagation debt window (#824, dnr-propagation.mjs)
 * before the caller navigates — the storage write resolves durable before
 * the service worker's prefs cache + DNR rule table have actually updated.
 */
async function setPrivacyPrefs(context, extensionId, prefs) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);
  await page.evaluate((p) => new Promise((resolve) => chrome.storage.sync.set(p, resolve)), prefs);
  await page.close();
  await new Promise((r) => setTimeout(r, 500));
}

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

function beaconPageHtml(destUrl) {
  return `<!doctype html><html><body>
  <p id="page-content">Real page content</p>
  <script>
    window.__beaconQueued = navigator.sendBeacon(${JSON.stringify(destUrl)});
  </script>
</body></html>`;
}

/** Polls a real Node-side condition (not page-side) for up to timeoutMs. */
async function pollUntil(fn, { timeoutMs = 5000, intervalMs = 100 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (fn()) return true;
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

test.describe("Referer & Beacon Privacy — real-Chromium E2E (Phase 5, mandatory)", () => {
  test("5.1: suppressReferer ON, cross-origin request to a plain domain -> Referer ABSENT on the wire", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
    const destServer = await serveCapturingServer();
    let pageServer;
    try {
      await setPrivacyPrefs(context, extensionId, {
        suppressReferer: true,
        blockBeacons: false,
        whitelist: [],
        blacklist: [],
      });

      pageServer = await serveFixturePage(fetchPageHtml(destServer.url));
      const page = await context.newPage();
      await page.goto(pageServer.url);
      await page.waitForFunction(() => window.__fetchDone === true);

      const arrived = await pollUntil(() => destServer.requests.length > 0);
      expect(arrived, "destination server must have received exactly one request").toBe(true);
      expect(destServer.requests.length).toBe(1);
      expect(destServer.requests[0].headers.referer, "Referer must be ABSENT with suppressReferer ON").toBeUndefined();
      await page.close();
    } finally {
      if (pageServer) await pageServer.close();
      await destServer.close();
    }
  });

  test("5.2: same request to an ALLOWLISTED destination with the toggle ON -> Referer PRESENT (allowlist wins)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
    const destServer = await serveCapturingServer();
    const destHost = new URL(destServer.origin).hostname;
    let pageServer;
    try {
      await setPrivacyPrefs(context, extensionId, {
        suppressReferer: true,
        blockBeacons: false,
        whitelist: [destHost],
        blacklist: [],
      });

      pageServer = await serveFixturePage(fetchPageHtml(destServer.url));
      const page = await context.newPage();
      await page.goto(pageServer.url);
      await page.waitForFunction(() => window.__fetchDone === true);

      const arrived = await pollUntil(() => destServer.requests.length > 0);
      expect(arrived, "destination server must have received exactly one request").toBe(true);
      expect(destServer.requests.length).toBe(1);
      expect(destServer.requests[0].headers.referer, "Referer must be PRESENT on an allowlisted destination even with the toggle ON").toBeTruthy();
      await page.close();
    } finally {
      if (pageServer) await pageServer.close();
      await destServer.close();
    }
  });

  test("5.3: global toggle OFF, plain domain -> Referer PRESENT (baseline)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
    const destServer = await serveCapturingServer();
    let pageServer;
    try {
      await setPrivacyPrefs(context, extensionId, {
        suppressReferer: false,
        blockBeacons: false,
        whitelist: [],
        blacklist: [],
      });

      pageServer = await serveFixturePage(fetchPageHtml(destServer.url));
      const page = await context.newPage();
      await page.goto(pageServer.url);
      await page.waitForFunction(() => window.__fetchDone === true);

      const arrived = await pollUntil(() => destServer.requests.length > 0);
      expect(arrived, "destination server must have received exactly one request").toBe(true);
      expect(destServer.requests.length).toBe(1);
      expect(destServer.requests[0].headers.referer, "Referer must be PRESENT at baseline (toggle OFF, not blocklisted)").toBeTruthy();
      await page.close();
    } finally {
      if (pageServer) await pageServer.close();
      await destServer.close();
    }
  });

  test("5.4: global toggle OFF, domain on the BLOCKLIST -> Referer ABSENT (blocklist force-suppress; the core D2 proof)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
    const destServer = await serveCapturingServer();
    const destHost = new URL(destServer.origin).hostname;
    let pageServer;
    try {
      await setPrivacyPrefs(context, extensionId, {
        suppressReferer: false,
        blockBeacons: false,
        whitelist: [],
        blacklist: [destHost],
      });

      pageServer = await serveFixturePage(fetchPageHtml(destServer.url));
      const page = await context.newPage();
      await page.goto(pageServer.url);
      await page.waitForFunction(() => window.__fetchDone === true);

      const arrived = await pollUntil(() => destServer.requests.length > 0);
      expect(arrived, "destination server must have received exactly one request").toBe(true);
      expect(destServer.requests.length).toBe(1);
      expect(
        destServer.requests[0].headers.referer,
        "Referer must be ABSENT on a blocklisted destination even with the global toggle OFF (D2)"
      ).toBeUndefined();
      await page.close();
    } finally {
      if (pageServer) await pageServer.close();
      await destServer.close();
    }
  });

  test("5.5a: blockBeacons ON -> sendBeacon() is blocked (never reaches the destination)", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
    const destServer = await serveCapturingServer();
    let pageServer;
    try {
      await setPrivacyPrefs(context, extensionId, {
        suppressReferer: false,
        blockBeacons: true,
        whitelist: [],
        blacklist: [],
      });

      pageServer = await serveFixturePage(beaconPageHtml(destServer.url));
      const page = await context.newPage();
      await page.goto(pageServer.url);
      await page.waitForFunction(() => window.__beaconQueued === true);

      // Blocked case: cannot early-exit on absence, must wait out the full window.
      await pollUntil(() => destServer.requests.length > 0, { timeoutMs: 3000 });
      expect(destServer.requests.length, "sendBeacon() must be BLOCKED with blockBeacons ON").toBe(0);
      await page.close();
    } finally {
      if (pageServer) await pageServer.close();
      await destServer.close();
    }
  });

  test("5.5b: blockBeacons ON but destination ALLOWLISTED -> beacon is allowed", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
    const destServer = await serveCapturingServer();
    const destHost = new URL(destServer.origin).hostname;
    let pageServer;
    try {
      await setPrivacyPrefs(context, extensionId, {
        suppressReferer: false,
        blockBeacons: true,
        whitelist: [destHost],
        blacklist: [],
      });

      pageServer = await serveFixturePage(beaconPageHtml(destServer.url));
      const page = await context.newPage();
      await page.goto(pageServer.url);
      await page.waitForFunction(() => window.__beaconQueued === true);

      const arrived = await pollUntil(() => destServer.requests.length > 0);
      expect(arrived, "beacon must reach an ALLOWLISTED destination even with blockBeacons ON").toBe(true);
      await page.close();
    } finally {
      if (pageServer) await pageServer.close();
      await destServer.close();
    }
  });

  test("5.5c: blockBeacons OFF but destination on the BLOCKLIST -> beacon is still blocked", async ({ context, extensionId }) => {
    await completeOnboarding(context, extensionId);
    const destServer = await serveCapturingServer();
    const destHost = new URL(destServer.origin).hostname;
    let pageServer;
    try {
      await setPrivacyPrefs(context, extensionId, {
        suppressReferer: false,
        blockBeacons: false,
        whitelist: [],
        blacklist: [destHost],
      });

      pageServer = await serveFixturePage(beaconPageHtml(destServer.url));
      const page = await context.newPage();
      await page.goto(pageServer.url);
      await page.waitForFunction(() => window.__beaconQueued === true);

      await pollUntil(() => destServer.requests.length > 0, { timeoutMs: 3000 });
      expect(destServer.requests.length, "blocklisted destination must block the beacon even with blockBeacons OFF (D2)").toBe(0);
      await page.close();
    } finally {
      if (pageServer) await pageServer.close();
      await destServer.close();
    }
  });
});
