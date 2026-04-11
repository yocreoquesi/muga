/**
 * E2E: Service worker
 *
 * Tests that the background service worker is running,
 * responds to messages, and handles preferences correctly.
 */

import { test, expect } from "./fixtures.mjs";

test.describe("Service worker", () => {
  test("service worker is registered and running", async ({ context }) => {
    const sw = context.serviceWorkers()[0] || (await context.waitForEvent("serviceworker"));
    expect(sw.url()).toContain("service-worker.js");
  });

  test("responds to getPrefs message", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const prefs = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "getPrefs" }, resolve);
      });
    });

    expect(prefs).toBeDefined();
    expect(typeof prefs.enabled).toBe("boolean");
    expect(typeof prefs.dnrEnabled).toBe("boolean");

    await page.close();
  });

  test("PROCESS_URL cleans a dirty URL", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    // Ensure extension is enabled
    await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.sync.set({ enabled: true, onboardingDone: true }, resolve);
      });
    });

    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: "PROCESS_URL",
            url: "https://example.com?utm_source=test&utm_medium=email&real=keep",
            skipStats: true,
          },
          resolve
        );
      });
    });

    expect(result).toBeDefined();
    // URL constructor normalizes path: example.com -> example.com/
    expect(result.cleanUrl).toMatch(/^https:\/\/example\.com\/?\?real=keep$/);
    expect(result.removedTracking).toContain("utm_source");
    expect(result.removedTracking).toContain("utm_medium");

    await page.close();
  });

  test("PROCESS_URL returns unchanged URL when clean", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "PROCESS_URL", url: "https://example.com?q=search&page=1", skipStats: true },
          resolve
        );
      });
    });

    expect(result).toBeDefined();
    expect(result.cleanUrl).toBe("https://example.com?q=search&page=1");
    expect(result.removedTracking).toHaveLength(0);

    await page.close();
  });

  test("PROCESS_URL handles non-HTTP schemes gracefully", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const result = await page.evaluate(() => {
      return new Promise((resolve) => {
        chrome.runtime.sendMessage(
          { type: "PROCESS_URL", url: "ftp://files.example.com/doc.pdf", skipStats: true },
          resolve
        );
      });
    });

    // Non-HTTP returns untouched
    expect(result).toBeDefined();
    expect(result.action).toBe("untouched");
    expect(result.removedTracking).toHaveLength(0);

    await page.close();
  });

  test("PROCESS_URL rejects oversized payloads", async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/popup/popup.html`);

    const result = await page.evaluate(() => {
      const hugeUrl = "https://example.com?" + "x".repeat(50_000);
      return new Promise((resolve) => {
        chrome.runtime.sendMessage({ type: "PROCESS_URL", url: hugeUrl, skipStats: true }, resolve);
      });
    });

    // Oversized returns error with cleanUrl: null
    expect(result).toBeDefined();
    expect(result.cleanUrl).toBeNull();
    expect(result.action).toBe("error");

    await page.close();
  });
});
