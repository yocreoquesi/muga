/**
 * E2E: Consent migration sync → local (#406)
 *
 * Exercises the migration introduced by #355 in a real browser:
 *   - Legacy consent fields live in chrome.storage.sync (`onboardingDone`,
 *     `consentVersion`, `consentDate`).
 *   - On first SW wake post-upgrade, those fields are copied into
 *     chrome.storage.local under `mugaConsent` and removed from sync.
 *
 * The unit suite in tests/unit/sync-migration.test.mjs already covers
 * the pure logic exhaustively. This spec verifies the integration:
 * the SW exposes a __TEST__runConsentMigration handler (gated on the
 * test-mode sentinel) that drives the same migrateConsentToLocal()
 * production calls on startup, and the chrome.storage APIs in a real
 * browser produce the expected end-state.
 *
 * Each test seeds storage from a known clean slate, runs the migration
 * via the test-mode handler, and asserts on storage afterwards.
 *
 * Flake hazard, if you are reading this after a red run (#1216): the service
 * worker ALSO calls migrateConsentToLocal() from module scope and from its
 * startup handler, so a wake between seedStorage() and runMigration() puts two
 * migrations in flight over the same data. The report below is per-call, so an
 * overlap used to produce `ranWork: true, copiedToLocal: false` for a copy that
 * had in fact happened — the storage assertions stayed correct throughout,
 * only the report lied. #1216 made concurrent callers share one migration and
 * one report; tests/unit/sync-migration.test.mjs pins that. If a report
 * assertion here fails again, check whether the worker completed a migration
 * on its own before the explicit call rather than alongside it.
 *
 * Flake hazard #2 (#1231): every launched context is a fresh install, so
 * `recordImplicitAcceptOnInstall()` (service-worker.js) fires on EVERY test
 * and writes `mugaConsent` to chrome.storage.local asynchronously, outside
 * this file's control. `clearAllStorage()` in beforeEach does not cancel a
 * write already in flight — if it lands after the clear, the explicit
 * migration below sees a local record that was never seeded by this test
 * (`copiedToLocal: false` when `true` was expected, or a stray
 * `consentVersion: "1.5"` — that is TERMS_VERSION, not a seeded value).
 * `waitForInstallSettled()` (fixtures.mjs) is the barrier: it blocks until
 * that write has landed, so clearAllStorage() always runs after it rather
 * than racing it.
 */

import { test, expect, waitForInstallSettled } from "./fixtures.mjs";
import {
  seedStorage,
  installTestModeSentinel,
  clearTestModeSentinel,
} from "./helpers/index.mjs";

const LEGACY_KEYS = ["onboardingDone", "consentVersion", "consentDate"];

async function runMigration(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  const result = await page.evaluate(() =>
    new Promise(resolve => {
      chrome.runtime.sendMessage({ type: "__TEST__runConsentMigration" }, resolve);
    })
  );
  if (opened) await page.close();
  return result;
}

async function readStorage(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  const result = await page.evaluate((legacyKeys) =>
    new Promise(resolve => {
      chrome.storage.sync.get(legacyKeys, sync => {
        chrome.storage.local.get({ mugaConsent: null }, local => {
          resolve({ sync, local });
        });
      });
    }), LEGACY_KEYS
  );
  if (opened) await page.close();
  return result;
}

async function clearAllStorage(context, extensionId) {
  const extOrigin = `chrome-extension://${extensionId}`;
  let page = context.pages().find(p => p.url().startsWith(extOrigin));
  let opened = false;
  if (!page) {
    page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);
    opened = true;
  }
  // #1231: wait for the install-time implicit-accept write to land BEFORE
  // clearing, using this SAME page — no page beyond the one this function
  // already opens-if-needed/closes-if-opened. An earlier version of this
  // fix waited from a page the caller opened separately and then left open
  // for the rest of the test; that changed how many extension pages exist
  // at any given moment relative to main, which was enough to intermittently
  // break the unrelated `context.waitForEvent("page")` race in
  // popup.spec.mjs's "settings link opens options page" test, elsewhere in
  // the same serial suite. Folding the wait into the page this function was
  // going to open (and close) anyway keeps the page-lifecycle shape
  // identical to main.
  await waitForInstallSettled(page);
  await page.evaluate(() =>
    Promise.all([
      new Promise(resolve => chrome.storage.sync.clear(resolve)),
      new Promise(resolve => chrome.storage.local.clear(resolve)),
    ])
  );
  if (opened) await page.close();
}

test.describe("Consent migration: sync → local (#406)", () => {
  test.beforeEach(async ({ context, extensionId }) => {
    // waitForInstallSettled() runs inside clearAllStorage (above), on the
    // same page that function already manages, BEFORE the clear itself —
    // see the "Flake hazard #2" docblock above for why the wait has to
    // happen before this clear runs at all.
    await clearAllStorage(context, extensionId);
    await installTestModeSentinel(context, extensionId);
  });

  test.afterEach(async ({ context, extensionId }) => {
    await clearTestModeSentinel(context, extensionId);
  });

  test("legacy sync state migrates to local on first run", async ({ context, extensionId }) => {
    const ts = Date.now();
    await seedStorage(context, extensionId, {
      sync: { onboardingDone: true, consentVersion: "1.0", consentDate: ts },
    });

    const report = await runMigration(context, extensionId);
    expect(report.ok).toBe(true);
    expect(report.ranWork).toBe(true);
    expect(report.copiedToLocal).toBe(true);
    expect(report.cleanedSync).toBe(true);

    const { sync, local } = await readStorage(context, extensionId);
    expect(local.mugaConsent).toMatchObject({
      onboardingDone: true,
      consentVersion: "1.0",
      consentDate: ts,
    });
    for (const key of LEGACY_KEYS) {
      expect(sync[key]).toBeUndefined();
    }
  });

  test("fresh install (no legacy sync) is a no-op", async ({ context, extensionId }) => {
    const report = await runMigration(context, extensionId);
    expect(report.ok).toBe(true);
    expect(report.ranWork).toBe(false);
    expect(report.copiedToLocal).toBe(false);
    expect(report.cleanedSync).toBe(false);

    const { local } = await readStorage(context, extensionId);
    expect(local.mugaConsent).toBeNull();
  });

  test("idempotent: running twice leaves the same end state", async ({ context, extensionId }) => {
    const ts = Date.now();
    await seedStorage(context, extensionId, {
      sync: { onboardingDone: true, consentVersion: "1.0", consentDate: ts },
    });

    const first = await runMigration(context, extensionId);
    expect(first.ranWork).toBe(true);

    const second = await runMigration(context, extensionId);
    expect(second.ok).toBe(true);
    expect(second.ranWork).toBe(false);
    expect(second.copiedToLocal).toBe(false);

    const { sync, local } = await readStorage(context, extensionId);
    expect(local.mugaConsent.onboardingDone).toBe(true);
    expect(local.mugaConsent.consentVersion).toBe("1.0");
    expect(local.mugaConsent.consentDate).toBe(ts);
    for (const key of LEGACY_KEYS) {
      expect(sync[key]).toBeUndefined();
    }
  });

  test("conflict: local wins when both stores hold consent state", async ({ context, extensionId }) => {
    const localTs = 1700000000000;
    const syncTs = 1600000000000;
    // Seed local with this device's authoritative state.
    await seedStorage(context, extensionId, {
      local: {
        mugaConsent: { onboardingDone: true, consentVersion: "1.0", consentDate: localTs },
      },
      sync: { onboardingDone: true, consentVersion: "0.9", consentDate: syncTs },
    });

    const report = await runMigration(context, extensionId);
    expect(report.ok).toBe(true);
    expect(report.ranWork).toBe(true);
    expect(report.copiedToLocal).toBe(false);  // local was already populated
    expect(report.cleanedSync).toBe(true);

    const { sync, local } = await readStorage(context, extensionId);
    expect(local.mugaConsent.consentVersion).toBe("1.0");
    expect(local.mugaConsent.consentDate).toBe(localTs);
    for (const key of LEGACY_KEYS) {
      expect(sync[key]).toBeUndefined();
    }
  });

  test("partial sync state migrates with sensible defaults", async ({ context, extensionId }) => {
    // Only onboardingDone present in sync — older legacy installs that
    // never wrote consentVersion / consentDate.
    await seedStorage(context, extensionId, {
      sync: { onboardingDone: true },
    });

    const report = await runMigration(context, extensionId);
    expect(report.ok).toBe(true);
    expect(report.ranWork).toBe(true);
    expect(report.copiedToLocal).toBe(true);
    expect(report.cleanedSync).toBe(true);

    const { sync, local } = await readStorage(context, extensionId);
    expect(local.mugaConsent.onboardingDone).toBe(true);
    // Defaults from CONSENT_DEFAULTS — null, not undefined.
    expect(local.mugaConsent.consentVersion).toBeNull();
    expect(local.mugaConsent.consentDate).toBeNull();
    for (const key of LEGACY_KEYS) {
      expect(sync[key]).toBeUndefined();
    }
  });
});
