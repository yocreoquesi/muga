/**
 * MUGA E2E helper — service-worker lifecycle control (#398)
 *
 * Two complementary tools for testing what happens when the service
 * worker is unresponsive:
 *
 *   killServiceWorker(context)
 *     Best-effort termination of the active SW via Chrome DevTools
 *     Protocol. The SW may respawn on the next event; tests asserting
 *     "SW death is non-fatal for user-facing navigation" should kill
 *     and immediately exercise the user-facing path.
 *
 *   simulateUnresponsiveSW(page)
 *     Page-side override of chrome.runtime.sendMessage that never
 *     resolves. Lighter and more reliable than real termination —
 *     simulates the *symptom* (no message response) without actually
 *     stopping the worker. Use this when the test only needs to
 *     verify "user-facing path doesn't block on the SW".
 *
 * Most tests should prefer simulateUnresponsiveSW. Use killServiceWorker
 * only when the SW's own state (e.g. session storage) needs to be
 * gone too.
 */

/**
 * Attempts to terminate the currently-running service worker via CDP.
 * Returns when the request is sent; the SW may take a moment to die
 * and may respawn on the next chrome.runtime event.
 */
export async function killServiceWorker(context) {
  const sw = context.serviceWorkers()[0];
  if (!sw) return;
  // Approach 1: ask the SW to unregister itself. This forces a kill
  // cycle even if the browser would otherwise keep it alive.
  try {
    await sw.evaluate(() => {
      // self.registration.unregister() schedules unregistration after
      // current tasks; call it inside a microtask boundary so the SW
      // doesn't try to send back a response after it's gone.
      Promise.resolve().then(() => self.registration.unregister().catch(() => {}));
    });
  } catch {
    // SW may already be terminated; ignore.
  }
}

/**
 * Overrides chrome.runtime.sendMessage in the page's content script
 * world to never resolve. Returns a teardown function that restores
 * the original.
 *
 * Caveats:
 *   - This affects messages sent FROM the page (or content script
 *     in the same world). Messages from the SW itself are unaffected.
 *   - Override is per-page; tests using this on multiple pages must
 *     install per page.
 */
export async function simulateUnresponsiveSW(page) {
  await page.evaluate(() => {
    if (window.__muga_orig_sendMessage) return; // already installed
    window.__muga_orig_sendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = () => new Promise(() => { /* never resolves */ });
  });
  return async () => {
    await page.evaluate(() => {
      if (window.__muga_orig_sendMessage) {
        chrome.runtime.sendMessage = window.__muga_orig_sendMessage;
        delete window.__muga_orig_sendMessage;
      }
    });
  };
}
