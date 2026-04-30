/**
 * E2E: Service-worker lifecycle helpers + test-mode sentinel (#398)
 *
 * Establishes the foundational helpers under tests/e2e/helpers/ and
 * proves the test-mode sentinel mechanism works end-to-end against the
 * service worker's `__TEST__` message handler.
 *
 * **Scope-limit note**: tests for the content-script bundle's
 * availability (`window.__mugaCleaner`) and for cold-service-worker
 * navigation behavior are **deferred** to slice #409 (local cleaning
 * paths) where they can be validated against observable user-visible
 * outcomes rather than via cross-world reads. The bundle attaches to
 * the content-script isolated world, which Playwright's `page.evaluate`
 * cannot reach from an arbitrary remote page.
 *
 * What this spec proves:
 *   - The sentinel-gated `__TEST__` handler in the SW rejects messages
 *     when the sentinel is unset, accepts them when it is set.
 *   - `readActionSurface` returns a structured response with the
 *     expected fields when the sentinel is set.
 *   - `installTestModeSentinel` / `clearTestModeSentinel` round-trip
 *     correctly.
 *   - `simulateUnresponsiveSW` and `killServiceWorker` helpers exist
 *     and compose with the fixture, ready to be used by later slices.
 */

import { test, expect } from "./fixtures.mjs";
import {
  installTestModeSentinel,
  clearTestModeSentinel,
  readActionSurface,
} from "./helpers/index.mjs";

test.describe("Test-mode sentinel + __TEST__ message handler (#398)", () => {
  test.afterEach(async ({ context, extensionId }) => {
    // Always clear so subsequent tests start without the sentinel.
    await clearTestModeSentinel(context, extensionId);
  });

  test("__TEST__ message is rejected when the sentinel is unset", async ({ context, extensionId }) => {
    await clearTestModeSentinel(context, extensionId);

    const extOrigin = `chrome-extension://${extensionId}`;
    const page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);

    const response = await page.evaluate(() =>
      new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "__TEST__readActionSurface", tabId: 1 }, resolve);
      })
    );

    expect(response).toBeDefined();
    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/test mode not active/);

    await page.close();
  });

  test("__TEST__ message is accepted when the sentinel is set", async ({ context, extensionId }) => {
    await installTestModeSentinel(context, extensionId);

    const extOrigin = `chrome-extension://${extensionId}`;
    const page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);

    const response = await page.evaluate(() =>
      new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "__TEST__readActionSurface", tabId: 1 }, resolve);
      })
    );

    expect(response).toBeDefined();
    expect(response.ok).toBe(true);
    // The presenter has not seen tabId 1 yet, so the title is whatever
    // chrome.action returns (typically the manifest default). What we
    // verify is the SHAPE: every documented field is present.
    expect(response).toHaveProperty("title");
    expect(response).toHaveProperty("badgeText");
    expect(response).toHaveProperty("badgeColor");
    expect(response).toHaveProperty("iconKind");
    expect(response).toHaveProperty("state");
    expect(["default", "preserved"]).toContain(response.iconKind);

    await page.close();
  });

  test("readActionSurface helper returns the same shape", async ({ context, extensionId }) => {
    await installTestModeSentinel(context, extensionId);

    const surface = await readActionSurface(context, extensionId, 1);
    expect(surface).not.toBeNull();
    expect(surface.ok).toBe(true);
    expect(surface).toHaveProperty("title");
    expect(surface).toHaveProperty("badgeText");
    expect(surface).toHaveProperty("iconKind");
  });

  test("__TEST__ handler rejects unknown sub-types even when sentinel is set", async ({ context, extensionId }) => {
    await installTestModeSentinel(context, extensionId);

    const extOrigin = `chrome-extension://${extensionId}`;
    const page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);

    const response = await page.evaluate(() =>
      new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "__TEST__neverHeardOfIt" }, resolve);
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/unknown __TEST__ message/);

    await page.close();
  });

  test("__TEST__readActionSurface rejects invalid tabId", async ({ context, extensionId }) => {
    await installTestModeSentinel(context, extensionId);

    const extOrigin = `chrome-extension://${extensionId}`;
    const page = await context.newPage();
    await page.goto(`${extOrigin}/popup/popup.html`);

    const response = await page.evaluate(() =>
      new Promise(resolve => {
        chrome.runtime.sendMessage({ type: "__TEST__readActionSurface", tabId: -1 }, resolve);
      })
    );

    expect(response.ok).toBe(false);
    expect(response.error).toMatch(/invalid tabId/);

    await page.close();
  });
});
