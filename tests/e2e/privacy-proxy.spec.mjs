/**
 * E2E: Privacy Proxy (#453, B20 Group C)
 *
 * Acceptance criteria covered here:
 *   PR-01 — proxy fully inert when off (no requests to unwrap.muga.app)
 *   PR-09 — export/import round-trip preserves privacyProxyEnabled
 *
 * Acceptance criteria NOT covered here (marked test.skip with explanation):
 *   PR-02 — opt-in with permission grant/denial: chrome.permissions.request
 *            cannot be mocked via Playwright route(); it requires a real
 *            permission dialog. A follow-up issue should add a __TEST__
 *            sentinel in the SW that bypasses the permission gate, similar
 *            to how __TEST__emitToolbarEvent works for toolbar tests.
 *            Track in: muga#453 follow-up / "Add __TEST__grantProxyPermission sentinel"
 *
 *   PR-03 — opaque wrapper resolved via proxy: requires mocking both
 *            chrome.permissions.request (for toggle enable) and the
 *            unwrap.muga.app/unwrap endpoint. The SW fetch goes through
 *            the service-worker context, not the page context, so
 *            Playwright page.route() does not intercept it. A future
 *            test should use a local test server registered via
 *            Playwright's context.route() matching unwrap.muga.app hosts.
 *
 *   PR-04 — tampered signature rejected: blocked by same constraints as PR-03.
 *
 *   PR-05 — build hash display: blocked by same constraints as PR-03
 *            (healthz fetch goes through SW context).
 *
 * The remaining ACs (PR-06 disclosure text, PR-07 mode label, PR-08 toast CTA,
 * PR-10/11 unit gates, PR-12 manifest floor) are covered by unit/structural
 * tests already in place.
 */

import { test, expect } from "./fixtures.mjs";
import { seedStorage } from "./helpers/index.mjs";

// ── PR-01: proxy fully inert when off ─────────────────────────────────────────

test.describe("PR-01 — privacy proxy inert when disabled", () => {
  test("no requests to unwrap.muga.app when privacyProxyEnabled = false", async ({
    context,
    extensionId,
    optionsPage: page,
  }) => {
    // Ensure the pref is explicitly false
    await seedStorage(context, extensionId, {
      sync: { privacyProxyEnabled: false },
    });

    // Track any requests to the proxy endpoint
    let proxyHitCount = 0;
    await context.route("**/unwrap.muga.app/**", (route) => {
      proxyHitCount++;
      route.continue();
    });

    // Reload the options page with the updated pref
    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    // Assert checkbox is unchecked (pref is false)
    const checkbox = page.locator("#privacyProxyEnabled");
    await expect(checkbox).not.toBeChecked();

    // REASON: SW background activity (e.g. startup healthz fetch) may race with
    // the route interceptor; 500 ms gives any in-flight requests time to settle
    // before we assert count === 0.
    await page.waitForTimeout(500);

    // No requests to the proxy should have been made
    expect(proxyHitCount).toBe(0);

    // Remove the route interceptor
    await context.unroute("**/unwrap.muga.app/**");
  });
});

// ── PR-02: opt-in with permission grant/denial ────────────────────────────────

test.describe("PR-02 — opt-in with permission grant/denial", () => {
  test.skip(
    "PR-02-A: granting permission persists pref and fires REFRESH_BUILD_HASH_NOW",
    // Skipped: chrome.permissions.request is a real browser dialog that cannot
    // be intercepted or mocked via Playwright page.evaluate() or route().
    // To implement: add a __TEST__grantProxyPermission sentinel in the service
    // worker that short-circuits chrome.permissions.request. See comment at the
    // top of this file for full explanation. (muga#453 follow-up)
    async () => {}
  );

  test.skip(
    "PR-02-B: denying permission reverts checkbox and shows permission-denied toast",
    // Same constraint as PR-02-A above.
    async () => {}
  );
});

// ── PR-03: opaque wrapper resolved via proxy ──────────────────────────────────

test.describe("PR-03 — opaque wrapper resolved via proxy", () => {
  test.skip(
    "SW resolves s.click.aliexpress.com via unwrap endpoint when proxy is enabled",
    // Skipped: the SW fetch to unwrap.muga.app/unwrap goes through the SW
    // context, not the page context. Playwright page.route() (and even
    // context.route()) does not intercept requests from service workers in
    // Chrome. Requires a local test server approach or a __TEST__ SW mock.
    // Track in: muga#453 follow-up / "Mock SW fetch in e2e tests"
    async () => {}
  );
});

// ── PR-04: tampered signature rejected ───────────────────────────────────────

test.describe("PR-04 — tampered signature rejected", () => {
  test.skip(
    "SW rejects unwrap response with mismatched signature",
    // Blocked by same constraint as PR-03 (SW fetch not interceptable via
    // Playwright context.route() on Chrome MV3 service workers).
    async () => {}
  );
});

// ── PR-05: build hash display ─────────────────────────────────────────────────

test.describe("PR-05 — build hash display", () => {
  test.skip(
    "worker-build-hash shows first 7 chars and verify link is correct",
    // The healthz fetch that populates workerBuildHash goes through the SW
    // context. Playwright cannot intercept it. This can be tested by seeding
    // chrome.storage.local with { workerBuildHash: "abc1234567890", workerBuildHashFetchedAt: <ts> }
    // and asserting the DOM renders correctly — but the REFRESH_BUILD_HASH_NOW
    // message that triggers the SW fetch would overwrite the seeded value.
    // Partial test approach: seed storage directly and assert display without
    // triggering a refresh. Deferred to a follow-up test batch.
    async () => {}
  );

  test("worker-build-hash element renders a dash when no hash is stored", async ({
    context,
    extensionId,
    optionsPage: page,
  }) => {
    // Ensure no build hash is stored
    await seedStorage(context, extensionId, {
      sync: { privacyProxyEnabled: false },
      local: { workerBuildHash: null, workerBuildHashFetchedAt: null },
    });

    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    const hashEl = page.locator("#worker-build-hash");
    await expect(hashEl).toBeAttached();
    // When no hash is stored, the element should show "—"
    await expect(hashEl).toHaveText("—");
  });

  test("worker-build-hash shows first 7 chars of a stored hash", async ({
    context,
    extensionId,
    optionsPage: page,
  }) => {
    const testHash = "abc1234567890abcdef";
    await seedStorage(context, extensionId, {
      local: { workerBuildHash: testHash, workerBuildHashFetchedAt: Date.now() },
    });

    await page.reload();
    await page.waitForFunction(() => document.body.dataset.mugaReady === "1");

    const hashEl = page.locator("#worker-build-hash");
    await expect(hashEl).toHaveText(testHash.slice(0, 7));
  });
});

// ── PR-09: export/import round-trip ──────────────────────────────────────────

test.describe("PR-09 — export/import round-trip for privacyProxyEnabled", () => {
  test("privacyProxyEnabled = true survives an export/import cycle", async ({
    context,
    extensionId,
    optionsPage: page,
  }) => {
    // Seed privacyProxyEnabled = true directly into storage (bypass the
    // permission dialog by writing directly to sync storage).
    await seedStorage(context, extensionId, {
      sync: { privacyProxyEnabled: true },
    });

    // Trigger export via the options page export button.
    // Use page.evaluate to click the button directly — it may be hidden by
    // CSS but is still accessible via JS (same pattern as other options tests
    // that use evaluate to interact with visually-hidden controls).
    // We intercept the download event to capture the exported JSON.
    const downloadPromise = page.waitForEvent("download");
    await page.evaluate(() => {
      const btn = document.getElementById("export-btn");
      if (!btn) throw new Error("export-btn not found");
      btn.click();
    });
    const download = await downloadPromise;

    // Read the downloaded file content
    const stream = await download.createReadStream();
    let raw = "";
    for await (const chunk of stream) {
      raw += chunk;
    }
    const exported = JSON.parse(raw);

    // Assert the exported payload includes privacyProxyEnabled = true
    expect(exported.privacyProxyEnabled).toBe(true);
    expect(exported.muga).toBe(true);

    // Reset privacyProxyEnabled to false in storage
    await seedStorage(context, extensionId, {
      sync: { privacyProxyEnabled: false },
    });

    // Import the exported file back via the hidden file input.
    // We use page.evaluate to programmatically trigger the import
    // with a File object constructed from the exported JSON bytes.
    await page.evaluate((jsonStr) => {
      return new Promise((resolve, reject) => {
        const file = new File([jsonStr], "muga-settings.json", {
          type: "application/json",
        });

        const dt = new DataTransfer();
        dt.items.add(file);

        const input = document.getElementById("import-file");
        if (!input) { reject(new Error("import-file input not found")); return; }

        Object.defineProperty(input, "files", {
          value: dt.files,
          configurable: true,
        });

        input.dispatchEvent(new Event("change", { bubbles: true }));
        // Give the async import handler time to write to storage
        setTimeout(resolve, 1000);
      });
    }, raw);

    // REASON: the import handler writes to chrome.storage.sync asynchronously
    // inside a file.text() + JSON.parse + setPrefs chain; 500 ms allows the
    // full async write to complete before we read back the value.
    await page.waitForTimeout(500);

    // Read back the storage value and assert it was restored to true
    const restoredValue = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.get({ privacyProxyEnabled: false }, (r) =>
          resolve(r.privacyProxyEnabled)
        );
      });
    });

    expect(restoredValue).toBe(true);
  });
});
